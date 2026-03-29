# Documentation Index

## Structure

- **`implementation/`** — detailed feature implementation docs (data models, services, flows, tRPC endpoints)
  - See [implementation/index.md](./implementation/index.md) for organized navigation
- **`backlog/`** — planned work and future tasks
  - `backlog/index.md` — simple tasks and quick items
  - Individual files for detailed plans requiring thorough exploration
- **`deployment/`** — deployment guides for Railway and local

## Implementation Docs

- `implementation/project-overview.md` — high-level purpose, architecture, and conventions
- `implementation/auth-implementation.md` — access/refresh token model and session lifecycle
- `implementation/launch-implementation.md` — token launch flow and persistence
- `implementation/bundle-implementation.md` — bundle creation and transaction batching
- `implementation/config-implementation.md` — configuration and env parsing
- `implementation/wallets-implementation.md` — wallet data model, services, and UI behavior
- `implementation/transactions-implementation.md` — transaction refresh and pricing logic
- `implementation/holdings-implementation.md` — holdings refresh, sell flow, and UI
- `implementation/exit-implementation.md` — holdings exit flow
- `implementation/volume-bot-implementation.md` — volume bot sessions and wallet management
- `implementation/dashboard-monitoring.md` — dashboard monitoring mode, subscriptions, and polling behavior
- `implementation/shyft-integration.md` — Shyft gRPC, REST, DeFi, and callback infrastructure
- `implementation/pricing-implementation.md` — usage-fee schedule, scope rules, and enforcement model
- `implementation/subscription-implementation.md` — Pro subscription purchase and entitlement
- `implementation/logging-implementation.md` — structured logging setup
- `implementation/api-abuse-protection.md` — request identity, rate-limit tiers, and endpoint hardening
- `implementation/ui-responsive-layout.md` — shared responsive strategy and cross-page layout baseline
- `implementation/test-run-logging.md` — JSONL test-run event capture and manual template

## Backlog

- `backlog/index.md` — consolidated list of simple tasks and implementation items
- `backlog/volume-bot-restart.md` — volume bot session restart spec

## Deployment

- `deployment/railway.md` — Railway environments, branch mapping, and database setup
