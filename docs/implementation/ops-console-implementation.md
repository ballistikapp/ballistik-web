# Ops Console Implementation

## Purpose

Internal, Operator-only surface for looking up Users, inspecting Launch pipelines, and revealing custody keys during incidents. Bookmark-only at `/ops`; non-Operators receive not-found behavior.

## Auth model

- Reuses the existing User session (`auth-token` cookie).
- `User.isOperator` (`Boolean @default(false)`) marks Operators. Grant/revoke via DB only.
- Operator checks always load the flag from the database (not JWT claims) so revoke takes effect without re-login.
- Page guard: `app/ops/layout.tsx` — logged-out → auth redirect; logged-in non-Operator → `notFound()`.
- API: every ops service method calls `requireOperator` and throws `AppError("Not found", 404)` when closed.

See ADRs:

- `docs/adr/0001-ops-operator-flagged-user.md`
- `docs/adr/0002-ops-key-reveal-log-only-audit.md`
- `docs/adr/0003-ops-console-not-found-hiding.md`

## Layers

| Layer | Path |
| --- | --- |
| Schema | `prisma/schema.prisma` (`User.isOperator`) |
| Zod | `server/schemas/ops.schema.ts` |
| Service | `server/services/ops.service.ts` |
| Router | `server/trpc/routers/ops.router.ts` (`ops` on app router) |
| UI | `app/ops/**`, `components/ops/**` |

## Procedures

- `ops.lookupUser` — `operatorProcedure`; main-wallet or mint → User id
- `ops.getUserSpine` — `operatorProcedure`; User identity + tokens + launches + wallets including MAIN (no private keys)
- `ops.getLaunchAutopsy` — `operatorProcedure`; Launch status/timeline logs (no raw `input`/`result`)
- `ops.revealPrivateKey` — `operatorSensitiveProcedure` (8/min); wallet or mint key; logs Operator + target via request logger

`operatorProcedure` / `operatorSensitiveProcedure` are the ops-facing procedure names (auth + rate limit). Operator authorization remains in `opsService` via a DB `isOperator` check so denials stay not-found and stay testable at the service seam.

## UI routes

- `/ops` — lookup
- `/ops/users/[userId]` — User spine + reveal controls
- `/ops/launches/[launchId]` — Launch autopsy

Ops uses a minimal dedicated layout (no product token sidebar). No Ops entry in normal app navigation.

## Migration note

Agents edit the Prisma schema only. Humans run the migration that adds `User.isOperator`. After migrate, set flags for the tiny Operator set in staging/production.

## Tests

`server/services/ops.service.test.ts` covers Operator vs non-Operator denial, lookup hits/misses, private-key omission, and reveal + audit log behavior at the ops service seam.
