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
- `config`: JSON config snapshot (includes target + wallet selection)
- `scheduledStopAt`: optional auto-stop time
- `totalVolumeUsd`, `totalTrades`, `totalPnlSol`, `runtimeSeconds`: summary stats
  - `totalPnlSol` is the net SOL delta from bot-only trades on the bonding curve

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

## Config (volumeBot.start)
- `generatedWalletCount`: number of new volume wallets created per session
- `selectedWalletPublicKeys`: existing wallets included in this run (main wallet excluded)
- `fundingPerWalletSol`: SOL funded to each volume wallet at start
- `minTradeAmountSol` / `maxTradeAmountSol`: randomized SOL buy size range
- `minIntervalSeconds` / `maxIntervalSeconds`: randomized per-wallet tick interval range
- `sellRatio`: fraction of token balance to sell on sell actions (0-1)
- `strategy`: neutral | pump | dump
- `buyBiasPct`: buy probability for pump; dump flips to sell bias
- `tradeVariancePct`: random variance applied to target trade sizing
- `slippageBps`: slippage tolerance in basis points applied to min-out on buys/sells (UI default 1000)
- `strategyTargetSol`: target net SOL delta for pump/dump (required)
- `targetSolApplied`: applied target after capping by selected balances (dump only)
- `targetVolumePerHour`: optional volume pacing target (not currently enforced)
- `targetDurationSeconds`: auto-stop after duration if `scheduledStopAt` is not provided
- `targetDurationHours`: legacy fallback for existing sessions
- `scheduledStopAt`: optional explicit stop time override

## Worker Workflow (Event-Based)
- `start`: validate input, create session, initialize next tick times
- `tick`: execute one buy/sell/wait and schedule next tick in DB
- `stop`: stop session, return SOL to main wallet (tokens remain)
- `reclaim`: consolidate SOL back to main wallet
- `close-accounts`: close SPL token accounts for rent reclaim
- Target pacing spreads remaining SOL across expected ticks and total wallet count
- Target direction ramps buy/sell bias based on remaining target for precision
- Targeted sell fallbacks scale sell ratios down when quote data is unavailable

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
- `volumeBot.eligibleWallets` list eligible wallets with token balances
- `volumeBot.selectionSummary` compute target cap for dump selections
- `volumeBot.logs` return recent session logs

## UI Behavior
- Token-scoped runs list at `/volume-bot` (token selected via sidebar switcher).
- Start/config page at `/volume-bot/new` with wallet selection + target pre-check.
- Per-run detail page at `/volume-bot/[sessionId]` with session stats, net SOL progress, and live logs.
- Session status is polled every 2-3s for live stats on the run page.
- Actions: start, stop, reclaim, close accounts.

## Runtime Requirements
- Persistent Node.js process (required for timers)
- Solana RPC provider

## Environment Variables
- `SOLANA_RPC_URL`
