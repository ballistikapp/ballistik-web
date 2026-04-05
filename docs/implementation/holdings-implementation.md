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

## Sell Flow

1. User selects holdings rows and opens the Sell dialog.
2. Client sends `holding.sellByToken` with token public key, wallet public keys, sell percentage, and optional toggles (`closeAta`, `returnSolToMainWallet`).
3. Service fetches on-chain token balances, computes sell amounts, and submits RPC sell transactions per wallet.
4. Sell transactions can use the main wallet as fee payer when available.
5. Sell submissions are concurrency-limited via `rpcConfig.tuning.sellConcurrency` (default 5) instead of unbounded fan-out.
6. Sell RPC calls now use `retryRpcWithTimeout`:
   - `getLatestBlockhash` uses `rpcConfig.tuning.rpcTimeoutMs` (30s default)
   - `sendAndConfirmTransaction` uses `rpcConfig.tuning.confirmTimeoutMs` (120s default)
7. If close ATA is enabled, the service closes empty associated token accounts after selling.
8. If return SOL is enabled, the service returns the maximum available SOL from processed wallets to the main wallet. It tries to use the main wallet as fee payer when possible and otherwise falls back to the existing source-funded transfer.
9. Client invalidates `holding.listByToken` after mutations so all mounted consumers refetch.

## UI Behavior

- Bulk sell action operates on selected holdings rows.
- Shared `main = dev` holdings should appear as one logical wallet row, not duplicated role rows.
- Manual refresh is available; auto refresh uses `RefreshCache` staleness.
- Header layout keeps title on the left and refresh controls on the right.
- Metrics cards are shown under the header and summarize currently loaded holdings rows.
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
