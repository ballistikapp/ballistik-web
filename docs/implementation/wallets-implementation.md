# Wallets Implementation (Token-Scoped)

## Overview

Wallets are token-scoped for operational usage, while the main wallet is user-scoped. The wallets page and wallet detail pages separate operational wallets (bundler/volume/distribution) from the main and dev wallets, with different fetch paths and behavior.

Wallet-adapter authentication does not replace the Main Wallet. The connected wallet is stored separately as `User.authWalletPublicKey` for login/linking, and the server-held Main Wallet remains the funding, fee, recovery, and execution wallet used by app actions.

When a token launch uses `devWalletOption = use_main`, the token's dev wallet and the user's main wallet share the same wallet address. In that case, the UI should present a single shared wallet concept labeled `Main Wallet (used as dev)` instead of rendering duplicate main/dev presentations for the same public key.

## Data Model

- `Wallet.tokenPublicKey` is used for operational wallets (bundler/volume/buyer/distribution).
- Dev wallets are shared across tokens via `TokenDevWallet` join model.
- Main wallet is user-scoped via `User.mainWallet`.
- Wallet-adapter login identity is user-scoped via `User.authWalletPublicKey` and is not a `Wallet` row.
- App-managed `Wallet` rows are not valid wallet-adapter login identities for other accounts. A connected wallet can only be linked as an auth wallet when it is external to the app-managed wallet table, or when it is the current user's own Main Wallet during authenticated linking.
- `Wallet.isSystemWallet` (`Boolean @default(false)`) marks the platform-provided dev wallet.
- System dev wallet stores an empty string `""` as `privateKey` (placeholder — never decoded). The `isSystemWallet` flag prevents any code from trying to use it. The actual signing key is loaded from env.

Prisma changes:

- `Wallet.tokenPublicKey` (nullable)
- `Wallet.isSystemWallet` (`Boolean @default(false)`)
- `Token.operationalWallets` (relation to `Wallet`)
- `TokenDevWallet` join model for dev wallet sharing

### System Dev Wallet

The system dev wallet is a platform-provided keypair stored in the `SYSTEM_DEV_WALLET_PRIVATE_KEY` env var. Its DB `Wallet` row has `privateKey: ""` (empty placeholder) and `isSystemWallet: true`. It is used as the default dev wallet for free-tier launches and is available to Pro users as an explicit option.

The system dev wallet is excluded from:
- Wallet pages, wallet detail, wallet balance totals
- Private key export (`wallet.getPrivateKey` rejects it)
- Manual send/return SOL flows
- Wallet balance refresh and live balance subscriptions
- Volume bot eligibility

The system dev wallet is included in:
- Holdings, dashboard holdings, and transactions (token-position views)
- Sell and exit flows (with forced SOL recovery to user's main wallet)
- Launch funding and cleanup

Creator rewards are **not available** for tokens using the system dev wallet — the service returns `eligible: false` and the dashboard card is hidden.

## Volume Bot Wallets

- Volume bot wallets are still `Wallet` rows with `type = VOLUME`.
- Per-session state and recovery metadata live in `VolumeBotWallet`.
- Reclaim and close-accounts actions update both the wallet balance and the session wallet status.

## Buyer Wallets

- Buyer wallets are token-scoped `Wallet` rows with `type = BUYER`.
- They are generated from the holdings/dashboard `BUY` dialog as a separate step before buying.
- Each generated buyer wallet is charged through the shared generated-wallet usage-fee policy (`0.02 SOL` each before plan discounts/waivers).
- Newly created buyer wallets are included in operational wallet queries and are eligible for holdings buy, sell, exit, send, return, balance refresh, dashboard stats, and transaction refresh flows.

## Queries and Services

tRPC procedures:

- `wallet.getOperationalByToken` fetches operational wallets by `tokenPublicKey` (`BUNDLER`, `VOLUME`, `BUYER`, `DISTRIBUTION`).
  - Supports optional pagination: `page`, `pageSize` (default `1` / `200`, max `200`).
  - Returns `totalCount` alongside the current page of wallets.
- `wallet.createBuyerByToken` generates token-scoped `BUYER` wallets and collects the generated-wallet usage fee from the main wallet before persisting the new wallet rows. Denied for legacy Tokens (`platformVersion == null`) via `assertNonLegacyPlatformCapability` ("new buys").
- `wallet.getDevByToken` fetches dev wallet for a token via `TokenDevWallet`.
- `wallet.getMain` fetches the user main wallet.
- `wallet.getByPublicKey` fetches a single wallet with token ownership checks.
- `wallet.getPrivateKey` fetches a wallet private key on-demand after access checks.
- `wallet.refreshBalances` refreshes balances via server-side RPC with a 5s debounce.
- `wallet.refreshBalances` accepts optional `force` to bypass debounce for immediate post-transaction refreshes.

After balance refresh or token-scoped SOL send/return flows that can change sidebar badge inputs, the client calls `invalidateTokenSidebarCounts` (see `@/lib/trpc/invalidate-token-sidebar-counts` and `docs/implementation/holdings-implementation.md` — Sidebar badge cache).
- `wallet.refreshBalances` returns structured outcomes for manual UX:
  - `refreshed`
  - `skippedCooldown`
  - `skippedNotAllowed`
  - `requestedCount`
  - `targeted`
- `wallet.sendSol` sends SOL from main wallet to selected token wallets.
- `wallet.returnSol` returns SOL from selected token wallets to main wallet, using the main wallet as fee payer for max reclaim when possible and falling back otherwise.
- `wallet.sendSol` and `wallet.returnSol` return structured transfer outcomes:
  - `submittedCount`
  - `failedCount`
  - `skippedCount`
  - `results: [{ publicKey, status, signature?, error? }]`

Service rules:

- Operational wallets must match `Wallet.tokenPublicKey`.
- Dev wallet access is validated through `TokenDevWallet`.
- Main wallet is always user-scoped via `User.mainWallet`.
- `wallet.getWalletByToken` parallelizes token/user ownership reads with `Promise.all` before wallet-specific validation.
- `wallet.getWalletPrivateKey` parallelizes token/user ownership reads with `Promise.all` before wallet-specific validation.

## Access Rules

- Token ownership is verified on all wallet reads and mutations
- Main wallet access is validated via `User.mainWallet`
- Dev wallet access is validated via `TokenDevWallet`
- Operational wallets must match the requested `tokenPublicKey`

## Generated Private Key Persistence

- Any wallet private key generated by server-side flows is appended to `.keys/generated-private-keys.jsonl`.
- The `.keys/` directory is created locally on demand and ignored by git.
- Records are written in JSONL format with source metadata (`service`, `operation`) plus `publicKey`, `privateKey`, and timestamp.
- Imported keys are not part of this generated-key persistence rule.

## RPC Usage

- All Solana RPC calls are server-side only
- RPC URL and credentials are never exposed to the client
- Balance refresh is initiated from the UI but executed on the server
- When `SHYFT_API_KEY` is set, balance refresh uses Shyft Wallet API (`GET /sol/v1/wallet/balance`) instead of raw `getMultipleAccountsInfo` RPC calls
- Falls back to raw RPC if Shyft API is unavailable
- Timeout and retry controls are centralized:
  - `retryRpcWithTimeout` wraps long-tail calls
  - `rpcConfig.tuning.rpcTimeoutMs` defaults to 30s for read RPC calls
  - `rpcConfig.tuning.confirmTimeoutMs` defaults to 120s for `sendAndConfirmTransaction`
- Transfer mutations use configurable concurrency via `rpcConfig.tuning.transferConcurrency` (default 5)

## Data Fetch Patterns

- Main wallet: `wallet.getMain`
- Dev wallet: `wallet.getDevByToken`
- Operational wallets: `wallet.getOperationalByToken`
- Token selector data: `token.getUserTokens` returns paginated payloads (`items`, `totalCount`, `page`, `pageSize`) and UI currently consumes the first page.
- Token selector payloads are public-only and do not include sensitive fields such as `privateKey`.

## Token Private Key Access Contract

- Default token reads are sanitized (`token.getUserTokens`, `token.getAllUserTokens`, `token.getByPublicKey`) and return only non-sensitive token metadata.
- Token private keys are available only through explicit user-triggered retrieval using `token.getPrivateKey`.
- `token.getPrivateKey` is a protected mutation intended for on-demand access checks; consumers should avoid background/prefetch patterns for this call.
- The My Tokens table (`/tokens`) includes a row action (`Show Private Key`) that opens a confirmation dialog and fetches the token private key only after the user clicks `Get private key`.

## UI Behavior

Wallets list page:

- Separates main/dev wallets from operational wallets.
- When main and dev share the same `publicKey`, renders a single shared wallet card labeled `Main Wallet (used as dev)`.
- Shared-wallet totals and transfer selections must dedupe by `publicKey` so the same address is not counted twice.
- Provides bulk actions for refresh, send, and return.
- Dev wallet actions include send and return.
- Shared-wallet presentations do not expose self-transfer or self-return actions.

Wallet detail page:

- Non-main wallets allow send and return actions.
- When the token dev wallet is the same address as the user's main wallet, the detail title remains `Main Wallet (used as dev)` and does not expose self-transfer or self-return actions.
- Private keys are fetched on demand from a dialog in the wallet detail view.
- Wallet detail includes holdings and transactions tables scoped to the current wallet.
- Wallet detail tables reuse:
  - `holding.listByToken({ tokenPublicKey, walletPublicKey })`
  - `transaction.listByToken({ tokenPublicKey, walletPublicKey, groupBySignature: false })`
- Sorting and pagination remain client-side in DataTable because datasets are already constrained by `walletPublicKey`.
- Wallet detail transactions are action-level rows (not signature-grouped).

## Balance Strategy

- DB stores `balanceSol`, `balanceRefreshedAt`.
- Refresh is on-demand only; no background auto-refresh.
- Server enforces a 5-second debounce per wallet by default.
- `force: true` bypasses debounce and is reserved for post-transaction refreshes.
- `RefreshCache` stores the last successful wallet refresh timestamp per token/scope (including targeted refreshes) to drive staleness checks.
- tRPC subscription `subscription.onBalanceUpdate` pushes real-time balance changes via gRPC stream, reducing the need for manual refresh.

## Post-Tx Targeted Refresh Policy

After SOL-moving transactions, the app performs targeted refreshes for affected wallets instead of relying only on broad invalidation:

- Source wallet(s) and destination wallet(s) are refreshed together.
- Main wallet is included whenever it sends or receives SOL.
- Post-tx refresh calls use `wallet.refreshBalances` with `force: true` to avoid debounce delays.
- Post-tx refresh source-of-truth is the service layer (`walletService.sendSolFromMainWallet` and `walletService.returnSolToMainWallet`).
- Client dialogs consume transfer outcomes and invalidate query caches for mounted consumers, but do not trigger a second forced refresh.
- Manual refresh actions continue to use default debounce behavior (`force` omitted).

## Cache Invalidation

Wallet balance queries use targeted `wallet.refreshBalances` for post-tx and manual updates. Manual targeted refreshes patch query caches first (`setData`) and only fall back to invalidate when needed.

## Manual Refresh Behavior

- **Refresh all**: requests all allowed wallets for the token scope and keeps broad invalidation behavior.
- **Refresh selected / single wallet**: uses targeted wallet keys, applies structured outcome toasts, and patches wallet caches directly.
- **Cooldown feedback**: uses `skippedCooldown` from server output for accurate partial-result messaging.
- **Access feedback**: requested wallets outside token access are surfaced via `skippedNotAllowed`.
- **Detail/list consistency**: detail-page refresh also patches list query caches for the refreshed wallet.

## Transfer UX Behavior

- Send and return execute in best-effort mode per wallet for bulk selections.
- Users receive summary feedback for partial success (`submitted/failed/skipped`).
- Failed wallet outcomes include per-wallet error text when available.
- Send mode shows total outflow preview: `amountPerWallet * selectedWalletCount`.
- Shared main/dev wallet addresses are excluded from token-wallet transfer targets so users cannot send from main to the same main wallet through the dev-wallet path.

Invalidation triggers:

- **Launch success**: `wallet.getMain` is invalidated when the launch status transitions to `SUCCEEDED` (main wallet funds dev/bundler wallets).
- **Volume bot start**: `wallet.getMain` is invalidated after `volumeBot.start` succeeds (main wallet funds session wallets).
- **Volume bot reclaim**: `wallet.getMain` is invalidated after `volumeBot.reclaim` succeeds (session wallets return SOL to main wallet).
- **Holdings sell**: `wallet.getMain` is invalidated after `holding.sellByToken` succeeds (main wallet may be the fee payer).
- **Send/Return SOL**: `wallet.getMain`, `wallet.getOperationalByToken`, and `wallet.getDevByToken` are invalidated directly inside `WalletTransferDialog` after successful transfers. The parent `onSuccess` callback remains for non-cache concerns (e.g. `RefreshCache` timestamp updates, toasts).

Wallet queries override the global 5-minute `staleTime` with `cacheConfig.staleMs.wallets` (60s) so that navigating to a page with stale cached data triggers a background refetch as a safety net.

## Account Pages (User-Scoped)

Routes:

- `/account` redirects to `/account/main-wallet`.
- `/account/main-wallet` shows the user's Main Wallet operations.
- `/account/auth-wallet` shows wallet-adapter login linking.
- `/account/subscription` shows subscription management.

The account pages are top-level, not token-scoped. They live outside the `[tokenPublicKey]` scope because the main wallet and wallet-adapter login identity are user-scoped.

### Sections

1. **Main Wallet** (`/account/main-wallet`): display name (editable inline), SOL balance with refresh, public key (copyable), private key (on-demand dialog), View on Solscan link, Deposit, Withdraw, and Send SOL action.
2. **Auth Wallet** (`/account/auth-wallet`): linked wallet-adapter public key or link flow using a connected wallet signature.
3. **Subscription** (`/account/subscription`): paid plan purchase, upgrade, extension, and billing history.

### Backend Procedures

- `auth.updateName` — `protectedProcedure` mutation. Updates `User.name`.
- `wallet.getMainPrivateKey` — `protectedProcedure` mutation. Returns the main wallet private key by user ownership (no token context needed).

### Send SOL Flow

The main-wallet account page uses `AccountSendDialog` to send SOL from the main wallet to token-scoped wallets:

1. User selects a token from a dropdown (`token.getUserTokens`).
2. Wallets for the selected token are loaded (`wallet.getOperationalByToken` + `wallet.getDevByToken`).
3. User selects wallet(s) via checkboxes, enters amount per wallet.
4. Submit calls existing `wallet.sendSol` with the selected `tokenPublicKey` and `walletPublicKeys`.

### Deposit & Withdraw (User-Scoped Main Wallet)

The main-wallet account page and auth dropdown also expose user-scoped main wallet actions:

- **Deposit**: informational only (no mutation). Shows the main wallet public key, copy action, and QR code. Users fund this wallet to use app features, including users who signed in through wallet adapter.
- **Withdraw**: sends SOL from the user's main wallet to any external wallet address.
- **Wallet Login**: shows linked connected-wallet status. If no connected wallet is linked, authenticated users can connect a wallet, sign a one-time challenge, and link it for future login. Linking is performed only on `/account/auth-wallet`; the header dropdown links to that page rather than embedding the adapter controls.

Withdraw behavior:

1. User enters destination wallet address.
2. User either enters `amountSol` or chooses `Max`.
3. UI requires a review step and then a final destructive confirmation before submit.
4. Submit calls `wallet.withdrawMainSol`.

### Main Withdraw API Contract

- `wallet.withdrawMainSol` is user-scoped and does not require `tokenPublicKey`.
- Input:
  - `destinationPublicKey: string`
  - `amountSol?: number`
  - `useMax?: boolean`
- Validation:
  - destination must be a valid Solana public key
  - either `amountSol` or `useMax` must be provided
- Service:
  - recomputes spendable lamports from live RPC state
  - for `useMax`, subtracts estimated network fee
  - rejects non-positive transfer amounts
  - submits one transfer transaction and refreshes main wallet balance
  - returns `signature` and effective `amountSol`

### Cache Invalidation

- `auth.updateName` success invalidates `auth.me`.
- `auth.linkWalletAdapter` success invalidates `auth.me`.
- Send SOL success invalidates `wallet.getMain`, `wallet.getOperationalByToken`, and `wallet.getDevByToken` (same pattern as `WalletTransferDialog`).

## Migrations

Use `prisma migrate dev` to generate migrations after schema changes. Do not create migration files manually.

Latest performance migration added:

- `Wallet(tokenPublicKey, type)` for operational wallet list filters.
