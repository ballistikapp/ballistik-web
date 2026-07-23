# Referral Implementation

## Purpose

Product-facing Referrals surface for all authenticated Users: Marketer Application intake for non-Marketers, setup + referred Users + payouts for enabled Marketers, and read-only history for disabled Marketers. Register-time Referral attribution and fee-collection dual-transfer splits are unchanged. Ops designates Marketers and reviews Applications; rates and designation stay Operator-owned.

See `CONTEXT.md` and ADRs:

- `docs/adr/0004-referral-atomic-fee-split.md`
- `docs/adr/0005-referral-register-only-live-rate.md`

Ops designation and Applications inbox live in [Ops Console](./ops-console-implementation.md). Fee collection details also live in [Pricing](./pricing-implementation.md).

## Layers

| Layer | Path |
| --- | --- |
| Schema | `prisma/schema.prisma` (`Marketer`, `MarketerApplication`, `Referral`, `ReferralPayout`) |
| Config | `lib/config/marketer.config.ts` (Application message max length) |
| Zod | `server/schemas/marketer.schema.ts`, `server/schemas/marketer-application.schema.ts`, optional `referralCode` on `loginWithWalletSignatureSchema` |
| Service | `server/services/marketer.service.ts`, `server/services/marketer-application.service.ts`; Referral create in `auth.service` register path; fee split in `usage-fee.service`; Ops create Marketer auto-approves pending Application |
| Router | `server/trpc/routers/marketer.router.ts` (`marketer` on app router); Ops Application procedures on `ops` |
| UI | `app/(app)/referrals/page.tsx`, `components/marketer/**` |
| Nav | Account **Referrals** for all authenticated Users (`components/layout/sidebar/app-sidebar.tsx`) |
| Auth entry | `/auth?ref=<code>` → `WalletAuthActions` → `auth.loginWithWalletSignature` |
| Fee seam | `usageFeeService.collectFromMainWallet` (usage fees + subscription charges) |

## Procedures

- `marketer.getMe` — `protectedRateLimitedProcedure`; discriminated status for the current User:
  - `can_apply` — not a Marketer, no pending Application (never applied or last was approved without a row edge-case)
  - `pending` — latest Application is pending
  - `rejected` — latest Application is rejected (includes optional Operator note); User may submit a new Application
  - `enabled` — enabled Marketer with setup
  - `disabled` — disabled Marketer with setup (read-only history)
- `marketer.submitApplication` — `protectedRateLimitedProcedure`; required length-capped message; at most one pending; blocked if already a Marketer
- `marketer.updateSetup` — `protectedRateLimitedProcedure`; set/change `referralCode` and/or `feeCollectorPublicKey`; requires **enabled** Marketer; disabled / non-Marketer → not-found
- `marketer.listReferredUsers` — `protectedRateLimitedProcedure`; sticky Referrals for the current Marketer (enabled or disabled); newest first; each row includes payout-ledger aggregates (`totalEarnedLamports`, `lastPayoutAt`, `payoutCount` — zeros/null when never paid); non-Marketer → not-found
- `marketer.listPayouts` — `protectedRateLimitedProcedure`; Referral Payouts for the current Marketer (enabled or disabled); newest first
- `marketer.getAggregates` — `protectedRateLimitedProcedure`; total earned, referral count, last payout time (enabled or disabled)

## Marketer Application

- Message required, max `MARKETER_APPLICATION_MESSAGE_MAX_LENGTH` (1000).
- Status: `PENDING` | `APPROVED` | `REJECTED`.
- At most one pending Application per User (enforced in service).
- Reject (Ops) may include an optional Operator note shown to the User.
- After reject, User may submit a **new** Application row.
- Creating a Marketer for that User auto-approves their pending Application (same transaction). Creating a Marketer with no pending Application has no Application side effects.
- Disabled Marketers cannot apply again (already designated).

## Marketer-owned fields

- **referralCode** — optional until set; unique when set; mutable. Slug: lowercase letters, numbers, and hyphens; 3–32 chars; normalized to lowercase on save. Changing the code stops old links from resolving for **new** registrations; existing Referrals stay attached (ADR 0005).
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

- `/referrals` — Application intake (can apply / pending / rejected+resubmit), or Marketer setup + Referred Users (identity + payout-ledger earned/last/count) + Payouts; disabled Marketers see read-only setup/history
- Account nav **Referrals** link always shown for authenticated Users
- Intake only — no User-facing rate or self-designation

## Seam tests

- `server/services/usage-fee.service.test.ts` — fee-collection seam (no Referral, qualifying split + payout, missing collector, disabled Marketer, zero/sub-lamport share, live rate)
- `server/services/marketer-application.service.test.ts` — Application submit rules, reject, approve-pending, and `ops.createMarketer` auto-approve / no-op when none pending
- `server/services/marketer.service.test.ts` — referred-Users projection with per-User Referral Payout aggregates (zeros when never paid; disabled Marketer read-only)
