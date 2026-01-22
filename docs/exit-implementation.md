# Exit Implementation

## Overview

The Exit flow consolidates all token holdings across operational wallets, sells them via Jito bundles, closes emptied token accounts, and transfers remaining SOL back to the user's main wallet. Progress and activity logs are persisted in the database so the dialog can resume after refresh.

## Data Models

### HoldingExit

- Tracks an exit run per user/token
- Persists `status`, `progress`, `currentStep`, and `result`
- Stores `input` for parameters such as `jitoTipSol`

### HoldingExitLog

- Stores timestamped log entries for an exit run
- Used by the UI activity feed

## tRPC Procedures

- `holding.startExit` starts an exit run and returns an `exitId`
- `holding.exitStatus` returns the exit record with logs
- `holding.getActiveExit` returns the running exit for a token (PENDING/RUNNING), or null

## Exit Flow

1. **Prepare**: load allowed wallets (main, dev, operational), fetch on-chain balances, sort descending.
2. **Chunk**: split into groups of 24 wallets.
3. **Bundle**: for each chunk:
   - biggest holder is the seller
   - send tokens to seller in groups of 5 wallets per transaction
   - last transaction includes remaining transfers plus the sell instruction
   - submit as a Jito bundle
4. **Cleanup**:
   - close empty ATAs for wallets involved in the exit
   - transfer remaining SOL to the main wallet
5. **Finalize**:
   - persist `result` summary
   - mark status `SUCCEEDED` or `FAILED`

## Bundle Structure

For a full 24-wallet chunk:

1. TX1: 5 transfers to seller
2. TX2: 5 transfers to seller
3. TX3: 5 transfers to seller
4. TX4: 5 transfers to seller
5. TX5: 3 transfers + sell all tokens from seller

Smaller chunks are packed using the same grouping pattern.

## Legacy Reference (Dump)

The legacy app uses a bundled dump flow that groups wallet positions, sends a `bundleDumpPercentage` request, and runs a consolidated sell path when requested. Key files:

- UI entry point: `components/positions/dump-dialog.tsx`
- API: `app/api/pump/bundleDumpPercentage/route.ts`
- Aggregated sell builder: `app/api/pump/txAggregation.ts`

## Progress Tracking

Progress is updated in the `HoldingExit` record:

- Preparing and chunking updates
- Per-chunk processing steps
- Cleanup steps (ATA close + SOL recovery)

The UI polls `holding.exitStatus` every 2 seconds while status is `PENDING` or `RUNNING`.

## UI Behavior

- Exit dialog opens on demand or automatically when a running exit exists
- Activity logs are shown in real time
- Summary is shown after success with totals (wallets, bundles, tokens, ATAs closed, SOL recovered)
- No abort or cancel actions are available
