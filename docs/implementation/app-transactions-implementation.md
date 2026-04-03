# App Transactions Implementation

## Overview

`AppTransaction` is a unified operational ledger that captures every on-chain operation the app produces. It tracks the full lifecycle of transactions from PENDING through CONFIRMED or FAILED.

This table does **not** replace `TokenTransaction`, which tracks market activity (including external traders) and powers dashboard P&L, price charts, and volume metrics. App-initiated trades appear in both tables — they serve different query patterns.

## Data Model

### `AppTransaction` table

| Field | Type | Description |
|-------|------|-------------|
| `id` | String (cuid) | Primary key |
| `userId` | String | Owner user |
| `tokenPublicKey` | String? | Associated token (null for fees, withdrawals) |
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

Protected procedure. Returns cursor-based paginated results ordered by `createdAt DESC`.

**Input filters** (all optional):
- `tokenPublicKey` — filter by token
- `source` — filter by feature (LAUNCH, EXIT, etc.)
- `type` — filter by operation type (TRADE_BUY, TRANSFER_FUND, etc.)
- `status` — filter by status (PENDING, CONFIRMED, FAILED)
- `cursor` — cursor for pagination
- `limit` — page size (1–100, default 50)

## Indexes

- `[userId, createdAt]` — primary list query
- `[userId, tokenPublicKey, createdAt]` — per-token filtered view
- `[userId, source, createdAt]` — feature-scoped queries
- `[userId, type, createdAt]` — type-filtered queries
- `[transactionSignature]` — signature lookup and multi-instruction grouping
- `[bundleId]` — Jito bundle grouping
- `[referenceId]` — join to related records
- `[status]` — pending/failed queries

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
