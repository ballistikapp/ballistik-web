# Implementation Documentation

This directory contains detailed implementation documentation for all features in sollabs-web.

## Overview

- [Project Overview](./project-overview.md) — high-level purpose, architecture, and conventions

## Core Features

### Token Launch

- [Launch Implementation](./launch-implementation.md) — token launch flow and persistence
- [Bundle Implementation](./bundle-implementation.md) — bundle creation and transaction batching

### Wallet & Transaction Management

- [Wallets Implementation](./wallets-implementation.md) — wallet data model, services, and UI behavior
- [Transactions Implementation](./transactions-implementation.md) — transaction refresh and pricing logic

### Holdings & Trading

- [Holdings Implementation](./holdings-implementation.md) — holdings refresh, sell flow, and UI
- [Exit Implementation](./exit-implementation.md) — holdings exit flow

### Automation

- [Volume Bot Implementation](./volume-bot-implementation.md) — volume bot sessions and wallet management
- [Dashboard Monitoring](./dashboard-monitoring.md) — dashboard monitoring mode, subscriptions, and polling behavior

## Infrastructure

### External Services

- [Shyft Integration](./shyft-integration.md) — Shyft gRPC, REST, DeFi, and callback infrastructure

### System Configuration

- [Config Implementation](./config-implementation.md) — configuration and env parsing
- [Logging Implementation](./logging-implementation.md) — structured logging setup

## Related Documentation

- [Backlog](../backlog/index.md) — planned work and future tasks
- [Railway Deployment](../deployment/railway.md) — environment and branch deployment mapping
