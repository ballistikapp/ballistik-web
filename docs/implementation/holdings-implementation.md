# Holdings Implementation

## Overview

Holdings show per-wallet token balances, holding percentage vs mint supply, and last activity for a selected token. The holdings page supports refresh and bulk sell actions. Wallets with open token accounts (ATAs) are included even when the balance is zero so users can close them.

## tRPC Procedures

- `holding.listByToken` fetches holdings for a token (optionally filtered by wallet) and includes token mint supply metadata for `Holding %`.
- `holding.refreshByToken` refreshes holdings via Shyft `getTokenBalance()` per wallet (fetches only the target token's balance). Falls back to batched RPC `getMultipleParsedAccounts` when `SHYFT_API_KEY` is not set.
- `holding.buyByToken` submits buy transactions for selected wallets using a SOL amount per wallet.
- `holding.sellByToken` submits sell transactions for selected wallets at a percentage of on-chain token balances.

## Access Rules

- Token ownership is verified on every holdings read and mutation.
- Allowed wallets are the main wallet, token dev wallet, and token operational wallets.
- Sell actions only execute for allowed wallets with private keys.
- When `main = dev`, holdings behavior must treat that shared wallet as one owner keyed by `wallet.publicKey`.

## Refresh Flow

The `refreshByToken` service is optimized for speed:

1. `getAllowedWallets()` resolves the token and its associated wallets.
   - Shared main/dev addresses are deduped by `publicKey` before balance fetching.
2. Balance fetching uses an **adaptive strategy**:
   - Small/medium wallet sets use Shyft `getTokenBalance()` per wallet with bounded concurrency and retry/backoff on transient errors.
   - Large wallet sets use direct batched RPC (`getMultipleParsedAccounts`) for faster aggregate fetch throughput.
   - Safety on provider failure is preserved: unresolved wallets are skipped and never destructively deleted in that run.
3. Existing holdings are fetched, then refresh computes a **diff**:
   - `create` when a row should exist and is missing
   - `update` only when persisted fields actually changed
   - `delete` when no balance/no ATA and a row exists
   - `lastUpdated` changes only for rows that were created/updated
4. Last transaction lookup (`DISTINCT ON`) is narrowed to wallets that are actually being created/updated (instead of all wallets in scope).
5. Persistence runs in a single atomic write phase with batched delete (`deleteMany`) plus grouped create/update operations.
   - If duplicate `Holding` rows already exist for the same `(walletPublicKey, tokenPublicKey)`, refresh keeps one canonical row and deletes the extras.
6. The mutation touches refresh cache state; client invalidates `holding.listByToken` and refetches.

## Sidebar badge cache (`token.getSidebarCounts`)

The app shell sidebar shows badges (holdings / wallets with balance / active volume-bot sessions) from `token.getSidebarCounts`. After any flow that mutates **holdings**, **token-scoped wallet SOL** used in those counts, or **volume-bot session** status for a mint, the client must call `invalidateTokenSidebarCounts` from `@/lib/trpc/invalidate-token-sidebar-counts` with that mint and `trpc.useUtils()` so React Query refetches the procedure. Holdings refresh, sell, exit completion, dashboard refresh/monitoring holdings refresh, and related wallet balance updates are wired accordingly; new features touching the same DB surfaces should follow the same pattern.

## Sell Flow

1. User opens the shared `SELL` dialog from the dashboard/holdings page or selects table rows and clicks `Sell Selected`.
2. For full `SELL` openings, the dialog hydrates immediately from the dashboard/holdings data already on the page, lists wallets with positive token balances, and selects all wallets by default. Users can adjust the wallet selection before selling.
   - The dialog auto-refreshes holdings only when the known holdings refresh timestamp is older than one minute.
   - A manual Refresh button in the wallet selector lets users force a holdings refresh before selling.
3. For `Sell Selected`, the dialog opens on the Sell tab with the selected table wallets only, preserving the focused selected-wallet flow.
4. Client sends `holding.sellByToken` with token public key, selected wallet public keys, sell percentage, and optional toggles (`closeAta`, `returnSolToMainWallet`).
5. Service fetches on-chain token balances, computes sell amounts, and submits RPC sell transactions per wallet.
6. Sell transactions can use the main wallet as fee payer when available.
7. Sell submissions are concurrency-limited via `rpcConfig.tuning.sellConcurrency` (default 5) instead of unbounded fan-out.
8. Sell RPC calls now use `retryRpcWithTimeout`:
   - `getLatestBlockhash` uses `rpcConfig.tuning.rpcTimeoutMs` (30s default)
   - `sendAndConfirmTransaction` uses `rpcConfig.tuning.confirmTimeoutMs` (120s default)
9. If close ATA is enabled, the service closes empty associated token accounts after selling.
10. If return SOL is enabled, the service returns the maximum available SOL from processed wallets to the main wallet. It tries to use the main wallet as fee payer when possible and otherwise falls back to the existing source-funded transfer.
11. Client invalidates `holding.listByToken` after mutations so all mounted consumers refetch.

## Buy Flow

1. User opens the `BUY` dialog from the holdings page or from the dashboard action beside `SELL`.
2. Dialog lists existing eligible token wallets except the standalone main wallet. The dev wallet is selected by default; operational wallets are available but unselected. If the main wallet is also the token dev wallet, that shared main/dev address remains eligible as the dev wallet.
3. User may create token-scoped `BUYER` wallets from the dialog before buying. The creation step charges the generated-wallet platform fee (`0.02 SOL` each) through the shared usage-fee policy: Free pays full, Developer receives the configured discount, and Pro is waived.
4. Newly created buyer wallets are automatically selected for the current buy after `wallet.createBuyerByToken` succeeds and wallet queries refetch.
5. User enters `SOL per wallet`; buy flow does not support Jito or token-target buys.
6. Advanced settings are collapsed by default and currently expose slippage in basis points.
7. Client sends `holding.buyByToken` with token public key, selected wallet public keys, SOL amount per wallet, and slippage.
8. Service verifies token ownership, resolves allowed wallets with private keys, fetches wallet SOL balances, and estimates each wallet's required SOL including buy amount, ATA rent when needed, the wallet account's post-buy rent-exempt residual, transaction buffer, and an extra pump-fee reserve (`max(2%, 0.002 SOL)`).
9. When a selected buying wallet has insufficient SOL, the main wallet funds only the estimated deficit before the buy.
10. Buy transactions use `buildBuyTokenTransaction` with quote-derived `minTokensOut` from the configured slippage.
11. Buy submissions are concurrency-limited using the same bounded RPC fan-out pattern as holding sells.
12. After buying, only wallets that received top-up funding are considered for excess return, and the service returns only SOL above that wallet's pre-buy balance threshold.
13. Per-wallet buy send failures are logged with wallet, mint, amount, slippage, and transaction logs when available. If every selected wallet fails to buy, the mutation throws a user-facing error instead of returning a successful `0 submitted` result.
14. Client refreshes holdings, selected wallet balances, main wallet balance, dashboard stats, and sidebar counts after completion.

## UI Behavior

- The shared `SELL` dialog has `Sell` and `Exit` tabs. The Sell tab can operate on refreshed wallet holdings or on a constrained selected-row wallet set.
- The `BUY` dialog is separate from `SELL`/`Exit`, is available from both holdings and dashboard, and performs regular per-wallet buys without tabs.
- BUY supports generating token-scoped `BUYER` wallets directly in the dialog as a separate step before the user clicks `Buy`.
- BUY v1 uses SOL-per-wallet as the only amount mode. Token-target buying can be added later as a quote-driven mode with explicit max SOL handling.
- BUY advanced settings are collapsed behind an accordion and start with slippage.
- Full `SELL` openings do not depend on holdings table row selection. They open from current page/dashboard data, show wallets with positive balances, and select all wallets by default. They refresh on open only when holdings data is stale by more than one minute.
- The holdings table toolbar exposes `Sell Selected` for selected-row sells. A separate `SELL` button in the holdings summary area opens the full shared dialog.
- Shared `main = dev` holdings should appear as one logical wallet row, not duplicated role rows.
- Manual refresh is available; auto refresh uses `RefreshCache` staleness.
- Header layout keeps title on the left and refresh controls on the right.
- Metrics cards are shown under the header in three columns: active wallets with ATAs tracked, holdings value with total tokens and supply share, and the standalone `SELL` action.
- Holding percentage uses `tokenBalance / totalMintSupply * 100`.
- Mint supply is fetched by `holding.listByToken` from RPC (`getTokenSupply`) and returned with the list payload.
- Mint supply lookups use a short-lived in-memory cache (10s TTL, capped map size) to reduce repeated RPC calls across paginated requests.
- If supply is temporarily unavailable, the table shows `--` instead of `0.0000%`.
- Zero-balance rows appear when the wallet has an open ATA for the token.
- Sell dialog includes an option to close empty ATAs after the sell (enabled only for 100% sells and checked by default when the dialog opens).
- Sell dialog includes a "Return SOL to main wallet" toggle with a short description that it returns the maximum available SOL from processed wallets back to the main wallet, and it is checked by default when the dialog opens.
- After sell and exit flows complete from the holdings page, the client refreshes holdings and related wallet balances, then invalidates the affected wallet queries so the next wallet view reflects the latest balances.
- `subscription.onTokenBalanceUpdate` is available server-side for real-time token balance events; the holdings page currently relies on staleness checks and explicit refresh/invalidation.
- This pass is application-level only; no schema migration is introduced for holdings dedupe.

## Test Run Logging

Holdings instrumentation for the production-readiness run is defined in `docs/implementation/test-run-logging.md`.

Holdings-specific logging must capture:

- `holdings_refresh` events for manual and monitoring refresh paths
- `holdings_page_snapshot` events describing the rows and totals shown to the user
- `trade_result` and `funds_return` context for `holding.sellByToken`
- Before/after wallet balance snapshots when sell flows optionally return SOL to the main wallet

The automated log must be detailed enough to compare:

- Holdings-page totals
- Dashboard holdings aggregates
- Per-wallet sell outcomes
- Recovered SOL returned after sell flows
