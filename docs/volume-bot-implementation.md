# Volume Bot Implementation

## Goals
- Provide a production-ready volume bot with durable scheduling.
- Run trading loops outside Vercel using a queue worker.
- Persist sessions, wallets, and trade logs for recovery and UI status.
- Support scheduled stop, sell-on-stop, reclaim, and close-accounts actions.

## Architecture Summary
- UI and tRPC run on Vercel.
- Worker process runs BullMQ queues and executes trades.
- Redis backs BullMQ; Postgres stores state and logs.

## Data Model
### VolumeBotSession
Tracks one bot run per token/user.
- `status`: DRAFT | RUNNING | STOP_REQUESTED | STOPPING | STOPPED | FAILED
- `config`: JSON config snapshot
- `scheduledStopAt`: optional auto-stop time
- `totalVolumeUsd`, `totalTrades`, `totalPnlSol`, `runtimeSeconds`: summary stats

### VolumeBotWallet
Tracks per-wallet state for a session.
- Links to `Wallet` (type VOLUME)
- `status`: ACTIVE | PAUSED | RECLAIMED | FAILED
- `solBalance`, `tokenBalance`, `tradesExecuted`, `pnlSol`
- Reclaim metadata (`reclaimedAt`, `reclaimTxSignature`)

### VolumeBotLog
Structured log entries for trades and errors.
- `level`: INFO | WARN | ERROR | TRADE
- `type`: string tag (start, tick, buy, sell, stop, reclaim)
- `data`: JSON payload (signature, amounts, error details)

## Queue Workflow (BullMQ)
- `start`: validate input, create session, enqueue tick jobs
- `tick`: execute one buy/sell/wait and schedule next tick
- `stop`: cancel ticks, sell tokens, return SOL
- `reclaim`: consolidate SOL back to main wallet
- `close-accounts`: close SPL token accounts for rent reclaim

## tRPC Endpoints
- `volumeBot.start` create session, enqueue start job
- `volumeBot.status` return session + wallet stats
- `volumeBot.stop` request stop and enqueue stop job
- `volumeBot.reclaim` enqueue reclaim job
- `volumeBot.closeAccounts` enqueue close-accounts job
- `volumeBot.listSessions` list recent sessions by token/user

## UI Behavior
- Token selection required
- Presets + custom config inputs
- Live polling for status and stats
- Actions: stop, reclaim, close accounts

## Runtime Requirements
- Redis for BullMQ
- Separate worker process to run queues
- Solana RPC provider

## Environment Variables
- `REDIS_URL`
- `SOLANA_RPC_URL`
