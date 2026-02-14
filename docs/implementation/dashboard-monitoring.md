# Dashboard Monitoring Mode

## Overview

The dashboard supports two data refresh modes controlled by a floating "Monitoring Panel":

- **Monitoring OFF** (default for tokens launched >1 hour ago): Polls `dashboard.getStats` every 30 seconds.
- **Monitoring ON** (default for tokens launched <1 hour ago): Subscribes to SSE streams (gRPC balance/transaction updates + volume bot trade events) and refetches dashboard data on every event, with a 2-second debounce to avoid hammering.

## Architecture

```
On-chain events (gRPC/Yellowstone) ─┐
                                     ├──► SSE Subscriptions ──► Dashboard Client
Volume Bot Worker (trade events) ───┤    (tRPC)                 (debounced refetch)
                                     │
                                     └──► 30s polling fallback (always active)
```

### Data Flow: Monitoring Mode ON

1. `GrpcManager` streams on-chain account and transaction updates.
2. `subscription.router.ts` filters relevant events and yields them via SSE.
3. `volume-bot-worker.ts` emits `tradeComplete` events through `dashboardEvents` EventEmitter.
4. `subscription.router.ts` `onVolumeBotUpdate` listens to the EventEmitter and yields to SSE.
5. `dashboard-client.tsx` subscribes to `onNewTransaction`, `onBalanceUpdate`, and `onVolumeBotUpdate`.
6. On any event, a debounced (2s) call to `refetchStats()` fires.
7. 30-second polling remains active as a safety net.

`onTokenBalanceUpdate` is available in `subscription.router.ts`, but dashboard monitoring currently uses `onBalanceUpdate` (SOL), `onNewTransaction`, and `onVolumeBotUpdate` for refresh triggers.

### Data Flow: Monitoring Mode OFF

1. `dashboard.getStats` query has `refetchInterval: 30_000`.
2. No SSE connections are opened.
3. The monitoring panel shows a countdown to the next refresh.

## Key Components

### Floating Monitoring Panel (`components/dashboard/monitoring-panel.tsx`)

- Fixed position, bottom-right corner.
- Two states: **expanded** (full controls) and **minimized** (small pill).
- Shows:
  - Monitoring mode toggle (switch)
  - "Last refreshed: Xs ago"
  - "Next refresh in: Xs" (countdown)
  - Manual refresh button
- Minimized state shows a small pill with monitoring status indicator.

### Dashboard Events (`server/events/dashboard-events.ts`)

- Singleton `EventEmitter` that bridges the volume bot worker to the subscription router.
- Events:
  - `tradeComplete`: `{ tokenPublicKey, sessionId }` — emitted after a successful trade in the worker.

### Subscription: `onVolumeBotUpdate` (`server/trpc/routers/subscription.router.ts`)

- Listens to `dashboardEvents` for `tradeComplete` events.
- Filters by `tokenPublicKey` from the subscription input.
- Yields events to the SSE client.

## Default Monitoring State

- Derived from `statsData.header.launchCompletedAt` (the `Launch.completedAt` field).
- If `launchCompletedAt` is null or more than 1 hour ago: OFF.
- If `launchCompletedAt` is within the last hour: ON.
- User toggle overrides the default; persisted in `localStorage` per token (`monitoring:{tokenPublicKey}`).

## Dashboard Stats: `launchCompletedAt`

Added to the `header` section of the `dashboard.getStats` response. Queried from the `Launch` model where `tokenPublicKey` matches and `status` is `SUCCEEDED`.

## Note: Transactions Source Migration

Transactions page data is being migrated to `TokenTransaction` (token-wide, per-action rows).
Dashboard metrics currently continue to read from legacy `Transaction` until a follow-up migration aligns dashboard aggregation with `TokenTransaction`.
