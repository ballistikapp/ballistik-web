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

- `ops.getOverview` — `operatorProcedure`; Ops Overview tiles (new Users 7d, Launches 7d, Failed Launches 7d, total Users, total Tokens)
- `ops.listUsers` — `operatorProcedure`; paginated Users browse (`page`/`pageSize`/`search`/`sortBy`/`sortDir`); no private keys
- `ops.listLaunches` — `operatorProcedure`; paginated Launches browse (same list shape + owner fields); no private keys / no raw `input`/`result`
- `ops.listTokens` — `operatorProcedure`; paginated Tokens browse (owner fields); no private keys
- `ops.listWallets` — `operatorProcedure`; paginated Wallets browse including system (`type` / `isSystemWallet` filters); no private keys
- `ops.lookupUser` — `operatorProcedure`; main-wallet or mint → User id
- `ops.getUserSpine` — `operatorProcedure`; User identity + tokens + launches + wallets including MAIN (no private keys)
- `ops.getToken` — `operatorProcedure`; Token identity/metadata/status/owner (no private key)
- `ops.getWallet` — `operatorProcedure`; Wallet type/pubkey/owner/token/stored balance (no private key)
- `ops.getLaunchAutopsy` — `operatorProcedure`; Launch status/timeline logs (no raw `input`/`result`)
- `ops.revealPrivateKey` — `operatorSensitiveProcedure` (8/min); wallet or mint key; logs Operator + target via request logger

List search is case-insensitive contains. Users search: `id`, `name`, `mainWalletPublicKey`. Launches search: `id`, `tokenPublicKey`, `userId`, `currentStep`, and any `LaunchStatus` whose name contains the query (enum fields cannot use SQL `contains`). Tokens search: `publicKey`, `name`, `symbol`, `userId`, and any `TokenStatus` whose name contains the query. Wallets search: `publicKey`, `userId`, `tokenPublicKey`, and any `WalletType` whose name contains the query. Allowed sorts — Users: `createdAt`/`name`/`plan`; Launches: `createdAt`/`startedAt`/`status`; Tokens: `createdAt`/`name`/`symbol`/`status`; Wallets: `createdAt`/`type`/`balanceSol`. Default sort: `createdAt desc`. Default page size 25 (max 100).

`operatorProcedure` / `operatorSensitiveProcedure` are the ops-facing procedure names (auth + rate limit). Operator authorization remains in `opsService` via a DB `isOperator` check so denials stay not-found and stay testable at the service seam.

## UI routes

- `/ops` — Ops Overview (summary tiles) + User lookup
- `/ops/users` — Users browse (dense table; row → User spine)
- `/ops/wallets` — Wallets browse (dense table + type/system filters; row → Wallet detail)
- `/ops/tokens` — Tokens browse (dense table; row → Token detail)
- `/ops/launches` — Launches browse (dense table; row → Launch autopsy)
- `/ops/users/[userId]` — User spine + reveal controls
- `/ops/tokens/[publicKey]` — Token detail + mint-key reveal
- `/ops/wallets/[publicKey]` — Wallet detail + wallet-key reveal
- `/ops/launches/[launchId]` — Launch autopsy

Ops uses a minimal dedicated layout with an Ops sidebar (Overview, Users, Wallets, Tokens, Launches) and no product token sidebar. No Ops entry in normal app navigation.

## Migration note

Agents edit the Prisma schema only. Humans run the migration that adds `User.isOperator`. After migrate, set flags for the tiny Operator set in staging/production.

## Tests

`server/services/ops.service.test.ts` covers Operator vs non-Operator denial, Ops Overview tile counts, Users/Launches/Tokens/Wallets list pagination/search/sort (+ Wallet type/system filters) + private-key omission, Token/Wallet detail reads, lookup hits/misses, private-key omission on spine/autopsy/detail, and reveal + audit log behavior at the ops service seam.
