# Logging Implementation

## Goals
- Centralize server-side logging
- Keep runtime output console-first for now
- Keep audit timelines in main Postgres only where product flows require it
- Keep transport simple and console-only for now

## Current Logger
- Location: `lib/logger.ts`
- Output: JSON lines to console
- Levels: `debug`, `info`, `warn`, `error`
- Minimum level: `LOG_LEVEL` (defaults to `info`)

## Source of Truth Policy
- Main Postgres log tables (`LaunchLog`, `HoldingExitLog`, `VolumeBotLog`) are for domain/audit timelines shown in product flows.
- Runtime/operational logs (request lifecycle, infra diagnostics, background worker health, unexpected errors) go through the shared logger transport and are not treated as product timeline data.
- Main DB is not the sink for all operational logs.

## Log Shape
Each log line is JSON with:
- `timestamp`
- `level`
- `message`
- Context fields merged in (ex: `requestId`, `userId`, `path`, `durationMs`)

## Minimum Structured Context
- `requestId` for request-scoped logs (or job/session ID for background work)
- `service` or subsystem tag for non-request work
- `durationMs` on operation completion/failure logs where timing is relevant
- Entity identifiers (`launchId`, `exitId`, `sessionId`) for domain workflows
- Launch background jobs and Solana bundle code should include `launchId` on stdout logs via `logger.child({ launchId, subsystem })`

## Launch Debug File Logging

Optional JSONL file logging for local test runs lives in `lib/test-run-log.ts`:

- Enable with `TEST_RUN_LOG_ENABLED=true`
- Optional `TEST_RUN_ID` and `TEST_RUN_LOG_PATH` override the default `logs/test-runs/<runId>.jsonl`
- `persistLaunchLog()` and other domain log writers also append mirrored events when enabled

Use this for reconstructing a full launch attempt from a single file during bundled-launch debugging. Production relies on stdout (Railway) plus `LaunchLog` rows.

## Launch Failure Stack Traces

- `LaunchLog` ERROR rows remain user-facing: message plus structured `data` without stack traces
- Operational `logger.error("Launch failed", ...)` in `launch.service.ts` includes `errorStack` when the caught value is an `Error`

## Usage
- Base logger: `import { logger } from "@/lib/logger"`
- Child logger with shared context: `const requestLogger = logger.child({ requestId, userId })`
- Set transport later: `logger.setTransport((entry) => { ... })`

## Request Context
tRPC context adds:
- `requestId` (from `x-request-id` or generated)
- `logger` (child logger with request/user metadata)

## Redaction and Safety
- Never log raw secrets or private material (private keys, JWTs, API keys, callback secrets, auth headers).
- Prefer boolean/shape indicators over raw payload dumps for sensitive inputs (ex: `hasTwitter`, `tokenMediaSource`).
- Keep log payloads concise; avoid large arrays/objects in hot paths unless needed for diagnostics.

## Extension Points
- Replace the transport via `setTransport` to write logs to a database or external service.
- Keep the console transport for local dev and fallback.

## Transport Policy
- Runtime logs remain console JSON output in all environments.
- Additional shipping transports are intentionally deferred to future observability work.

## Verification
- Trigger representative traffic (tRPC request, background worker tick, handled error).
- Confirm JSON log lines include `timestamp`, `level`, `message`, and expected context fields.
- Confirm request-scoped entries include `requestId` and relevant identifiers.
- Confirm handled errors include structured error metadata (`errorName`, `errorMessage`, optional `errorStack`).

## Deferred Backlog
- External log shipping transport decisions are deferred to a future observability pass.
- DB retention/maintenance jobs (pruning/archive/cron strategy) are intentionally deferred to reduce current complexity.
