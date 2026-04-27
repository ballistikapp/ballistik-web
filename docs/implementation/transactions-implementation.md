# Transactions Implementation

## Overview

Transactions are split into two storage layers:

- `TokenTransaction` stores token-wide activity and is the source for the `/[tokenPublicKey]/transactions` page.
- `Transaction` (legacy/current table) remains for wallet-scoped pages and workflows.

Rows are stored per action (wallet + signature + action type), with SOL amount, token amount, and derived price per token. `TokenTransaction` represents market activity, so amounts should match pump.fun trade records rather than full wallet balance deltas.

Operational wallet deltas, including account rent, network fees, tips, and token creation costs, are tracked separately in `AppTransaction` for P&L and cost accounting.

## tRPC Procedures

- `transaction.listByToken` returns token activity rows plus server-side header metrics. By default it keeps the legacy grouped-by-signature view for existing callers.
- The `/[tokenPublicKey]/transactions` page calls `transaction.listByToken` with `groupBySignature: false`, so bundled pump.fun buys render as one row per wallet trade. The flat view excludes the bonding-curve side of each transaction and shows owned/external trader rows.
- `transaction.refreshByToken` fetches token-related signatures and persists unseen or stale action rows.

## Price Calculation

- Pump.fun `TradeEvent` logs are preferred when available. `sol_amount` becomes `TokenTransaction.solAmount`, and `token_amount` becomes `TokenTransaction.tokenAmount`.
- Token amounts are converted using token decimals from parsed token balances, with pump.fun's six-decimal token default as fallback.
- If no matching `TradeEvent` is present, ingestion falls back to the legacy balance-delta parser: token deltas come from pre/post token balances, and SOL deltas come from the wallet system account or wSOL delta.
- Price per token is calculated as `solAmount / tokenAmount`.

## Refresh Behavior

The `refreshByToken` service is optimized for speed and incremental updates:

1. Signature discovery uses token-related sources (Shyft callbacks/history and token-linked accounts such as mint + bonding curve).
2. Existing latest rows are loaded first; refresh fetches newest signatures first and stops once already-known signatures dominate the window.
3. Parsed transaction fetching uses batched RPC parsing, then converts each signature into one or more per-owner action rows.
4. Writes are idempotent with unique dedupe keys, so overlap/retries are safe.
5. `RefreshCache` is touched after refresh so the UI can decide staleness and trigger background refetch.
6. Parsed transaction batches now use `retryRpcWithTimeout` with `rpcConfig.tuning.parseTimeoutMs` (45s default) to avoid long-tail RPC hangs while still retrying transient failures.
7. Existing rows are corrected to pump.fun event amounts only when their signatures are encountered by normal refresh/stale-row retry. There is no historical backfill sweep.

### Database Indexes

`TokenTransaction` uses indexes for token-wide list and dedupe:

- list/read index on `tokenPublicKey + createdAt`.
- unique dedupe on `tokenPublicKey + transactionSignature + walletPublicKey + transactionType`.

`Transaction` indexes remain unchanged for wallet-scoped workflows.

## Access Rules

- Token-wide list includes owned and external wallets.
- Owned rows are marked using wallet metadata when a matching local wallet exists.

## Transactions Header Metrics

The transactions page header uses server-side metrics across all matching token transaction rows, not just the current page. Metrics use the same flat-row filter as the page table, with owned vs external splits:
- Buys (count)
- Sells (count)
- Volume (SOL)
- Unique traders
