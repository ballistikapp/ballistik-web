# Wallets Implementation (Token-Scoped)

## Overview

Wallets are token-scoped for operational usage, while the main wallet is user-scoped. The wallets page and wallet detail pages separate operational wallets (bundler/volume/distribution) from the main and dev wallets, with different fetch paths and behavior.

## Data Model

- `Wallet.tokenPublicKey` is used for operational wallets (bundler/volume/distribution).
- Dev wallets are shared across tokens via `TokenDevWallet` join model.
- Main wallet is user-scoped via `User.mainWallet`.

Prisma changes:

- `Wallet.tokenPublicKey` (nullable)
- `Token.operationalWallets` (relation to `Wallet`)
- `TokenDevWallet` join model for dev wallet sharing

## Volume Bot Wallets

- Volume bot wallets are still `Wallet` rows with `type = VOLUME`.
- Per-session state and recovery metadata live in `VolumeBotWallet`.
- Reclaim and close-accounts actions update both the wallet balance and the session wallet status.

## Queries and Services

tRPC procedures:

- `wallet.getOperationalByToken` fetches operational wallets by `tokenPublicKey`.
- `wallet.getDevByToken` fetches dev wallet for a token via `TokenDevWallet`.
- `wallet.getMain` fetches the user main wallet.
- `wallet.getByPublicKey` fetches a single wallet with token ownership checks.
- `wallet.getPrivateKey` fetches a wallet private key on-demand after access checks.
- `wallet.refreshBalances` refreshes balances via server-side RPC with a 10s debounce.
- `wallet.sendSol` sends SOL from main wallet to selected token wallets.
- `wallet.returnSol` returns SOL from selected token wallets to main wallet.

Service rules:

- Operational wallets must match `Wallet.tokenPublicKey`.
- Dev wallet access is validated through `TokenDevWallet`.
- Main wallet is always user-scoped via `User.mainWallet`.

## Access Rules

- Token ownership is verified on all wallet reads and mutations
- Main wallet access is validated via `User.mainWallet`
- Dev wallet access is validated via `TokenDevWallet`
- Operational wallets must match the requested `tokenPublicKey`

## RPC Usage

- All Solana RPC calls are server-side only
- RPC URL and credentials are never exposed to the client
- Balance refresh is initiated from the UI but executed on the server
- When `SHYFT_API_KEY` is set, balance refresh uses Shyft Wallet API (`GET /sol/v1/wallet/balance`) instead of raw `getMultipleAccountsInfo` RPC calls
- Falls back to raw RPC if Shyft API is unavailable

## Data Fetch Patterns

- Main wallet: `wallet.getMain`
- Dev wallet: `wallet.getDevByToken`
- Operational wallets: `wallet.getOperationalByToken`

## UI Behavior

Wallets list page:

- Separates main/dev wallets from operational wallets.
- Provides bulk actions for refresh, send, and return.
- Dev wallet actions include send and return.

Wallet detail page:

- Non-main wallets allow send and return actions.
- Private keys are fetched on demand from a dialog in the wallet detail view.

## Balance Strategy

- DB stores `balanceSol`, `balanceRefreshedAt`.
- Refresh is on-demand only; no background auto-refresh.
- Server enforces a 10-second debounce per wallet (30s when subscriptions are active).
- `RefreshCache` stores the last full refresh time per token to drive staleness checks.
- tRPC subscription `subscription.onBalanceUpdate` pushes real-time balance changes via gRPC stream, reducing the need for manual refresh.

## Cache Invalidation

Wallet balance queries use `utils.[router].[procedure].invalidate()` (via `trpc.useUtils()`) so that all mounted consumers of the same query auto-refetch without manual `refetch()` wiring.

Invalidation triggers:

- **Launch success**: `wallet.getMain` is invalidated when the launch status transitions to `SUCCEEDED` (main wallet funds dev/bundler wallets).
- **Volume bot start**: `wallet.getMain` is invalidated after `volumeBot.start` succeeds (main wallet funds session wallets).
- **Volume bot reclaim**: `wallet.getMain` is invalidated after `volumeBot.reclaim` succeeds (session wallets return SOL to main wallet).
- **Holdings sell**: `wallet.getMain` is invalidated after `holding.sellByToken` succeeds (main wallet may be the fee payer).
- **Send/Return SOL**: `wallet.getMain`, `wallet.getOperationalByToken`, and `wallet.getDevByToken` are invalidated directly inside `WalletTransferDialog` after successful transfers. The parent `onSuccess` callback remains for non-cache concerns (e.g. `RefreshCache` timestamp updates, toasts).

Wallet queries override the global 5-minute `staleTime` with `cacheConfig.staleMs.wallets` (60s) so that navigating to a page with stale cached data triggers a background refetch as a safety net.

## Migrations

Use `prisma migrate dev` to generate migrations after schema changes. Do not create migration files manually.
