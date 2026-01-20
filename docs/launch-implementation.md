# Token Launch Implementation (sollabs-web)

## Goals
- Provide a clean, async launch pipeline with clear progress tracking and logs.
- Persist launches and allow UI resume after refresh.
- Use main wallet as funding wallet; generate dev and bundler wallets server-side.
- Support vanity mint pool selection with safe reservation and release.
- Keep launch logic modular for reuse in tokens and wallets.
- Volume bot uses dedicated `VolumeBotSession` and `VolumeBotLog` models.

## Core Flow
1. UI submits launch input via `trpc.launch.start`.
2. Server creates a `Launch` record and starts an async job.
3. Job writes structured logs to `LaunchLog` and updates `Launch.progress`.
4. UI polls `trpc.launch.status` and renders progress with shadcn/ui.
5. Cancellation sets `cancelRequestedAt`; job checks between steps.

## tRPC Endpoints
- `launch.start` (mutation): creates launch and starts async job.
- `launch.status` (query): returns launch + logs for polling.
- `launch.cancel` (mutation): requests cancellation.
- `launch.getActive` (query): resume latest running/pending launch.

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
Pool of pre-generated vanity mints.
- `reservedAt`: optimistic lock for in-progress launch
- `usedAt`: set on success
- `tokenPublicKey`: linked when mint is used

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
When `distributionWalletMultiplier > 1`, server generates `DISTRIBUTION` wallets and links them to the token. Token distribution logic is intentionally separate for later extension.

### Wallet Associations

- Operational wallets (`BUNDLER`, `VOLUME`, `DISTRIBUTION`) are token-scoped via `Wallet.tokenPublicKey`
- Dev wallets are linked through `TokenDevWallet` to allow sharing across multiple tokens
- Main wallet remains user-scoped via `User.mainWallet`

## Launch Job Steps (Short)
1. **Initialize**: mark launch RUNNING, set `startedAt`, progress to 2.
2. **Validate**: enforce min buy thresholds and bundle wallet limit.
3. **Wallets**: load main wallet, resolve dev wallet, generate bundler wallets if enabled.
4. **Funding**: transfer required SOL to dev and bundler wallets before on-chain work, including ATA rent, volume accumulator rent, and fee buffers.
5. **Metadata + Mint**: resolve image, build metadata, reserve vanity mint if requested.
6. **Create + Buy**: create token and execute dev/bundler buys (bundle via Jito if enabled).
7. **Persist**: create Token, link wallets, mark vanity mint used, generate distribution wallets if needed.
8. **Complete**: mark SUCCEEDED or CANCELED, store result metadata, log completion.

## UI Integration
`app/(app)/launch/launch-form.tsx` now:
- Starts launch via `launch.start`
- Opens `LaunchProgressDialog` and polls status
- Resumes from local storage or `launch.getActive`
- Allows user cancellation
- Uses shadcn/ui components for dialogs, badges, buttons, and progress
- Uses numeric form values end-to-end (no string parsing)
 - Emits concise step logs with structured metrics

## Key Files
- `prisma/schema.prisma` (Launch, LaunchLog, VanityMint)
- `server/services/launch.service.ts`
- `server/trpc/routers/launch.router.ts`
- `server/schemas/launch.schema.ts`
- `server/solana/bundle-create-and-buy.ts`
- `server/solana/bundle-transaction-builder.ts`
- `server/solana/pump-transaction-builders.ts`
- `app/(app)/launch/launch-progress-dialog.tsx`
- `app/(app)/launch/launch-form.tsx`

## Environment Requirements
- `SOLANA_RPC_URL` must be set for on-chain operations.
- Jito block engine URLs are defined in `src/lib/config/jito.config.ts`.
- `SHYFT_API_KEY` is required for gRPC confirmation.

## Bundle Launch
### Overview
When bundle buy is enabled, create + dev buy + bundler buys are sent as a Jito bundle. The path is:
1. Build the token create transaction.
2. Build buy transactions for each buyer.
3. Pack transactions into a bundle and submit through Jito.

### Transaction Packing Rules
- The bundle can contain up to 5 transactions.
- The first transaction includes:
  - A compute budget instruction (800k units),
  - The token create instructions,
  - Up to 1 buy.
- Subsequent transactions include up to 3 buys each.
- With 10 bundler wallets + dev buy (11 total buys), the packing is:
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

## Balance Refresh Strategy

- Balances are refreshed on demand only
- Server enforces a 15-second debounce per wallet

