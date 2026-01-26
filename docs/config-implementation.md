# Config Implementation

## Goals
- Centralize environment variable parsing and validation
- Provide typed, domain-focused config objects
- Keep config access consistent across server modules

## Structure
- `lib/config/env.ts` parses and validates raw environment values with Zod
- `lib/config/launch.config.ts` exposes launch-specific settings derived from `env`
- `lib/config/rpc.config.ts` stores RPC tuning and gRPC region defaults
- `lib/config/cache.config.ts` stores refresh staleness and cooldown thresholds
- `src/lib/config/jito.config.ts` stores Jito block engine URL defaults

## Usage
- Call `getEnv()` when you need raw environment values
- Call `getDatabaseUrl()` when you need the Prisma connection string
- Call `getLaunchConfig()` for launch-specific constants and env-derived settings
- Avoid direct `process.env` access outside `lib/config`

## Environment Variables
- `SOLANA_RPC_URL` is required and validated when `getEnv()` is called
- `SHYFT_API_KEY` is optional and used for Shyft gRPC authentication
- `DATABASE_URL` is used for Prisma connections when set
- `DEV_STORAGE_POSTGRES_URL` / `PROD_STORAGE_POSTGRES_URL` are optional fallbacks for local and hosted Postgres

## Logging
- `LOG_LEVEL` is optional and defaults to `info`
- Supported levels: `debug`, `info`, `warn`, `error`
- Server logs are JSON lines to console with `timestamp`, `level`, `message`, and merged context fields
- Use `logger.setTransport()` to route logs to another destination later
- Next.js request logging is disabled via `next.config.ts` (`logging.incomingRequests = false`)
- BigInt native binding warnings are suppressed to avoid console noise

## Extending
- Add new domain configs under `lib/config`
- Derive values from `env` and validate with Zod
- Export inferred types for new config objects
