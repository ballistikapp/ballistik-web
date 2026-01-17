# Token Launch Implementation (sollabs-web)

## Goals
- Provide a clean, async launch pipeline with clear progress tracking and logs.
- Persist launches and allow UI resume after refresh.
- Use main wallet as funding wallet; generate dev and bundler wallets server-side.
- Support vanity mint pool selection with safe reservation and release.
- Keep launch logic modular for reuse in tokens, wallets, and volume-bot features.

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
When `distributionMultiplier > 1`, server generates `DISTRIBUTION` wallets and links them to the token. Token distribution logic is intentionally separate for later extension.

## Launch Job Steps
- Validate inputs and thresholds
- Load main wallet and prepare dev wallet
- Generate bundler wallets when enabled
- Resolve metadata image (base64 or URL)
- Reserve vanity mint if requested
- Create token using PumpFun SDK
- Execute bundle buys (sequential SDK buy instructions)
- Persist token + wallet associations
- Mark launch complete and store result metadata

## UI Integration
`app/(app)/launch/launch-form.tsx` now:
- Starts launch via `launch.start`
- Opens `LaunchProgressDialog` and polls status
- Resumes from local storage or `launch.getActive`
- Allows user cancellation
- Uses shadcn/ui components for dialogs, badges, buttons, and progress

## Key Files
- `prisma/schema.prisma` (Launch, LaunchLog, VanityMint)
- `server/services/launch.service.ts`
- `server/trpc/routers/launch.router.ts`
- `server/schemas/launch.schema.ts`
- `app/(app)/launch/launch-progress-dialog.tsx`
- `app/(app)/launch/launch-form.tsx`

## Environment Requirements
- `SOLANA_RPC_URL` must be set for on-chain operations.

## Extension Points
- Add distribution transfer logic to move tokens into distribution wallets.
- Add fee collection and Jito tip handling if needed.
- Reuse `Launch` and `LaunchLog` for volume-bot workflows.
