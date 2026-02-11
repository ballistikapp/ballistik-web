# Logging Implementation

## Goals
- Centralize server-side logging
- Keep output console-only for now
- Make it easy to add external transports later

## Current Logger
- Location: `lib/logger.ts`
- Output: JSON lines to console
- Levels: `debug`, `info`, `warn`, `error`
- Minimum level: `LOG_LEVEL` (defaults to `info`)

## Log Shape
Each log line is JSON with:
- `timestamp`
- `level`
- `message`
- Context fields merged in (ex: `requestId`, `userId`, `path`, `durationMs`)

## Usage
- Base logger: `import { logger } from "@/lib/logger"`
- Child logger with shared context: `const requestLogger = logger.child({ requestId, userId })`
- Set transport later: `logger.setTransport((entry) => { ... })`

## Request Context
tRPC context adds:
- `requestId` (from `x-request-id` or generated)
- `logger` (child logger with request/user metadata)

## Extension Points
- Replace the transport via `setTransport` to write logs to a database or external service.
- Keep the console transport for local dev and fallback.
