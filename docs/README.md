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
- `implementation/launch-implementation.md` — token launch flow and persistence
- `implementation/config-implementation.md` — configuration and env parsing
- `implementation/wallets-implementation.md` — wallet data model, services, and UI behavior
- `implementation/transactions-implementation.md` — transaction refresh and pricing logic
- `implementation/holdings-implementation.md` — holdings refresh, sell flow, and UI
- `implementation/shyft-integration.md` — Shyft gRPC, REST, DeFi, and callback infrastructure
- `implementation/volume-bot-implementation.md` — volume bot sessions and wallet management
- `implementation/bundle-implementation.md` — bundle creation and transaction batching
- `implementation/exit-implementation.md` — holdings exit flow
- `implementation/logging-implementation.md` — structured logging setup

## Backlog

- `backlog/index.md` — consolidated list of simple tasks and implementation items

## Deployment

- `deployment/railway.md` — Railway environments, branch mapping, and database setup
