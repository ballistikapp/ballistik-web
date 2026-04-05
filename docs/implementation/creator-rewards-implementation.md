# Creator Rewards Implementation

## Overview

Creator rewards let users claim accumulated Pump.fun creator fees for their tokens. The feature handles the core constraint that Pump claims are wallet-wide while the product surface is token-wide, including shared creator wallets (system dev wallet) where multiple tokens or users share the same creator address.

## Data Model

### `CreatorRewardBalance`

Token-level entitlement ledger, keyed by `userId + tokenPublicKey`.

| Field                    | Type          | Description                                           |
| ------------------------ | ------------- | ----------------------------------------------------- |
| `id`                     | String (cuid) | Primary key                                           |
| `userId`                 | String        | Owner user                                            |
| `tokenPublicKey`         | String        | Token mint address                                    |
| `creatorWalletPublicKey` | String        | Creator wallet that earns rewards                     |
| `isSystemWallet`         | Boolean       | Whether the creator is the platform system dev wallet |
| `accruedLamports`        | BigInt        | Cumulative rewards accrued from on-chain trades       |
| `paidOutLamports`        | BigInt        | Cumulative rewards paid out to user                   |
| `lastAccrualSignature`   | String?       | Most recent trade signature processed                 |
| `lastAccrualSlot`        | BigInt?       | Slot of the most recent processed trade               |
| `lastReconciledAt`       | DateTime?     | When rewards were last reconciled from chain          |

**Unique constraint**: `[userId, tokenPublicKey]`

### `CreatorRewardWalletSettlement`

Creator-wallet settlement ledger. Tracks how much SOL has been pulled from Pump for a given creator wallet and how much has been paid out.

| Field                     | Type      | Description                                    |
| ------------------------- | --------- | ---------------------------------------------- |
| `creatorWalletPublicKey`  | String    | Primary key                                    |
| `claimedFromPumpLamports` | BigInt    | Cumulative SOL claimed from Pump creator vault |
| `paidOutToUsersLamports`  | BigInt    | Cumulative SOL paid out to users               |
| `lastClaimSignature`      | String?   | Signature of last Pump claim tx                |
| `lastClaimAt`             | DateTime? | When last Pump claim occurred                  |

The difference `claimedFromPumpLamports - paidOutToUsersLamports` represents SOL available for future payouts without another Pump claim.

### `CreatorRewardAccrual`

Normalized per-signature reward rows from raw on-chain Pump trades.

| Field                    | Type          | Description                       |
| ------------------------ | ------------- | --------------------------------- |
| `id`                     | String (cuid) | Primary key                       |
| `tokenPublicKey`         | String        | Token mint address                |
| `creatorWalletPublicKey` | String        | Creator wallet                    |
| `transactionSignature`   | String        | On-chain signature                |
| `slot`                   | BigInt        | Transaction slot                  |
| `blockTime`              | DateTime?     | Block time                        |
| `tradeSide`              | String        | BUY or SELL                       |
| `creatorFeeLamports`     | BigInt        | Creator fee delta from this trade |

**Unique constraint**: `[tokenPublicKey, transactionSignature, tradeSide]`

## Architecture

### Two-Ledger Design

Pump's `collectCreatorFee` instruction drains the entire creator vault (wallet-wide), but the product shows per-token claimable amounts. This requires:

1. **Token entitlement ledger** (`CreatorRewardBalance`): tracks how much each token has accrued and how much has been paid out
2. **Creator wallet settlement** (`CreatorRewardWalletSettlement`): tracks wallet-wide Pump claim totals so one claim can fund multiple token payouts without overpaying

### On-Demand Reconciliation

Reward data is never fetched in the background. Reconciliation runs only when:

- The user clicks "Refresh" on the creator rewards card
- `claimByToken` runs its mandatory pre-claim reconciliation

Reconciliation scans the bonding curve for new trade signatures, fetches the full transaction to extract the creator-vault balance delta, and persists accrual rows.

### Delta-Based Calculation

Creator fee accrual is derived from actual on-chain creator-vault balance changes, not from fee formulas. For each trade signature:

1. Fetch the confirmed transaction
2. Find the creator vault in the account list
3. Compute `postBalance - preBalance` for the vault
4. Persist the exact delta as `creatorFeeLamports`

This is robust against protocol fee changes and rounding differences.

## Service Layer

`server/services/creator-rewards.service.ts`

### `getByToken(tokenPublicKey, userId)`

Returns cached reward data from `CreatorRewardBalance`. Creates the balance record if it doesn't exist.

### `refreshByToken(tokenPublicKey, userId)`

Runs on-demand reconciliation: fetches new trade signatures, extracts creator fee deltas, persists accrual rows, and updates the balance.

### `claimByToken(tokenPublicKey, userId)`

Full claim flow with concurrency locking:

1. Acquires a lock on `creatorWallet:token`
2. Runs mandatory reconciliation
3. Checks claimable amount exceeds transfer fee (5000 lamports)
4. Checks settlement balance; if insufficient, calls Pump `collectCreatorFee`
5. Transfers payout (claimable minus transfer fee) to user's main wallet
6. Updates both ledgers atomically
7. Records `REWARD_CLAIM` and `REWARD_PAYOUT` in AppTransaction
8. Invalidates dashboard stats cache

### Failure Handling

- Pump claim fails → no settlement credit, no payout, no P&L change
- Pump claim succeeds, payout fails → settlement stays credited, token claimable unchanged, retryable
- Retry reuses existing settlement before attempting another Pump claim

## API Layer

`server/trpc/routers/creator-rewards.router.ts`

| Endpoint                       | Procedure            | Description              |
| ------------------------------ | -------------------- | ------------------------ |
| `creatorReward.getByToken`     | `protectedProcedure` | Read cached reward data  |
| `creatorReward.refreshByToken` | `protectedProcedure` | On-demand reconciliation |
| `creatorReward.claimByToken`   | `sensitiveProcedure` | Claim and payout         |

## Dashboard Integration

### P&L Formula

```
net = ownedSellVolume + creatorRewardsClaimedSol - totalBuyVolume - totalFees - creationCostSol
```

Only confirmed `REWARD_PAYOUT` rows feed P&L. The `creatorRewardsClaimedSol` field is queried from AppTransaction alongside other cost/revenue queries.

### UI Components

- **Creator Rewards Card** (`creator-rewards-card.tsx`): shows claimable SOL, last refreshed time, refresh button, claim button
- **P&L Details Dialog**: includes "Creator Rewards" as a line item under "Total Received" when > 0
- **Dashboard Stats**: "Received" summary includes creator rewards

## System Dev Wallet Handling

Tokens launched with the platform system dev wallet (`isSystemWallet: true`) are **not eligible** for creator rewards. The shared system dev wallet's creator vault accrues fees from all tokens that use it, but no individual user can claim from it — this avoids the complex multi-tenant accounting problem on a shared wallet.

Service-layer gates:

- `getByToken`: returns a zeroed response with `eligible: false` (no DB balance creation, no vault check)
- `refreshByToken`: returns the same zeroed response (skip reconciliation)
- `claimByToken`: throws `AppError` with HTTP 400

The dashboard `CreatorRewardsCard` is hidden entirely when `eligible === false`.

## Limitations

- **v1 is future-only**: rewards accrued before feature rollout are not backfilled. Only trades observed after the first reconciliation contribute to entitlement.
- **No background ingestion**: all data is on-demand. Dashboard shows cached data that may be stale until manually refreshed.
