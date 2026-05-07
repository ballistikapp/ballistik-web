# Auth Implementation

## Purpose

Define the authentication model for `sollabs-web`, including access token verification, refresh-session lifecycle, cookie behavior, and trust boundaries across tRPC, server layouts, and proxy.

## Current Auth Baseline

- Auth entrypoints live in `server/trpc/routers/auth.router.ts`.
- Account creation uses wallet-adapter auth only. Legacy private-key auth remains available as sign-in only for existing accounts.
- Wallet-adapter auth proves ownership of an external connected wallet, while the app still creates and uses a server-held Main Wallet for operational actions.
- Auth identity is resolved in `server/trpc/context.ts` from `auth-token` cookie; `auth.me` rehydrates the current user profile from the database so linked wallet and account metadata reflect the latest persisted state.
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

1. `loginWithPrivateKey` / `loginWithWalletSignature`
   - Create an `AuthSession`.
   - Create initial `RefreshToken` record with hashed token.
   - Issue JWT access token with `userId`, Main Wallet `publicKey`, optional `authWalletPublicKey`, `name`, and `plan`.
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

### `AuthChallenge`

- `id`
- `publicKey` (connected wallet public key)
- `nonce` (unique)
- `purpose` (`WALLET_LOGIN` or `WALLET_LINK`)
- `expiresAt`
- `consumedAt`
- `createdAt`

### `User.authWalletPublicKey`

- Optional unique external wallet identity for wallet-adapter login.
- Not a relation to `Wallet`; it is not an operational wallet and does not store a private key.
- New wallet-adapter accounts receive a generated server-held Main Wallet, stored through `User.mainWalletPublicKey`. The auth flow redirects directly into the app; Main Wallet details are accessed later from the app UI.
- Existing private-key users can link one connected wallet from Account.
- Changing or unlinking the connected wallet is out of scope for the first implementation.

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
- Wallet-adapter login uses a short-lived server challenge and Ed25519 message signature verification.
- Auth challenges are single-use and marked consumed after successful verification.
- Access-token verification remains stateless in normal request path.
- No implicit refresh inside tRPC context or server layout helpers.
- Feature entitlement and platform-fee waiver decisions are made from the verified access-token `plan` claim, not from per-request database reads.

## Client Refresh Behavior

- Client retries once on `UNAUTHORIZED` by calling `auth.refreshSession`.
- If refresh succeeds, original request is retried once.
- If refresh fails, client treats user as signed out.

## Trust Boundaries

- `proxy.ts` remains a convenience gate, not a source of auth truth.
- `/auth` stays public at the proxy layer so stale access-token cookies cannot block sign-in.
- Authenticated redirects away from `/auth` are handled in `app/auth/layout.tsx`, where the JWT is actually verified.
- Procedure-level checks and service-level session state are authoritative.
- Session creation/rotation/revocation operations are service-owned.
- Wallet-adapter signatures only authenticate a user. They do not authorize launches, trading, fee payments, or recovery from the connected wallet.
- Operational actions continue to spend from the user's server-held Main Wallet.

## Wallet-Adapter Collision Policy

- A wallet already stored as `User.authWalletPublicKey` signs into that linked account.
- An unlinked wallet that matches any `User.mainWalletPublicKey` is treated as a legacy account wallet and is rejected from public wallet login. The user must sign in with the private key first, then link wallet login from Account.
- A wallet cannot be linked to more than one user. Linking a wallet already linked to another user returns a conflict.
- Re-linking the same wallet to the same current account is idempotent and succeeds.
- App-managed wallets in the `Wallet` table cannot be used as external wallet-adapter identities unless the wallet is the current user's own Main Wallet during an authenticated link.
- Wallet login carries an intent:
  - `register`: unknown external wallets can create a new account with a generated server-held Main Wallet. This is the public `/auth` default because wallet auth is both sign-in and signup.
  - `login`: unknown external wallets are rejected with guidance to create an account or use private-key login.

## Client Auth Entry

- `/auth` shows wallet sign-in first and does not expose separate create-account/sign-in tabs.
- `?method=private-key` opens the private-key sign-in fallback for existing legacy accounts.
- The private-key fallback does not create accounts.

## Wallet-Adapter UI Visibility

The Solana wallet-adapter (connected browser wallet) is treated as transient browser state, not as account chrome. To avoid conflating it with the Main Wallet (operational) and the Auth Wallet (linked identity), adapter UI is surfaced only where it is actively required:

- `/auth` — `WalletAuthActions mode="login"` exposes Connect / Disconnect for sign-in.
- `/account/auth-wallet` — `WalletAuthActions mode="link"` exposes Connect / Disconnect only when no auth wallet is linked yet. Once linked, the page shows the linked public key with no adapter controls.
- The post-auth header dropdown (`AuthButton`) does not render adapter controls or a link-from-dropdown action. It shows an `Auth Wallet` row that links to `/account/auth-wallet` for linking or review.

`WalletAdapterButton` is a minimal Connect / Disconnect control. It does not expose "Change wallet" or "Copy address" entries, since switching the connected account is a user action inside the wallet extension itself.

On `auth.logout` success, the client calls the wallet adapter's `disconnect()` before reloading, so the next sign-in starts with a clean adapter state. Adapter disconnects or pubkey changes do not trigger automatic logout — auth is decoupled from adapter state by design.

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
