# Implementation Documentation

This directory contains detailed implementation documentation for all features in sollabs-web.

## Overview

- [Project Overview](./project-overview.md) — high-level purpose, architecture, and conventions
- [Auth Implementation](./auth-implementation.md) — access/refresh token model and session lifecycle
- [UI Responsive Layout Pass](./ui-responsive-layout.md) — shared responsive strategy and cross-page layout baseline

## Core Features

### Token Launch

- [Launch Implementation](./launch-implementation.md) — token launch flow and persistence
- [Bundle Implementation](./bundle-implementation.md) — bundle creation and transaction batching

### Wallet & Transaction Management

- [Wallets Implementation](./wallets-implementation.md) — wallet data model, services, and UI behavior
- [Transactions Implementation](./transactions-implementation.md) — transaction refresh and pricing logic
- [App Transactions](./app-transactions-implementation.md) — unified operational ledger for all on-chain operations

### Holdings & Trading

- [Holdings Implementation](./holdings-implementation.md) — holdings refresh, sell flow, and UI
- [Exit Implementation](./exit-implementation.md) — holdings exit flow

### Automation

- [Volume Bot Implementation](./volume-bot-implementation.md) — volume bot sessions and wallet management
- [Dashboard Monitoring](./dashboard-monitoring.md) — dashboard monitoring mode, subscriptions, and polling behavior

### Billing

- [Subscription Implementation](./subscription-implementation.md) — Pro subscription purchase and entitlement
- [Pricing Implementation](./pricing-implementation.md) — usage-fee schedule, scope rules, and enforcement model

## Infrastructure

### External Services

- [Shyft Integration](./shyft-integration.md) — Shyft gRPC, REST, DeFi, and callback infrastructure

### System Configuration

- [Config Implementation](./config-implementation.md) — configuration and env parsing
- [Logging Implementation](./logging-implementation.md) — structured logging setup
- [API Abuse Protection](./api-abuse-protection.md) — request identity, rate-limit tiers, and endpoint hardening
- [Test Run Logging](./test-run-logging.md) — JSONL test-run event capture and manual template

## Related Documentation

- [Backlog](../backlog/index.md) — planned work and future tasks
- [Railway Deployment](../deployment/railway.md) — environment and branch deployment mapping
