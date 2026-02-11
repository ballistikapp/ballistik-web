# Volume Bot Implementation

## Goals

- Provide a production-ready volume bot with durable scheduling.
- Run trading loops inside the web process using in-memory timers.
- Persist sessions, wallets, and trade logs for recovery and UI status.
- Support scheduled start, scheduled stop, reclaim, and close-accounts actions.

## Recent Changes: Independent Range Intervals

**Date**: 2026-01-29

### What Changed

Previously, the volume bot selected one range per wallet tick using weighted probabilities, and that range's interval determined when the next tick would occur.

Now, **each range runs on its own independent timer**. For a session with 10 wallets and 3 ranges, there are 30 concurrent timers (10 × 3).

### Key Differences

1. **Probability Semantics**: `probability` now means "execution probability when this range's timer fires" instead of "selection weight"
2. **No Probability Sum Requirement**: Ranges no longer need to sum to 1.0 since they're independent
3. **Concurrent Execution**: All ranges fire on their own schedules simultaneously
4. **In-Flight Protection**: Wallets can't execute multiple trades concurrently; if one range is trading, others skip
5. **Volume Calculation**: Sum across all ranges since they run in parallel

### Why This Change

This provides more predictable and consistent behavior - a range with 1-5 second interval will actually fire every 1-5 seconds regardless of other ranges, making volume patterns more reliable and easier to reason about.

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

Each range defines a trade size pattern and timing. **Ranges run independently** - each range has its own interval timer per wallet:

- `solMin` / `solMax`: minimum and maximum trade size in SOL
- `increment`: step size for round numbers; if set, build steps from `solMin` to `solMax` and pick uniformly
- `probability`: execution probability (0-1); probability that a trade executes when the range's interval fires
- `intervalMin` / `intervalMax`: seconds between consecutive ticks for **this specific range** (independent of other ranges)
- `direction`: `buy` | `sell` | `both`
- `buyProbability`: required when `direction = both` (0-1)

**Important**: Unlike the old behavior where ranges were selected by probability at each tick, **each range now runs on its own independent timer**. The `probability` field now controls whether a trade executes when the range's timer fires, not the selection frequency.

**Trade Amount Selection**:

- If `increment > 0`: build steps `[solMin, solMin + increment, ...]` up to `solMax`, then select a step uniformly.
- If `increment` is null/0/undefined: generate uniform random `solMin..solMax`.

**Execution Probability Check**:

- When a range's timer fires, generate `R1 = Math.random()` in `[0, 1)`.
- If `R1 > range.probability`, skip trade execution and reschedule for the next interval.
- This allows ranges to fire regularly but execute trades only with a certain probability.

**Direction Selection**:

- If `direction = buy`: return buy.
- If `direction = sell`: return sell.
- If `direction = both`: generate independent `R2 = Math.random()` and compare with `buyProbability`.

CRITICAL: Random values are generated independently for probability check (`R1`) and direction selection (`R2`).

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

1. Each `range.probability` must be in range `[0, 1]`. **Note**: Probability sum validation is removed since ranges run independently.
2. Each range: `solMin <= solMax`, `intervalMin <= intervalMax`.
3. `solMin >= 0.001`, `solMax <= 10`, `intervalMin >= 1`, `intervalMax <= 3600`.
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

**With independent range intervals**, each range fires on its own schedule and probability controls execution:

For each range:

- `avgAmount = (solMin + solMax) / 2`
- `avgInterval = (intervalMin + intervalMax) / 2`
- `ticksPerMinute = 60 / avgInterval`
- `executionsPerMinute = ticksPerMinute * probability * totalWalletCount`
- `volumePerMinute = avgAmount * executionsPerMinute`
- `minVolumePerMinute = solMin * (60 / intervalMax) * probability * totalWalletCount`
- `maxVolumePerMinute = solMax * (60 / intervalMin) * probability * totalWalletCount`

Sum across **all ranges** (they run concurrently) and multiply by `(targetDurationSeconds / 60)` for session totals.
Display: `X-Y SOL/min, A-B SOL total session`.

**Example**: 3 ranges with 10 wallets each:
- Range 0: interval 10-20s, probability 0.5 → ~1.5 trades/min (10 wallets × 60/15 × 0.5)
- Range 1: interval 5-10s, probability 0.3 → ~2.4 trades/min (10 wallets × 60/7.5 × 0.3)
- Range 2: interval 30-60s, probability 1.0 → ~1.3 trades/min (10 wallets × 60/45 × 1.0)
- **Total**: ~5.2 trades/min across all ranges

### Net Delta SOL Estimation

Shows the min and max expected net SOL change (profit/loss) for the session. This helps users understand the expected P&L before starting the bot.

**Per-trade net delta calculation** for each range:

- `direction = buy`: `minNetDelta = +probability * solMin`, `maxNetDelta = +probability * solMax`
- `direction = sell`: `minNetDelta = -probability * solMax`, `maxNetDelta = -probability * solMin`
- `direction = both`: 
  - `minNetDelta = probability * (buyProbability * solMin - sellProbability * solMax)`
  - `maxNetDelta = probability * (buyProbability * solMax - sellProbability * solMin)`

**Per-minute and total calculation**:

- `netSolPerTrade = { min: sum(minNetDelta), max: sum(maxNetDelta) }` across all ranges
- `tradesPerMinute = (60 / avgIntervalWeighted) * totalWalletCount`
- `netSolPerMinute = { min: netSolPerTrade.min * tradesPerMinute, max: netSolPerTrade.max * tradesPerMinute }`
- `netSolTotal = { min: netSolPerMinute.min * minutes, max: netSolPerMinute.max * minutes }`

**Display on Start Volume Bot page** (preflight section):

- **Net Δ SOL per minute**: `X—Y SOL` (min to max range)
- **Total net Δ SOL (at end)**: `A—B SOL` (min to max range for full session)

These metrics appear alongside volume estimates and help users understand:
- Whether the session will be net profitable or net cost
- The range of possible outcomes based on configuration
- Expected SOL balance change at session end

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

- `start`: validate input, create session, fund wallets, schedule independent timers for each wallet-range combination
- `tick`: execute one trade for a specific wallet-range pair and schedule next tick for that range
- `stop`: request stop, cancel all timers, return SOL to main wallet (tokens remain)
- `reclaim`: consolidate SOL back to main wallet (manual action post-stop)
- `close-accounts`: close empty SPL token accounts for rent reclaim

### Scheduling Phase (per wallet-range pair)

1. For each wallet, schedule a timer for **each range independently**.
2. Generate interval using `randomBetween(range.intervalMin, range.intervalMax)`.
3. Set `nextTickAt = now + interval` for this specific wallet-range pair.
4. Store timer with key `walletId:rangeIndex`.

**Key Change**: Instead of one timer per wallet, there are now `walletCount * rangeCount` timers running concurrently.

### Execution Phase (when wallet-range timer fires)

1. Validate session status = RUNNING and wallet status = ACTIVE.
2. Check `scheduledStopAt` or duration exceeded and stop if needed.
3. **Check execution probability**: `Math.random() > range.probability` → skip and reschedule.
4. **Check if wallet has trade in-flight**: if yes, skip and reschedule (prevents concurrent trades).
5. Select trade amount from this specific range.
6. Select direction using independent random `R2` if `direction = both`.
7. Fetch balances from chain (SOL and tokens) using gRPC cache or RPC fallback.
8. Build transaction with slippage protection.
9. Execute transaction and wait for confirmation.
10. Update balances and stats.
11. Schedule next tick for **this specific wallet-range pair**.

### Wallet Eligibility & Retry

Cooldown:

- `cooldownSeconds = Math.max(range.intervalMin * 0.5, 0.5)`
- Eligible when `(now - lastTradeAt) > cooldownSeconds`

Eligibility filters:

- `status = ACTIVE`
- `inFlightTrade = false` (per wallet, prevents concurrent trades from multiple ranges)
- For buys: `solBalance >= tradeAmount + 0.003`
- For sells: `tokenBalance > 0`

**Important**: The `inFlightTrade` check prevents a wallet from executing multiple trades concurrently (e.g., when multiple range timers fire at the same time). If a wallet is already trading, other ranges will skip and reschedule.

If no eligible wallets:

- Retry up to 3 times with 5 second delays (15 seconds total).
- After 3 failures, log a warning with ineligibility reasons, skip trade, and schedule the next tick for that specific range.

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

- In-memory timers scheduled per **wallet-range pair** using computed `nextTickAt`
- Timer keys use format: `walletId:rangeIndex` (e.g., `abc123:0`, `abc123:1`)
- Each wallet has `rangeCount` independent timers running concurrently
- Per-session stop timers based on `scheduledStopAt`
- Max timeout: ~24.8 days (JavaScript setTimeout limit)

**Example**: A session with 10 wallets and 3 ranges will have 30 concurrent timers (10 × 3).

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
- For each wallet, schedules timers for **all ranges** (fresh intervals computed).
- Immediately processes all wallet-range combinations (concurrency: 5).
- Since timers are in-memory only, recovery starts all ranges fresh with new random intervals.

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
- `volumeBot.status` — return session + wallet stats + range metrics (by sessionId or tokenPublicKey)
  - Returns: `session`, `wallets`, `rangeMetrics`
  - `session.totalPnlSol`: total net delta SOL at session end
  - `session.netDeltaSolPerMinute`: net delta SOL per minute (totalPnlSol / runtimeMinutes)
  - `rangeMetrics`: array of per-range expected net delta SOL metrics
    - `rangeIndex`: range position in config
    - `expectedNetDeltaSolPerTrade`: expected net SOL change per trade for this range
    - `expectedNetDeltaSolPerMinute`: expected net SOL change per minute across all wallets
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

### Session Page Display

The session page (`/volume-bot/[sessionId]`) displays:

**Whole Session Metrics:**
- Total net delta SOL at session end (`totalPnlSol`)
- Net delta SOL per minute (`netDeltaSolPerMinute = totalPnlSol / runtimeMinutes`)

**Per-Range Metrics:**
- For each range, display expected net delta SOL per minute
- Calculated based on range configuration (direction, probability, interval, amount)
- Accounts for all wallets in the session

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
