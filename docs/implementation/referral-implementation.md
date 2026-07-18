# Referral Implementation

## Purpose

Product-facing Marketer setup, register-time Referral attribution, and (later) Referral Payout tracking. Ops designates Marketers; this surface lets an enabled Marketer configure their shareable code and fee-collector wallet, and see Users attributed via their code.

See `CONTEXT.md` and ADRs:

- `docs/adr/0004-referral-atomic-fee-split.md`
- `docs/adr/0005-referral-register-only-live-rate.md`

Ops designation lives in [Ops Console](./ops-console-implementation.md). Fee splitting is a follow-on slice.

## Layers

| Layer | Path |
| --- | --- |
| Schema | `prisma/schema.prisma` (`Marketer`, `Referral`, `ReferralPayout`) |
| Zod | `server/schemas/marketer.schema.ts`, optional `referralCode` on `loginWithWalletSignatureSchema` |
| Service | `server/services/marketer.service.ts`; Referral create in `auth.service` register path |
| Router | `server/trpc/routers/marketer.router.ts` (`marketer` on app router) |
| UI | `app/(app)/referrals/page.tsx`, `components/marketer/**` |
| Nav | Account group item gated in `components/layout/sidebar/app-sidebar.tsx` |
| Auth entry | `/auth?ref=<code>` → `WalletAuthActions` → `auth.loginWithWalletSignature` |

## Procedures

- `marketer.getMe` — `protectedRateLimitedProcedure`; returns the current User’s Marketer setup when they are an **enabled** Marketer; otherwise `null` (used for nav visibility and page gate)
- `marketer.updateSetup` — `protectedRateLimitedProcedure`; set/change `referralCode` and/or `feeCollectorPublicKey`; requires enabled Marketer; disabled / non-Marketer → not-found
- `marketer.listReferredUsers` — `protectedRateLimitedProcedure`; sticky Referrals for the current enabled Marketer (name, main wallet, join time); newest first; disabled / non-Marketer → not-found

## Marketer-owned fields

- **referralCode** — optional until set; unique when set; mutable. Slug: lowercase letters, numbers, hyphens; 3–32 chars; normalized to lowercase on save. Changing the code stops old links from resolving for **new** registrations; existing Referrals stay attached (ADR 0005).
- **feeCollectorPublicKey** — optional until set; mutable; validated Solana public key. Required before Referral Payouts can be sent (fee-split slice).

Ops-owned fields (`nickname`, `feeShareRate`, `isEnabled`) are not writable here.

## Register-time attribution

- Query param: `ref` on `/auth` (share link `{origin}/auth?ref={referralCode}`).
- Client passes `referralCode` into `auth.loginWithWalletSignature`.
- Server creates a sticky `Referral` only when:
  1. `intent === "register"` creates a brand-new User, and
  2. the code normalizes to a valid slug, and
  3. it matches an **enabled** Marketer with that current `referralCode`.
- Missing, malformed, unknown, or disabled codes are ignored; User creation still succeeds.
- Existing-User wallet sign-in (and private-key login) never creates or reassigns a Referral, even if `ref` is present.
- Attribution runs inside the same Prisma transaction as User + Main Wallet create.

## Product UI

- `/referrals` — setup form (code, fee-collector, copyable `/auth?ref=<code>` link), Referred Users table, placeholder Referral Payouts section
- Account nav **Referrals** link appears only when `marketer.getMe` is non-null
- Non-Marketers and disabled Marketers: no nav link; visiting `/referrals` redirects to `/account`; write/list APIs return not-found

## Out of this doc (follow-on)

- Fee-collection dual-transfer split and Referral Payout ledger
- Payouts list and aggregates on the Marketer surface
