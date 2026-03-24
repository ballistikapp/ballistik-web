# Auth Implementation

## Purpose

Define the authentication model for `sollabs-web`, including access token verification, refresh-session lifecycle, cookie behavior, and trust boundaries across tRPC, server layouts, and proxy.

## Current Auth Baseline

- Auth entrypoints live in `server/trpc/routers/auth.router.ts`.
- User registration/login currently relies on main wallet ownership.
- Auth identity is resolved in `server/trpc/context.ts` from `auth-token` cookie.
- Server route protection in layouts uses `lib/utils/auth.ts`.
- `proxy.ts` is optimistic and checks cookie presence only.
- The access token carries the user's current `plan` claim for request-time feature gating.

## Identified Gaps Addressed

- Access token expiry and cookie maxAge mismatch.
- No refresh-token rotation or per-device session persistence.
- No server-side revocation model for active sessions.
- No token-family reuse detection for stolen refresh tokens.

## Target Session Model

Authentication uses two cookies:

- `auth-token`: short-lived JWT access token for request authorization.
- `refresh-token`: opaque, long-lived token used only to mint new access tokens.

Server persistence:

- `AuthSession` tracks per-device/session lifecycle and revocation.
- `RefreshToken` stores hashed opaque token values and rotation chain metadata.

## Token Lifecycle

1. `register` / `loginWithPrivateKey`
   - Create an `AuthSession`.
   - Create initial `RefreshToken` record with hashed token.
   - Issue JWT access token with `userId`, `publicKey`, `name`, and `plan`.
   - Set both cookies.
2. `refreshSession`
   - Validate refresh token hash and session state.
   - Mark current refresh token as used.
   - Create replacement refresh token.
   - Rotate cookies and return session metadata.
   - Re-evaluate time-based Pro entitlement before issuing the next access token.
3. `logout`
   - Revoke current session and outstanding refresh tokens.
   - Clear both cookies.
4. `logoutAll` (optional endpoint)
   - Revoke all sessions for the user.
   - Clear local cookies.

## Cookie Policy

- `httpOnly: true` for access and refresh cookies.
- `sameSite: "lax"` for both cookies.
- `secure` enabled for production non-local hosts.
- Access cookie maxAge matches JWT expiry.
- Refresh cookie maxAge follows refresh-session TTL config.

## Data Model

### `AuthSession`

- `id`
- `userId`
- `ip`
- `userAgent`
- `lastSeenAt`
- `expiresAt`
- `revokedAt`
- `createdAt`, `updatedAt`

### `RefreshToken`

- `id`
- `sessionId`
- `tokenHash` (unique)
- `expiresAt`
- `usedAt`
- `revokedAt`
- `replacedById`
- `createdAt`

## Security Controls

- Opaque refresh tokens are hashed before DB persistence.
- Refresh tokens are single-use and rotated on every refresh.
- Reuse of a previously used refresh token revokes the full session.
- Access-token verification remains stateless in normal request path.
- No implicit refresh inside tRPC context or server layout helpers.
- Feature entitlement and platform-fee waiver decisions are made from the verified access-token `plan` claim, not from per-request database reads.

## Client Refresh Behavior

- Client retries once on `UNAUTHORIZED` by calling `auth.refreshSession`.
- If refresh succeeds, original request is retried once.
- If refresh fails, client treats user as signed out.

## Trust Boundaries

- `proxy.ts` remains a convenience gate, not a source of auth truth.
- Procedure-level checks and service-level session state are authoritative.
- Session creation/rotation/revocation operations are service-owned.

## Return-Target Redirects

- Protected-route auth redirects preserve the original in-app destination via `redirect` query param (for example `/auth?redirect=%2Flaunch%3Fpreset%3Dfree`).
- Post-auth client navigation resolves destination from `redirect` and falls back to `/` when missing.
- Redirect validation only allows same-origin relative paths beginning with `/`.
- External URLs, protocol-relative values, and malformed targets are rejected to prevent open redirects.

## Environment Requirements

- `JWT_SECRET` required in production.
- `REFRESH_TOKEN_TTL_DAYS` required in production.
- `SESSION_MAX_TTL_DAYS` optional; defaults applied when unset.
- Optional `JWT_EXPIRATION` controls access token lifetime and therefore the entitlement-refresh window for `plan` changes.

## Operational Signals

Track and log:

- session created/refreshed/revoked
- refresh failures by reason
- refresh-token reuse incidents
- refresh success rate and retry rate
- plan-claim rollout issues, especially stale-access windows after plan changes

## Entitlement Freshness

- `User.plan` in the database is the source of truth when issuing or refreshing access tokens.
- Requests rely on the `plan` embedded in the current access token.
- Upgrades and downgrades therefore become effective on the next token issue/refresh or when the current access token expires.
- Weekly Pro purchases should force an immediate `refreshSession` on the client so upgraded users receive a fresh `plan = PRO` token right away.
- Weekly Pro expiry does not require an automatic background job in v1; an expired plan can be normalized back to `FREE` during normal login/refresh flows.

## Validation Checklist

- Login issues both `auth-token` and `refresh-token` cookies.
- Expired access token + valid refresh token rotates both tokens.
- Reused refresh token revokes the session and blocks further refresh.
- `logout` revokes the current session and clears cookies.
- `logoutAll` revokes all sessions for the user.
