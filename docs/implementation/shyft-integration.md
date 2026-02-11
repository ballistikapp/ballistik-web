# Shyft Integration

## Overview

Shyft provides multiple APIs for interacting with Solana data. The project uses the Shyft "Build" plan which includes gRPC streaming (Yellowstone + RabbitStream), REST APIs, Callbacks, and DeFi APIs. All Shyft features are opt-in: when `SHYFT_API_KEY` is not set, the system falls back to raw Solana RPC calls.

## Environment Variables

- `SHYFT_API_KEY` — enables all Shyft integrations (gRPC, REST, Callbacks, DeFi)
- `SHYFT_CALLBACK_SECRET` — validates incoming webhook requests at `/api/webhooks/shyft`
- `APP_URL` — base URL for Shyft callback webhook registration (e.g. `https://app.example.com`)

## gRPC Streaming

### Centralized Manager (`server/solana/grpc-manager.ts`)

A single `GrpcManager` instance manages one persistent gRPC connection and multiplexes subscriptions across features. It supports two endpoint types:

- **RabbitStream** — shred-level streaming with 15-100ms latency advantage, no transaction metadata. Used as default for fastest signature detection.
- **Yellowstone gRPC** — post-execution streaming with full transaction metadata.

The manager provides an event-driven API:

- `grpcManager.subscribe(id, accounts)` — register interest in accounts
- `grpcManager.unsubscribe(id)` — remove a subscription
- `grpcManager.onAccountUpdate(callback)` — listen for account changes (balance, token balance)
- `grpcManager.onTransactionUpdate(callback)` — listen for new transactions (signature + account keys)

Auto-reconnect with 5-second backoff is built in. The manager is a global singleton preserved across hot reloads in development.

### Shared Utilities (`server/solana/grpc-utils.ts`)

Common functions extracted from previously duplicated code:

- `normalizePublicKey()` / `normalizeSignature()` — handle various key formats (string, Uint8Array, Buffer)
- `extractSignatureFromUpdate()` — extract signature from gRPC transaction updates
- `extractAccountKeysFromUpdate()` — extract account keys from gRPC transaction updates
- `loadGrpcClient()` — dynamic import of `@triton-one/yellowstone-grpc`

### Feature-Specific Wrappers

- `volume-bot-grpc.ts` — delegates to grpc-manager, maintains per-session balance caches and pending transaction confirmations
- `token-transactions-grpc.ts` — delegates to grpc-manager, maintains per-token signature lists and parsed transaction caches
- `shyft-grpc.ts` — standalone short-lived gRPC connection for bundle confirmation (uses Yellowstone endpoint)

## tRPC Subscriptions (`server/trpc/routers/subscription.router.ts`)

Three SSE-based subscription endpoints push real-time data from gRPC streams to the client:

- `subscription.onBalanceUpdate` — streams SOL balance changes for a set of wallet addresses
- `subscription.onTokenBalanceUpdate` — streams token balance changes for wallets holding a specific token
- `subscription.onNewTransaction` — streams new transaction signatures for a token (mint + bonding curve accounts)

### Client Setup

The tRPC client uses a `splitLink` to route subscriptions to `httpSubscriptionLink` (SSE) and queries/mutations to `httpBatchLink`. See `lib/trpc/provider.tsx`.

### Fallback Behavior

When subscriptions are available, polling intervals are relaxed (e.g. live transactions poll every 30s instead of 2s). If the subscription connection fails, components fall back to aggressive polling automatically.

## Shyft REST APIs (`server/services/shyft-api.service.ts`)

Centralized client for Shyft REST endpoints at `https://api.shyft.to/sol/v1`:

- `getWalletBalance(address)` — SOL balance for a wallet
- `getAllTokens(address)` — all token balances with metadata (name, symbol, image, decimals)
- `getTokenBalance(wallet, token)` — single token balance with decimals
- `getTransactionHistory(account, options)` — pre-parsed transaction history
- `parseTransactions(signatures)` — batch parse up to 100 signatures
- `sendTransaction(encoded)` — submit transactions via Shyft dedicated nodes

### Usage in Services

- `wallet.service.ts` — uses `getWalletBalance()` for balance refresh (RPC fallback)
- `holding.service.ts` — uses `getAllTokens()` per wallet for bulk token balance refresh, filtering for the target mint (RPC fallback). This replaces the previous per-wallet `getTokenBalance()` approach.
- `transaction.service.ts` — uses `getTransactionHistory()` for signature fetching (RPC fallback)

## Shyft Callbacks (`server/services/shyft-callback.service.ts`)

Manages Shyft webhook registrations for passive event monitoring:

- `createAccountCallback()` — register for account balance changes
- `createTransactionCallback()` — register for parsed transaction events (SWAP, TOKEN_TRANSFER, SOL_TRANSFER)
- `removeCallback()` / `removeCallbacksByAddress()` / `removeCallbacksByProject()` — cleanup

Callbacks are tracked in the `ShyftCallback` Prisma model with the Shyft-assigned callback ID.

### Callback Automation

Callbacks are automatically registered and cleaned up across the lifecycle:

- **Token creation** (`token.service.ts`): registers account callbacks for the token mint address and its bonding curve PDA
- **Launch wallet creation** (`launch.service.ts`): registers transaction callbacks for bundler, distribution, and dev wallets (events: SWAP, TOKEN_TRANSFER, SOL_TRANSFER)
- **Volume bot reclaim** (`volume-bot-worker.ts`): removes callbacks for session wallet addresses during fund reclamation

All registrations require both `SHYFT_API_KEY` and `APP_URL` to be set. Failures are logged but do not block the parent operation.

### Webhook Endpoint (`app/api/webhooks/shyft/route.ts`)

- Validates `x-api-key` header against `SHYFT_CALLBACK_SECRET`
- Extracts affected wallet and token addresses from the callback payload
- Looks up associated wallets and tokens in the database
- Calls `refreshCacheService.touch()` with appropriate scopes:
  - `SWAP` / `TOKEN_TRANSFER` → `TRANSACTIONS` + `HOLDINGS`
  - `SOL_TRANSFER` → `WALLETS`
- This marks caches as stale, causing the next client query to trigger a server-side refresh

## Shyft DeFi APIs (`server/services/shyft-defi.service.ts`)

Client for DeFi pool data at `https://defi.shyft.to/v0`:

- `getPoolsByToken(address)` — all pools for a token across Raydium, Orca, Meteora, PumpSwap
- `getPoolsByPair(tokenA, tokenB)` — pools for a specific pair
- `getLiquidityDetails(pool)` — TVL, reserves, and price for a pool
- `getPoolInfo(pool)` — detailed pool information

### Dashboard Integration

The token dashboard displays DeFi pool data for graduated tokens (when `isComplete` is true):

- **Service**: `dashboard.service.ts` → `getDeFiPools()` calls `shyftDefiService.getPoolsByToken()`
- **Router**: `dashboard.router.ts` → `dashboard.getDefiPools` tRPC procedure
- **UI**: `dashboard-defi-pools.tsx` renders a "DeFi Pools" card showing:
  - Pool address (linked to Solscan)
  - DEX name (badge)
  - TVL and 24h volume
  - Token reserve breakdown
  - Fee rate
- Only shown when pools exist (post-graduation tokens)

## Caching

### Bonding Curve Cache (`server/solana/pump-quotes.ts`)

In-memory TTL cache for `fetchPumpQuoteState()`:

- Keyed by mint address
- 5-second TTL (configurable via `cacheConfig.ttlMs.bondingCurve`)
- Max 500 entries with LRU eviction
- Reduces redundant `getMultipleAccountsInfo` calls during rapid trading

### TanStack Query Tuning (`lib/trpc/provider.tsx`)

- Global `staleTime` set to 5 minutes for non-real-time data
- Per-query overrides for real-time feeds:
  - Live transactions: 10s staleTime when subscribed, 1s when polling
  - Volume bot status: 3s staleTime, 5s refetch interval

## Data Flow

```
Solana Network
  ├─> RabbitStream (fastest, no meta)
  │    └─> grpc-manager.ts
  │         ├─> AccountUpdate listeners
  │         │    ├─> volume-bot-grpc.ts (balance cache)
  │         │    ├─> launch.service.ts (mint confirmation, raced with RPC)
  │         │    └─> subscription.router.ts (SSE to client)
  │         └─> TransactionUpdate listeners
  │              ├─> token-transactions-grpc.ts (signature list)
  │              ├─> volume-bot-grpc.ts (tx confirmation)
  │              └─> subscription.router.ts (SSE to client)
  │
  └─> Shyft Callbacks (push, parsed events)
       └─> /api/webhooks/shyft (route.ts)
            └─> refreshCacheService.touch() → marks caches stale
                 └─> next client query triggers server-side refresh

Client
  └─> tRPC splitLink
       ├─> httpSubscriptionLink (SSE) → subscription.router.ts
       └─> httpBatchLink (HTTP) → feature routers → services → Shyft REST / RPC
```

## Region Selection

Both RabbitStream and Yellowstone gRPC endpoints are region-aware:

- `getRabbitStreamUrl(region)` — maps Vercel region to closest RabbitStream endpoint (AMS, VA, NY, FRA)
- `getDefaultShyftGrpcUrl(region)` — maps Vercel region to closest Yellowstone endpoint (7 regions)

See `lib/config/rpc.config.ts` for the full mapping.
