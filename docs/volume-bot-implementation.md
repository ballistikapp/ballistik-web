# Volume Bot Implementation

## Goals

- Provide a production-ready volume bot with durable scheduling.
- Run trading loops inside the web process using in-memory timers.
- Persist sessions, wallets, and trade logs for recovery and UI status.
- Support scheduled start, scheduled stop, reclaim, and close-accounts actions.

## Architecture Summary

- UI and tRPC run in the web service.
- Timer manager schedules wallet ticks from the web process.
- Postgres stores state and logs.
- Trades execute against pump.fun bonding curve via `@pump-fun/pump-sdk`.

## Data Model

### VolumeBotSession

Tracks one bot run per token/user.

- `status`: DRAFT | SCHEDULED | RUNNING | STOP_REQUESTED | STOPPING | STOPPED | FAILED
- `config`: JSON config snapshot (ranges + wallet + behavior + timing)
- `scheduledStartAt`: optional scheduled start time
- `scheduledStopAt`: optional auto-stop time
- `stopRequestedAt`: timestamp when stop was requested
- `startedAt`, `stoppedAt`: session lifecycle timestamps
- `lastTickAt`: timestamp of most recent wallet tick (used by watchdog)
- `totalVolumeUsd`, `totalTrades`, `totalPnlSol`, `runtimeSeconds`: summary stats
  - `totalPnlSol` is the net SOL delta from bot-only trades on the bonding curve

### VolumeBotPreset

Stores per-user saved configurations for quick reuse.

- `name`: unique per user
- `config`: JSON snapshot (ranges + wallet + behavior + duration, including selected wallets)
- `createdAt`, `updatedAt`

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
- In-memory only: `inFlightTrade`, `slippageFailureCount`

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

### Probability Format (0-1 decimals)

- All probabilities are stored and used as decimals in the range `[0, 1]`.
- Example: 60% = `0.6`, not `60`.

### Range Configuration

Each range defines a trade size pattern and timing:

- `solMin` / `solMax`: minimum and maximum trade size in SOL
- `increment`: step size for round numbers; if set, build steps from `solMin` to `solMax` and pick uniformly
- `probability`: selection frequency (0-1); all range probabilities must sum to 1
- `intervalMin` / `intervalMax`: seconds between consecutive trades for this range
- `direction`: `buy` | `sell` | `both`
- `buyProbability`: required when `direction = both` (0-1)

**Trade Amount Selection**:

- If `increment > 0`: build steps `[solMin, solMin + increment, ...]` up to `solMax`, then select a step uniformly.
- If `increment` is null/0/undefined: generate uniform random `solMin..solMax`.

**Range Selection**:

- Generate `R1 = Math.random()` in `[0, 1)`.
- Accumulate probabilities until sum >= `R1`.

**Direction Selection**:

- If `direction = buy`: return buy.
- If `direction = sell`: return sell.
- If `direction = both`: generate independent `R2 = Math.random()` and compare with `buyProbability`.

CRITICAL: Never reuse random values between range selection (`R1`) and direction selection (`R2`).

### Wallet Configuration

- `generatedWalletCount`: number of new wallets to create per session
- `selectedWalletPublicKeys`: existing wallets included in this run
- `fundingPerGeneratedWallet`: SOL funded to each generated wallet
- `topUpAmount`: SOL threshold for selected wallets (top up to this amount if below)

### Behavior Configuration

- `slippageBps`: slippage tolerance in basis points
- `sellFallbackRatio`: fraction of token balance to sell when target sell cannot be met
- `pauseOnHighSlippage`: pause wallet when repeated high slippage occurs
- `maxSlippageFailures`: consecutive slippage failures before pausing

### Timing Configuration

- `targetDurationSeconds`: total runtime (required)
- `scheduledStartAt`: optional future timestamp for delayed start
- `scheduledStopAt`: optional explicit stop timestamp (overrides targetDurationSeconds)

### Validation Rules

1. `sum(range.probability) = 1.0` with tolerance `Math.abs(sum - 1.0) < 0.001`.
2. Each range: `solMin <= solMax`, `intervalMin <= intervalMax`.
3. `solMin >= 0.001`, `solMax <= 10`, `intervalMin >= 10`, `intervalMax <= 3600`.
4. `totalWalletCount = generated + selected` must be `1-50`.
5. `targetDurationSeconds` must be `1-604800`.
6. If `scheduledStartAt` is set, it must be in the future and within 30 days.
7. If `direction = both`, `buyProbability` is required (0-1).
8. If `increment` is defined, it must be `> 0` and yield at least 2 steps.
9. Net sell sessions require selected wallets with tokens (block if none).

## Preflight Validation & Estimates

### Net SOL Direction

For each range:

- `direction = buy`: contribution = `+probability * avgAmount`
- `direction = sell`: contribution = `-probability * avgAmount`
- `direction = both`: contribution = `probability * avgAmount * (2 * buyProbability - 1)`

`netSolDirection = sum(contributions)`

Validation behavior:

- `< 0` (net sell): require selected wallets with token holdings, block if none.
- `>= 0` with sell ranges: warn if `estimatedSellVolume > totalSellableValue * 0.5`.
- `> 0` with no sell ranges: wallet selection optional.

### Volume Estimation

For each range:

- `avgAmount = (solMin + solMax) / 2`
- `avgInterval = (intervalMin + intervalMax) / 2`
- `tradesPerMinute = 60 / avgInterval * probability * totalWalletCount`
- `volumePerMinute = avgAmount * tradesPerMinute`
- `minVolumePerMinute = solMin * 60 / intervalMax * probability * totalWalletCount`
- `maxVolumePerMinute = solMax * 60 / intervalMin * probability * totalWalletCount`

Sum across ranges and multiply by `(targetDurationSeconds / 60)` for session totals.
Display: `X-Y SOL/min, A-B SOL total session`.

### Funding Calculation (Suggested)

1. `avgIntervalWeighted = Σ(probability * (intervalMin + intervalMax)/2)`
2. `estimatedTradesPerWallet = targetDurationSeconds / avgIntervalWeighted`
3. `avgTradeSizeWeighted = Σ(probability * (solMin + solMax)/2)`
4. Compute `netSolDirection` using the formula above
5. `totalExpectedVolume = estimatedTradesPerWallet * avgTradeSizeWeighted * totalWalletCount`
6. `bufferMultiplier = netSolDirection > 0 ? clamp(1 + netSolDirection/totalExpectedVolume, 1.0, 2.0) : 1.0`
7. `baseFunding = estimatedTradesPerWallet * avgTradeSizeWeighted`
8. `suggestedFunding = Math.ceil(baseFunding * bufferMultiplier * 1.1 * 100) / 100`

The UI pre-fills `fundingPerGeneratedWallet` with `suggestedFunding` and warns if the user sets a lower value.

## Worker Workflow (Event-Based)

### Lifecycle Operations

- `start`: validate input, create session, fund wallets, schedule timers
- `tick`: execute one trade and schedule next tick
- `stop`: request stop, cancel timers, return SOL to main wallet (tokens remain)
- `reclaim`: consolidate SOL back to main wallet (manual action post-stop)
- `close-accounts`: close empty SPL token accounts for rent reclaim

### Scheduling Phase (per wallet)

1. Select range using weighted probabilities (R1).
2. Generate interval using `randomBetween(intervalMin, intervalMax)`.
3. Set `nextTradeAt = now + interval`.
4. Store assigned range for the wallet tick and schedule timer.

### Execution Phase (when timer fires)

1. Validate session status = RUNNING and wallet status = ACTIVE.
2. Check `scheduledStopAt` or duration exceeded and stop if needed.
3. Select trade amount from the assigned range.
4. Select direction using independent random `R2` if `direction = both`.
5. Fetch balances from chain (SOL and tokens).
6. Build transaction with slippage protection.
7. Execute transaction and wait for confirmation.
8. Update balances and stats.
9. Schedule next tick.

### Wallet Eligibility & Retry

Cooldown:

- `cooldownSeconds = Math.max(range.intervalMin * 0.3, 10)`
- Eligible when `(now - lastTradeAt) > cooldownSeconds`

Eligibility filters:

- `status = ACTIVE`
- `inFlightTrade = false`
- For buys: `solBalance >= tradeAmount + 0.003`
- For sells: `tokenBalance > 0`

If no eligible wallets:

- Retry up to 3 times with 5 second delays (15 seconds total).
- After 3 failures, log a warning with ineligibility reasons, skip trade, and schedule the next tick.

### Sell Transaction Handling

Critical: fetch bonding curve state and calculate token amounts within 5 seconds of execution.

CASE A: `tokenBalance >= requiredAmount`

- Sell `requiredAmount`, apply slippage protection.

CASE B: `tokenBalance < requiredAmount` and `>= requiredAmount * 0.5`

- Sell all available tokens (partial sell).
- Log: `Partial sell: target X SOL, selling all Y tokens`.

CASE C: `tokenBalance < requiredAmount * 0.5`

- Sell `tokenBalance * sellFallbackRatio`.
- Log: `Fallback ratio sell: target X SOL, selling Y% of balance`.

CASE D: `tokenBalance = 0`

- Skip trade.
- Log: `Sell skipped: no tokens`.

### Slippage Counter Logic

In-memory tracking per wallet:

- `inFlightTrade: boolean`
- `slippageFailureCount: number`

After each trade:

1. `slippage = |actual - target| / target`
2. If `slippage > slippageBps/10000`:
   - Increment `slippageFailureCount`
   - If `slippageFailureCount >= maxSlippageFailures` and `pauseOnHighSlippage = true`, set wallet status to PAUSED and do not reschedule
3. If normal trade, reset `slippageFailureCount = 0`

## Timer Manager

### Core Scheduling

- In-memory timers scheduled per wallet using `nextTickAt`
- Per-session stop timers based on `scheduledStopAt`
- Max timeout: ~24.8 days (JavaScript setTimeout limit)

### Scheduled Start

- If delay <= 24 days: `setTimeout(startSession, delay)`.
- If delay > 24 days: daily polling job checks, creates timer when within 24 days.
- On timer fire:
  1. Update status = RUNNING, set `startedAt`.
  2. Fund generated wallets (always).
  3. Top up selected wallets if `solBalance < topUpAmount`.
  4. Schedule first trade for each wallet.
- On restart: recreate timers for SCHEDULED sessions.

### Recovery

- On startup, reads all RUNNING sessions and ACTIVE wallets.
- Re-schedules timers for upcoming ticks.
- Immediately processes overdue ticks (concurrency: 5).

### Watchdog

- Runs every 5 minutes to detect orphaned sessions.
- Sessions with no activity for 30 minutes are auto-stopped.
- Logs warning before stopping orphaned sessions.

### Shutdown

- Registers SIGTERM/SIGINT handlers.
- Cancels all timers on shutdown.
- Sessions remain in RUNNING or SCHEDULED state for recovery on restart.

## System Limits (volume-bot.config.ts)

- `minWallets`: 1
- `maxWallets`: 50
- `minFundingPerWalletSol`: 0.001
- `minTradeAmountSol`: 0.001
- `maxTradeAmountSol`: 10
- `minIntervalSeconds`: 10
- `maxIntervalSeconds`: 3600 (1 hour)
- `minRanges`: 1
- `maxRanges`: 5
- `minRangeProbability`: 0.01
- `maxRangeProbability`: 1.0
- `slippageBps`: 1000 (10% default)
- `maxConcurrentTicks`: 6
- `tickStaleMs`: 600,000 ms (10 minutes, stale tick threshold)
- `maxDurationHours`: 168 (7 days)
- `maxDurationSeconds`: 604,800 (168 _ 60 _ 60)
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
- `volumeBot.selectionSummary` — preflight estimates and wallet warnings
- `volumeBot.logs` — return recent session logs (last 40 entries)
- `volumeBot.listPresets` — list saved presets for the user
- `volumeBot.savePreset` — create/update preset by name
- `volumeBot.deletePreset` — delete preset by id

## UI Behavior (Minimal Scope)

- Data-dense display over aesthetics.
- Auto-refresh every 2-3s for RUNNING sessions.
- Essential changes only: range builder form, preflight estimates display, range-based session summary.
- Remove legacy strategy fields.
- Defer styling and polish.
- Presets: select, apply, save, delete from the start page.

## Initialization

Timer recovery is triggered via `lib/volume-bot-init.ts`, called from the tRPC context creation in `server/trpc/context.ts`.
The init function uses a global promise to ensure single initialization across all requests. On first call, it runs `recover()` and registers shutdown handlers.

## gRPC Streaming (RabbitStream)

The volume bot uses Shyft RabbitStream for real-time account updates, reducing RPC polling by ~80%.

### Architecture

- `server/solana/volume-bot-grpc.ts` — gRPC manager with balance caching
- `lib/solana/rpc-limiter.ts` — Token bucket rate limiter (fallback)
- `lib/config/rpc.config.ts` — RabbitStream endpoint configuration

### How It Works

1. When a session starts, the timer manager connects to RabbitStream
2. Subscribes to wallet SOL accounts, token accounts, and bonding curve
3. Balance updates stream into in-memory cache
4. Worker reads from cache first, falls back to RPC on cache miss
5. Transaction confirmations received via gRPC streaming

### RPC Calls Comparison

| Operation | Without gRPC | With gRPC |
|-----------|--------------|-----------|
| Check SOL balance | 1 RPC | 0 (cached) |
| Check token balance | 1 RPC | 0 (cached) |
| Get blockhash | 1 RPC | 1 RPC |
| Send transaction | 1 RPC | 1 RPC |
| Confirm transaction | 3-5 RPC | 0 (streamed) |
| Post-trade balances | 2 RPC | 0 (streamed) |
| **Total per trade** | **~10 RPC** | **~2 RPC** |

### Rate Limits (Shyft Build Plan)

- RPC requests: 100/sec (limiter uses 80/sec)
- sendTransaction: 20/sec (max ~18 trades/sec)
- gRPC connections: 10 (1 for volume bot)

### Interval-Wallet Constraints

| Min Interval | Max Wallets | Trades/sec |
|--------------|-------------|------------|
| 1s | 18 | ~18 |
| 2s | 36 | ~18 |
| 5s | 50 | ~10 |
| 10s | 50 | ~5 |

### Fallback Behavior

- If `SHYFT_API_KEY` is not set, gRPC is disabled
- If gRPC connection fails, uses RPC with rate limiter
- On cache miss, fetches via RPC with rate limiting
- Auto-reconnect with 5-second delay on disconnect

## Runtime Requirements

- Persistent Node.js process (required for in-memory timers).
- Solana RPC provider with sufficient rate limits.
- PostgreSQL database for state persistence.

## Environment Variables

- `SOLANA_RPC_URL` — Solana RPC endpoint (required)
- `SHYFT_API_KEY` — Shyft API key for gRPC streaming (optional, recommended)
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
│   ├── volume-bot-presets.service.ts # Preset CRUD
│   ├── volume-bot-worker.ts      # Tick processing, trade execution
│   └── volume-bot-timer.ts       # Timer manager, recovery, watchdog
├── schemas/
│   └── volume-bot.schema.ts      # Zod validation schemas
├── solana/
│   └── volume-bot-grpc.ts        # RabbitStream gRPC manager
└── trpc/routers/
    └── volume-bot.router.ts      # tRPC endpoints

lib/
├── config/
│   ├── volume-bot.config.ts      # System limits and defaults
│   └── rpc.config.ts             # RabbitStream endpoints
├── solana/
│   └── rpc-limiter.ts            # Token bucket rate limiter
└── volume-bot-init.ts            # Initialization entry point
```
