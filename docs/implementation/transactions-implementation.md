# Transactions Implementation

## Overview

Transactions track per-wallet buy, sell, and create activity for a token. Each row stores SOL amount, token amount, and a derived price per token.

## tRPC Procedures

- `transaction.listByToken` returns stored transactions for a token with wallet metadata.
- `transaction.refreshByToken` scans recent on-chain signatures for allowed wallets and persists new or updated rows.
- `transaction.liveByToken` streams recent transactions for a token across all wallets using RabbitStream.

## Live Monitoring

- RabbitStream gRPC subscriptions (via centralized `grpc-manager.ts`) include the token mint and bonding curve accounts.
- Live results include owned/foreign wallet labels plus per-item SOL/token amounts.
- Totals include `totalLiquiditySol` and `foreignLiquiditySol` for the current feed window.
- tRPC subscription `subscription.onNewTransaction` pushes new transaction signatures in real-time via SSE. The client uses this to trigger a data refetch instead of polling every 2 seconds.
- When subscriptions are active, polling interval drops to 30s as a fallback; without subscriptions it remains at 2s.

## Price Calculation

- Token deltas come from pre/post token balances for the owner and the token mint.
- SOL deltas come from the wallet system account when present.
- If the wrapped SOL (wSOL) token balance delta is larger than the system account delta, use the wSOL delta instead.
- Price per token is calculated as `solAmount / tokenAmount`.

## Refresh Behavior

The `refreshByToken` service is optimized for speed:

1. Signature fetching and stale transaction query run **in parallel**:
   - **Signatures**: Shyft `getTransactionHistory()` or RPC `getSignaturesForAddress()` per wallet, with concurrency limit of 5 (via `mapWithConcurrency`). Shyft calls fall back to RPC on failure.
   - **Stale query**: Fetches existing rows with zero SOL/price for backfill, runs concurrently with signature fetching.
2. Parsed transaction fetching uses `getParsedTransactions()` in batches of 10, with 3 concurrent batches via `mapWithConcurrency`.
3. New transactions are bulk-inserted via `createMany()`. Stale row updates are batched in a single `$transaction()`.
4. `RefreshCache` is updated on each refresh to support client staleness checks.
5. UI invalidates the `listByToken` query cache after mutation, triggering a background refetch without blocking.

### Database Indexes

The `Transaction` table has composite indexes to support refresh queries:
- `@@index([walletPublicKey, tokenPublicKey, createdAt])` for aggregation and stale lookups.
- `@@index([tokenPublicKey, transactionSignature, walletPublicKey])` for existing transaction deduplication.

## Access Rules

- Allowed wallets are the main wallet, token dev wallet, and token operational wallets.
