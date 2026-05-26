# API Abuse Protection

## Purpose

This document defines the abuse-protection model for API surfaces in `ballistik-web`, including tRPC, auth endpoints, and webhooks. The goal is to reduce brute-force, spam, replay, and high-cost request abuse while keeping router code thin.

## Protected Surfaces

- `app/api/trpc/[trpc]/route.ts` (all tRPC procedures)
- `server/trpc/routers/auth.router.ts` (public auth mutations)
- `app/api/webhooks/shyft/route.ts` (callback ingest endpoint)
- Service-level job starters and fund movement flows

## Request Identity

Abuse controls use normalized request identity from `server/trpc/context.ts`:

- `requestId`
- `clientIp` (derived from `x-forwarded-for` / `x-real-ip`)
- `userAgent`
- `user.id` when authenticated

All logging and limiter keys should reuse these values to avoid route-specific duplication.

## Rate-Limit Tiers

The API uses route tiers instead of one global limit.

- `public` — low-risk public read behavior
- `auth` — login/logout and account bootstrap operations
- `protected` — authenticated default operations
- `expensiveMutation` — state-changing flows with heavy RPC/DB cost
- `sensitiveMutation` — private-key and fund movement actions
- `webhook` — callback ingest endpoint

## Keying Strategy

- Public: `clientIp + path`
- Auth: `clientIp + path` with strict limits
- Protected: `userId + path` with `clientIp` fallback when user is absent
- Sensitive: `userId + path` with low quotas and action-level concurrency guards
- Webhook: `clientIp + endpoint`

## Procedure Tiers

`server/trpc/trpc.ts` exposes procedure variants so routers pick risk level without embedding limiter logic:

- `publicProcedure`
- `publicRateLimitedProcedure`
- `authRateLimitedProcedure`
- `protectedProcedure`
- `protectedRateLimitedProcedure`
- `expensiveProtectedProcedure`
- `sensitiveProcedure`

## Router Classification

- `auth.router.ts`
  - `loginWithPrivateKey`, `loginWithWalletSignature`, `createWalletChallenge`, `logout`: `authRateLimitedProcedure`
  - `me`: `publicRateLimitedProcedure`
  - `updateName`, `linkWalletAdapter`, `logoutAll`: `protectedRateLimitedProcedure`
- `wallet.router.ts`
  - private key + transfer procedures use `sensitiveProcedure`
  - refresh/fetch procedures use `protectedRateLimitedProcedure` or `expensiveProtectedProcedure`
- `launch.router.ts`, `holding.router.ts`, `volume-bot.router.ts`
  - heavy mutations use `expensiveProtectedProcedure`
  - normal reads use `protectedRateLimitedProcedure`

The `test` router must not be publicly exposed in production.

## Webhook Security

`app/api/webhooks/shyft/route.ts` enforces:

- Required callback secret in production
- Shared-secret header validation before expensive work
- Replay protection with short cache window using signature/event identifiers
- Webhook-specific rate limiting and payload-size caps

## Service-Level Safeguards

Rate limits reduce abuse volume, but service controls prevent duplicate side effects:

- Concurrency locks for launch/exit/session starts and SOL transfer actions
- Short idempotency windows for repeated job-start requests
- Conflict responses for duplicate in-flight actions

These controls apply in:

- `server/services/launch.service.ts`
- `server/services/holding-exit.service.ts`
- `server/services/volume-bot.service.ts`
- `server/services/wallet.service.ts`

## Session Hardening

Auth/JWT behavior follows:

- Production must provide `JWT_SECRET` (no insecure fallback)
- Access-token TTL reduced from long-lived defaults
- Auth failure bursts are observable through structured logs and limiter rejections

## Operational Validation

Minimum checks after rollout:

- 429 responses for burst traffic on public auth endpoints
- Per-user throttling on protected procedures
- Stricter throttling for sensitive wallet/funding operations
- Webhook replay attempts are rejected
- Logs include `requestId`, `clientIp`, route, and limiter bucket data
