# Test Run Logging

## Goal

Provide a production-readiness logging path for a critical manual run covering launch, volume bot activity, manual buys/sells, dashboard monitoring, holdings/transactions validation, fund return, and exit.

The implementation must produce:

- An automated local JSONL file with verbose structured events
- A manual JSON template for operator-entered notes and observations
- Before/after wallet balance evidence for slippage and fund-accounting analysis
- Dashboard-specific snapshots because dashboard correctness is the primary risk area

## Output Files

### Automated log

- Format: `jsonl`
- Default location: `logs/test-runs/<runId>.jsonl`
- Behavior: append-only, one JSON object per line
- Purpose: high-volume event stream for later filtering, diffing, and timeline reconstruction

### Manual run file

- Format: `json`
- Location: `docs/plans/2026-03-20-test-run-logging-template.json`
- Purpose: human-entered notes, expectations, discrepancies, bug severity, and final verdict

## Event Model

Every automated record should include these common fields:

- `runId`
- `timestamp`
- `eventType`
- `source`
- `tokenPublicKey`
- `page`
- `action`
- `userId` when server-side context exists
- `wallets`
- `balancesBefore`
- `balancesAfter`
- `expectedValue`
- `actualValue`
- `delta`
- `notes`

Optional fields are expected for more detailed events:

- `trigger`
- `status`
- `durationMs`
- `signature`
- `sessionId`
- `launchId`
- `refreshMode`
- `dataSource`
- `cache`
- `error`
- `summary`
- `snapshot`

## Event Taxonomy

The logging pipeline should support at least these event types:

- `run_started`
- `wallet_balance_snapshot`
- `dashboard_summary`
- `dashboard_full_snapshot`
- `dashboard_refresh`
- `dashboard_subscription_event`
- `dashboard_query_result`
- `launch_step`
- `volume_bot_event`
- `trade_attempt`
- `trade_result`
- `holdings_refresh`
- `holdings_page_snapshot`
- `transactions_refresh`
- `transactions_page_snapshot`
- `funds_return`
- `run_issue`
- `run_completed`

## Capture Rules

### Dashboard

Dashboard logs are the highest priority and should be captured at two depths:

- High-frequency summary events after meaningful refreshes and monitoring-triggered updates
- Full dashboard snapshots at critical milestones or when server results materially change

Dashboard summary events should include:

- Header price and market-cap fields
- Activity-card buy volume, sell volume, and transaction count
- Treasury totals
- Holdings totals and owned-wallet count
- Recent transaction count
- Monitoring health
- Refresh trigger (`poll`, `manual`, `sse`, `post-holdings-refresh`)

Full dashboard snapshots should include the rendered data payload that drives:

- Header
- Activity card
- Treasury card
- Holdings breakdown
- Recent transactions
- Operations state
- DeFi pool panel when present

### Holdings and Transactions Pages

The holdings and transactions routes should log page-level snapshots so dashboard aggregates can be compared with page-scoped data.

Holdings page events should capture:

- Loaded row count
- Total token balance
- Supply share
- Wallets with positive balance
- Refresh results
- Sell input and outcome summaries

Transactions page events should capture:

- Loaded row count
- Buy/sell counts
- Owned/external volume split
- Unique trader counts
- Refresh results

### Launch and Volume Bot

Existing launch and volume-bot logs remain useful, but the test-run stream should add correlation and before/after balance evidence.

Launch instrumentation must capture:

- Run start context
- Funding plan and post-funding balances
- Create/buy submission details
- Post-launch SOL return results
- Final launch wallet snapshot

Volume bot instrumentation must capture:

- Session start and stop
- Pre-trade balances
- Quote/min-output context when available
- Post-trade balances
- Actual-versus-target deltas
- Slippage warnings and wallet pauses

### Wallet Balance Snapshots

Balance snapshots are required:

- At run start
- Before and after launch funding
- Before and after launch create/buy
- Before and after holdings sell actions
- Before and after return-to-main-wallet actions
- Before and after volume-bot trades where feasible
- At run end

Each balance snapshot should identify the data source:

- `rpc`
- `subscription-cache`
- `database-snapshot`

## Slippage Analysis

Slippage analysis should not rely on a single metric. The log should preserve both intent and observed effect.

Per action, capture:

- Intended spend or receive amount
- Observed SOL delta
- Observed token delta
- Fee payer when relevant
- Quote-derived min output when available
- Computed slippage basis points
- Any fallback mode used for sells

This allows later comparison between:

- Expected wallet delta
- Immediate on-chain effect
- Persisted dashboard/holdings state
- Final recovered amount returned to the main wallet

## Client and Server Responsibilities

### Server-side logging

Server flows write directly to the JSONL file for:

- Launch lifecycle
- Volume bot lifecycle and trades
- Holdings refresh and sell flows
- Wallet refresh and transfer flows
- Dashboard service query and cache behavior

### Client-side logging

Client routes cannot write directly to the local file, so they must send structured events to a server endpoint or tRPC mutation that appends to the same JSONL file.

This is required for:

- Dashboard snapshots of what the user actually sees
- Holdings page summaries
- Transactions page summaries
- Monitoring health transitions
- Client refresh triggers and subscription errors

## Security Rules

- Never log private keys, session tokens, or secrets
- Do not serialize full token records if they may contain hidden fields
- Prefer whitelisted summary payloads over raw object dumps for client logs
- Keep wallet public keys and transaction signatures, but treat them as operational identifiers only

## Manual Run Template Requirements

The manual JSON template should include:

- Test metadata
- Pre-run expectations
- Baseline wallet balances
- Milestone-by-milestone dashboard observations
- Manual buy/sell entries
- Holdings/transactions discrepancies
- Slippage notes
- Bugs found with severity and repro notes
- Final before/after reconciliation
- Production-readiness verdict

## Validation Requirements

Before the test run is used, validate:

- The JSONL file is created automatically for a run
- Events are appended in valid JSONL form
- Dashboard summary and full-snapshot events are both present
- Wallet before/after snapshots are present around critical actions
- No secrets appear in log output
- The manual JSON template parses as valid JSON
