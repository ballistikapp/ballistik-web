# Referral Implementation

## Purpose

Product-facing Marketer setup, register-time Referral attribution, fee-collection dual-transfer splits, and Referral Payout tracking. Ops designates Marketers; this surface lets an enabled Marketer configure their shareable code and fee-collector wallet, see attributed Users, and reconcile Referral Payouts with light aggregates.

See `CONTEXT.md` and ADRs:

- `docs/adr/0004-referral-atomic-fee-split.md`
- `docs/adr/0005-referral-register-only-live-rate.md`

Ops designation lives in [Ops Console](./ops-console-implementation.md). Fee collection details also live in [Pricing](./pricing-implementation.md).

## Layers

| Layer | Path |
| --- | --- |
| Schema | `prisma/schema.prisma` (`Marketer`, `Referral`, `ReferralPayout`) |
| Zod | `server/schemas/marketer.schema.ts`, optional `referralCode` on `loginWithWalletSignatureSchema` |
| Service | `server/services/marketer.service.ts`; Referral create in `auth.service` register path; fee split in `usage-fee.service` |
| Router | `server/trpc/routers/marketer.router.ts` (`marketer` on app router) |
| UI | `app/(app)/referrals/page.tsx`, `components/marketer/**` |
| Nav | Account group item gated in `components/layout/sidebar/app-sidebar.tsx` |
| Auth entry | `/auth?ref=<code>` → `WalletAuthActions` → `auth.loginWithWalletSignature` |
| Fee seam | `usageFeeService.collectFromMainWallet` (usage fees + subscription charges) |

## Procedures

- `marketer.getMe` — `protectedRateLimitedProcedure`; returns the current User’s Marketer setup when they are an **enabled** Marketer; otherwise `null` (used for nav visibility and page gate)
- `marketer.updateSetup` — `protectedRateLimitedProcedure`; set/change `referralCode` and/or `feeCollectorPublicKey`; requires enabled Marketer; disabled / non-Marketer → not-found
- `marketer.listReferredUsers` — `protectedRateLimitedProcedure`; sticky Referrals for the current enabled Marketer (name, main wallet, join time); newest first; disabled / non-Marketer → not-found
- `marketer.listPayouts` — `protectedRateLimitedProcedure`; Referral Payouts for the current enabled Marketer (amount, rate, reason, signature, referred User); newest first
- `marketer.getAggregates` — `protectedRateLimitedProcedure`; total earned (Marketer lamports sum), referral count, last payout time

## Marketer-owned fields

- **referralCode** — optional until set; unique when set; mutable. Slug: lowercase letters, numbers, hyphens; 3–32 chars; normalized to lowercase on save. Changing the code stops old links from resolving for **new** registrations; existing Referrals stay attached (ADR 0005).
- **feeCollectorPublicKey** — optional until set; mutable; validated Solana public key. Required at collection time before a Referral Payout can be sent.

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

## Fee split at collection (ADR 0004 / 0005)

All platform fee collections that go through `usageFeeService.collectFromMainWallet` (launch/volume-bot/exit/buyer-wallet usage fees and subscription charges) resolve Referral qualification at collection time:

1. Referred User has a Referral
2. Marketer is enabled
3. Live `feeShareRate` > 0
4. `feeCollectorPublicKey` set and a valid Solana pubkey
5. Marketer share floors to ≥ 1 lamport (`floor(totalLamports * rate)`)

When qualified: one Solana transaction with two `SystemProgram.transfer` instructions (Marketer share, then platform remainder). On success, a `ReferralPayout` row is written (ledger write failures are logged; they do not undo the confirmed transfer).

When not qualified (no Referral, disabled, missing/invalid collector, rate 0, or zero Marketer lamports): single transfer to the platform fee collector as before; no `ReferralPayout`.

Pro-waived (zero) fees still skip collection entirely — no transfers and no Referral Payout.

## Product UI

- `/referrals` — setup form (code, fee-collector, copyable `/auth?ref=<code>` link), Referred Users table, Referral Payouts table + aggregates (total earned, referral count, last payout)
- Account nav **Referrals** link appears only when `marketer.getMe` is non-null
- Non-Marketers and disabled Marketers: no nav link; visiting `/referrals` redirects to `/account`; write/list APIs return not-found

## Seam tests

`server/services/usage-fee.service.test.ts` covers the agreed fee-collection seam behaviors from the referral spec (no Referral, qualifying split + payout, missing collector, disabled Marketer, zero/sub-lamport share, live rate).
