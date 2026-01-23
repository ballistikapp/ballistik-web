# Volume Bot Implementation

## Goals
- Provide a production-ready volume bot with durable scheduling.
- Run trading loops inside the web process using in-memory timers.
- Persist sessions, wallets, and trade logs for recovery and UI status.
- Support scheduled stop, sell-on-stop, reclaim, and close-accounts actions.

## Architecture Summary
- UI and tRPC run in the web service.
- Timer manager schedules wallet ticks from the web process.
- Postgres stores state and logs.

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
- `nextTickAt`: next scheduled tick time
- Reclaim metadata (`reclaimedAt`, `reclaimTxSignature`)

### VolumeBotLog
Structured log entries for trades and errors.
- `level`: INFO | WARN | ERROR | TRADE
- `type`: string tag (start, tick, buy, sell, stop, reclaim)
- `data`: JSON payload (signature, amounts, error details)

## Worker Workflow (Event-Based)
- `start`: validate input, create session, initialize next tick times
- `tick`: execute one buy/sell/wait and schedule next tick in DB
- `stop`: stop session, sell tokens, return SOL
- `reclaim`: consolidate SOL back to main wallet
- `close-accounts`: close SPL token accounts for rent reclaim

## Timer Manager
- In-memory timers scheduled per wallet using `nextTickAt`
- Recovery on startup reads active sessions/wallets and re-schedules timers
- Scheduled stops use timers based on `scheduledStopAt`

## tRPC Endpoints
- `volumeBot.start` create session and schedule timers
- `volumeBot.status` return session + wallet stats
- `volumeBot.stop` stop session immediately
- `volumeBot.reclaim` run reclaim for the session
- `volumeBot.closeAccounts` run close-accounts for the session
- `volumeBot.listSessions` list recent sessions by token/user

## UI Behavior
- Token-scoped page (token selected via sidebar switcher).
- Session status is polled every 10s for live stats (client cache reduces redundant refetches).
- Actions: start, stop, reclaim, close accounts.

## Runtime Requirements
- Persistent Node.js process (required for timers)
- Solana RPC provider

## Environment Variables
- `SOLANA_RPC_URL`
