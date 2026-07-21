# Token Launch Implementation (ballistik-web)

## Goals

- Provide a clean, async launch pipeline with clear progress tracking and logs.
- Persist launches and allow UI resume after refresh.
- Use main wallet as funding wallet; generate dev and bundler wallets server-side.
- Support vanity mint pool selection with reserve-first behavior and bounded retry fallback.
- Keep launch logic modular for reuse in tokens and wallets.
- Volume bot uses dedicated `VolumeBotSession` and `VolumeBotLog` models.

## Core Flow

1. UI submits versioned pump.fun launch input via `trpc.launch.start` (`versionedLaunchInputSchema`).
2. If the external input schema rejects the request, no `Launch` record is created.
3. Schema-valid submissions create a `Launch` with `platform=PUMPFUN`, `platformVersion="1"`, versioned `input` JSON **before** Platform planning, then schedule the shared lifecycle.
4. Lifecycle resolves pump.fun via `resolveLaunchPlatform`, calls `platform.plan`, persists the secret-free authoritative plan (`plan` / `planSchemaVersion` / `planPersistedAt`), then calls `platform.execute` with that exact plan on the lifecycle context.
5. Planning validation failures and insufficient main-Wallet funds transition the Launch to visible, retryable `FAILED` history (no silent discard). If plan persistence fails, pump.fun compensates local key refs / vanity reservations created during planning.
6. Execute validates the persisted pump.fun plan (`pumpfunLaunchPlanV1Schema`) and branches:
   - **Non-bundled** (`!intendedEffects.bundleBuyEnabled`): Platform-owned path (`runPumpfunNonBundledExecute` → `runNonBundledPumpfunLaunchJob`). Uses plan identities/funding, pump venue metadata upload via raw `buildCreateTokenTransaction` / `buildCreateAndDevBuyVersionedTransaction`, Launch-owned AppTransaction bookkeeping, confirm/activate/cleanup. No PumpFunSDK. System creator Wallet is rejected. Returns a typed execute outcome (not `compat`).
   - **Bundled** (`intendedEffects.bundleBuyEnabled`): Platform-owned path (`runPumpfunBundledExecute` → `runBundledPumpfunLaunchJob` → `createAndBuyInBundle`). Executes the exact persisted plan (wallets, allocations, tip, Mayhem flag, vanity reservation). Raw create/buy builders + Jito; Mayhem uses Token-2022 / dynamic ALT packing. Shared packing constants live in `bundle-transaction-builder`. No PumpFunSDK. System creator Wallet is rejected. Returns a typed execute outcome.
7. Platform success is confirmed plan-intended create/buy landing (non-bundled create or create+dev-buy; bundled Jito create+buys). Distribution, Token activate, SOL cleanup, and Launch row persistence are post-success control-plane steps: degradation keeps `succeeded` and never falsely cancels after irreversible submit.
8. Typed outcomes (`succeeded` / `canceled` / `failed` / `partial` / `indeterminate`) are mapped by the shared lifecycle to `Launch.status` plus `outcomeKind` / `outcomeDetails`. `partial` and `indeterminate` map to `FAILED` with those kinds. Fee collection runs only on `succeeded`.
9. Job writes structured logs and progress; terminal status is owned by the lifecycle after execute returns.
10. UI polls `trpc.launch.status` and renders progress with shadcn/ui.
11. Cancellation sets `cancelRequestedAt` through the lifecycle entrypoint. Cooperative cancel stops only at safe points before irreversible submission; after submit, outcomes are classified from chain evidence.

## tRPC Endpoints

- `launch.start` / `status` / `cancel` / `retry` / `getActive` route through `launchLifecycle` (`server/services/launch-lifecycle.ts`). Recovery, clone, and history remain on `launchService`.
- `launch.start` (mutation): accepts `versionedLaunchInputSchema` (pump.fun only; system creator Wallet / SPL / EVM rejected). Creates the Launch row first (versioned input + media normalize on metadata), then schedules lifecycle plan → persist → execute.
  - Schema-invalid requests never create a Launch row.
  - Insufficient-funds and other planning failures become visible retryable `FAILED` Launch history after the row exists.
- `launch.previewCosts` (query): accepts `versionedLaunchPreviewInputSchema` (Platform + config, no Token metadata). Routes through `resolveLaunchPlatform(...).preview` and returns the review envelope: `money` (`normalizedLaunchMoneySummarySchema` lamport strings + labeled line items) plus `mainWalletBalanceLamports`, `hasSufficientMainWallet`, `platformFeeWaived`, and `platformFeeDiscountRate`. Side-effect-free (read-only RPC/balance); does not persist plans, fund Wallets, publish metadata, or submit on-chain.
- `launch.status` (query): returns launch + logs for polling.
- `launch.cancel` (mutation): requests cancellation.
- `launch.getActive` (query): resume latest running/pending launch.
- `launch.recoveryWallets` (query): returns wallets eligible for SOL recovery after launch runs.
- `launch.recoverSol` (mutation): transfers recoverable SOL from launch wallets back to main wallet via Platform `recover` (validates persisted plan when present; funded-cap drain).
  - Idempotent behavior: when no eligible wallets are found, it returns an empty result set instead of throwing.
- `launch.recoveryWalletsByToken` (query): resolves failed/canceled launch by token and returns wallets eligible for recovery.
- `launch.recoverSolByToken` (mutation): token-scoped reclaim entrypoint for My Tokens and Launch history row actions when a Token mint exists (also via Platform `recover`).
- `launch.status` also surfaces failed-launch auto reclaim activity through launch logs and `Launch.result`.
- `launch.getUserLaunches` (query): returns all user launches with token join for the clone token dialog.

## Database Models

### Launch

Tracks state and progress.

- `status`: PENDING | RUNNING | SUCCEEDED | FAILED | CANCELED
- `progress`: 0–100
- `currentStep`: string
- `platform` / `platformVersion`: nullable Platform identity. Null version marks a legacy Launch (do not infer from JSON shape). New records use `PUMPFUN` + version `"1"`.
- `input`: original launch payload (JSON). Legacy rows keep the flat shape; new submissions store the discriminated versioned contract (`server/schemas/launch-platform.schema.ts`). Plan/start use versioned `metadata`/`config` directly. Retry/clone/legacy reads resolve both shapes via `resolveStoredLaunchInput` without migrating legacy JSON. Execute still resolves stored input for media/fees/logs while wallets and funding come from the persisted plan.
- `plan` / `planSchemaVersion` / `planPersistedAt`: secret-free authoritative Platform plan. Written after `platform.plan` succeeds and before `platform.execute`. pump.fun plan schema version `"1"` (`pumpfunLaunchPlanV1Schema`) includes normalized money, public wallet identities, allocations, intended effects, recovery caps, and opaque pump fields (vanity reservation ids — never private keys).
- `outcomeKind` / `outcomeDetails`: Platform-owned outcome classification persisted by the shared lifecycle (`succeeded`, `canceled`, `failed`, `partial`, `indeterminate`).
- `result`: output metadata (JSON)
- `tokenPublicKey`: token link when available
- `cancelRequestedAt`: used for safe cancellation

### LaunchLog

Structured log entries per launch.

- `level`: INFO | WARN | ERROR | STEP
- `message`: concise event
- `step`: optional step id
- `data`: optional JSON context

### LaunchRecoveryWallet

Per-launch recovery tracking for managed wallets (cross-Platform term: Managed Launch Wallet).

- One row per recovery wallet (`DEV`, `BUNDLER`, `DISTRIBUTION` via legacy `role` enum)
- `platformRole`: optional Platform-defined role identifier string (not a global enum of every future role)
- `isManaged`: whether launch cleanup is allowed to operate on the wallet automatically
- `fundedLamports`: the actual SOL top-up this launch funded into that wallet (recovery cap; not the plan required-balance target)
- `reclaimStatus`, `reclaimTxSignature`, `reclaimError`, `lastAttemptAt`, `reclaimedAt`: reclaim bookkeeping for auto and manual recovery flows
- New-version launches persist MLW rows from the authoritative plan before funding (`platformRole` + exact public keys). Execute requires a persisted plan; there is no flat-input wallet-row fallback on the Platform path.

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
- `platform` / `platformVersion`: nullable Platform identity matching the Launch that created the Token. Null version marks a legacy Token.
- `PENDING`: token and wallet links are persisted before create transaction is submitted
- `ACTIVE`: set after on-chain confirmation/distribution completes
- `FAILED`: set when launch errors after token persistence

### Platform contracts

- `versionedLaunchInputSchema`: external `launch.start` input — shared Token metadata + pump.fun `config`. Only `PUMPFUN` is accepted; SPL/EVM and system creator Wallet are rejected at validation. Buy/bundle limits (`MIN_BUY_AMOUNT_SOL`, `MAX_BUNDLE_WALLETS`) are owned by `lib/config/launch.config.ts` and imported by schemas/service.
- New Launch/Token rows persist `platform=PUMPFUN` and `platformVersion="1"`. Tokens inherit Platform identity from the Launch at pending-token persistence.
- `launch-input-compat`: `resolveStoredLaunchInput` / `toVersionedLaunchInput` / `flattenVersionedLaunchInput` / `buildNewLaunchPersistence` support legacy flat rows, clone bags, and retry bridging without rewriting legacy JSON. New plan/start paths do not flatten as their working model.
- Funnel Platform picker exposes pump.fun (working) and SPL (coming soon); EVM is removed from selection. Client funnel is a shared shell plus `components/launch/platforms/pumpfun/`.
- `normalizedLaunchMoneySummarySchema`: shared preview/plan money summary (immediate required balance, temporary funding, permanent spend, expected return, main-Wallet deltas, usage fees, labeled line items). Amounts are integer lamport decimal strings so they survive Prisma `Json` plan storage. Signed main-Wallet deltas are outflows (negative).
- `versionedLaunchPreviewInputSchema` / `launchPlatformPreviewResultSchema`: preview input (Platform + config) and API envelope (`money` + wallet/policy fields). Stable pump.fun line labels live in `lib/launch/money-labels.ts`.
- `resolveLaunchPlatform`: typed registry resolves pump.fun only; unsupported Platforms throw before record creation. Each module exposes `preview` / `plan` / `execute` / `recover` / `compensatePlanResources`. pump.fun `preview` returns the normalized envelope via the cost calculator; `plan` builds the secret-free authoritative plan from versioned `config` (may create unfunded Wallet key refs and vanity reservations; must not fund or submit on-chain); `execute` validates the persisted plan then routes non-bundled launches to `runPumpfunNonBundledExecute` and bundled launches to `runPumpfunBundledExecute`, returning typed outcomes; `recover` validates the plan when present and reclaims SOL from persisted Managed Launch Wallet evidence with funded caps (`recoverSol` routes through it).
- Shared lifecycle (`launchLifecycle`): router entry for start/status/cancel/retry/getActive; owns plan durability (plan → persist → execute); provides lifecycle contexts including the persisted plan; maps typed Platform outcomes to `status` + `outcomeKind` / `outcomeDetails`; owns the post-success usage-fee helper. Start/cancel/retry orchestration helpers and Platform-owned execute job bodies still live in `launch.service.ts`. Fee collection runs only after Platform success and never downgrades a successful Launch when collection fails. Transitional lifecycle/execute compatibility delegates and the system creator Launch path are removed.
- Retry creates a new Launch linked to the failed attempt, reuses saved new-version input, and produces a fresh plan; the prior Launch and plan remain immutable.
- `isLegacyPlatformRecord` / `isLegacyPlatformVersion`: null `platformVersion` ⇒ legacy (never inferred from JSON input shape).

### Legacy custody-safe capability policy

Null `platformVersion` Launch/Token records are custody-safe read-only for new operations. Enforcement is a single seam: `assertNonLegacyPlatformCapability` (`server/services/launch-capability.ts`), with shared copy in `lib/launch/legacy-capability.ts`.

| Capability | Legacy (`platformVersion == null`) | Version `"1"` |
|---|---|---|
| History / detail reads | Allowed | Allowed |
| Exit / sell | Allowed | Allowed |
| SOL reclaim (launch + volume-bot) | Allowed | Allowed |
| Key access | Allowed | Allowed |
| Retry | Denied | Allowed (existing rules) |
| Clone | Denied (`launch.getCloneInput` assert + `getUserLaunches` omits clone `input`) | Allowed |
| New buys / create buyer wallets | Denied | Allowed |
| Volume bot start | Denied | Allowed |

Denied paths return a consistent user-safe `AppError` (400). UI hides/disables retry, clone, buy, and new volume-bot sessions using `isLegacy` / `platformVersion` from launch and token reads.

Database migrations remain human-owned (do not agent-run `prisma migrate`).

## Wallet Handling

### Main Wallet

Used as the funding wallet (no selection in UI).

### Dev Wallet (creator Wallet)

New launches accept only:

- `use_main`: main wallet as creator
- `generate`: server creates a new `DEV` wallet
- `import`: server validates and stores imported key as `DEV`

The system creator Wallet option is removed from new Launch input, planning, and execute. Legacy rows that still store `devWalletOption: "system"` remain readable under the legacy custody-safe policy; retry/clone of those rows is denied with a user-safe explanation. `nonSystemDevWalletFeeSol` is `0` (legacy fee line retained for display compatibility).

When `use_main` is selected, the launch still persists the token's dev-wallet link, but the linked address is the user's main wallet. Downstream wallet UI should present this as one shared wallet labeled `Main Wallet (used as dev)` instead of two separate wallet cards for the same address.

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
2. **Validate**: enforce minimum buy thresholds and bundle wallet limit from `lib/config/launch.config.ts` (`MIN_BUY_AMOUNT_SOL` / `MAX_BUNDLE_WALLETS`; currently `0.05` SOL and `8` bundler wallets). System creator Wallet is rejected.
3. **Wallets**: load main wallet and Managed Launch Wallet keypairs from the persisted plan (keys created during planning). Persist `LaunchRecoveryWallet` rows from the plan before funding.
4. **Callback Registration**: when `SHYFT_API_KEY` and `APP_URL` are set, register Shyft transaction callbacks for bundler, distribution, and dev wallet addresses (events: SWAP, TOKEN_TRANSFER, SOL_TRANSFER). Best-effort — failures do not block the launch.
5. **Funding**: transfer SOL to reach plan required-balance targets before venue submission. Snapshot actual top-ups onto `fundedLamports`.
6. **Metadata + Mint**: resolve image, build pump venue metadata, consume vanity reservation from the plan when present.
   - Metadata description appends `Launched with ballistik.app` by default.
   - Attribution is appended after two line breaks when user description exists.
   - If description is empty, metadata uses only `Launched with ballistik.app`.
   - Attribution is removed only when paid removal is enabled.
   - Vanity reservation retries up to 3 random candidates.
   - Candidates that already exist on-chain are released and skipped.
7. **Persist Pending Token**: create Token with `PENDING` status and link wallets before on-chain create.
   - Launch input media is normalized before persistence: `tokenImage`/`tokenBanner` data URLs are uploaded to Pinata and replaced with gateway URLs in `Launch.input`.
   - If media upload cannot produce a URL, launch queueing fails and no launch record is created.
   - `Token.imageUrl` stores the same normalized media URL.
8. **Create + Buy**: create token and execute creator/bundler buys.
   - Non-bundled launches run through Platform execute (`runNonBundledPumpfunLaunchJob`): raw create or create+dev-buy only, allocations from the persisted plan, Launch-owned AppTransaction rows. PumpFunSDK is not used on this path.
   - The non-bundled create-time dev buy uses the same raw `buy_exact_sol_in` transaction builder as the newer Pump flow, including the volume accumulator accounts and the trailing `bonding_curve_v2` account required by the on-chain program after the Cashback upgrade.
   - Bundled launches run through Platform execute (`runBundledPumpfunLaunchJob` → `createAndBuyInBundle` / Jito) using the exact persisted plan and the same raw create/buy builders (no PumpFunSDK). Packing limits and buyer→tx mapping share helpers in `bundle-transaction-builder`.
   - In bundled launches, follow-up buyer ATA creation is hoisted into the first create transaction so later bundle transactions can submit buy-only instructions against the freshly created mint state.
   - Hoisted ATA instructions keep their original buyer payer/owner, and those buyer keypairs are added to the first transaction signer set so the reordered bundle remains signature-valid without shifting rent costs.
   - ATA hoisting is capped by an actual versioned-transaction size estimate; once the first bundle transaction would exceed Solana's raw `1232`-byte limit, remaining buyer ATA creation stays in later bundle transactions.
   - When that hoist is present, the first bundle transaction skips the synthetic compute-budget instruction to stay under Solana's raw 1232-byte transaction limit.
9. **Confirm**: verify token mint exists on-chain using a gRPC-first approach — subscribe to the mint account via `grpcManager` and race against RPC polling. First response wins, with automatic cleanup of the gRPC subscription on completion or timeout.
   - Vanity mint is consumed only after this confirmation succeeds.
   - For bundled launches, bundle confirmation also polls Jito `getInflightBundleStatuses` so logs can distinguish block-engine `Pending` / `Failed` / `Landed` / `Invalid` states from plain RPC `not_found` signatures.
   - The first bundle resend waits the normal resend interval instead of firing immediately, giving newly sent bundles a short grace period to surface before resend logic begins.
10. **Distribution**: split bundler wallet token balances into distribution wallets when enabled.
11. **Activate**: set Token status to `ACTIVE` after launch succeeds on-chain.
12. **Post-Launch SOL Sweep**: after a successful launch, transfer excess SOL from managed launch wallets (generated dev wallet, bundler wallets, distribution wallets) back to main wallet. Cleanup tries to use the main wallet as fee payer when possible and otherwise falls back to the existing source-funded transfer.
13. **Failure Reclaim**: if launch execution fails after recovery wallets were persisted, attempt to return remaining SOL to the main wallet before final UI guidance is shown.
   - Failed-launch reclaim is capped per wallet to `min(current wallet balance, launch-funded lamports for that wallet)`.
   - The per-wallet funded amount is persisted on `LaunchRecoveryWallet.fundedLamports` after funding succeeds, so recovery never returns more than the plan-funded cap for a Managed Launch Wallet.
14. **Complete**: mark SUCCEEDED or CANCELED, or mark FAILED after reclaim outcome is recorded, store result metadata, log completion.

## UI Integration

- Launch form starts via `launch.start` and polls `launch.status`.
- The launch funnel is owned by the shared `components/launch/launch-funnel-shell.tsx` shell, with shared metadata/review UI under `components/launch/shared/` and pump.fun configuration under `components/launch/platforms/pumpfun/`.
- Funnel form state is nested as `{ platform, metadata, config }`; flat preset and clone inputs are mapped into that shape at initialization.
- Both the inline Review and the overview dialog use `launch.previewCosts` through `toPreviewMoneyDisplay` for active fee/reserve amounts. Inactive toggles may still show nominal catalog fee amounts (struck through) from `usage-fees.config` for UX continuity.
- Progress dialog renders launch status and logs.
- The app header shows active launch progress beside the sidebar trigger via `activeProcess.list`; clicking the header pill opens the same launch progress dialog.
- Resume uses local storage or `launch.getActive` for in-progress launches only.
- User can request cancellation.
- Launch history (`/launches`) is powered by `launch.getUserLaunches` and shows every attempt, including pre-mint failures, with Launch statuses and retry lineage.
- My Tokens (`/tokens`) is powered by `token.getAllUserTokens` and lists persisted Tokens only.
- Reclaim actions are available from Launch history (including pre-mint attempts by `launchId`) and from My Tokens (token-scoped); the launch progress dialog does not open a reclaim dialog during launch.
- During long launch work, the progress dialog surfaces helper copy: `Token creation may take couple of minutes. Please be patient.`
- Progress activity is rendered newest-first, with the most recent row visually emphasized and raw log levels hidden from the user-facing list.
- Failed launch progress first attempts automatic reclaim and shows reclaim as launch activity.
- If automatic reclaim succeeds, the failed dialog keeps a visible reclaimed-funds step and does not show manual reclaim guidance.
- If automatic reclaim fails, failed launch progress surfaces retry and Launch history guidance for manual reclaim.
- Shared main/dev launches with no generated recovery wallets are treated as a valid zero-wallet recovery state rather than an error.
- Retry from progress dialog and Launch history creates a new linked launch attempt and opens progress for the new attempt.

### Retry Model (Failed Launches)

- Retry uses `launch.retry` and creates a new linked `Launch` record from the failed attempt's saved input.
- The failed launch remains immutable history; new execution logs are written to the new attempt.
- Retry does not recollect launch usage fees.
- Retry still runs funding availability checks before queueing.

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
- The launch form still submits data URLs, but persisted `Launch.input` stores URL references for media fields (no base64 blobs).
- Banner can only be set during creation and is sent with the metadata upload.
- Metadata upload posts `file` (main) and optional `banner` to `https://pump.fun/api/ipfs` alongside socials.

## Key Files

- `prisma/schema.prisma` (Launch, LaunchLog, LaunchRecoveryWallet, VanityMint)
- `server/services/launch.service.ts`
- `server/services/storage.service.ts`
- `server/trpc/routers/launch.router.ts`
- `server/schemas/launch.schema.ts`
- `server/solana/bundle-create-and-buy.ts`
- `server/solana/bundle-transaction-builder.ts`
- `server/solana/pump/transactions.ts`
- `app/(app)/launch/launch-progress-dialog.tsx`
- `app/(app)/launch/launch-overview-dialog.tsx`
- `components/launch/launch-funnel-shell.tsx` (shared funnel shell)
- `components/launch/shared/` (platform selector, shared metadata, normalized review)
- `components/launch/platforms/pumpfun/` (pump.fun config fields + flat→nested mapping)
- `app/(app)/launch/launch-form.tsx` (re-exports shell as `LaunchForm`)

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
- Server collects launch usage fees from main wallet to collector wallet only after launch success (`SUCCEEDED`).
- Failed or canceled launches do not charge usage fees.
- Launch usage fees are generated-wallet fee, vanity fee, optional attribution-removal fee, and a bundle-buy fee when `bundleBuyEnabled` is true.
- A launch can be free when bundle buy is disabled, `devWalletOption` is not `generate`, vanity mint is disabled, and attribution removal is disabled.

## Launch Cost Quote Model

Launch uses a hybrid quote model:

- Edit-time estimate in the form for responsive fee totals (client-side usage-fee helpers).
- Server quote (`launch.previewCosts` → Platform `preview`) as the source of truth for review/overview and temporary reserves.

The normalized `money` summary groups values into:

- `immediateRequiredBalanceLamports`: immediate debit from main wallet when launch starts.
- `temporaryFundingLamports`: operational wallet funding and reserves expected to return later.
- `expectedReturnLamports`: estimated SOL returned after post-launch cleanup.
- `permanentSpendLamports`: expected non-recoverable spend.
- `expectedMainWalletDeltaNowLamports` / `expectedMainWalletDeltaAfterCleanupLamports`: signed main-Wallet deltas (negative = outflow).
- `usageFeeLamports` plus labeled `lineItems` for fees, buys, tips, rent, buffers, and expected return.

### Quote Categories

Platform preview line items cover:

- Usage fees (bundle-buy fee, attribution-removal fee, vanity fee, generated-wallet fee).
- Dev buy and bundle-buy funding requirements.
- Jito tip (when bundle buy is enabled).
- Rent and setup funding (ATA rent, user volume accumulator rent, distribution ATA rent).
- Operational buffers (`createFeeBufferLamports`, `fundingBufferLamports`, `transferFeeBufferLamports`) and creator/main reserves.

The Launch overview dialog reads these fields from the API envelope rather than parallel named SOL objects.

### Fixed Bundle Spend

- Bundle-buy variance redistributes spend across bundler wallets but does not increase the total bundle spend.
- Fixed total bundle spend is `bundlerWalletCount * bundlerBuyAmountSol`.
- The launch quote and funding plan do not include an additional bundle-variance reserve.
- Each launch attempt derives one deterministic per-wallet bundle allocation server-side and reuses it for wallet funding and bundle execution.
- User retries create a new launch attempt, so they receive a fresh deterministic allocation for that new attempt.

### Return and Residual Handling

- Post-launch cleanup attempts to return excess SOL from managed launch wallets back to main wallet.
- If some SOL cannot be returned during cleanup, launch result metadata records actual returned and residual amounts so UI can show the difference between expected and realized post-cleanup deltas.
- Residual SOL remains recoverable through reclaim paths and should be displayed explicitly as reclaimable balance.
- Once all on-chain launch work is complete, later persistence-only failures must repair the launch into a successful token state instead of downgrading the mint to `FAILED`. This keeps `Launch.tokenPublicKey` populated and the token `ACTIVE`, so dashboard and holdings flows stay usable even if a post-confirm Prisma write times out.
- Launch control-plane writes (`Launch` status/progress and token status updates) retry transient Prisma timeout/pool errors. Progress updates are best-effort so a short-lived database stall does not abort an otherwise healthy on-chain launch.

## On-chain Confirmation Timeouts

- Bundle CREATE confirmation timeout is set to 3 minutes (`180_000ms`) in `server/solana/jito-bundle.ts`.
- Mint account confirmation timeout is set to 5 minutes via `getLaunchConfig().mintConfirmTimeoutMs` in `lib/config/launch.config.ts`.
- Bundle confirmation uses bounded resend and blockhash-rebuild loops within the 3-minute window.

## Bundle Launch

### Overview

When bundle buy is enabled, create + dev buy + bundler buys are sent as a Jito bundle. The path is:

1. Build the token create transaction as a raw `TransactionInstruction` with the `create` discriminator and Borsh-encoded args (name, symbol, uri, creator pubkey).
2. Build buy transactions for each buyer using a raw `buy_exact_sol_in` instruction with the SOL amount and `min_tokens_out = 1`.
3. Pack transactions into a bundle and submit through the deep Jito transport (`sendJitoBundle`). Tip placement happens inside Jito; Launch owns AppTransaction meanings from the returned signatures/confirmation/telemetry.
4. Simulation errors hard-fail — invalid bundles are never sent to Jito.
   - Each transaction is first simulated individually (`simulateTransaction`); only the first (create) transaction's result gates the launch, since buy transactions are expected to fail individual simulation before the mint exists.
   - When `HELIUS_RPC_URL` is set, a sequential `simulateBundle` preflight (Jito-Solana RPC method, `server/solana/simulate-bundle.ts`) simulates all 5 transactions against a single bank so buys see the CREATE state. A sequential failure aborts the launch with per-transaction errors and logs. If the env var is unset or the RPC does not support the method, the preflight is skipped (logged as `bundle_sequential_simulation` with status `unsupported`/`error`). The preflight runs on the initial build only; rebuilds reuse the same instructions with a fresh blockhash.

Note: All pump.fun instructions (`create`, `buy_exact_sol_in`, `sell`) are built as raw `TransactionInstruction` (not via Anchor) using hardcoded discriminators. The canonical Anchor IDL at `data/pumpfun-idl.json` is statically imported by `server/solana/pump/idl.ts`, consumed directly by `BorshCoder`/`EventParser` with strict schema validation, and used to decode the on-chain `Global` account (`server/solana/pump/global-account.ts`) and `TradeEvent` logs (`server/solana/pump/events.ts`, consumed by `transaction.service.ts`). IDL field names are snake_case (e.g. `fee_basis_points`, `sol_amount`, `is_buy`) as decoded directly from the IDL, not camelCased.

Note: `buy_exact_sol_in` data is 24 bytes (discriminator + sol_amount + min_tokens_out); the `track_volume` OptionBool parameter is omitted. The on-chain account layout matches `@pump-fun/pump-sdk` 1.36.x: 16 fixed accounts followed by exactly two trailing remaining accounts in this order: `bonding_curve_v2` (PDA seeds `["bonding-curve-v2", mint]`, read-only) then a single writable `buyback_fee_recipient` chosen at random from the 8-recipient pool stored in `Global.buyback_fee_recipients` (or the `PUMP_BUYBACK_FEE_RECIPIENTS` env override). Total 18 keys per buy. Failure modes: passing zero buyback recipients throws `BuybackFeeRecipientMissing` 6062 / `0x17ae`; passing all 8 (or putting `bonding_curve_v2` after them) corrupts the program's account-index reads and surfaces as a misleading Anchor `Overflow` 6024 / `0x1788` thrown deep inside `buy.rs`. Reference: pump-fun/pump-public-docs#30.

Note: The `sell` instruction layout is conditional on the `cashback_enabled` flag at byte 82 of the bonding curve account. Non-cashback tokens use 14 fixed + `[bonding_curve_v2, buyback_fee_recipient]` (16 keys); cashback tokens use 14 fixed + `[user_volume_accumulator, bonding_curve_v2, buyback_fee_recipient]` (17 keys). `buyback_fee_recipient` is ALWAYS the last account.

Note: No off-chain token amount calculation is needed. The program determines tokens from the SOL input, deducts fees (currently 1.25% via the `pfee` program), and transfers the appropriate token amount. `min_tokens_out = 1` is safe inside an atomic Jito bundle where MEV is not a concern.

### Transaction Packing Rules

- The bundle can contain up to 5 transactions.
- The first transaction includes:
  - A compute budget instruction (400k units — sized from measured usage, ~193k max for create + dev buy; lower requested CU improves Jito auction priority since bundles are ranked by tip per requested CU),
  - The token create instructions,
  - Up to 1 buy.
- Subsequent transactions include up to 2 buys each (capped to keep each tx under the 1232-byte versioned transaction limit with the current pump IDL; raise once launch ALT lands).
- With the max 8 bundler wallets + dev buy (9 total buys), the packing is:
  - TX1: create + dev buy
  - TX2: 2 buys
  - TX3: 2 buys
  - TX4: 2 buys
  - TX5: 2 buys

### Buyer Amounts

- Bundle buy uses a fixed total spend:
  - `totalBundleSpend = bundlerWalletCount * bundlerBuyAmountSol`
- Variance changes how that fixed total is distributed across bundler wallets.
- The `0.05 SOL` minimum applies to the user's configured `bundlerBuyAmountSol`, not to each randomized buy amount.
- The per-wallet bundle amounts are generated once per launch attempt and then reused for both wallet funding and transaction building.
- Buy amounts represent the actual spend; ATA rent is funded separately.
- User volume accumulator rent is funded separately for each buy wallet.

### Jito Tip

- If `jitoTipAmountSol > 0`, tip placement is owned by `sendJitoBundle` (appended to the last transaction; tip account selected internally).
- Callers pass tip lamports and tipper only; adaptive tip policy is enabled with `enableAdaptiveTip` (multipliers/max escalations stay inside Jito).
- The tip is paid by the main wallet and sent to a Jito tip account.

### Jito Block Engine

- Bundle submission rotates through available Jito block engine endpoints based on RPC network.
- Tip accounts are cached per endpoint to reduce rate limiting.
- Per-endpoint send rejections are surfaced as `bundle_send_rejections` telemetry and persisted to the launch log.

### Dropped-Bundle Detection

- `getInflightBundleStatuses` is pinned to the endpoint that accepted the send and reports whether the responding endpoint matched (`matchedPreferred`). An `Invalid` status from any other region is inconclusive and ignored.
- When the send endpoint itself reports `Invalid` on 2+ consecutive reads more than 10 seconds after the last send, the bundle is treated as dropped by the block engine (accepted but discarded before the auction): a `bundle_dropped_by_engine` WARN event is emitted, the preferred endpoint rotates to the next region, and a resend fires immediately instead of waiting out the normal resend interval.

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
- `bundle_inflight_status` events (per-region block-engine status, including whether the reading came from the send endpoint) are persisted to the launch log.
- Simulation logs for failing transactions are kept in full (up to 100 lines); passing transactions log head + tail (errors typically appear at the tail).
- Sequential `simulateBundle` preflight results are logged as `bundle_sequential_simulation` with per-transaction errors, logs, and units consumed.

## Clone Token

Allows users to pre-populate the launch form with configuration from a previous launch.

### Data Source

- All launch configuration is stored in `Launch.input` (JSON) for every launch.
- Each token has a `launches` relation (`Launch.tokenPublicKey` -> `Token.publicKey`).
- The clone dialog queries the `Launch` table with a `Token` join to get display data (`imageUrl`) alongside the stored input.

### tRPC Endpoint

- `launch.getUserLaunches` (query): returns all user launches ordered by `createdAt` desc.
  - Selects: `id`, `status`, `retriedFromLaunchId`, `input`, `tokenPublicKey`, `errorMessage`, `createdAt`, joined `token` metadata, and retry-attempt presence.
  - Extracts `tokenName`, `tokenSymbol`, and social URLs from `input` JSON as fallback when the token relation is null (e.g. launches that failed before token creation).
  - Returns lineage fields (`retriedFromLaunchId`, `hasRetryAttempts`) and legacy markers for the Launch history surface and Clone Token dialog.
  - Serves as the canonical data source for Launch history and the Clone Token dialog. My Tokens uses `token.getAllUserTokens` instead.

### Clone Behavior

- All form fields from `Launch.input` are populated **except** `tokenImage` and `tokenBanner` (base64/data-URL file uploads are not reusable).
- Cloned fields include: token metadata (name, symbol, description, socials), dev wallet option, buy amounts, Jito tip, bundler configuration.
- The form remounts with new default values via a React `key` change, ensuring a clean TanStack Form reset.

### UI Flow

1. User clicks "Clone Token" button in the launch page header.
2. A dialog opens showing a table of previous launches (clone-oriented columns plus single-row selection).
3. User selects a launch and clicks "Clone".
4. Dialog closes and the launch form is populated with the selected configuration.

### Key Files

- `app/(app)/launch/clone-token-dialog.tsx`
- `app/(app)/launch/page.tsx`
- `app/(app)/launch/launch-form.tsx`

## Launch Presets

- Launch supports URL-driven presets via the `preset` query parameter (`lib/config/launch-presets.config.ts`).
- `preset=free` initializes a free configuration (`devWalletOption = generate`, bundle buy disabled, vanity disabled, attribution removal disabled).
- Missing or unknown `preset` values default to the regular preset (`devWalletOption = generate`, bundle buy enabled, `bundlerWalletCount = 8`, vanity enabled, attribution removal disabled).
- The server does not coerce `devWalletOption` by plan; presets and submissions use `generate` / `import` / `use_main` only.
- Preset values are applied before clone values; cloning overrides preset initialization. Clone/preset bags that still carry `system` are remapped to `generate` in the funnel.
- Unauthenticated visits preserve preset URLs through auth redirects using the `redirect` query param (for example `/launch?preset=free` -> `/auth?redirect=%2Flaunch%3Fpreset%3Dfree` -> back to `/launch?preset=free` after login/signup).

## Balance Refresh Strategy

- Balances are refreshed on demand only
- Server enforces a 15-second debounce per wallet
- Launch history and My Tokens explicitly refetch on mount so navigation does not reuse a fresh-cache snapshot for too long.

## Failed Launch Reclaim UX

- Automatic reclaim runs only after a launch reaches a failed execution path and only when recovery wallets are available.
- Automatic reclaim is logged as launch activity so it appears in the launch progress dialog just like create, confirm, and cleanup steps.
- Launch state remains `FAILED` even when automatic reclaim succeeds.
- Automatic reclaim outcome is stored in `Launch.result.failureRecovery` for user-facing messaging.
- `failureRecovery.manualActionRequired` determines whether the progress dialog should tell the user to go to Launch history for reclaim.
- Failed-launch reclaim is launch-scoped: each managed wallet can only return the funded top-up recorded for that launch, never more than its current balance.
- Manual `recoverSol` uses the same funded-cap drain when the Launch has a `plan_funded_cap` recovery policy or a recorded `fundedLamports` top-up. Legacy launches without plan/funding snapshots keep full-balance reclaim.
- Failed launches without `failureRecovery` metadata fall back to showing Launch history guidance so older/stale failure records still have a recovery path.
- Manual reclaim remains available from Launch history and My Tokens row actions and the reclaim dialog.

## Reclaim Dialog

- The reclaim dialog keeps wallet rows in the scrollable region and uses a sticky footer for actions.
- The sticky footer shows the total reclaimable SOL amount on the left.
- Successful reclaim invalidates `launch.getUserLaunches` and `token.getAllUserTokens` so Launch history and My Tokens refresh immediately.

## Mayhem Mode

Optional, beta pump.fun feature that adds an AI trading agent that autonomously trades the token for its first 24 hours. Toggled via `mayhemMode` on `launchTokenSchema`; persisted as `Token.isMayhemMode` for display/filtering only — the on-chain `BondingCurve.is_mayhem_mode` field decoded via `decodeBondingCurve()` (`server/solana/pump/global-account.ts`) is always the source of truth for transaction-building and fee-routing decisions, never the DB flag.

### Create Flow

- When `mayhemMode` is true, Platform execute preflight-checks `Global.create_v2_enabled` / `Global.mayhem_mode_enabled` (`assertMayhemCreateAllowed` in `server/solana/pump/global-account.ts`) right after input validation, before wallets/funding — fails fast with a clear `AppError` if pump.fun has disabled create_v2 or Mayhem mode server-side, since pump.fun frames this as experimental beta with no dedicated toggle and can disable it at any time. Bundled submission uses `intendedEffects.mayhemMode` from the persisted plan.
- Token creation uses `create_v2` (`buildCreateTokenV2TransactionRaw` in `server/solana/pump/instructions.ts`) instead of `create`: Token-2022 mint, plus 5 extra fixed accounts (Mayhem program, global params, sol vault, mayhem state, mayhem token vault — PDAs derived in `deriveMayhemCreateV2Accounts`).
- Cashback is passed as `false` by default for Mayhem creates; not exposed as a separate toggle in this pass.
- Both the bundle path (`bundle-create-and-buy.ts`) and the non-bundle combined create+dev-buy versioned transaction path (`buildCreateAndDevBuyVersionedTransaction` in `server/solana/pump/transactions.ts`) support `isMayhemMode`.
- The bundle path additionally builds a per-launch dynamic Address Lookup Table for Mayhem launches (see `docs/implementation/bundle-implementation.md`) because `create_v2`'s extra accounts would otherwise overflow the already-tight bundle transaction size budget.

### Buy/Sell

- `buildBuyTokenTransactionRaw` / `buildSellTransaction` resolve the token program (Token vs Token-2022) per-mint — via the on-chain mint account owner when it exists, or `isMayhemMode`/bonding-curve `is_mayhem_mode` as a fallback when the mint doesn't exist yet (bundle create+buy).
- Mayhem-mode trades route the primary protocol fee recipient to a random pick from `Global.reserved_fee_recipient`/`reserved_fee_recipients` instead of the standard fixed recipient. The trailing `buyback_fee_recipient` remaining account is unaffected (buyback is a separate mechanism from the Mayhem reserved pool).

### Known Gaps (Fast-Follow)

- **Volume bot**: blocked server-side (`volumeBotService.startSession` throws `AppError` for `Token.isMayhemMode` tokens) and the UI hides/disables the "Start"/"New Session" entry points. `volume-bot-worker.ts`, `volume-bot.service.ts` trade loops, and `holding-sol-recovery.ts` are not yet Token-2022-aware.
- Buying more tokens into holdings for an existing Mayhem token (as opposed to the dev/creator buy at launch time) is not covered by this pass.

### Key Files (Mayhem-specific)

- `server/solana/pump/instructions.ts` (`buildCreateTokenV2TransactionRaw`, `deriveMayhemCreateV2Accounts`, `getTokenProgramIdForPumpMint`)
- `server/solana/pump/global-account.ts` (`decodeBondingCurve`, `assertMayhemCreateAllowed`, `getReservedFeeRecipients`)
- `server/solana/pump/launch-alt.ts`
- `lib/config/pump-mayhem.config.ts`

## Test Run Logging

The production-readiness run logging design is documented in `docs/implementation/test-run-logging.md`.

Launch-specific instrumentation for that run must add correlated JSONL events around:

- Funding plan preparation and post-funding balances
- Create-and-buy submission
- Bundle telemetry relevant to timing or retries
- Post-launch SOL sweep back to the main wallet
- Final launch completion and residual balance state

Launch logs should preserve enough data to compare expected main-wallet impact against actual before/after wallet balance snapshots during the test run.
