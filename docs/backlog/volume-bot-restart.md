# Volume Bot: Restart Stopped Sessions

## Overview

Allow users to restart a STOPPED or FAILED volume bot session with a new duration and optional scheduling, reusing the existing session record and wallets.

## Approach

**Reuse existing session** (not clone). Reset runtime metrics, re-fund wallets, reschedule timers. Old transaction logs stay attached to the same session for continuity.

## Session Lifecycle (Current)

```
DRAFT → SCHEDULED → RUNNING → STOP_REQUESTED → STOPPING → STOPPED / FAILED
```

Restart adds:

```
STOPPED / FAILED → (restart) → SCHEDULED / RUNNING
```

## Schema Changes

### Prisma (`VolumeBotSession`)

```prisma
restartedAt   DateTime?
restartCount  Int @default(0)
```

Migration required.

### Zod Schema (`server/schemas/volume-bot.schema.ts`)

```typescript
export const restartVolumeBotSchema = z.object({
  sessionId: z.string().min(1),
  targetDurationSeconds: z.number().int().min(1),
  scheduledStartAt: z.date().optional(),
});
```

## Service Method

New `restartSession(input, userId)` in `volume-bot.service.ts`:

1. **Validate** session is STOPPED or FAILED, belongs to user
2. **Check** no other active session for the same token
3. **Reset session fields:**
   - `status` → RUNNING (or SCHEDULED if `scheduledStartAt` provided)
   - `startedAt` → now (or null if scheduled)
   - `stoppedAt`, `stopRequestedAt`, `lastTickAt` → null
   - `runtimeSeconds`, `totalTrades`, `totalVolumeUsd`, `totalPnlSol` → 0
   - `targetDurationSeconds` → user-provided value (update in config JSON)
   - `scheduledStartAt` → user-provided or null
   - `scheduledStopAt` → calculated from start + duration
   - `restartedAt` → now
   - `restartCount` → increment
4. **Reset wallets:**
   - All `VolumeBotWallet` for session: `status` → ACTIVE
   - Clear: `reclaimedAt`, `reclaimTxSignature`, `pausedAt`, `pauseReason`, `nextTickAt`
5. **Re-fund wallets** (same logic as `startSession`):
   - Generated wallets: fund with `fundingPerGeneratedWallet`
   - Selected wallets: top-up if balance < `topUpAmount`
6. **Re-validate** token balances if config has net-sell direction
7. **Schedule** via `volumeBotTimer.scheduleSession(sessionId)`

## Router Endpoint

```typescript
restart: protectedProcedure
  .input(restartVolumeBotSchema)
  .mutation(async ({ input, ctx }) => {
    return await volumeBotService.restartSession(input, ctx.user.id);
  })
```

## UI

- **Restart button** on session page, visible only for STOPPED/FAILED sessions
- **Dialog** with:
  - Duration input (same as new session page)
  - Scheduled start toggle + date/time picker (same pattern as new session page)
  - Warning: "Wallets will be re-funded from main wallet"
  - Confirm button
- Loading/success/error states via mutation

## Complications to Handle

| Concern | Solution |
|---|---|
| Wallets are RECLAIMED (no SOL) | Re-fund using same logic as `startSession()` |
| Timer state is in-memory | `scheduleSession()` recreates all timers |
| gRPC subscription cleared on stop | Re-subscribe during restart |
| Active session check blocks start | Allow restart of STOPPED/FAILED (modify guard) |
| `scheduledStopAt` stale | Recalculate from new start + new duration |
| PAUSED wallets | Reset to ACTIVE |
| Token balances for net-sell | Re-validate before restart |

## Estimated Scope

- 1 migration (2 new fields)
- 1 new Zod schema
- 1 new service method (~100 lines, adapted from `startSession`)
- 1 new router endpoint
- UI: restart button + dialog with duration/scheduling inputs
