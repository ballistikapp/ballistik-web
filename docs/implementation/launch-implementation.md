# Token Launch Implementation (sollabs-web)

## Goals

- Provide a clean, async launch pipeline with clear progress tracking and logs.
- Persist launches and allow UI resume after refresh.
- Use main wallet as funding wallet; generate dev and bundler wallets server-side.
- Support vanity mint pool selection with reserve-first behavior and bounded retry fallback.
- Keep launch logic modular for reuse in tokens and wallets.
- Volume bot uses dedicated `VolumeBotSession` and `VolumeBotLog` models.

## Core Flow

1. UI submits launch input via `trpc.launch.start`.
2. Server performs synchronous input and funding preflight checks before queueing.
3. If the main wallet cannot cover required launch funding, `launch.start` throws the exact user-facing error and no `Launch` record is created.
4. When preflight passes, server creates a `Launch` record and starts an async job.
5. Job writes structured logs to `LaunchLog` and updates `Launch.progress`.
6. UI polls `trpc.launch.status` and renders progress with shadcn/ui.
7. Cancellation sets `cancelRequestedAt`; job checks between steps.

## tRPC Endpoints

- `launch.start` (mutation): runs synchronous validation/funding preflight, then creates launch and starts async job.
  - Insufficient-funds failures return immediately and do not enqueue a launch.
- `launch.previewCosts` (query): returns a live pre-operation quote for launch costs and expected wallet impact.
- `launch.status` (query): returns launch + logs for polling.
- `launch.cancel` (mutation): requests cancellation.
- `launch.getActive` (query): resume latest running/pending launch.
- `launch.recoveryWallets` (query): returns wallets eligible for SOL recovery after launch runs.
- `launch.recoverSol` (mutation): transfers recoverable SOL from launch wallets back to main wallet.
  - Idempotent behavior: when no eligible wallets are found, it returns an empty result set instead of throwing.
- `launch.recoveryWalletsByToken` (query): resolves failed/canceled launch by token and returns wallets eligible for recovery.
- `launch.recoverSolByToken` (mutation): token-scoped reclaim entrypoint for Manage Tokens row actions.
- `launch.getUserLaunches` (query): returns all user launches with token join for the clone token dialog.

## Database Models

### Launch

Tracks state and progress.

- `status`: PENDING | RUNNING | SUCCEEDED | FAILED | CANCELED
- `progress`: 0–100
- `currentStep`: string
- `input`: original launch payload (JSON)
- `result`: output metadata (JSON)
- `tokenPublicKey`: token link when available
- `cancelRequestedAt`: used for safe cancellation

### LaunchLog

Structured log entries per launch.

- `level`: INFO | WARN | ERROR | STEP
- `message`: concise event
- `step`: optional step id
- `data`: optional JSON context

### VanityMint

Pool of pre-generated vanity mints (reserve first, consume after on-chain confirmation).

- `reservedAt`: set when a mint is reserved for a launch attempt before create submission.
- `usedAt`: set only after the mint is confirmed on-chain.
- `tokenPublicKey`: linked when token creation succeeds.
- `userId`: user who reserved/consumed the mint.
- If vanity is requested and no valid mint can be assigned, launch fails with a user-facing fallback message.

### Vanity Mint Failure Handling

- Vanity mints are reserved first, then consumed only after mint confirmation succeeds on-chain.
- Vanity assignment uses up to 3 random candidates from the unreserved/unused pool.
- If a candidate mint already exists on-chain, its reservation is released immediately and another candidate is attempted.
- If no valid vanity mint is assigned after retries, launch fails with: `Error assigning vanity mint. Try disabling vanity mint.`
- Failures before consume release the active reservation back to the pool.
- Failures after consume keep the vanity consumed and tied to the token.
- The system never swaps a failed vanity token to a non-vanity key.

### Token

Token records are created before on-chain submission to avoid wallet orphaning.

- `status`: PENDING | ACTIVE | FAILED
- `PENDING`: token and wallet links are persisted before create transaction is submitted
- `ACTIVE`: set after on-chain confirmation/distribution completes
- `FAILED`: set when launch errors after token persistence

## Wallet Handling

### Main Wallet

Used as the funding wallet (no selection in UI).

### Dev Wallet

Based on `devWalletOption`:

- `use_main`: main wallet
- `generate`: server creates a new `DEV` wallet
- `import`: server validates and stores imported key as `DEV`

### Bundler Wallets

If bundle buys are enabled, server generates `BUNDLER` wallets and uses them for buy transactions.

### Distribution Wallets

When `distributionWalletMultiplier > 1`, server generates `DISTRIBUTION` wallets tied to the launch and splits each bundler wallet's purchased tokens across the new wallets after buys complete. Each source wallet keeps its share (integer division remainder stays in the source).

### Wallet Associations

- Operational wallets (`BUNDLER`, `VOLUME`, `DISTRIBUTION`) are token-scoped via `Wallet.tokenPublicKey`
- Dev wallets are linked through `TokenDevWallet` to allow sharing across multiple tokens
- Main wallet remains user-scoped via `User.mainWallet`
- During launch, wallet links are persisted while token is `PENDING`, then reused for recovery/cleanup if launch fails

### Generated Private Key Persistence

- Every private key generated during launch is persisted to a local JSONL file.
- Storage directory: `.keys/` at the project root (created automatically when needed).
- Storage file: `.keys/generated-private-keys.jsonl`.
- Each record includes source metadata (`service`, `operation`), `publicKey`, `privateKey`, and timestamp.
- The local key directory is gitignored and intended only for local operational recovery/debugging.

## Launch Job Steps (Short)

1. **Initialize**: mark launch RUNNING, set `startedAt`, progress to 2.
2. **Validate**: enforce minimum buy thresholds (`0.05` SOL for dev buy, `0.1` SOL for bundle buy amount per wallet) and bundle wallet limit (max `10` bundler wallets).
3. **Wallets**: load main wallet, resolve dev wallet, generate bundler and distribution wallets if enabled.
4. **Callback Registration**: when `SHYFT_API_KEY` and `APP_URL` are set, register Shyft transaction callbacks for bundler, distribution, and dev wallet addresses (events: SWAP, TOKEN_TRANSFER, SOL_TRANSFER). Best-effort — failures do not block the launch.
5. **Funding**: transfer required SOL to dev and bundler wallets before on-chain work, including ATA rent, volume accumulator rent, distribution ATA rent, and fee buffers.
6. **Metadata + Mint**: resolve image, build metadata, reserve vanity mint if requested.
   - Metadata description appends `Launched with ballistik.app` by default.
   - Attribution is appended after two line breaks when user description exists.
   - If description is empty, metadata uses only `Launched with ballistik.app`.
   - Attribution is removed only when paid removal is enabled.
   - Vanity reservation retries up to 3 random candidates.
   - Candidates that already exist on-chain are released and skipped.
7. **Persist Pending Token**: create Token with `PENDING` status and link wallets before on-chain create.
   - `tokenImage` is uploaded to Pinata when `PINATA_JWT` is configured, and the resulting gateway URL is stored in `Token.imageUrl`.
   - If Pinata is not configured, the existing base64 data URL fallback behavior is preserved.
8. **Create + Buy**: create token and execute dev/bundler buys (bundle via Jito if enabled).
9. **Confirm**: verify token mint exists on-chain using a gRPC-first approach — subscribe to the mint account via `grpcManager` and race against RPC polling. First response wins, with automatic cleanup of the gRPC subscription on completion or timeout.
   - Vanity mint is consumed only after this confirmation succeeds.
10. **Distribution**: split bundler wallet token balances into distribution wallets when enabled.
11. **Activate**: set Token status to `ACTIVE` after launch succeeds on-chain.
12. **Post-Launch SOL Sweep**: after a successful launch, transfer excess SOL from managed launch wallets (generated dev wallet, bundler wallets, distribution wallets) back to main wallet, leaving transfer-fee buffer in each source wallet.
13. **Complete**: mark SUCCEEDED or CANCELED, store result metadata, log completion.

## UI Integration

- Launch form starts via `launch.start` and polls `launch.status`.
- Progress dialog renders launch status and logs.
- Resume uses local storage or `launch.getActive` for in-progress launches only.
- User can request cancellation.
- Manage Tokens table is powered by `launch.getUserLaunches`, mapping launch statuses to display statuses (SUCCEEDED -> ACTIVE, RUNNING/PENDING -> PENDING, FAILED/CANCELED -> FAILED).
- Reclaim actions are owned by Manage Tokens row actions (shown only when `hasRecoveryWallets` is true) and not by the launch progress dialog.
- Failed launch progress surfaces a short CTA to open Manage Tokens with failed status filtering.

### Review and Confirm Surfaces

- The in-page Review section keeps token metadata full-width at the top.
- Under token metadata, the lower block is a 2-column layout:
  - Left column: launch configuration.
  - Right column: usage-fee panel with `Total fees` followed by all fee line items.
- Fee line items are always rendered, including inactive items.
  - Inactive items are visually de-emphasized (reduced opacity + strikethrough) while still showing nominal fee amounts.
- The submit strip at the bottom of the Review step shows only:
  - Total fees
  - Total generated wallets
  - Estimated main-wallet spend
- The previous `Draft estimate` wording is replaced with `Estimated main-wallet spend`.
- The launch overview dialog mirrors the same fee-panel structure for consistency with the in-page Review step.

### Media Inputs

- Main media (`tokenImage`): JPG/PNG/GIF up to 15MB or MP4 up to 30MB.
- Client recommends 1:1 for images and 16:9 or 9:16 / 1080p+ for video.
- Banner (`tokenBanner`, optional): JPG/PNG/GIF up to 4.3MB, recommended 1500x500 (3:1).
- Launch input still carries data URLs from the form, but token persistence stores a Pinata gateway URL in `Token.imageUrl` when Pinata is enabled.
- Banner can only be set during creation and is sent with the metadata upload.
- Metadata upload posts `file` (main) and optional `banner` to `https://pump.fun/api/ipfs` alongside socials.

## Key Files

- `prisma/schema.prisma` (Launch, LaunchLog, VanityMint)
- `server/services/launch.service.ts`
- `server/services/storage.service.ts`
- `server/trpc/routers/launch.router.ts`
- `server/schemas/launch.schema.ts`
- `server/solana/bundle-create-and-buy.ts`
- `server/solana/bundle-transaction-builder.ts`
- `server/solana/pump-transaction-builders.ts`
- `app/(app)/launch/launch-progress-dialog.tsx`
- `app/(app)/launch/launch-overview-dialog.tsx`
- `app/(app)/launch/launch-form.tsx`

## Environment Requirements

- `SOLANA_RPC_URL` must be set for on-chain operations.
- `FEE_COLLECTOR_WALLET_ADDRESS` must be set for usage-fee collection.
- Jito block engine URLs are defined in `lib/config/jito.config.ts`.
- `SHYFT_GRPC_TOKEN` (or `SHYFT_API_KEY` fallback) is optional but recommended for faster gRPC-assisted confirmation; launch confirmation still has RPC polling fallback.
- `PINATA_JWT` is optional; when set, token media is uploaded to Pinata and persisted as a gateway URL.
- `PINATA_GATEWAY_URL` is optional and defaults to `https://gateway.pinata.cloud`.

## Launch Usage Fees

- Launch usage fees are documented centrally in `docs/implementation/pricing-implementation.md`.
- Launch computes and displays usage-fee breakdowns before confirmation.
- Server preflight includes usage fees in required main-wallet balance checks.
- Server collects launch usage fees from main wallet to collector wallet when launch starts.
- Launch usage fees are generated-wallet fee, vanity fee, optional attribution-removal fee, and a bundle-buy fee when `bundleBuyEnabled` is true.
- A launch can be free when bundle buy is disabled, `devWalletOption` is not `generate`, vanity mint is disabled, and attribution removal is disabled.

## Launch Cost Quote Model

Launch uses a hybrid quote model:

- Edit-time estimate in the form for responsive feedback.
- Confirm-time server quote (`launch.previewCosts`) as the source of truth.

The server quote groups values into:

- `chargedNowSol`: immediate debit from main wallet when launch starts.
- `temporaryFundingSol`: operational wallet funding and reserves expected to return later.
- `expectedReturnSol`: estimated SOL returned after post-launch cleanup.
- `permanentSpendSol`: expected non-recoverable spend.
- `netMainWalletDeltaNowSol`: immediate impact.
- `netMainWalletDeltaAfterCleanupSol`: expected final impact after return.

### Quote Categories

`launch.previewCosts` includes line items for:

- Usage fees (bundle-buy fee, attribution-removal fee, vanity fee, generated-wallet fee).
- Dev buy and bundle-buy funding requirements (including variance reserve).
- Jito tip (when bundle buy is enabled).
- Rent and setup funding (ATA rent, user volume accumulator rent, distribution ATA rent).
- Operational buffers (`createFeeBufferLamports`, `fundingBufferLamports`, `transferFeeBufferLamports`) and creator/main reserves.

### Return and Residual Handling

- Post-launch cleanup attempts to return excess SOL from managed launch wallets back to main wallet.
- If some SOL cannot be returned during cleanup, launch result metadata records actual returned and residual amounts so UI can show the difference between expected and realized post-cleanup deltas.
- Residual SOL remains recoverable through reclaim paths and should be displayed explicitly as reclaimable balance.

## On-chain Confirmation Timeouts

- Bundle CREATE confirmation timeout is set to 5 minutes in `server/solana/jito-bundle.ts`.
- Mint account confirmation timeout is set to 5 minutes via `getLaunchConfig().mintConfirmTimeoutMs` in `lib/config/launch.config.ts`.
- These longer windows reduce false launch failures during network congestion and delayed status propagation.

## Bundle Launch

### Overview

When bundle buy is enabled, create + dev buy + bundler buys are sent as a Jito bundle. The path is:

1. Build the token create transaction (via Anchor `program.methods.create`).
2. Build buy transactions for each buyer using a raw `buy_exact_sol_in` instruction with the SOL amount and `min_tokens_out = 1`.
3. Pack transactions into a bundle and submit through Jito.
4. Simulation errors hard-fail — invalid bundles are never sent to Jito.

Note: Buy instructions are built as raw `TransactionInstruction` (not via Anchor) using the `buy_exact_sol_in` discriminator with 24-byte data (discriminator + sol_amount + min_tokens_out). The `track_volume` OptionBool parameter is omitted. Each buy instruction includes 17 accounts: the standard 16 accounts plus a trailing `bonding_curve_v2` PDA (derived from `["bonding-curve-v2", mint]`). The V2 trailing account is required by the current program version — without it, the program falls into a legacy code path that overflows at `buy.rs:181`.

Note: No off-chain token amount calculation is needed. The program determines tokens from the SOL input, deducts fees (currently 1.25% via the `pfee` program), and transfers the appropriate token amount. `min_tokens_out = 1` is safe inside an atomic Jito bundle where MEV is not a concern.

### Transaction Packing Rules

- The bundle can contain up to 5 transactions.
- The first transaction includes:
  - A compute budget instruction (800k units),
  - The token create instructions,
  - Up to 1 buy.
- Subsequent transactions include up to 3 buys each.
- With the max 10 bundler wallets + dev buy (11 total buys), the packing is:
  - TX1: create + dev buy
  - TX2: 3 buys
  - TX3: 3 buys
  - TX4: 3 buys
  - TX5: 1 buy

### Buyer Amounts

- Each bundler buy amount uses a random variance:
  - `amount = bundlerBuyAmountSol ± (bundlerBuyAmountSol * bundlerBuyVariancePercent / 100)`
- Buys with non-positive amounts are skipped.
- Buy amounts represent the actual spend; ATA rent is funded separately.
- User volume accumulator rent is funded separately for each buy wallet.

### Jito Tip

- If `jitoTipAmountSol > 0`, a SOL transfer is added to the last bundle transaction.
- The tip is paid by the main wallet and sent to a Jito tip account.

### Jito Block Engine

- Bundle submission rotates through available Jito block engine endpoints based on RPC network.
- Tip accounts are cached per endpoint to reduce rate limiting.

### Signatures and Blockhash

- All bundle transactions share a single recent blockhash.
- Transactions are compiled to v0 and signed by the relevant wallets.
- Signers are deduplicated for the final tipped transaction.

### Diagnostics Logging

- Create preparation logs include fee payer, instruction count, and metadata URI prefix.
- Create simulation logs include blockhash and units consumed.
- Bundle transaction logs include instruction counts and fulfilled buy counts per tx.
- Jito bundle send logs include RPC endpoint, tipper, tip account, blockhash, and signature preview.
- Confirmation logs include summary counts, resend triggers, and gRPC confirmation.

## Clone Token

Allows users to pre-populate the launch form with configuration from a previous launch.

### Data Source

- All launch configuration is stored in `Launch.input` (JSON) for every launch.
- Each token has a `launches` relation (`Launch.tokenPublicKey` -> `Token.publicKey`).
- The clone dialog queries the `Launch` table with a `Token` join to get display data (`imageUrl`) alongside the stored input.

### tRPC Endpoint

- `launch.getUserLaunches` (query): returns all user launches ordered by `createdAt` desc.
  - Selects: `id`, `status`, `input`, `tokenPublicKey`, `errorMessage`, `createdAt`, joined `token { name, symbol, imageUrl, websiteUrl, twitterUrl, telegramUrl }`, and `_count { recoveryWallets }`.
  - Extracts `tokenName`, `tokenSymbol`, and social URLs from `input` JSON as fallback when the token relation is null (e.g. launches that failed before token creation).
  - Returns `hasRecoveryWallets` boolean derived from the recovery wallet count.
  - Serves as the canonical data source for both the Manage Tokens table and the Clone Token dialog.

### Clone Behavior

- All form fields from `Launch.input` are populated **except** `tokenImage` and `tokenBanner` (base64/data-URL file uploads are not reusable).
- Cloned fields include: token metadata (name, symbol, description, socials), dev wallet option, buy amounts, Jito tip, bundler configuration.
- The form remounts with new default values via a React `key` change, ensuring a clean TanStack Form reset.

### UI Flow

1. User clicks "Clone Token" button in the launch page header.
2. A dialog opens showing a table of previous launches (reuses the manage tokens table columns minus links/actions, plus single-row selection).
3. User selects a launch and clicks "Clone".
4. Dialog closes and the launch form is populated with the selected configuration.

### Key Files

- `app/(app)/launch/clone-token-dialog.tsx`
- `app/(app)/launch/page.tsx`
- `app/(app)/launch/launch-form.tsx`

## Launch Presets

- Launch supports URL-driven presets via the `preset` query parameter.
- `preset=free` initializes a free configuration (`devWalletOption = use_main`, bundle buy disabled, vanity disabled, attribution removal disabled).
- Missing or unknown `preset` values default to the regular preset (`devWalletOption = generate`, bundle buy enabled, `bundlerWalletCount = 10`, vanity enabled, attribution removal disabled).
- Preset values are applied before clone values; cloning overrides preset initialization.
- Unauthenticated visits preserve preset URLs through auth redirects using the `redirect` query param (for example `/launch?preset=free` -> `/auth?redirect=%2Flaunch%3Fpreset%3Dfree` -> back to `/launch?preset=free` after login/signup).

## Balance Refresh Strategy

- Balances are refreshed on demand only
- Server enforces a 15-second debounce per wallet
