# App Transactions Implementation

## Overview

`AppTransaction` is a unified operational ledger that captures every on-chain operation the app produces. It tracks the full lifecycle of transactions from PENDING through CONFIRMED or FAILED.

This table does **not** replace `TokenTransaction`, which tracks market activity (including external traders) and powers price charts, volume metrics, and sell-side P&L. App-initiated trades appear in both tables — they serve different query patterns. The dashboard P&L uses both sources: sell volumes from `TokenTransaction` and dev buy + fee data from `AppTransaction` (see [Dashboard P&L Integration](#dashboard-pl-integration)).

## Data Model

### `AppTransaction` table

| Field | Type | Description |
|-------|------|-------------|
| `id` | String (cuid) | Primary key |
| `userId` | String | Owner user |
| `tokenPublicKey` | String? | Associated token (null for global withdrawals; populated for fee records linked to a specific token) |
| `type` | AppTransactionType | Two-level category enum |
| `source` | AppTransactionSource | Feature that generated this transaction |
| `status` | TransactionStatus | PENDING → CONFIRMED or FAILED |
| `transactionSignature` | String? | On-chain signature (null while PENDING) |
| `bundleId` | String? | Groups transactions within a Jito bundle |
| `walletPublicKey` | String? | Actor wallet — the wallet performing the action |
| `fromAddress` | String? | Source address |
| `toAddress` | String? | Destination address |
| `solAmount` | Decimal? | SOL amount involved |
| `tokenAmount` | Decimal? | Token amount involved |
| `pricePerToken` | Decimal? | Price per token (TRADE types only) |
| `jitoTipLamports` | Int? | Jito tip amount on the last tx in a bundle |
| `referenceId` | String? | Soft link to related record (launch ID, exit ID, session ID) |
| `description` | String? | Auto-generated human-readable summary |
| `errorMessage` | String? | Populated on FAILED status |
| `blockTime` | DateTime? | On-chain block time |
| `createdAt` | DateTime | Row creation time |
| `updatedAt` | DateTime | Last update time |

### `AppTransactionType` enum

Combined two-level enum. UI derives category by splitting on first underscore.

| Category | Type | Description |
|----------|------|-------------|
| TRADE | `TRADE_BUY` | Token buy on pump.fun |
| TRADE | `TRADE_SELL` | Token sell on pump.fun |
| TRADE | `TRADE_CREATE` | Token creation on pump.fun |
| TRANSFER | `TRANSFER_FUND` | SOL funding (main → operational wallets) |
| TRANSFER | `TRANSFER_RETURN` | SOL return (operational → main) |
| TRANSFER | `TRANSFER_RECLAIM` | SOL reclaim from failed/recovery wallets |
| TRANSFER | `TRANSFER_WITHDRAW` | SOL withdraw (main → external) |
| FEE | `FEE_USAGE` | Platform usage fee |
| FEE | `FEE_PRO` | Pro subscription payment |
| TOKEN | `TOKEN_DISTRIBUTE` | SPL token distribution |
| TOKEN | `TOKEN_CONSOLIDATE` | SPL token consolidation |
| ACCOUNT | `ACCOUNT_ATA_CREATE` | Create associated token account |
| ACCOUNT | `ACCOUNT_ATA_CLOSE` | Close token account |

### `AppTransactionSource` enum

| Source | Feature |
|--------|---------|
| `LAUNCH` | Token launch pipeline |
| `EXIT` | Batch holding exit |
| `VOLUME_BOT` | Volume bot sessions |
| `HOLDING` | Manual holding operations (sell) |
| `WALLET` | Manual wallet operations (withdraw, fund, return) |
| `BILLING` | Fee collection, Pro subscription |

## Tracking Pattern

### Status lifecycle

1. Row created with `PENDING` status before the on-chain send
2. Updated to `CONFIRMED` with signature after success
3. Updated to `FAILED` with error message on failure

### Resilience

Tracking is best-effort. DB failures never block on-chain operations:
- Create failure: logged as warning, operation proceeds untracked
- Confirm/fail failure: logged as warning, operation result unaffected

### Retry behavior

Each retry attempt (e.g., on `TransactionExpiredBlockheightExceededError`) creates a new row. A failed first attempt stays as FAILED; a successful retry is a separate CONFIRMED row.

### Multi-instruction transactions

One row per logical operation. Batch funding of N wallets produces N rows sharing the same `transactionSignature`.

### Jito bundles

One row per transaction in the bundle. All rows share the same `bundleId`. The last transaction row gets `jitoTipLamports` populated.

## Context via `referenceId`

The `referenceId` field is a soft polymorphic link. Interpret it using `source`:

| Source | `referenceId` points to |
|--------|------------------------|
| `LAUNCH` | `Launch.id` |
| `EXIT` | `HoldingExit.id` |
| `VOLUME_BOT` | `VolumeBotSession.id` |
| `BILLING` | `ProSubscriptionPayment.id` |
| `HOLDING` | — (not used) |
| `WALLET` | — (not used) |

## API

### `appTransaction.list`

Protected procedure. Returns offset-based paginated results ordered by `createdAt DESC`.

**Input filters** (all optional):
- `tokenPublicKey` — filter by token
- `source` — filter by feature (LAUNCH, EXIT, etc.)
- `type` — filter by operation type (TRADE_BUY, TRANSFER_FUND, etc.)
- `status` — filter by status (PENDING, CONFIRMED, FAILED)
- `search` — free text search across `description`, `walletPublicKey`, `transactionSignature` (case-insensitive)
- `page` — page number (default 1)
- `pageSize` — page size (1–100, default 25)

**Returns**: `{ items: AppTransaction[], totalCount: number }`

### `appTransaction.costBreakdown`

Protected procedure. Aggregates confirmed `AppTransaction` data for a token, grouped by `type` and `source`. Used by the P&L details dialog.

**Input**: `{ tokenPublicKey: string }`

**Returns**: `{ byType, bySource, summary: { totalFees, totalFunding, totalReturns, totalBuys, totalSells, netPnl, totalTransactions } }`

## Indexes

- `[userId, createdAt]` — primary list query
- `[userId, tokenPublicKey, createdAt]` — per-token filtered view
- `[userId, source, createdAt]` — feature-scoped queries
- `[userId, type, createdAt]` — type-filtered queries
- `[transactionSignature]` — signature lookup and multi-instruction grouping
- `[bundleId]` — Jito bundle grouping
- `[referenceId]` — join to related records
- `[status]` — pending/failed queries

## Dashboard P&L Integration

The token dashboard P&L combines data from two sources:

- **Sell volume**: `TokenTransaction.groupBy` where `isOwned: true`, `transactionType: 'SELL'`
- **Buy volume**: `TokenTransaction` owned buy volume + `AppTransaction.TRADE_BUY` (source: `LAUNCH`) sum. The dev buy during token creation is recorded as a `TRADE_BUY` in `AppTransaction` with the exact configured dev buy amount. This is more accurate than the `TokenTransaction.CREATE` row, which includes creation overhead.
- **Fees**: `AppTransaction` aggregation of `FEE_USAGE` and `FEE_PRO` types for the token, plus Jito tips from `jitoTipLamports`.

P&L formula:

```
totalBuyVolume = ownedBuyVolume (TokenTransaction) + devBuySol (AppTransaction)
pnl = ownedSellVolume - totalBuyVolume - totalFees
```

This is computed in `dashboard.service.ts` via `getOperationalCosts()`, which runs three parallel queries against `AppTransaction`:
1. Fee aggregation (grouped by type for `FEE_USAGE` / `FEE_PRO`)
2. Jito tip aggregation (sum of `jitoTipLamports`)
3. Dev buy aggregation (`TRADE_BUY` where source is `LAUNCH`)

The P&L card shows a clickable details dialog (`pnl-details-dialog.tsx`) breaking down: bought, sold, trading P&L, platform fees, pro fees, Jito tips, and net P&L.

### `tokenPublicKey` on fee records

Fee collection via `usage-fee.service.ts` accepts an optional `tokenPublicKey`. Callers must pass it so that `getOperationalCosts` can find fee records for a specific token:

- `launch.service.ts` → passes `tokenPublicKey` from `finalizeLaunch` params
- `volume-bot.service.ts` → passes `token.publicKey` from the resolved token
- `pro-subscription.service.ts` → no token context (global fee, not per-token)

## History UI

The History page (`/history`) displays all `AppTransaction` records for the authenticated user in a `DataTable` with:

- **Server-side filtering**: source, type, status dropdowns + free text search (debounced)
- **Offset pagination**: page/pageSize managed via `nuqs` URL state
- **Columns**: type (color-coded badge), source, status (with indicator dot), description, wallet (internal link when `tokenPublicKey` present), SOL amount, signature (Solscan link), bundle ID (Jito explorer link), time (exact + relative)

Located in `app/(app)/history/` with `page.tsx` (data fetching + toolbar) and `columns.tsx` (column definitions).

## Instrumented Call Sites

| Service | Sites | Types |
|---------|-------|-------|
| `launch.service.ts` | 7 | TRANSFER_FUND, TOKEN_DISTRIBUTE, TRANSFER_RETURN, TRANSFER_RECLAIM, TRADE_CREATE, TRADE_BUY |
| `bundle-create-and-buy.ts` | 1 (bundle) | TRADE_CREATE, TRADE_BUY |
| `wallet.service.ts` | 3 | TRANSFER_WITHDRAW, TRANSFER_FUND, TRANSFER_RETURN |
| `usage-fee.service.ts` | 1 | FEE_USAGE, FEE_PRO |
| `holding.service.ts` | 3 | TRADE_SELL, TRANSFER_RETURN, ACCOUNT_ATA_CLOSE |
| `holding-exit.service.ts` | 3 + 1 bundle | TRANSFER_FUND, ACCOUNT_ATA_CLOSE, TRANSFER_RETURN, TRADE_SELL |
| `volume-bot-worker.ts` | 3 | TRADE_BUY, TRADE_SELL, ACCOUNT_ATA_CLOSE |
