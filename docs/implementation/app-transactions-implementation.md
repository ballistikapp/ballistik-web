# App Transactions Implementation

## Overview

`AppTransaction` is a unified operational ledger that captures every on-chain operation the app produces. It tracks the full lifecycle of transactions from PENDING through CONFIRMED or FAILED.

This table does **not** replace `TokenTransaction`, which tracks market activity (including external traders) and powers price charts, volume metrics, and transaction lists. App-initiated trades appear in both tables — they serve different query patterns. Dashboard P&L is sourced from `AppTransaction` only (see [Dashboard P&L Integration](#dashboard-pl-integration)).

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
| `intentSolAmount` | Decimal? | Display-only intent value the producer set before send (signed: outflows negative). Never used for P&L. |
| `solAmount` | Decimal? | **Signed wallet delta in SOL** for `walletPublicKey` on `transactionSignature`, computed from `meta.preBalances`/`postBalances` after confirmation. Outflows negative, inflows positive. P&L is `SUM(solAmount)`. |
| `lamportsDelta` | BigInt? | Same value as `solAmount` but in raw lamports for exact-precision SUM math. P&L uses this. |
| `txFeeLamports` | Int? | The portion of `meta.fee` attributable to this row's wallet (non-zero only when the wallet is the fee payer). Informational. |
| `tokenAmount` | Decimal? | Token amount involved |
| `pricePerToken` | Decimal? | Price per token (TRADE types only) |
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
| FEE | `FEE_SUBSCRIPTION` | Subscription payment |
| FEE | `JITO_TIP` | Jito bundle tip on the tipper wallet (only created when the tipper has no other row on the tip-bearing signature) |
| TOKEN | `TOKEN_DISTRIBUTE` | SPL token distribution |
| TOKEN | `TOKEN_CONSOLIDATE` | SPL token consolidation |
| ACCOUNT | `ACCOUNT_ATA_CREATE` | Create associated token account |
| ACCOUNT | `ACCOUNT_ATA_CLOSE` | Close token account |
| REWARD | `REWARD_CLAIM` | Collect creator rewards from Pump creator vault |
| REWARD | `REWARD_PAYOUT` | Transfer claimed rewards to user main wallet |

### `AppTransactionSource` enum

| Source | Feature |
|--------|---------|
| `LAUNCH` | Token launch pipeline |
| `EXIT` | Batch holding exit |
| `VOLUME_BOT` | Volume bot sessions |
| `HOLDING` | Manual holding operations (sell) |
| `WALLET` | Manual wallet operations (withdraw, fund, return) |
| `BILLING` | Fee collection, Pro subscription |
| `CREATOR_REWARD` | Creator reward claim and payout |

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

**One row per (signature × user-owned wallet).** A batch funding from main → 5 operational wallets in one transaction produces 6 rows (1 sender + 5 receivers), all sharing the same `transactionSignature`. After settlement:
- The sender row's `lamportsDelta` is the negative of the total amount sent + the tx fee.
- Each receiver row's `lamportsDelta` is the positive amount they received.
- `SUM(lamportsDelta)` over the bundle equals the negative tx fee (the only real P&L impact of an internal transfer).

Per the unique constraint `[transactionSignature, walletPublicKey]`, a wallet that is both sender and receiver on the same signature (self-transfer) collapses to a single row. Producers must skip the receiver row when sender and receiver are the same wallet.

For launch funding, those `TRANSFER_FUND` rows remain the operational ledger of main-wallet top-ups. Failed-launch auto reclaim does not derive its cap from these best-effort rows; it uses the persisted `LaunchRecoveryWallet.fundedLamports` snapshot written during launch funding so shared wallets can only return launch-specific SOL.

### Jito bundles

One row per (transaction in the bundle × user-owned wallet). All rows share the same `bundleId`. The tip-bearing signature gets a `JITO_TIP` row on the tipper wallet whenever the tipper does not otherwise have a row on that signature; if it would conflict, the tip is naturally captured in the tipper's existing row's wallet delta.

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
| `CREATOR_REWARD` | — (not used; token context via `tokenPublicKey`) |

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

### Ops: `ops.listWalletAppTransactions`

Operator procedure. Returns offset-based paginated AppTransaction rows for a Wallet, ordered by `createdAt DESC`. Filters by exact actor `walletPublicKey` (not `fromAddress`/`toAddress`). Returns 404 if the Wallet does not exist.

**Input**: `{ walletPublicKey, page?, pageSize? }` (defaults 1 / 25, max 100)

**Returns**: `{ items: { id, type, status, solAmount, transactionSignature, description, createdAt }[], totalCount }`

Service path: `opsService.listWalletAppTransactions` → `appTransactionService.listByWallet`.

### `appTransaction.costBreakdown`

Protected procedure. Aggregates confirmed `AppTransaction` data for a token, grouped by `type` and `source`. Used by the P&L details dialog.

**Input**: `{ tokenPublicKey: string }`

**Returns**: `{ byType, bySource, summary: { totalFees, totalFunding, totalReturns, totalBuys, totalSells, netPnl, totalTransactions } }`

## Indexes

- `[userId, createdAt]` — primary list query
- `[userId, tokenPublicKey, createdAt]` — per-token filtered view
- `[userId, source, createdAt]` — feature-scoped queries
- `[userId, type, createdAt]` — type-filtered queries
- `[walletPublicKey, createdAt]` — Ops / actor-wallet history
- `[transactionSignature]` — signature lookup and multi-instruction grouping
- `[bundleId]` — Jito bundle grouping
- `[referenceId]` — join to related records
- `[status]` — pending/failed queries

## Dashboard P&L Integration

The token dashboard P&L equals the actual SOL change across the user's managed
wallets attributable to this token, computed as a single SUM over signed
wallet-delta rows in `AppTransaction`. `TokenTransaction` is still used for
market activity, transaction tables, price charts, and reconciliation, but it
does not feed P&L.

### Wallet-delta semantics

Every row's `solAmount`/`lamportsDelta` is the signed lamport delta on the
row's actor wallet (`walletPublicKey`) for the row's transaction signature,
computed from `meta.preBalances`/`postBalances` after confirmation. Outflows
are negative, inflows are positive. The delta naturally includes every cost on
that wallet for that tx: network fee, priority fee, pump.fun swap fee, ATA
rent, and the Jito tip when the wallet was the tipper.

This means there is **no derived "creation cost" residual**, no "intent vs
realized" reconciliation, and no special-cased per-source math. Internal
transfers cancel between sender and receiver rows except for the tx fee.

### P&L formula

```
P&L = SUM(AppTransaction.lamportsDelta) / 1e9
WHERE userId = U AND tokenPublicKey = T AND status = 'CONFIRMED'
  AND type != 'FEE_SUBSCRIPTION'  -- subscriptions are global, not per-token
```

Computed in `dashboard.service.ts:getOperationalCosts()` via two `groupBy`
queries (one by `type`, one by `source` for the per-feature fee breakdown),
plus a count of unsettled CONFIRMED rows.

### Settlement (`server/services/app-transaction-settler.ts`)

Producers create rows in `PENDING` with an `intentSolAmount`, send the
transaction, then call `settleSignature({ signature, rows })`. The settler
fetches `getTransaction` once and writes `lamportsDelta`, `solAmount`,
`txFeeLamports`, and `blockTime` for each row from the same `meta` payload —
so all rows tied to one signature settle from one RPC call.

### Backstop sweep

`settleUnsettledForToken` runs at the start of every dashboard cache miss
(bounded to 50 rows). It finds CONFIRMED rows where `lamportsDelta` is null
(producer missed the sync settle, RPC blip, process death between submit and
settle) and re-settles them via `getTransaction`. Idempotent: a row already
settled is left alone. The dashboard surfaces `unsettledRowCount > 0` as an
"Incomplete" badge until the next settle.

### Per-row producer rules

Every producer that submits a transaction must:

1. Before send, create one PENDING row per user-owned wallet that the
   transaction will touch, set `intentSolAmount` (signed) for display, leave
   `lamportsDelta` null.
2. After confirm, call `confirmMany(ids, signature)` then
   `settleSignature({ signature, rows })`.
3. On failure, call `failMany(ids, errorMessage)`.

When sender and receiver are the same wallet (self-transfer), produce only one
row to satisfy the unique `[transactionSignature, walletPublicKey]` constraint.

### Mapping to dashboard breakdown

The P&L details dialog groups types into UI sections:

| Section | Types |
|---------|-------|
| Trades | `TRADE_BUY`, `TRADE_SELL`, `TRADE_CREATE` |
| Costs | `FEE_USAGE` (split by source: LAUNCH/EXIT/VOLUME_BOT/WALLET), `JITO_TIP`, `TRANSFER_*`, `ACCOUNT_ATA_*`, `TOKEN_*` |
| Rewards | `REWARD_CLAIM` + `REWARD_PAYOUT` |

`launchFeeBreakdown` (generated wallets, vanity, attribution removal, bundler)
is sourced from `Launch.input` config (intent), not from row sums. Any
discrepancy between intent and actual `LAUNCH`-source `FEE_USAGE` delta is
shown as a residual line ("Tx fees (collection)").

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
| `usage-fee.service.ts` | 1 | FEE_USAGE, FEE_SUBSCRIPTION |
| `holding.service.ts` | 3 | TRADE_SELL, TRANSFER_RETURN, ACCOUNT_ATA_CLOSE |
| `holding-exit.service.ts` | 3 + 1 bundle | TRANSFER_FUND, ACCOUNT_ATA_CLOSE, TRANSFER_RETURN, TRADE_SELL |
| `volume-bot-worker.ts` | 3 | TRADE_BUY, TRADE_SELL, ACCOUNT_ATA_CLOSE |
| `creator-rewards.service.ts` | 2 | REWARD_CLAIM, REWARD_PAYOUT |
