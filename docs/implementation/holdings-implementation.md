# Holdings Implementation

## Overview

Holdings show per-wallet token balances, holding percentage vs mint supply, and last activity for a selected token. The holdings page supports refresh and bulk sell actions. Wallets with open token accounts (ATAs) are included even when the balance is zero so users can close them.

## tRPC Procedures

- `holding.listByToken` fetches holdings for a token (optionally filtered by wallet) and includes token mint supply metadata for `Holding %`.
- `holding.refreshByToken` refreshes holdings via Shyft `getTokenBalance()` per wallet (fetches only the target token's balance). Falls back to batched RPC `getMultipleParsedAccounts` when `SHYFT_API_KEY` is not set.
- `holding.sellByToken` submits sell transactions for selected wallets at a percentage of on-chain token balances.

## Access Rules

- Token ownership is verified on every holdings read and mutation.
- Allowed wallets are the main wallet, token dev wallet, and token operational wallets.
- Sell actions only execute for allowed wallets with private keys.

## Refresh Flow

The `refreshByToken` service is optimized for speed:

1. `getAllowedWallets()` resolves the token and its associated wallets.
2. Balance fetching and supporting DB reads run **in parallel**:
   - **Balances**: Shyft `getTokenBalance()` calls with concurrency limit of 5 (via `mapWithConcurrency`), or batched RPC `getMultipleParsedAccounts` as fallback.
   - **Safety on provider failure**: if a wallet-level Shyft call fails, refresh attempts wallet-level RPC fallback before writing. Wallets that cannot be resolved are skipped (no destructive delete) for that refresh run.
   - **DB queries**: last transaction per wallet (`DISTINCT ON`) and existing holdings run concurrently.
3. All holding creates, updates, and deletes are batched into a single `prisma.$transaction()` call.
4. The mutation updates holdings server-side and touches refresh cache state. The client invalidates `holding.listByToken` and refetches.

## Sell Flow

1. User selects holdings rows and opens the Sell dialog.
2. Client sends `holding.sellByToken` with token public key, wallet public keys, and sell percentage.
3. Service fetches on-chain token balances, computes sell amounts, and submits RPC sell transactions per wallet.
4. Sell transactions can use the main wallet as fee payer when available.
5. If close ATA is enabled, the service closes empty associated token accounts after selling.
6. Client invalidates `holding.listByToken` after mutations so all mounted consumers refetch.

## UI Behavior

- Bulk sell action operates on selected holdings rows.
- Manual refresh is available; auto refresh uses `RefreshCache` staleness.
- Holding percentage uses `tokenBalance / totalMintSupply * 100`.
- Mint supply is fetched by `holding.listByToken` from RPC (`getTokenSupply`) and returned with the list payload.
- If supply is temporarily unavailable, the table shows `--` instead of `0.0000%`.
- Zero-balance rows appear when the wallet has an open ATA for the token.
- Sell dialog includes an option to close empty ATAs after the sell (enabled only for 100% sells).
- Client mutations invalidate `holding.listByToken` via `trpc.useUtils()` so mounted consumers refetch.
- `subscription.onTokenBalanceUpdate` is available server-side for real-time token balance events; the holdings page currently relies on staleness checks and explicit refresh/invalidation.