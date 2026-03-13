# Config Implementation

## Goals

- Centralize environment variable parsing and validation
- Provide typed, domain-focused config objects
- Keep config access consistent across server modules

## Structure

- `lib/config/env.ts` parses and validates raw environment values with Zod
- `lib/config/launch.config.ts` exposes launch-specific settings derived from `env`
- `lib/config/rpc.config.ts` stores RPC tuning, gRPC region defaults, and RabbitStream endpoints
- `lib/config/cache.config.ts` stores refresh staleness, cooldown thresholds, and TTL values
- `lib/config/jito.config.ts` stores Jito block engine URL defaults
- `lib/config/volume-bot.config.ts` stores volume bot limits and runtime defaults

## Usage

- Call `getEnv()` when you need raw environment values
- Call `getDatabaseUrl()` when you need the Prisma connection string
- Call `getLaunchConfig()` for launch-specific constants and env-derived settings
- Avoid direct `process.env` access outside `lib/config`

## Environment Variables

- `SOLANA_RPC_URL` is required and validated when `getEnv()` is called
- `SHYFT_API_KEY` is required and enables Shyft REST APIs, callback management, and DeFi APIs
- `SHYFT_GRPC_TOKEN` is required and provides the x-token for gRPC authentication
- `SHYFT_CALLBACK_SECRET` is optional and used to validate incoming Shyft webhook requests
- `REFRESH_TOKEN_TTL_DAYS` defaults to `7` days when unset and must be a positive integer when provided
- `PINATA_JWT` is required and enables token media uploads to Pinata during token persistence
- `PINATA_GATEWAY_URL` is required (must be a valid URL) and sets the base gateway used for stored IPFS media URLs
- `APP_URL` is required (must be a valid URL) and used to construct the Shyft callback webhook URL (`${APP_URL}/api/webhooks/shyft`) for automatic callback registration on token and wallet creation.
- `FEE_COLLECTOR_WALLET_ADDRESS` is required for usage-fee collection flows (launch and volume bot generated-wallet fees)
- `DATABASE_URL` is required for Prisma connections (one value per Railway environment)
- `getDatabaseUrl()` currently reads only `DATABASE_URL`
- `DEV_STORAGE_POSTGRES_URL` / `PROD_STORAGE_POSTGRES_URL` may still appear in legacy error messaging, but are not part of `env.ts` parsing today

## Environment Mapping

- Deployment platform is Railway with two environments: `staging` and `production`
- Branch mapping is `staging` -> Railway `staging`, and `main` -> Railway `production`
- Each environment has an independent PostgreSQL instance and therefore a different `DATABASE_URL`
- Local development currently uses the staging PostgreSQL connection via `DATABASE_URL`
- Local development can keep working without Pinata; token media falls back to existing inline data-URL storage when `PINATA_JWT` is unset

## Logging

- `LOG_LEVEL` is optional and defaults to `info`
- Supported levels: `debug`, `info`, `warn`, `error`
- Server logs are JSON lines to console with `timestamp`, `level`, `message`, and merged context fields
- Main DB log tables are reserved for domain/audit timelines; runtime operational logs should remain transport-based
- Use `logger.setTransport()` to route logs to another destination later
- Runtime log records should include stable context keys (`requestId` or job/session id, `service`, `durationMs` when relevant)
- Never emit secrets in logs (private keys, JWTs/tokens, API keys, auth headers)
- Next.js request logging is disabled via `next.config.ts` (`logging.incomingRequests = false`)
- BigInt native binding warnings are suppressed to avoid console noise

### Deferred Logging Work

- External log shipping transport selection is deferred to a future observability pass
- DB retention/maintenance jobs are deferred (no pruning cron in the current pass)

## Cache Config

`lib/config/cache.config.ts` defines:

- `staleMs` — staleness thresholds for transactions (30s), holdings (30s), and wallets (60s)
- `cooldownMs` — debounce intervals for balance refresh, with separate values for subscription-aware and polling modes
- `ttlMs` — TTL for in-memory caches (bonding curve: 5s, Shyft API responses: 10s)

When tRPC subscriptions are active, cooldowns are relaxed (e.g. 30s for wallet balances instead of 10s) because real-time updates supplement polling.

## Extending

- Add new domain configs under `lib/config`
- Derive values from `env` and validate with Zod
- Export inferred types for new config objects
