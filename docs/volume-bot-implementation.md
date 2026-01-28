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
- Trades execute against pump.fun bonding curve via `@pump-fun/pump-sdk`.

## Data Model
### VolumeBotSession
Tracks one bot run per token/user.
- `status`: DRAFT | RUNNING | STOP_REQUESTED | STOPPING | STOPPED | FAILED
- `config`: JSON config snapshot (includes target + wallet selection)
- `scheduledStopAt`: optional auto-stop time
- `stopRequestedAt`: timestamp when stop was requested
- `startedAt`, `stoppedAt`: session lifecycle timestamps
- `lastTickAt`: timestamp of most recent wallet tick (used by watchdog)
- `totalVolumeUsd`, `totalTrades`, `totalPnlSol`, `runtimeSeconds`: summary stats
  - `totalPnlSol` is the net SOL delta from bot-only trades on the bonding curve

### VolumeBotWallet
Tracks per-wallet state for a session.
- Links to `Wallet` (types: BUNDLER, VOLUME, or DISTRIBUTION — main wallet and DEV wallets excluded)
- `role`: TRADER (enum, currently only TRADER role)
- `status`: ACTIVE | PAUSED | RECLAIMED | FAILED
- `solBalance`, `tokenBalance`, `tradesExecuted`, `pnlSol`
- `lastTradeAt`: timestamp of last executed trade
- `nextTickAt`: next scheduled tick time
- `pausedAt`, `pauseReason`: pause metadata
- Reclaim metadata (`reclaimedAt`, `reclaimTxSignature`)

**Wallet Type Filtering**:
- Eligible types: BUNDLER, VOLUME, DISTRIBUTION
- DEV wallets are explicitly excluded from processing
- Main wallet is excluded from trading (only used as funding source)

### VolumeBotLog
Structured log entries for trades and errors.
- `level`: INFO | WARN | ERROR | TRADE
- `type`: string tag (start, tick, buy, sell, stop, reclaim, watchdog)
- `data`: JSON payload (signature, amounts, error details)
- `walletPublicKey`: optional wallet context
- `signature`: optional transaction signature

### Database Indexes
Indexes are defined for efficient queries:
- `VolumeBotSession`: `@@index([userId, status])`, `@@index([tokenPublicKey, status])`
- `VolumeBotWallet`: `@@unique([sessionId, walletPublicKey])`, `@@index([sessionId, status])`, `@@index([status, nextTickAt])`, `@@index([walletPublicKey])`
- `VolumeBotLog`: `@@index([sessionId, createdAt])`

## Config (volumeBot.start)

### Wallet Configuration
- `generatedWalletCount`: number of new volume wallets created per session
- `selectedWalletPublicKeys`: existing wallets included in this run (main wallet excluded)
- `fundingPerWalletSol`: SOL funded to each **generated** wallet at start (selected wallets only topped up for fees)

### Trade Parameters
- `minTradeAmountSol` / `maxTradeAmountSol`: randomized SOL buy size range
- `minIntervalSeconds` / `maxIntervalSeconds`: randomized per-wallet tick interval range
- `sellRatio`: fraction of token balance to sell on sell actions (0-1)
- `slippageBps`: slippage tolerance in basis points applied to min-out on buys/sells (UI default 1000)
- `tradeVariancePct`: random variance (±%) applied to trade sizing for organic look

### Strategy Configuration
- `strategy`: neutral | pump | dump
- `buyBiasPct`: buy probability for pump (0-100); dump flips this to sell bias
- `strategyTargetSol`: target net SOL delta for pump/dump (**required** for pump/dump, ignored for neutral)
- `targetSolApplied`: computed field - applied target after capping by selected balances (dump only)

### Duration Configuration
- `targetDurationSeconds`: auto-stop after duration if `scheduledStopAt` is not provided
- `targetDurationHours`: legacy fallback for existing sessions
- `scheduledStopAt`: optional explicit stop time override
- `targetVolumePerHour`: optional volume pacing target (not currently enforced)

### Validation Rules
- Total wallet count must be between 1-50
- `minTradeAmountSol` cannot exceed `maxTradeAmountSol`
- `minIntervalSeconds` cannot exceed `maxIntervalSeconds`
- Duration required: either `targetDurationSeconds`, `targetDurationHours`, or `scheduledStopAt`
- Max duration: 168 hours (7 days)

## Worker Workflow (Event-Based)

### Lifecycle Operations
- `start`: validate input, create session, fund wallets, schedule timers
- `tick`: execute one buy/sell/wait and schedule next tick
- `stop`: request stop, cancel timers, return SOL to main wallet (tokens remain)
  - Skips if already STOPPED or FAILED
  - Handles STOP_REQUESTED/STOPPING states gracefully
  - Uses async fire-and-forget pattern for `requestStop()`
- `reclaim`: consolidate SOL back to main wallet (manual action post-stop)
- `close-accounts`: close empty SPL token accounts for rent reclaim
  - Only closes accounts with zero token balance
  - Uses concurrency of 2 for both wallets and token accounts

### Tick Processing (`processVolumeBotWallet`)
1. **Status Checks**:
   - Session must be RUNNING (skips otherwise)
   - Wallet must be ACTIVE (skips DEV wallets)
   - Check scheduled stop time (auto-stop if reached)
   - Check duration exceeded (auto-stop if exceeded)
2. **Balance Fetch**: Get wallet SOL and token balances from chain
3. **Trade Sizing**: Compute target trade size based on remaining target and time
4. **Action Selection**: Select BUY/SELL/WAIT based on strategy, bias, and urgency
5. **Trade Execution**: Execute trade with slippage protection
6. **Balance Refresh**: Fetch fresh balances after trade for accurate PnL
7. **Stats Update**: Update wallet and session stats (volumes, PnL, trade count)
8. **Schedule Next Tick**: Schedule next tick with randomized interval

**Error Recovery**:
- Trade errors don't stop wallet processing — schedules next tick anyway
- Errors logged to `VolumeBotLog` with ERROR level
- Fee errors trigger auto top-up and retry before failing

### Action Selection Algorithm
- **No tokens held**: Always BUY
- **Has tokens**: Random selection based on `buyProbability`
  - Neutral: 50% buy probability
  - Pump: `buyBiasPct` directly used as buy probability
  - Dump: `buyBiasPct` flipped (e.g., 80% → 20% buy, 80% sell)

**Urgency-Based Bias Adjustment**:
When a target direction is set (pump/dump), urgency scales bias based on remaining target:
```
urgency = remainingSolAbs / targetSolAbs  // 0 to 1, clamped

// For pump (buy direction):
adjustedBuyProbability = buyProbability + (100 - buyProbability) * urgency

// For dump (sell direction):
adjustedBuyProbability = buyProbability - buyProbability * urgency
```
- **High urgency** (lots remaining): More aggressive bias toward target direction
- **Low urgency** (near completion): More balanced/neutral behavior to avoid overshooting

### Target Pacing Algorithm
The pacing algorithm ensures trades are distributed evenly across remaining time and wallets.

**Target Trade Size Computation (`computeTargetTradeSol`)**:
```
avgInterval = (minIntervalSeconds + maxIntervalSeconds) / 2
ticksRemaining = secondsRemaining / avgInterval
desiredPerTick = absRemaining / ticksRemaining / effectiveWallets
```

**Trade Sizing**:
- Base size bounded to `[minTradeAmountSol, maxTradeAmountSol]`
- Capped by per-wallet remaining target to prevent overshooting
- When `isTargetAligned` is true, uses `targetTradeSol` directly
- When not aligned, still caps by `targetTradeSol` to avoid exceeding target

**Trade Variance Application (`applyTradeVariance`)**:
```
variance = tradeVariancePct / 100
multiplier = 1 + (Math.random() * 2 - 1) * variance
variedAmount = baseAmount * multiplier
```
Applies random ± variance to trade sizes for organic appearance.

**Sell Quote Estimation**:
- For sells, estimates token amount needed for desired SOL output via `estimateTokenAmountForNetSolOut()`
- Falls back to `sellRatio` if quote estimation fails
- Uses `SELL_RATIO_BPS = 10_000` for percentage calculations

### Fee Handling
- Fee buffer: 0.003 SOL (3,000,000 lamports) reserved per wallet
- Auto top-up: If wallet balance is insufficient, tops up from main wallet
- Retry on fee errors: Attempts top-up and retry if transaction fails due to insufficient fees

**Fee Error Detection (`isFeeError`)**:
Checks error messages for keywords: `"insufficient"`, `"not enough"`, `"lamports"`, `"fee"` (case-insensitive).

**Retry Logic**:
1. Transaction fails with fee-related error
2. Top-up wallet from main wallet (0.003 SOL)
3. Retry the original transaction
4. If retry fails, log error and schedule next tick

**Balance Refresh**:
After each trade, fetches fresh balances to compute actual SOL delta for accurate PnL calculation (not estimated).

## Timer Manager

### Core Scheduling
- In-memory timers scheduled per wallet using `nextTickAt`
- Per-session stop timers based on `scheduledStopAt`
- Max timeout: ~24.8 days (JavaScript setTimeout limit)

### Recovery
- On startup, reads all RUNNING sessions and ACTIVE wallets
- Re-schedules timers for upcoming ticks
- Immediately processes overdue ticks (concurrency: 5)

### Watchdog
- Runs every 5 minutes to detect orphaned sessions
- Sessions with no activity for 30 minutes are auto-stopped
- Logs warning before stopping orphaned sessions

### Shutdown
- Registers SIGTERM/SIGINT handlers
- Cancels all timers on shutdown
- Sessions remain in RUNNING state for recovery on restart

## System Limits (volume-bot.config.ts)
- `minWallets`: 1
- `maxWallets`: 50
- `minFundingPerWalletSol`: 0.001
- `minTradeAmountSol`: 0.001
- `maxTradeAmountSol`: 1
- `minIntervalSeconds`: 10
- `maxIntervalSeconds`: 3600 (1 hour)
- `slippageBps`: 1000 (10% default)
- `maxConcurrentTicks`: 6
- `tickStaleMs`: 600,000 ms (10 minutes, stale tick threshold)
- `maxDurationHours`: 168 (7 days)
- `maxDurationSeconds`: 604,800 (168 * 60 * 60)
- `orphanedSessionTimeoutMs`: 1,800,000 ms (30 minutes)

## tRPC Endpoints
All endpoints require authentication (`protectedProcedure`).

- `volumeBot.start` — create session and schedule timers
- `volumeBot.status` — return session + wallet stats (by sessionId or tokenPublicKey)
- `volumeBot.stop` — request session stop (async, returns immediately)
- `volumeBot.reclaim` — consolidate SOL from session wallets to main wallet
- `volumeBot.closeAccounts` — close empty SPL token accounts for rent reclaim
- `volumeBot.listSessions` — list recent sessions by token/user (max 50)
- `volumeBot.eligibleWallets` — list eligible wallets with token balances and SOL estimates
- `volumeBot.selectionSummary` — compute target cap for dump selections (pre-start validation)
- `volumeBot.logs` — return recent session logs (last 40 entries)

## UI Behavior
- Token-scoped runs list at `/volume-bot` (token selected via sidebar switcher).
- Start/config page at `/volume-bot/new` with wallet selection + target pre-check.
- Per-run detail page at `/volume-bot/[sessionId]` with session stats, net SOL progress, and live logs.
- Session status is polled every 2-3s for live stats on the run page.
- Actions: start, stop, reclaim, close accounts.

### Presets
- **Conservative**: 10 wallets, 0.5 SOL funding, 0.01-0.03 SOL trades, 3-10 min intervals
- **Aggressive**: 30 wallets, 1 SOL funding, 0.05-0.15 SOL trades, 30s-3 min intervals, pump strategy

### Wallet Selection
- Shows wallets with token holdings (BUNDLER, VOLUME, DISTRIBUTION types)
- Displays token balance and estimated SOL value
- Required for dump strategy (must have tokens to sell)
- For dump: UI shows warning if target exceeds sellable value

## Initialization
Timer recovery is triggered via `lib/volume-bot-init.ts`, called from the tRPC context creation in `server/trpc/context.ts`:

```typescript
// server/trpc/context.ts
import { initVolumeBotTimers } from "@/lib/volume-bot-init";

export async function createContext() {
  // Fire-and-forget initialization with error logging
  void initVolumeBotTimers().catch((err) =>
    console.error("Failed to init volume bot timers:", err)
  );
  // ... rest of context
}
```

The init function uses a global promise to ensure single initialization across all requests. On first call, it runs `recover()` to restore RUNNING sessions and `registerShutdownHandlers()` for graceful shutdown. Subsequent calls return immediately without re-initializing.

## Runtime Requirements
- Persistent Node.js process (required for in-memory timers)
- Solana RPC provider with sufficient rate limits
- PostgreSQL database for state persistence

## Environment Variables
- `SOLANA_RPC_URL` — Solana RPC endpoint (required)
- `DATABASE_URL` — PostgreSQL connection string (required)

## Logging
The worker logs extensively with wallet prefix (first 8 chars of public key) for debugging:
- Action selection decisions
- Trade amounts and directions
- Balance changes and PnL
- Error details and retry attempts
- Watchdog activity and orphan detection

## Error Handling
- Trade errors: logged to VolumeBotLog, wallet schedules next tick
- Fee errors: auto top-up from main wallet, retry transaction
- Session errors: session marked FAILED, stops processing
- Orphaned sessions: watchdog auto-stops after 30 minutes of inactivity

## Token Handling
- Defaults to 6 decimals if mint info unavailable
- Uses actual token decimals when available from account info
- `formatTokenBalance()` handles decimals with 6 decimal places for fraction display
- Handles edge case: `decimals <= 0` returns raw number

## File Structure
```
server/
├── services/
│   ├── volume-bot.service.ts     # Main service (session CRUD, start, stop, reclaim)
│   ├── volume-bot-worker.ts      # Tick processing, trade execution
│   └── volume-bot-timer.ts       # Timer manager, recovery, watchdog
├── schemas/
│   └── volume-bot.schema.ts      # Zod validation schemas
└── trpc/routers/
    └── volume-bot.router.ts      # tRPC endpoints

lib/
├── config/
│   └── volume-bot.config.ts      # System limits and defaults
└── volume-bot-init.ts            # Initialization entry point
```
