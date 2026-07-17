# Ops Console v1

Status: implemented

## Problem Statement

When a User’s launch fails or support needs to understand platform state, Ballistik staff currently dig through the database, scripts, and RPC by hand. There is no internal, Operator-only surface to look up a User, see their tokens/launches/wallets, or inspect a Launch pipeline. That slows incident response and increases the chance of mistakes when reading raw rows (including private keys).

## Solution

Ship a read-only **Ops Console** inside the existing app at a hidden `/ops` URL. An **Operator** (a product User with an `isOperator` flag) can look up a User by main-wallet pubkey or token mint, view a User spine and a Launch autopsy, and optionally reveal wallet or mint private keys on demand (logged to the server logger). Non-Operators must not learn that Ops exists (not-found, not a special “forbidden” message).

## User Stories

1. As an Operator, I want to open a bookmarked `/ops` URL after normal login, so that I can use the Ops Console without a separate identity system.
2. As an Operator, I want the Ops Console to use a minimal dedicated chrome (not the normal token sidebar), so that it is obvious I am in god-read mode.
3. As an Operator, I want no Ops item in the normal app navigation, so that the feature stays discoverable only by bookmark.
4. As a non-Operator User, I want `/ops` to behave like an unknown route, so that I do not learn that an Ops Console exists.
5. As a logged-out visitor, I want `/ops` to require authentication the same way other protected app routes do, so that anonymous users cannot probe Ops data.
6. As a non-Operator who is logged in, I want Ops tRPC procedures to fail as not-found (not “not an operator”), so that the API does not advertise the privilege model.
7. As an Operator, I want to look up a User by their main wallet public key, so that I can start from the identifier they give in chat.
8. As an Operator, I want to look up a User by a token mint public key, so that I can start from a token link or mint they send.
9. As an Operator, I want a clear empty/not-found result when lookup matches nothing, so that I know the identifier is wrong rather than guessing.
10. As an Operator, I want mint lookup to resolve to the owning User, so that token-centric reports still land on the User spine.
11. As an Operator, I want to see User identity on the User page (id, name, main wallet pubkey, plan, paid-plan expiry), so that I can confirm who I am looking at and their entitlement state.
12. As an Operator, I want to see the User’s tokens (at least mint, name/symbol, status), so that I can navigate their launches and assets.
13. As an Operator, I want to see the User’s launches (at least id, status, progress/step, timestamps, linked token), so that I can open the right autopsy.
14. As an Operator, I want to see the User’s operational wallets (type, pubkey, SOL balance, balance refreshed time if available), so that I can see where funds may be stuck without leaving the User page.
15. As an Operator, I want private keys omitted from all list/detail payloads by default, so that casually browsing Ops does not dump custody material.
16. As an Operator, I do not want volume-bot sessions on the User page in v1, so that scope stays focused on User + Launch.
17. As an Operator, I want to open a Launch autopsy from a launch on the User page, so that I can move from spine to pipeline without a separate search.
18. As an Operator, I want the Launch autopsy to show status, progress, current step, started/completed times, cancel-requested flag, error message, and linked token, so that I can see pipeline state at a glance.
19. As an Operator, I want a chronological LaunchLog timeline (level, message, step, time, optional non-secret data), so that I can reconstruct what the job did.
20. As an Operator, I do not want recovery-wallet reclaim UI or money-trail sections in v1 Launch autopsy, so that the page stays a pipeline view.
21. As an Operator, I do not want raw full `input`/`result` JSON dumps in v1, so that secret-adjacent blobs are less likely to leak into the UI.
22. As an Operator, I want to reveal a specific Wallet private key on demand (including MAIN), so that I can recover or debug custody when browsing is not enough.
23. As an Operator, I want to reveal a Token mint private key on demand, so that mint-key emergencies are solvable from Ops.
24. As an Operator, I want reveal to require an explicit action per key (not bulk dump), so that accidental exposure is reduced.
25. As an Operator, I want each reveal to be recorded in server logs (who, what target, when), so that there is a lightweight audit trail without a new table.
26. As a platform maintainer, I want Operator access gated by a boolean on User in the database, so that I can grant/revoke without redeploying.
27. As a platform maintainer, I want the same Ops feature available in staging and production, so that real support works against prod with a tiny Operator set.
28. As a platform maintainer, I want Ops to be read-only aside from reveal (which only returns an existing secret), so that v1 cannot mutate launches, entitlements, or wallets.
29. As an Operator, I want Ops UI copy to say User (not “account”) and Ops Console (not “admin panel”), so that language matches the domain glossary.
30. As an implementer, I want all Ops business rules behind one ops service seam, so that authorization, projections, and reveal logging are testable in one place.
31. As an Operator, I want wallet balances shown from stored app state (not a mandatory live RPC refresh on every view), so that lookup stays fast and cheap.
32. As an Operator, I want navigating directly to an Ops User or Launch URL I am allowed to see to work after login, so that I can share deep links with other Operators.
33. As a non-Operator, I want deep links into Ops User/Launch pages to also not-found, so that leaked URLs do not confirm Ops exists.
34. As an Operator, I want reveal responses never to be cached in a shared client cache keyed for non-sensitive queries, so that keys do not linger in ordinary query data.
35. As a security-conscious Operator, I want MAIN and mint reveals treated the same as other wallet reveals (explicit action + log), so that high-value keys are not silently easier.

## Implementation Decisions

- **Feature shape**: Same Next.js app; routes under `/ops` with a minimal ops-only layout (no product token sidebar). No nav entry anywhere in the normal app shell.
- **Auth model**: Reuse existing User session cookies. Add `User.isOperator` (boolean, default false). Operator = authenticated User with `isOperator === true`. Grant/revoke via DB only in v1 (no Ops UI to flip the flag).
- **Privilege gate**: Introduce an operator-gated tRPC procedure (auth required + must be Operator). Fail closed for non-Operators with not-found semantics (aligned with hidden URL), not a distinct “forbidden operator” client message. Page-level guards for `/ops/**` must match.
- **Primary seam**: One **ops service** module owns lookup, User spine reads, Launch autopsy reads, and key reveal + log. Router and UI stay thin.
- **Lookup API**: Single lookup entry accepting either a main-wallet public key or a token mint public key (discriminated input or auto-detect by resolution order documented in the service). Returns the User id (and enough to render/navigate to the User page). Unknown → not-found style error.
- **User spine payload**: id, name, mainWalletPublicKey, plan, paidPlanStartedAt/ExpiresAt (or equivalent entitlement fields), tokens list, launches list, operational wallets list (non-MAIN and MAIN as needed for ops — include MAIN in identity; list operational wallets with type/pubkey/balanceSol/balanceRefreshedAt). **Never** include privateKey fields in these payloads.
- **Launch autopsy payload**: Launch id, userId, status, progress, currentStep, startedAt, completedAt, cancelRequestedAt, errorMessage, tokenPublicKey, and ordered logs (level, message, step, createdAt, data if present). Omit recovery wallets, reclaim status, and full raw input/result in v1.
- **Reveal API**: Explicit mutation/query marked sensitive (tight rate limit). Input identifies target: wallet public key or token mint public key. Authorize: caller is Operator; target belongs to some User (or is a mint owned by a User). Return the secret once. Log Operator userId, target type, target public key, timestamp (and request id if available). No durable audit table in v1.
- **Reveal scope**: Any `Wallet.privateKey` for a User (including MAIN_WALLET) and `Token.privateKey`.
- **Schema**: Prisma `User.isOperator Boolean @default(false)`. Migration handled by the human (agents only edit schema; do not run migrate commands).
- **Routers/schemas**: New ops schemas + ops router registered on the app router. Do not overload user-facing launch/wallet routers with cross-user reads.
- **UI pages (minimum)**: `/ops` search, `/ops/users/[userId]` spine, `/ops/launches/[launchId]` autopsy, reveal controls only on surfaces that already show the corresponding pubkey.
- **Environments**: Ship code path to staging and production; production Operator set kept tiny via DB flags.
- **Domain language**: Use Ops Console, Operator, User, Launch per `CONTEXT.md`.
- **ADRs**: Record Operator-as-flagged-User, reveal+log-only audit, and not-found hiding in `docs/adr/`.

## Testing Decisions

- **What makes a good test**: Assert external behavior of the ops service — given caller identity + DB state, outputs and errors match the rules (Operator vs not, lookup hits/misses, payloads never contain private keys unless reveal, reveal logs invoked, non-Operator denied). Do not assert UI markup, Prisma query shapes, or router wiring details.
- **Module under test**: The ops service (the agreed seam). Prefer node:test style used elsewhere in `server/services/*`.
- **Prior art**: Service-focused tests such as dashboard and launch helper tests (createRequire / node:test, stub or controlled DB dependencies where the codebase already does).
- **Minimum behaviors to cover**:
  1. Non-Operator cannot read spine / autopsy / reveal (not-found or equivalent closed failure).
  2. Operator lookup by main wallet and by mint succeeds; unknown id fails.
  3. User spine and Launch autopsy omit private keys.
  4. Reveal returns the correct secret for wallet and mint and causes a log line with Operator + target.
- **Out of testing scope for this spec’s automation**: Full Playwright for `/ops` chrome; production log-pipeline verification.

## Out of Scope

- Mutations: cancel launch, reclaim SOL, edit plan/entitlement, stop volume bots, edit User fields (except future flag tooling).
- Volume bot inspection or controls.
- Launch recovery / money-trail / reclaim status UI.
- Raw full `input`/`result` JSON viewer.
- Durable audit table or external SIEM.
- Env-var allowlist, separate Operator identity, SSO, VPN-only access.
- Separate deployable ops app or different repo.
- Ops nav entry in the product sidebar.
- Support-tier roles / least-privilege Operator subsets.
- Live chain refresh as a required part of every Ops view.
- Encrypting private keys at rest (pre-existing platform concern, not this feature).

## Further Notes

- Grilling outcome: v1 is deliberately a User spine + Launch pipeline autopsy with optional key reveal; recovery and volume bot were deferred on purpose.
- Blast radius is high because reveal includes MAIN and mint keys with only server-log audit — keep the production Operator set extremely small and treat reveals as exceptional.
- Next flow step after this spec: `/to-tickets` to split into tracer-bullet issues, then `/implement` per ticket with fresh context.
