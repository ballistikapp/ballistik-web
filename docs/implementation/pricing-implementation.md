# Pricing Implementation

## Goals

- Define one canonical usage-fee model for all fee-charged actions.
- Keep server fee enforcement and UI fee display aligned.
- Centralize fee constants and collector wallet configuration.

## Usage Fee Schedule

- `0.02 SOL` per generated wallet
- `0.1 SOL` for vanity token mint
- `0.1 SOL` for token launch

## Scope Rules

- Generated-wallet fee applies to generated wallets created by feature workflows (launch and volume bot).
- Auth/signup generated main wallets are excluded from usage-fee charging.
- Launch fee applies to each launch start.
- Vanity mint fee applies only when vanity mint is enabled for launch.

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
3. `0.1` launch base fee

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

## Related Files

- `lib/config/env.ts`
- `lib/config/usage-fees.config.ts`
- `server/services/usage-fee.service.ts`
- `server/services/launch.service.ts`
- `server/services/volume-bot.service.ts`
- `app/(app)/launch/launch-form.tsx`
- `app/(app)/launch/launch-overview-dialog.tsx`
- `app/(app)/[tokenPublicKey]/volume-bot/new/page.tsx`
