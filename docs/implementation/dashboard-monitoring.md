# Dashboard & Monitoring

## Overview

The token dashboard (`/[tokenPublicKey]/dashboard`) is the central monitoring page for a token. It displays real-time price, P&L (with fee breakdown), holdings breakdown, volume bot status, recent transactions, DeFi pool data, and a candlestick price chart.

### Data Sources

The dashboard uses two transaction models:

- **`TokenTransaction`**: Market activity (including external traders). Powers price charts, volume/activity metrics, recent transactions, sell-side P&L, and market buy volume. Filtered by `isOwned: true` for user-scoped metrics.
- **`AppTransaction`**: Operational ledger. Provides the dev buy amount (`TRADE_BUY` from `LAUNCH` source), fee aggregation (`FEE_USAGE`, `FEE_PRO`, Jito tips), and claimed creator rewards (`REWARD_PAYOUT` from `CREATOR_REWARD` source) for the P&L calculation. See [App Transactions — Dashboard P&L Integration](app-transactions-implementation.md#dashboard-pl-integration) for details.

External holders on the dashboard are sourced separately from live SPL token accounts, not from `TokenTransaction`. `holdersService.getCurrentHolders()` first attempts a live Solana RPC holder lookup, supports both classic SPL Token and Token-2022 account programs, reads owner + amount bytes, aggregates balances by owner wallet, and sorts the result descending. If the current RPC provider blocks the required index methods, the service falls back to reconstructing current holder balances from confirmed `TokenTransaction` buy/create/sell deltas and emits a concise warning log so the provider limitation remains visible during operations. `dashboard.getStats` then excludes user-managed wallets and the bonding curve wallet so the `External Holders` panel reflects current non-user holders rather than historical traders as closely as current data sources allow.

### Refresh Modes

The dashboard supports two data refresh modes controlled by a floating "Monitoring Panel":

- **Monitoring OFF** (default for tokens launched >1 hour ago): skips live subscriptions and relies on manual refresh by default, with a recent-launch auto-refresh window described below.
- **Monitoring ON** (default for tokens launched <1 hour ago): Subscribes to SSE streams for live transaction/activity signals and refetches dashboard data on events. Holdings freshness is maintained via automatic `holding.refreshByToken` runs triggered by monitoring events plus a bounded safety interval.

When monitoring is OFF, launch recency still matters:

- **Recent launch (<1 hour)**: on first dashboard open, a full chain refresh runs automatically so the page does not rely on stale post-launch snapshots. After that, the open page keeps auto-refreshing every 30 seconds.
- **Older token**: the dashboard does not background-refresh while monitoring is OFF. It fetches the initial DB snapshot on page load, then waits for manual refresh unless dashboard data is unavailable.

## Architecture

```
On-chain events (gRPC/Yellowstone) ─┐
                                     ├──► SSE Subscriptions ──► Dashboard Client
Volume Bot Worker (trade events) ───┤    (tRPC)                 (debounced refetch)
                                     │
                                     ├──► Ingestion Queue → transactionService (auto-ingest)
                                     │    └──► onIngestionComplete SSE
                                     │
                                     ├──► Dashboard-triggered holding.refreshByToken
                                     │    (debounced + single-flight + freshness TTL)
                                     ├──► Stats Cache Invalidation
                                     │
                                     └──► Monitoring poll / recency auto-refresh
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
    ├── getOperationalCosts()   → fees, Jito tips, dev buy via AppTransaction
    ├── getVolumeMetrics()      → buy/sell volumes via TokenTransaction.groupBy
    ├── getHoldingsBreakdown()  → user wallets, external holders, holdings value
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
- Incoming callbacks are received under `/api/webhooks/*`, which is intentionally treated as a public proxy path prefix and protected by route-level webhook secrets (for Shyft: `x-api-key` verification in `/api/webhooks/shyft`).

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
totalBuyVolume = ownedBuyVolume + devBuySol
creatorRewardsClaimedSol = sum of confirmed REWARD_PAYOUT (CREATOR_REWARD source)
P&L = ownedSellVolume + creatorRewardsClaimedSol - totalBuyVolume - totalFees - creationCostSol
```

- `ownedBuyVolume` / `ownedSellVolume`: from `TokenTransaction.groupBy` where `isOwned: true`, `status: 'CONFIRMED'`
- `devBuySol`: from the confirmed `AppTransaction.TRADE_BUY` for the token's recorded dev wallet (`TokenDevWallet.walletPublicKey`) on the successful launch. This is used instead of the `TokenTransaction.CREATE` row, which includes creation overhead in its `solAmount`.
- `creationCostSol`: residual launch funding that was not returned to the main wallet and was not spent on launch buys. It is derived as `launchFunding - launchReturns - launchBuySol`, where `launchBuySol` sums all confirmed launch `TRADE_BUY` rows for the successful launch.
- `totalFees`: platform fees (`FEE_USAGE`) + pro fees (`FEE_PRO`) from `AppTransaction.groupBy`
- Jito tips are displayed in the P&L details dialog but not subtracted from net P&L (they are included in the on-chain transaction costs, not a separate fee)

The P&L is purely realized portfolio P&L for the token's managed wallets — unrealized holdings value is not included. Holdings value is displayed separately on its own card.

Realized sell proceeds count toward portfolio P&L even if they are still sitting on a managed wallet such as the system dev wallet. Returning SOL to the user's main wallet is handled by separate wallet recovery flows and does not change the P&L formula.

### P&L Details Dialog

Clicking the P&L card opens a breakdown dialog (`pnl-details-dialog.tsx`) showing:
- **Trading section**: bought (total spent), sold (total received), trading P&L
- **Costs section**: platform fees, pro subscription fees, Jito tips
- **Net P&L**: trading P&L minus fees

All data comes from the `pnl` object in the `dashboard.getStats` response — no additional API call.

### Data Flow: Monitoring Mode ON

1. `GrpcManager` streams on-chain account and transaction updates.
2. `subscription.router.ts` filters relevant events and yields them via SSE:
   - `onBalanceUpdate`: updates `Wallet.balanceSol` in DB and invalidates stats cache.
   - `onTokenBalanceUpdate`: opportunistic account-event stream for telemetry and best-effort updates, but **not the required source of holdings truth**.
   - `onNewTransaction`: enqueues signatures for auto-ingestion via `ingestionQueue`, yields immediately.
3. `ingestionQueue` (`server/services/ingestion-queue.service.ts`) batches signatures per token (500ms window), calls `transactionService.ingestTokenSignatures`, invalidates stats cache, and emits `ingestionComplete` via `dashboardEvents`.
4. `subscription.router.ts` `onIngestionComplete` listens to `ingestionComplete` and yields to SSE.
5. `volume-bot-worker.ts` emits `tradeComplete` events through `dashboardEvents`; `onVolumeBotUpdate` yields these via SSE.
6. `dashboard-client.tsx` subscribes to live events and:
   - always debounces `refetchStats()` for low-latency UI updates
   - triggers debounced `holding.monitoringRefreshByToken` on meaningful events (`onIngestionComplete`, `onVolumeBotUpdate`) plus a bounded safety interval while monitoring is ON.
7. `holding.monitoringRefreshByToken` reuses `holding.refreshByToken` with per-user+token single-flight and freshness TTL guards, then invalidates stats cache after successful writes.
8. 30-second polling remains active as a safety net while monitoring is ON.
9. SSE errors and stale/idle conditions are tracked and surfaced in the Monitoring Panel as `Healthy`, `Degraded`, or `Disconnected`.

### Auto-Ingestion (`server/services/ingestion-queue.service.ts`)

When monitoring is active, gRPC-detected transaction signatures are automatically ingested:

1. `onNewTransaction` SSE listener calls `ingestionQueue.enqueue(tokenPublicKey, signature)`.
2. The queue collects signatures per token in a `Set<string>` (natural deduplication).
3. After a 500ms batch window (debounced), `flush()` calls `transactionService.ingestTokenSignatures`.
4. `ingestTokenSignatures` fetches parsed transactions via Solana RPC, extracts token owner transactions, and upserts `TokenTransaction` records.
5. After ingestion, the stats cache is invalidated and `dashboardEvents.emitIngestionComplete()` fires to notify the client via `onIngestionComplete` SSE.
6. Failures are retried with bounded backoff. If retries are exhausted, the queue defers to polling fallback and exposes telemetry via `dashboard.getGrpcStatus`.

### Pending Signature Handling (Real-time Consistency)

Freshly detected signatures can briefly return `null` from `getParsedTransactions` due to RPC propagation/finality timing. To avoid missing real-time transaction rows:

1. `transactionService.ingestTokenSignatures` performs bounded in-function re-fetches for unresolved signatures (small backoff, unresolved subset only).
2. If monitoring ingestion still has unresolved signatures after bounded attempts, it throws a retryable pending-signature error containing only unresolved signatures.
3. `ingestionQueue` re-enqueues only that unresolved subset (not the full original batch), preserving throughput and minimizing redundant RPC calls.
4. `onIngestionComplete` is emitted only after a successful flush with no unresolved signatures for that queued subset.

### Stats Cache Invalidation

The stats cache (`Map<string, CachedStats>`, 10s TTL, keyed by `tokenPublicKey:userId`) is invalidated via `invalidateStatsCache(tokenPublicKey)` whenever:

- A SOL balance update is written to DB (from `onBalanceUpdate`)
- A token balance update is written to DB (best-effort `onTokenBalanceUpdate`)
- Automatic holdings refresh completes (`holding.refreshByToken` / `holding.monitoringRefreshByToken`)
- Transactions are auto-ingested (from `ingestionQueue.flush`)
- Launch completes successfully (`launch.service` `finalizeLaunch` when status is `SUCCEEDED`)
- A holding exit reaches a terminal state (`holding-exit.service`: success, failure, cancel, or early “no balances” exit)

This ensures the next `getStats` call bypasses the cache and reads fresh DB data.

### Data Flow: Monitoring Mode OFF

1. No SSE connections are opened.
2. Recent launches run a one-time full chain refresh on first dashboard open, then a recurring 30-second auto-refresh while the page remains open.
3. Older tokens do not auto-refresh in the background when monitoring is OFF.
4. Monitoring-off refreshes that hit the chain use:
   - `wallet.refreshBalances` on manual refresh and the recent-launch initial auto refresh
   - `holding.refreshByToken` and `transaction.refreshByToken` on recent-launch recurring auto refreshes
5. The monitoring panel shows a countdown only when monitoring is OFF and the token is still in the recent-launch auto-refresh window.

### Manual Refresh (Mode-Aware)

The refresh button in the monitoring panel behaves differently based on the current mode:

**Monitoring OFF (or ON + disconnected):** "Refresh now" — triggers a full chain refresh:

1. `wallet.refreshBalances` — fetches SOL balances from Solana RPC via `getMultipleAccountsInfo`, writes to `Wallet.balanceSol` in DB.
2. `holding.refreshByToken` — fetches token holdings from Solana RPC via `getMultipleParsedAccounts`, diffs and writes to `Holding` records in DB.
3. `transaction.refreshByToken` — fetches new transaction signatures from Solana RPC via `getSignaturesForAddress`, parses and upserts `TokenTransaction` records.
4. All three run in parallel via `Promise.allSettled`.
5. After all complete, `refetchStats()` / `refetchToken()` / `refetchDefi()` are called to re-read the now-fresh DB data.

This is the user's primary way to get fully fresh data when monitoring is off.

### Holdings and Transaction Refresh Performance Notes

`holding.refreshByToken` is optimized for large wallet sets to avoid linear latency growth:

1. ATA account reads via Solana RPC are chunked and executed with bounded concurrency (instead of fully sequential batch loops).
2. Holding mutations (delete/create/update) are chunked and executed with bounded concurrency to reduce end-to-end DB write time while avoiding unbounded load spikes.
   - Holding row updates are chunked at 50 rows per transaction to keep individual DB transactions bounded.
   - Token transaction stale-row updates are chunked at 50 rows per transaction.
3. The `Holding` table uses query-oriented indexes for refresh/list paths:
   - `(tokenPublicKey, walletPublicKey)` for token-scoped wallet lookups during refresh.
   - `(tokenPublicKey, lastUpdated)` for holdings list reads ordered by recency.
4. The `Transaction` table uses query-oriented indexes for refresh/list and stale-row scans:
   - `(tokenPublicKey, createdAt)` for token-scoped list/sort reads.
   - `(tokenPublicKey, walletPublicKey, createdAt)` for wallet-scoped recency reads under a token.
   - `(tokenPublicKey, transactionSignature, walletPublicKey)` for existing-row lookup during refresh.
   - `(walletPublicKey, tokenPublicKey, createdAt)` for holdings `DISTINCT ON ("walletPublicKey") ... ORDER BY walletPublicKey, createdAt DESC`.
   - `(tokenPublicKey, updatedAt)` for stale-row scans ordered by latest updates.

5. Additional query indexes are applied to high-traffic ownership/list paths:
   - `Wallet(tokenPublicKey, type)` for operational wallet lists.
   - `Token(userId, createdAt)` for user token lists ordered by recency.
   - `RefreshCache(lastRefreshedAt)` for staleness sweeps/cleanup.
   - `TokenTransaction(tokenPublicKey, transactionSignature)` and `TokenTransaction(tokenPublicKey, status, transactionType)` for signature-grouped recent-activity and price-history reads.

These optimizations specifically target slow manual refresh behavior on tokens with many managed wallets.

### List Endpoint Pagination

Holdings and transactions list endpoints use server-side pagination to avoid returning full history payloads:

- `holding.listByToken` accepts optional `page` and `pageSize` and returns `{ holdings, totalCount, totalBalance, totalSupply }`.
- `transaction.listByToken` accepts optional `page` and `pageSize` and returns `{ items, totalCount }`.
- `token.getUserTokens` and `token.getAllUserTokens` accept optional `page` and `pageSize` and return `{ items, totalCount, page, pageSize }` (defaults: page `1`, pageSize `50`, max `100`).
- `wallet.getOperationalByToken` accepts optional `page` and `pageSize` and returns `{ token, wallets, totalCount, page, pageSize }` (defaults: page `1`, pageSize `200`).
- UI tables pass current page state into list queries and use TanStack manual pagination (`manualPagination` + `pageCount`) to keep pagination server-driven.

Token API security contract:

- `token.getUserTokens`, `token.getAllUserTokens`, and `token.getByPublicKey` return only public token metadata (`publicKey`, `status`, `name`, `symbol`, `description`, `imageUrl`, `websiteUrl`, `twitterUrl`, `telegramUrl`, `createdAt`, `updatedAt`, `userId`).
- `privateKey` is excluded from all default token read endpoints and must never be relied on by UI/query cache payloads.
- Private key retrieval is explicit-only through `token.getPrivateKey` (protected mutation, on-demand call by user action).

This keeps response size bounded and avoids client-side pagination over large result sets.

**Monitoring ON (healthy):** "Re-read dashboard" — lightweight DB re-read only:

1. Calls `refetchStats()` / `refetchToken()` / `refetchDefi()` to re-read current DB data.
2. No direct RPC call from this action — transactions are stream-driven and holdings are already auto-refreshed in the background by the hybrid pipeline.
3. Shown as a small text link (not a prominent button) since it's rarely needed.

The dashboard header's refresh button always performs a full chain refresh regardless of mode. The header also shows a freshness indicator immediately to the left of the refresh button so users can see how recently the current dashboard snapshot was updated.

### Launch and Exit Freshness

- The launch progress dialog's `Go to token` action performs the same full refresh sequence (`wallet.refreshBalances`, `holding.refreshByToken`, `transaction.refreshByToken`) before routing to the dashboard so freshly launched tokens do not open with zeroed holdings or activity cards.
- When a holding exit transitions from `PENDING`/`RUNNING` to a terminal state while the dashboard is open, the dashboard automatically triggers that same full refresh path instead of only re-reading cached DB snapshots.
- Recent launches opened with monitoring OFF also run an initial full refresh on page load, then use recurring auto refresh without repeated wallet SOL balance refreshes.

## Key Components

### Floating Monitoring Panel (`components/dashboard/monitoring-panel.tsx`)

- Fixed position, bottom-right corner.
- Two states: **expanded** (full controls) and **minimized** (small pill).
- Four panel health states:
  - **Monitoring OFF / recent launch**: "Refresh now" button (full chain refresh) + "Next in Xs" countdown.
  - **Monitoring OFF / older token**: "Refresh now" button (full chain refresh) with a manual-only status and no countdown.
  - **Monitoring ON (healthy)**: "Re-read dashboard" text link (lightweight DB re-read). No countdown.
  - **Monitoring ON (degraded)**: "Refresh now" button + warning when stream freshness is delayed.
  - **Monitoring ON (disconnected)**: "Refresh now" button (full chain refresh) + disconnection warning.
- Shows: monitoring mode toggle (switch), "Updated Xs ago", mode-appropriate refresh control.
- Minimized state shows a small pill with status indicator (green=healthy, amber=degraded/disconnected, gray=off).

## Monitoring Pipeline Rollout Flag

- `MONITORING_PIPELINE_V2` controls robust behavior rollout in subscriptions.
- Default behavior: enabled unless explicitly set to `false`.
- When disabled, server falls back to legacy fire-and-forget persistence behavior.

## Validation Scenarios

Use these scenarios to validate correctness after changes:

1. **Hybrid holdings refresh on ingestion-complete**
   - Trigger new transaction activity while monitoring is ON.
   - Expected: dashboard logs show `holding-monitoring-refresh-*` and `holding-refresh-summary` without visiting the holdings page.

2. **Hybrid holdings refresh on volume-bot update**
   - Trigger a volume-bot trade while monitoring is ON.
   - Expected: a monitoring-triggered holdings refresh runs, cache invalidates, and dashboard holdings reflect new DB state.

3. **Write failure handling**
   - Simulate DB write failure for balance/holding update.
   - Expected: structured error log, gRPC status `lastWriteFailureAt` populated, cache not falsely marked fresh.

4. **Ingestion retry and fallback**
   - Simulate RPC parsing failures for `ingestTokenSignatures`.
   - Expected: bounded retries with backoff, telemetry visible in `dashboard.getGrpcStatus.ingestion`, eventual polling recovery.

5. **UI health transitions**
   - Stop SSE stream while monitoring is ON.
   - Expected: panel transitions to `Disconnected`, refresh action becomes full refresh.
   - Restore stream but stop receiving events for threshold interval.
   - Expected: panel transitions to `Degraded`.

## Test Run Logging

The critical production-readiness logging design is documented in `docs/implementation/test-run-logging.md`.

For the test run, dashboard instrumentation must emit:

- `dashboard_summary` events after each meaningful refetch
- `dashboard_full_snapshot` events at major milestones and when server results materially change
- `dashboard_subscription_event` events for SSE activity and errors
- `dashboard_query_result` events describing cache hit/miss behavior and partial-failure fallback paths

Because dashboard correctness is the highest-risk area, client-visible state takes priority over raw server internals. Client routes should log the actual data rendered to the user, while the server logs why those values were produced.

### Dashboard Events (`server/events/dashboard-events.ts`)

- Singleton `EventEmitter` that bridges server-side events to the subscription router.
- Events:
  - `tradeComplete`: `{ tokenPublicKey, sessionId }` — emitted after a successful trade in the volume bot worker.
  - `ingestionComplete`: `{ tokenPublicKey, signatureCount }` — emitted after `ingestionQueue` successfully ingests a batch of transactions into the DB.

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
- Server sends `priceHistory`: an array of `{ time, price }` points derived from `TokenTransaction` rows (price = `solAmount / tokenAmount`), capped at 500 source rows and downsampled to ~250 points when needed.
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
