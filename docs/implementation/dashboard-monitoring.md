# Dashboard & Monitoring

## Overview

The token dashboard (`/[tokenPublicKey]/dashboard`) is the central monitoring page for a token. It displays real-time price, treasury balances, P&L, holdings breakdown, volume bot status, recent transactions, DeFi pool data, and a candlestick price chart.

### Data Source: TokenTransaction

All transaction-based metrics (volumes, P&L, price history, recent activity) use the `TokenTransaction` model. This model includes both user-owned and external transactions, with an `isOwned` boolean and `walletType` field for filtering.

- **User-scoped metrics** (P&L, buy/sell volumes in the P&L card): filtered by `isOwned: true`
- **Market-wide metrics** (Activity card volumes, transaction counts, price chart): use all transactions

### Refresh Modes

The dashboard supports two data refresh modes controlled by a floating "Monitoring Panel":

- **Monitoring OFF** (default for tokens launched >1 hour ago): Polls `dashboard.getStats` every 30 seconds.
- **Monitoring ON** (default for tokens launched <1 hour ago): Subscribes to SSE streams (gRPC balance/transaction updates + volume bot trade events) and refetches dashboard data on every event, with a 2-second debounce.

## Architecture

```
On-chain events (gRPC/Yellowstone) ─┐
                                     ├──► SSE Subscriptions ──► Dashboard Client
Volume Bot Worker (trade events) ───┤    (tRPC)                 (debounced refetch)
                                     │
                                     ├──► Server-side DB writes (balance updates)
                                     ├──► Ingestion Queue → transactionService (auto-ingest)
                                     ├──► Stats Cache Invalidation
                                     │
                                     └──► 30s polling fallback (always active)
```

### Service Layer Structure

`dashboard.getStats` is decomposed into focused sub-functions:

```
getStats(input, userId)
├── Phase 1 (parallel, no dependencies):
│   ├── getHeaderData()         → price (bonding curve / DEX), launchCompletedAt
│   └── getWalletKeys()         → operational + dev + main wallet public keys
│
└── Phase 2 (parallel, depends on Phase 1 for price & wallet keys):
    ├── getTreasuryData()       → SOL balances, wallet counts, running bots
    ├── getVolumeMetrics()      → buy/sell volumes via TokenTransaction.groupBy
    ├── getHoldingsBreakdown()  → user wallets, external holders, unrealized P&L
    ├── getOperations()         → volume bot sessions
    ├── getRecentTransactions() → last 15 TokenTransactions (grouped by signature, ordered by blockTime)
    └── getPriceHistory()       → time+price points from transactions (skipped when isComplete)
```

Result-level caching (10s TTL, keyed by `tokenPublicKey:userId`) prevents redundant recomputation during rapid SSE-triggered refreshes.

### Data Fetching: RPC-First Architecture

Balance, holding, and transaction signature fetching always use Solana RPC directly — no Shyft REST API is involved in these paths. This eliminates a dependency on the Shyft REST API quota for core operations.

- **SOL Balance Refresh** (`wallet.service.ts`): Uses `connection.getMultipleAccountsInfo()` in batches of 100. Single-wallet refresh uses `connection.getBalance()`.
- **Token Holding Refresh** (`holding.service.ts`): Computes ATAs and uses `connection.getMultipleParsedAccounts()` in batches of 100 to fetch token balances.
- **Transaction Signature Fetch** (`transaction.service.ts`): Uses `connection.getSignaturesForAddress()` for both the token mint and bonding curve accounts.
- **Transaction Parsing** (`transactionService.ingestTokenSignatures`): Uses `connection.getParsedTransactions()` in batches of 10.

All RPC batch calls are wrapped in `retryRpc()` (`lib/utils/rpc-retry.ts`) — 2 retries with exponential backoff (500ms, 1s) on transient errors (429, 502–504, timeout, connection reset).

**Shyft services still used:**
- `shyftDefiService.getPoolsByToken()` — for graduated token pricing and DeFi pool data (no RPC equivalent)
- gRPC streaming — for real-time on-chain event subscriptions (separate from REST API)
- Callback service — for webhook registration during launch

### Price for Graduated Tokens

For tokens where `isComplete === true` (graduated from bonding curve):

1. `priceService.getCurrentPrice` reads the bonding curve account for supply/reserve data
2. If `isComplete`, calls `getGraduatedPrice()` which queries Shyft DeFi API for DEX pools
3. Uses the pool with highest TVL to compute price from SOL/token reserves
4. Falls back to bonding curve price if no pools found
5. Graduated prices use a longer cache TTL (30s vs 10s for bonding curve)

### Market Cap

`marketCapSol = priceSol × tokenTotalSupply` to match pump.fun's definition. For graduated tokens where bonding curve tokens are 0, this equals total supply. `marketCapUsd = marketCapSol × solPriceUsd` (SOL/USD via Jupiter API primary, CoinGecko fallback).

### P&L Calculation

```
P&L = ownedSellVolume + holdingsValue - ownedBuyVolume
```

- `ownedBuyVolume` / `ownedSellVolume`: from `TokenTransaction.groupBy` where `isOwned: true`, `status: 'CONFIRMED'`
- `holdingsValue`: `totalTokenBalance × currentPrice` from user-filtered `Holding` records

### Data Flow: Monitoring Mode ON

1. `GrpcManager` streams on-chain account and transaction updates.
2. `subscription.router.ts` filters relevant events, yields them via SSE, **and writes live data to DB**:
   - `onBalanceUpdate`: updates `Wallet.balanceSol` in DB (fire-and-forget) and invalidates stats cache.
   - `onTokenBalanceUpdate`: updates `Holding.tokenBalance` in DB (fire-and-forget) and invalidates stats cache.
   - `onNewTransaction`: enqueues the signature for auto-ingestion via `ingestionQueue`.
3. `ingestionQueue` (`server/services/ingestion-queue.service.ts`) batches signatures per token (500ms window), calls `transactionService.ingestTokenSignatures` to parse and insert `TokenTransaction` records, then invalidates stats cache.
4. `volume-bot-worker.ts` emits `tradeComplete` events through `dashboardEvents` EventEmitter.
5. `subscription.router.ts` `onVolumeBotUpdate` listens to the EventEmitter and yields to SSE.
6. `dashboard-client.tsx` subscribes to `onNewTransaction`, `onBalanceUpdate`, `onTokenBalanceUpdate`, and `onVolumeBotUpdate`.
7. On any event, a debounced (2s) call to `refetchStats()` fires — by this time, DB writes and ingestion are complete, so `getStats` reads fresh data.
8. 30-second polling remains active as a safety net.
9. SSE errors are tracked and surfaced in the Monitoring Panel as a "Disconnected" state with amber indicator.

### Auto-Ingestion (`server/services/ingestion-queue.service.ts`)

When monitoring is active, gRPC-detected transaction signatures are automatically ingested:

1. `onNewTransaction` SSE listener calls `ingestionQueue.enqueue(tokenPublicKey, signature)`.
2. The queue collects signatures per token in a `Set<string>` (natural deduplication).
3. After a 500ms batch window (debounced), `flush()` calls `transactionService.ingestTokenSignatures`.
4. `ingestTokenSignatures` fetches parsed transactions via Solana RPC, extracts token owner transactions, and upserts `TokenTransaction` records.
5. After ingestion, the stats cache is invalidated so the next `getStats` call reads fresh data.
6. Errors are logged and swallowed — the 30s polling fallback ensures eventual consistency.

### Stats Cache Invalidation

The stats cache (`Map<string, CachedStats>`, 10s TTL, keyed by `tokenPublicKey:userId`) is invalidated via `invalidateStatsCache(tokenPublicKey)` whenever:

- A SOL balance update is written to DB (from `onBalanceUpdate`)
- A token balance update is written to DB (from `onTokenBalanceUpdate`)
- Transactions are auto-ingested (from `ingestionQueue.flush`)

This ensures the next `getStats` call bypasses the cache and reads fresh DB data.

### Data Flow: Monitoring Mode OFF

1. `dashboard.getStats` query has `refetchInterval: 30_000`. Each poll re-reads DB snapshots — it does NOT fetch live data from the chain.
2. No SSE connections are opened.
3. The monitoring panel shows a countdown to the next poll.
4. SOL balances and token holdings in DB are stale snapshots from the last manual refresh or gRPC live update.

### Manual Refresh (Mode-Aware)

The refresh button in the monitoring panel behaves differently based on the current mode:

**Monitoring OFF (or ON + disconnected):** "Refresh now" — triggers a full chain refresh:

1. `wallet.refreshBalances` — fetches SOL balances from Solana RPC via `getMultipleAccountsInfo`, writes to `Wallet.balanceSol` in DB.
2. `holding.refreshByToken` — fetches token holdings from Solana RPC via `getMultipleParsedAccounts`, diffs and writes to `Holding` records in DB.
3. Both run in parallel via `Promise.allSettled`.
4. After both complete, `refetchStats()` / `refetchToken()` / `refetchDefi()` are called to re-read the now-fresh DB data.

This is the user's primary way to get fully fresh data when monitoring is off.

**Monitoring ON (healthy):** "Force re-read" — lightweight DB re-read only:

1. Calls `refetchStats()` / `refetchToken()` / `refetchDefi()` to re-read current DB data.
2. No RPC calls — gRPC is already writing live balances/transactions to DB, so the data is already fresh.
3. Shown as a small text link (not a prominent button) since it's rarely needed.

The dashboard header's refresh button always performs a full chain refresh regardless of mode.

## Key Components

### Floating Monitoring Panel (`components/dashboard/monitoring-panel.tsx`)

- Fixed position, bottom-right corner.
- Two states: **expanded** (full controls) and **minimized** (small pill).
- Three refresh modes:
  - **Monitoring OFF**: "Refresh now" button (full chain refresh) + "Next in Xs" countdown.
  - **Monitoring ON (healthy)**: "Force re-read" text link (lightweight DB re-read). No countdown — gRPC handles live updates.
  - **Monitoring ON (disconnected)**: "Refresh now" button (full chain refresh) + SSE error warning.
- Shows: monitoring mode toggle (switch), "Updated Xs ago", mode-appropriate refresh control.
- Minimized state shows a small pill with status indicator (green=active, amber=disconnected, gray=off).

### Dashboard Events (`server/events/dashboard-events.ts`)

- Singleton `EventEmitter` that bridges the volume bot worker to the subscription router.
- Events:
  - `tradeComplete`: `{ tokenPublicKey, sessionId }` — emitted after a successful trade in the worker.

### Recent Transactions

- Uses `DISTINCT ON ("transactionSignature")` to collapse bundled transactions (e.g., 3 bundler wallets buying in the same Jito bundle) into a single row per signature.
- Prefers showing the owned wallet with a wallet type label over external/bonding curve entries.
- Ordered by `COALESCE(blockTime, createdAt) DESC` — uses actual on-chain time, not DB ingestion time.
- Client displays `blockTime` (falling back to `createdAt`) for the "time ago" label.

### Price Chart (Hybrid)

Uses two different chart implementations depending on token graduation status (`isComplete`):

**Graduated tokens (`isComplete === true`):**
- Embeds a DexScreener chart via iframe (`dexscreener.com/solana/{tokenPublicKey}?embed=1&...`).
- Full TradingView charting experience: candlesticks, indicators, drawing tools, interval selection, real-time streaming — all handled by DexScreener.
- Dark/light mode via `theme` and `chartTheme` URL params.
- No server-side price history query is issued (skipped when `isComplete`).

**Non-graduated tokens (`isComplete === false`):**
- Uses `lightweight-charts` AreaSeries (curved line + gradient fill) rendered from transaction data.
- Server sends `priceHistory`: an array of `{ time, price }` points derived from `TokenTransaction` rows (price = `solAmount / tokenAmount`), last 7 days, max 5,000 rows.
- The current bonding curve price is appended as the final data point so the chart always extends to "now".
- Custom price formatter using `formatPriceSol()` handles micro-SOL prices (sub-0.000001) without precision issues.
- Refreshed on the same 30s polling / SSE-debounce cycle as other dashboard data.

### Shared Formatting (`lib/utils/format.ts`)

All dashboard components use shared formatting utilities: `formatSol`, `formatPriceSol`, `formatMarketCap`, `formatTokenCount`, `formatPrice`, `truncateAddress`, `formatTimeAgo`, `formatRuntime`.

## Default Monitoring State

- Derived from `statsData.header.launchCompletedAt` (the `Launch.completedAt` field).
- If `launchCompletedAt` is null or more than 1 hour ago: OFF.
- If `launchCompletedAt` is within the last hour: ON.
- User toggle overrides the default; persisted in `localStorage` per token (`monitoring:{tokenPublicKey}`).
