# Config Implementation

## Goals
- Centralize environment variable parsing and validation
- Provide typed, domain-focused config objects
- Keep config access consistent across server modules

## Structure
- `lib/config/env.ts` parses and validates raw environment values with Zod
- `lib/config/launch.config.ts` exposes launch-specific settings derived from `env`

## Usage
- Import `env` when you need raw environment values
- Import `launchConfig` for launch-specific constants and env-derived settings
- Avoid direct `process.env` access outside `lib/config`

## Environment Variables
- `SOLANA_RPC_URL` is required
- `JITO_BLOCK_ENGINE_URL` is optional and defaults to `mainnet.block-engine.jito.wtf`

## Logging
- `LOG_LEVEL` is optional and defaults to `info`
- Supported levels: `debug`, `info`, `warn`, `error`
- Server logs are JSON lines to console with `timestamp`, `level`, `message`, and merged context fields
- Use `logger.setTransport()` to route logs to another destination later

## Extending
- Add new domain configs under `lib/config`
- Derive values from `env` and validate with Zod
- Export inferred types for new config objects
