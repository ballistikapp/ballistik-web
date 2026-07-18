# Referral Implementation

## Purpose

Product-facing Marketer setup and (later) Referral attribution / Referral Payout tracking. Ops designates Marketers; this surface lets an enabled Marketer configure their shareable code and fee-collector wallet.

See `CONTEXT.md` and ADRs:

- `docs/adr/0004-referral-atomic-fee-split.md`
- `docs/adr/0005-referral-register-only-live-rate.md`

Ops designation lives in [Ops Console](./ops-console-implementation.md). Register-time attribution and fee splitting are follow-on slices.

## Layers

| Layer | Path |
| --- | --- |
| Schema | `prisma/schema.prisma` (`Marketer`, `Referral`, `ReferralPayout`) |
| Zod | `server/schemas/marketer.schema.ts` |
| Service | `server/services/marketer.service.ts` |
| Router | `server/trpc/routers/marketer.router.ts` (`marketer` on app router) |
| UI | `app/(app)/referrals/page.tsx`, `components/marketer/**` |
| Nav | Account group item gated in `components/layout/sidebar/app-sidebar.tsx` |

## Procedures

- `marketer.getMe` — `protectedRateLimitedProcedure`; returns the current User’s Marketer setup when they are an **enabled** Marketer; otherwise `null` (used for nav visibility and page gate)
- `marketer.updateSetup` — `protectedRateLimitedProcedure`; set/change `referralCode` and/or `feeCollectorPublicKey`; requires enabled Marketer; disabled / non-Marketer → not-found

## Marketer-owned fields

- **referralCode** — optional until set; unique when set; mutable. Slug: lowercase letters, numbers, hyphens; 3–32 chars; normalized to lowercase on save. Changing the code stops old links from resolving (attribution of new Users is register-time; see ADR 0005).
- **feeCollectorPublicKey** — optional until set; mutable; validated Solana public key. Required before Referral Payouts can be sent (fee-split slice).

Ops-owned fields (`nickname`, `feeShareRate`, `isEnabled`) are not writable here.

## Product UI

- `/referrals` — setup form (code, fee-collector, copyable `/auth?ref=<code>` link) plus placeholder Referred Users and Referral Payouts sections
- Account nav **Referrals** link appears only when `marketer.getMe` is non-null
- Non-Marketers and disabled Marketers: no nav link; visiting `/referrals` redirects to `/account`; write APIs return not-found

## Share link

Copyable URL shape: `{origin}/auth?ref={referralCode}`. Query param name is `ref`. Auth registration does not consume `ref` until the attribution slice.

## Out of this doc (follow-on)

- Register-time Referral creation from `ref`
- Fee-collection dual-transfer split and Referral Payout ledger
- Filled referred-users / payouts lists and aggregates
