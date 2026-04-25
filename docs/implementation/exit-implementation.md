# Exit Implementation

## Overview

The Exit flow consolidates all token holdings across operational wallets, sells them via Jito bundles, closes emptied token accounts, and transfers remaining SOL back to the user's main wallet. Progress and activity logs are persisted in the database so the dialog can resume after refresh.

## Data Models

### HoldingExit

- Tracks an exit run per user/token
- Persists `status`, `progress`, `currentStep`, and `result`
- Stores `input` for parameters such as `jitoTipSol`
- Terminal statuses are:
  - `SUCCEEDED` when bundle submission and required cleanup both succeed
  - `PARTIAL_SUCCESS` when bundle submission succeeds but cleanup / SOL recovery has wallet failures
  - `FAILED` when bundle submission fails or the run aborts before a sell completes

### HoldingExitLog

- Stores timestamped log entries for an exit run
- Used by the UI activity feed

## tRPC Procedures

- `holding.startExit` starts an exit run and returns an `exitId`
- `holding.exitStatus` returns the exit record with logs
- `holding.getActiveExit` returns the running exit for a token (PENDING/RUNNING), or null
- `holding.cancelExit` requests cancellation for an active exit run

## Exit Flow

1. **Prepare**: load allowed wallets (main, dev, operational), fetch on-chain balances, sort descending.
   - Shared `main = dev` addresses are deduped by `publicKey` so exit processes one real wallet owner.
2. **Chunk**: split into groups of 20 wallets.
3. **Funding**: top up underfunded wallets before bundle processing to reduce failed transfers/sells.
4. **Bundle (parallel, concurrency=2)**: for each chunk:
   - biggest holder is the seller
   - send tokens to seller in groups of 5 wallets per transaction
   - sell instruction is in a separate final transaction (no transfers combined)
   - submit as a Jito bundle
5. **Cleanup**:
   - close empty ATAs for wallets involved in the exit
   - if a system dev wallet sold in the exit, immediately sweep realized SOL from that system wallet back to the user main wallet
   - return the remaining available SOL to the main wallet when enabled, using the main wallet as fee payer when possible and falling back otherwise
6. **Finalize**:
   - persist `result` summary
   - mark status `SUCCEEDED`, `PARTIAL_SUCCESS`, or `FAILED`
   - include total Jito tip paid in summary (`totalJitoTipSol`)

### Processing Model

- Chunk jobs are processed with controlled concurrency (`2` in flight).
- One chunk waiting on bundle confirmation does not block all remaining chunks.
- Chunk outcomes are tracked individually (`successfulChunks`, `failedChunks`).
- Cleanup (ATA close + SOL recovery) runs only after all chunk jobs settle.
- Cleanup wallet work runs with bounded concurrency (wallet-level parallelism) and aggregates results after all wallet tasks settle.
- The exit uses the same shared post-sell SOL recovery helpers as manual holding sells so system dev wallet behavior stays consistent across both flows.

### Sell Instruction

The sell instruction is built by `buildSellTransaction` in `pump-new-idl.ts`. It uses the same shared constants as the buy instruction (fee recipient, fee config, fee program) for consistency. The function:

- Fetches the creator from the bonding curve on-chain
- Derives all PDAs consistently with the buy instruction
- Does not require an Anchor `Program` object (pure instruction building)
- **Includes `bondingCurveV2`** as a trailing remaining account (V2 account layout). Without this account, the on-chain program falls back to a legacy code path with u64 arithmetic that overflows on the constant-product `k = virtualTokenReserves * virtualSolReserves` calculation, causing error 6024 (Overflow) for any sell amount
- Returns a single `Transaction`

All three sell paths (holding sell, volume bot sell, exit bundle sell) use this function. The holding service and exit bundle use `buildSellTransaction` directly. The volume bot uses the `sellTokensWithNewIdl` wrapper which delegates to it.

### Jito Bundle Resilience

The exit flow uses Jito bundles which can fail during network congestion. The bundle confirmation system handles this with:

- **Resend loop**: While the blockhash is fresh (<55s), the bundle is resent every 5 seconds if no signatures are found on-chain.
- **Blockhash rebuild**: When the blockhash expires (>55s) and signatures are still not found, the entire bundle is rebuilt with a fresh blockhash and resent. Up to 2 rebuilds are allowed, giving the bundle ~165s total window to land.
- **Default tip**: When no `jitoTipSol` is provided in the exit input, the default tip (`DEFAULT_JITO_TIP_SOL = 0.005 SOL`) is used. Higher tips improve priority during congestion.

### Future: Fast Mode (Optional)

If faster exits are needed later, add a configurable "fast mode" profile:

- Increase chunk concurrency from `2` to `3` (or `4`) for higher throughput.
- Keep default mode as the safer baseline; fast mode is opt-in.
- Add explicit telemetry/logging for:
  - bundle submission latency,
  - per-chunk success/failure rate,
  - RPC/Jito rate-limit frequency.
- Add guardrails:
  - automatic fallback to baseline concurrency on repeated rate limits,
  - cap in-flight chunks to avoid overloading RPC/Jito,
  - preserve the same cleanup/finalization semantics.

Suggested configuration shape:

```typescript
type ExitSpeedMode = "balanced" | "fast";

type ExitRuntimeConfig = {
  speedMode: ExitSpeedMode;
  chunkConcurrency: number;
};
```

## Bundle Structure

For a full 20-wallet chunk (1 seller + 19 senders):

1. TX1: 5 transfers to seller
2. TX2: 5 transfers to seller
3. TX3: 5 transfers to seller
4. TX4: 4 transfers to seller
5. TX5: sell all tokens from seller (no transfers)

Smaller chunks are packed using the same grouping pattern.

## Transaction Size Limits

Solana enforces strict transaction size limits:

| Limit Type | Max Size |
|------------|----------|
| Raw transaction | 1232 bytes |
| Base64 encoded | 1644 bytes |

### Why These Chunk Sizes?

The pump.fun sell instruction is large (15 accounts including bondingCurveV2, ~750-950 bytes). Combining it with multiple transfers exceeded the 1232 byte limit.

**Key constants:**
```typescript
const MAX_BUNDLE_TXS = 5;        // Jito bundle limit
const TRANSFERS_PER_GROUP = 5;   // Max transfers per transaction
const WALLETS_PER_CHUNK = 20;    // Max wallets per exit bundle iteration
```

**Calculation:**
- 1 transaction reserved for sell instruction
- 4 transactions available for transfers
- 4 × 5 = 20 transfers capacity in transfer transactions
- Practical chunk cap is 20 wallets (1 seller + up to 19 senders)

**Why sell is separate?**
- The sell instruction has 15 accounts (~480 bytes just for account keys)
- Plus instruction data, signatures, and transaction metadata
- Combining with transfers caused the "transaction too large" error

## Progress Tracking

Progress is updated in the `HoldingExit` record:

- Preparing and chunking updates
- Per-chunk processing steps with completed chunk counts
- Cleanup steps (ATA close + SOL recovery)

The UI polls `holding.exitStatus` every 2 seconds while status is `PENDING` or `RUNNING`.

## UI Behavior

- Exit is available as the `Exit` tab in the shared `SELL` dialog, which opens from both the dashboard and holdings page
- The dialog opens on demand or automatically on the Exit tab when a running exit exists
- Dialog shows a detailed pre-flight description of each exit step
- Dialog shows estimated total Jito tip before start (`tip per bundle × estimated bundles`)
- Exit preflight totals should reflect deduped holdings data so shared main/dev launches do not inflate wallet counts or token totals.
- Dialog includes a "Return SOL to main wallet" toggle with a clear description of SOL sweeping behavior, and it is checked by default when the dialog opens
- System dev wallet exits always force SOL return to the main wallet even if the toggle was off in the request
- Activity logs are shown in real time with newest entries first and the latest update visually emphasized in the progress feed
- Summary shows totals including chunk outcomes (total/successful/failed chunks), wallets, bundles, tokens, ATAs closed, SOL recovered, cleanup failures, system dev immediate sweeps, and total Jito tip
- Users can cancel an active exit via `holding.cancelExit`
- When an exit reaches a terminal state from the holdings page, the client refreshes holdings plus related wallet balances so follow-up views reflect the completed cleanup
- The dialog displays both the requested SOL-return preference and the effective server behavior when the system dev safety override changed the outcome.
