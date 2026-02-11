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
2. **Chunk**: split into groups of 13 wallets.
3. **Bundle**: for each chunk:
   - biggest holder is the seller
   - send tokens to seller in groups of 3 wallets per transaction
   - sell instruction is in a separate final transaction (no transfers combined)
   - submit as a Jito bundle
4. **Cleanup**:
   - close empty ATAs for wallets involved in the exit
   - transfer remaining SOL to the main wallet
5. **Finalize**:
   - persist `result` summary
   - mark status `SUCCEEDED` or `FAILED`

## Bundle Structure

For a full 13-wallet chunk (1 seller + 12 senders):

1. TX1: 3 transfers to seller
2. TX2: 3 transfers to seller
3. TX3: 3 transfers to seller
4. TX4: 3 transfers to seller
5. TX5: sell all tokens from seller (no transfers)

Smaller chunks are packed using the same grouping pattern.

## Transaction Size Limits

Solana enforces strict transaction size limits:

| Limit Type | Max Size |
|------------|----------|
| Raw transaction | 1232 bytes |
| Base64 encoded | 1644 bytes |

### Why These Chunk Sizes?

The pump.fun sell instruction is large (14 accounts, ~700-900 bytes). Combining it with multiple transfers exceeded the 1232 byte limit.

**Key constants:**
```typescript
const MAX_BUNDLE_TXS = 5;        // Jito bundle limit
const TRANSFERS_PER_GROUP = 3;   // Max transfers per transaction
const WALLETS_PER_CHUNK = 13;    // Max wallets per exit bundle iteration
```

**Calculation:**
- 1 transaction reserved for sell instruction
- 4 transactions available for transfers
- 4 × 3 = 12 transfers maximum
- 12 transfers + 1 seller = 13 wallets per chunk

**Why 3 transfers per transaction (not 5)?**
- Each `transferChecked` instruction adds ~100 bytes (accounts + data)
- Each transfer adds a signer (~64 bytes for signature)
- 3 transfers keeps transaction at ~600-800 bytes, leaving room for metadata

**Why sell is separate?**
- The sell instruction has 14 accounts (~450 bytes just for account keys)
- Plus instruction data, signatures, and transaction metadata
- Combining with transfers caused the "transaction too large" error

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
