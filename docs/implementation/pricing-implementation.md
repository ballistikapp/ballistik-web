# Pricing Implementation

## Goals

- Define one canonical usage-fee model for all fee-charged actions.
- Keep server fee enforcement and UI fee display aligned.
- Centralize fee constants and collector wallet configuration.

## Usage Fee Schedule

- `0.02 SOL` per generated wallet
- `0.1 SOL` for vanity token mint
- `0.1 SOL` to remove launch attribution text from token description
- `0.1 SOL` when bundle buy is enabled

## Scope Rules

- Generated-wallet fee applies to generated wallets created by feature workflows (launch and volume bot).
- Auth/signup generated main wallets are excluded from usage-fee charging.
- Vanity mint fee applies only when vanity mint is enabled for launch.
- Attribution-removal fee applies only when user opts to remove `Launched with ballistik.app` from launch metadata description.
- Bundle-buy fee applies when launch runs with `bundleBuyEnabled = true`.

## Configuration

- Fee collector wallet address is configured via environment variable:
  - `FEE_COLLECTOR_WALLET_ADDRESS`
- Runtime env parsing is handled in `lib/config/env.ts`.
- Shared fee constants and breakdown helpers are defined in `lib/config/usage-fees.config.ts`.

## Calculation Model

### Launch

Total launch usage fee is the sum of:

1. `generatedWalletCount * 0.02`
2. `0.1` when vanity mint is enabled
3. `0.1` when attribution removal is enabled
4. `0.1` when bundle buy is enabled

Generated wallet count for launch:

- `+1` when `devWalletOption = generate`
- `+bundlerWalletCount` when bundle buy is enabled
- `+bundlerWalletCount * (distributionWalletMultiplier - 1)` when distribution multiplier is greater than `1`

### Volume Bot

Total usage fee is:

- `generatedWalletCount * 0.02`

## Enforcement

- Usage fees are computed server-side and transferred from the user's main wallet to the configured collector wallet.
- Fee collection is part of protected server workflows and is never trusted to client-side calculations.
- Fee collection validates collector wallet configuration before transfer.

## UI Visibility Requirements

- Launch review and confirmation surfaces must show line-item usage fees and final totals.
- Volume bot preflight/confirmation surfaces must show generated wallet fee and total usage fee.
- UI breakdown values should be derived from the same shared fee constants used by server logic.
- Launch surfaces must show attribution-removal fee and bundle-buy fee as separate line items.
- Launch review and confirmation fee panels must always render all launch fee line items, even when a fee is not active.
- Inactive fee rows should be visually de-emphasized while still displaying nominal fee amounts.

## Operation Cost Quote Semantics

All pre-operation quotes use a shared vocabulary across launch and volume bot:

- `chargedNowSol`: amount debited from main wallet immediately when the operation starts.
- `temporaryFundingSol`: amount moved into operational wallets/rent reserves that is expected to be reclaimed later.
- `expectedReturnSol`: expected amount returned to main wallet after cleanup/reclaim.
- `permanentSpendSol`: expected non-recoverable spend (usage fees, protocol/network spend, tips, execution costs).
- `netMainWalletDeltaNowSol`: same value as `chargedNowSol` for immediate wallet impact.
- `netMainWalletDeltaAfterCleanupSol`: expected final main-wallet delta after return/reclaim.

### Precision Rules

- **Edit-time estimate**: fast client-side estimate used while users edit forms. This can be conservative.
- **Confirm-time quote**: server-generated live quote using current balances and rent values. This is the authoritative amount shown before user confirmation.
- Runtime-sensitive categories (for example trade execution fees and variable bundle buys) must be labeled as ranges or caveats when they cannot be exact at confirm time.

## Related Files

- `lib/config/env.ts`
- `lib/config/usage-fees.config.ts`
- `server/services/usage-fee.service.ts`
- `server/services/launch.service.ts`
- `server/services/volume-bot.service.ts`
- `app/(app)/launch/launch-form.tsx`
- `app/(app)/launch/launch-overview-dialog.tsx`
- `app/(app)/[tokenPublicKey]/volume-bot/new/page.tsx`
