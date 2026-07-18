# Referral System v1

Status: ready-for-agent

## Problem Statement

Ballistik has no way to attribute a new User to a Marketer or share platform fees with that Marketer. Operators cannot run a simple affiliate program: there is no Ops designation of Marketers, no shareable auth link, no on-chain split of usage and subscription fees, and no Marketer-facing surface to configure a fee-collector wallet or track Referrals and Referral Payouts.

## Solution

Introduce a simple referral program. An Operator designates an existing User as a Marketer in the Ops Console (nickname + fee-share rate). The Marketer chooses a referral code and fee-collector public key from a product nav surface, shares an auth link with that code, and earns a live percentage of each referred User’s platform payments (usage fees and subscriptions). On each qualifying collection, one Solana transaction sends the Marketer share to their fee-collector wallet and the remainder to the platform fee collector. The Marketer can track referred Users and payouts with light aggregates.

## User Stories

1. As an Operator, I want to designate an existing User as a Marketer, so that I can onboard affiliates without a separate account type.
2. As an Operator, I want to set a nickname on a Marketer, so that I can remember which User is which without relying on wallet addresses.
3. As an Operator, I want the nickname to be Ops-only (not the shareable code), so that my internal labels do not become public marketing identifiers.
4. As an Operator, I want to set a fee-share rate between 0 and 1 on the Marketer, so that every User they refer shares the same commercial terms.
5. As an Operator, I want to edit a Marketer’s fee-share rate later, so that I can renegotiate terms without touching each Referral.
6. As an Operator, I want rate changes to apply to future fee collections for existing Referrals, so that Ops edits take effect immediately.
7. As an Operator, I want to disable a Marketer, so that their code stops attributing new Users and existing Referrals stop producing Referral Payouts.
8. As an Operator, I want past Referral Payouts to remain visible after disable, so that historical earnings are not erased.
9. As an Operator, I want to list Marketers in the Ops Console, so that I can see who is enabled, their nickname, rate, and whether they have configured a code/collector.
10. As an Operator, I want Marketer management available only to Operators, so that ordinary Users cannot designate affiliates.
11. As a Marketer, I want a link in the main product nav, so that I can reach my referral surface without hunting.
12. As a non-Marketer User, I do not want that nav link, so that the UI stays clean for people who are not affiliates.
13. As a disabled Marketer, I do not want the nav link (or write actions), so that a disabled designation is truly off.
14. As a Marketer, I want to choose my own referral code, so that my share link matches how I brand myself.
15. As a Marketer, I want referral codes to be unique, so that my link cannot collide with another Marketer.
16. As a Marketer, I want to change my referral code later, so that I can fix or rebrand my link.
17. As a Marketer, I want old links with a previous code to stop attributing after I change the code, so that only the current code works.
18. As a Marketer, I want existing Referrals to stay attached after a code change, so that I do not lose people I already referred.
19. As a Marketer, I want a copyable auth URL that includes my current referral code as a query param, so that I can share one link for registration.
20. As a Marketer, I want to set my fee-collector wallet by supplying a Solana public key, so that Referral Payouts go to an address I control.
21. As a Marketer, I want to change my fee-collector public key later, so that I can rotate destination wallets.
22. As a Marketer, I want Referral Payouts to go directly to my fee-collector wallet on collection, so that I am not waiting on a platform payout batch.
23. As a Marketer, I want to see the Users I referred (identity + when they joined), so that I know who is attributed to me.
24. As a Marketer, I want to see my Referral Payouts (amount, when, which referred User, transaction signature), so that I can reconcile earnings on-chain.
25. As a Marketer, I want aggregates (total earned, referral count, last payout), so that I can answer “how am I doing?” at a glance.
26. As a new visitor, I want to open an auth link with a referral code query param, so that registering can attribute me to a Marketer.
27. As a brand-new registering User with a valid enabled Marketer code, I want a Referral created to that Marketer, so that my future platform payments can share fees.
28. As a registering User with a missing, unknown, or disabled referral code, I want registration to succeed with no Referral, so that a broken marketing link never blocks signup.
29. As an existing User logging in with a referral code in the URL, I want the code ignored, so that Referrals are not created or reassigned after first registration.
30. As a referred User, I want my usage fees to be split between my Marketer and the platform when my Marketer is enabled and has a fee-collector set, so that the affiliate program is funded from real product spend.
31. As a referred User, I want my subscription payments to be split the same way, so that plan purchases also compensate the Marketer.
32. As a referred User whose Marketer has no fee-collector public key set, I want the full fee to go to the platform collector, so that my payment is never blocked by Marketer misconfiguration.
33. As a referred User whose Marketer is disabled, I want the full fee to go to the platform collector, so that disable truly stops sharing.
34. As a referred User whose Marketer rate is 0, I want the full fee to go to the platform collector, so that a zero rate means no Marketer transfer.
35. As a referred User with no Referral, I want fee collection to behave exactly as today (single transfer to the platform collector), so that non-referred Users are unaffected.
36. As the platform, I want Marketer share and platform remainder in one atomic Solana transaction with two transfers, so that partial payouts cannot occur.
37. As the platform, I want a Referral Payout record written when a Marketer share is successfully sent, so that Marketers and Ops can track payouts.
38. As the platform, I want no Referral Payout record when the Marketer share is skipped (no collector, disabled, rate 0, or zero lamports), so that the payout list reflects real on-chain Marketer transfers.
39. As the platform, I want the live Marketer rate at collection time used for the split, so that Ops rate edits apply without rewriting Referrals.
40. As the platform, I want lamport rounding that never overshoots the total fee (Marketer share floored; remainder to platform), so that the two transfers always sum to the collected amount.
41. As a Marketer, I accept that multi-wallet “self-referral” sockpuppets are not specially blocked, so that v1 stays simple and Ops can police abuse.
42. As a referred User, I do not need UI that tells me I was referred, so that the product UX stays unchanged for payers.
43. As an implementer, I want all fee-split behavior centralized in the existing fee-collection seam, so that launch, volume bot, exit, and subscription paths inherit referral splitting without per-feature forks.
44. As an implementer, I want domain language (Marketer, Referral, Referral Payout) used in Ops/product copy and docs, so that the glossary stays consistent.
45. As an Operator, I want to see whether a Marketer has set a code and fee-collector (read-only), so that I can support them without editing those fields in Ops.
46. As a Marketer who has not set a code yet, I want the product surface to let me set one before sharing, so that I am not stuck with an empty link.
47. As a Marketer who has not set a fee-collector yet, I want to still see referred Users, so that attribution is visible even before I start earning.
48. As the platform, I want Pro-waived (zero) fees to produce no transfers and no Referral Payout, so that waived plans do not create empty payout noise.
49. As a platform maintainer, I want schema-only Prisma changes from agents (migrations run by humans), so that deploy process stays owned by the team.
50. As a platform maintainer, I want implementation docs updated for referral attribution and fee splitting, so that pricing and auth docs stay accurate.

## Implementation Decisions

- **Domain terms**: Follow `CONTEXT.md` — Marketer, Referral, Referral Payout. ADRs `0004` (atomic dual-transfer) and `0005` (register-only attribution; live Marketer rate) are binding.
- **Marketer identity**: Separate `Marketer` entity linked 1:1 to an existing User (not a new auth type). Created/updated/disabled only via Ops Console by Operators.
- **Marketer fields (Ops-owned)**: nickname (Ops label), feeShareRate in `[0, 1]`, isEnabled. Ops does not set the referral code or fee-collector public key.
- **Marketer fields (Marketer-owned)**: referralCode (optional until set; unique when set; mutable), feeCollectorPublicKey (optional until set; mutable; validated Solana pubkey).
- **Referral entity**: Separate record linking Marketer → referred User. One Referral per referred User (sticky). No per-Referral custom rate. Created only at brand-new User registration when the code resolves to an enabled Marketer with a code set.
- **Auth attribution**: Optional referral code accepted on register (wallet-signature create-User path). Invalid / missing / disabled / unknown codes ignored; User still created. Login paths ignore the code. Query param name: `ref`.
- **Fee scope**: Every collection through the shared fee-collection entry that charges usage fees or subscription SOL is subject to split when a Referral qualifies. Network fees, tips, rent, and non-collector transfers are out of this program.
- **Qualification for split at collection**: Referred User has a Referral; Marketer is enabled; feeShareRate > 0; feeCollectorPublicKey set and valid; Marketer share rounds to ≥ 1 lamport. Otherwise collect 100% to platform collector as today.
- **On-chain shape**: Single transaction, two `SystemProgram.transfer` instructions (Marketer share then platform remainder, or equivalent order documented in service). Same sender (User main wallet) as today. Record Referral Payout only after successful confirmation of that transaction when a Marketer leg was included.
- **Rounding**: Compute Marketer lamports as floor(totalLamports * rate); platform lamports = total − Marketer. If Marketer lamports is 0, single-transfer to platform only.
- **Payout ledger fields**: marketer amount, total fee, platform amount, rate used at collection, reason, tx signature, referred User, Marketer, timestamps — enough for Marketer analytics-lite UI.
- **Marketer product UI**: Nav item visible only for enabled Marketers; page for code + copyable link, fee-collector pubkey, referred Users list, payouts list, aggregates (total earned, referral count, last payout).
- **Ops UI**: Marketer list/detail (or Users-adjacent) to create/edit nickname, rate, enabled; show code/collector as read-only when present.
- **Nav / API gating**: Product Marketer procedures require authenticated User who is an enabled Marketer. Ops Marketer procedures require Operator. Fee split itself is server-side inside fee collection (no client trust).
- **App transaction tracking**: Prefer extending the existing fee AppTransaction flow so dual-destination collections remain auditable without inventing a parallel payment rail; Referral Payout is the Marketer-facing ledger.
- **No self-referral guard** in v1.
- **Docs**: Update implementation docs for pricing/fee collection and auth registration attribution; keep glossary/ADRs as source of product rules.

## Testing Decisions

- **What makes a good test**: Assert external behavior of the fee-collection seam — given User/Referral/Marketer state and a fee amount/reason, the resulting transfers (destinations + lamports), skip vs collect, and Referral Payout side effects match the rules. Do not assert UI, router wiring, Prisma query shapes, or auth-page query-param plumbing.
- **Single module under test (the agreed seam)**: The shared fee-collection service entry used for usage fees and subscriptions (today: collect-from-main-wallet). All referral money rules are proven here.
- **Prior art**: Service-focused `node:test` suites under server services (e.g. dashboard, holding helpers) with stubbed/controlled dependencies where the codebase already does so. No usage-fee tests exist today; add them at this seam.
- **Minimum behaviors to cover**:
  1. User with no Referral → single transfer to platform collector; no Referral Payout.
  2. Referral + enabled Marketer + collector + rate → one tx semantics with Marketer share and platform remainder; Referral Payout recorded with amounts/rate/signature.
  3. Missing fee-collector → 100% platform; no Referral Payout.
  4. Disabled Marketer → 100% platform; no Referral Payout.
  5. Rate 0 or Marketer share rounds to 0 lamports → 100% platform; no Referral Payout.
  6. Live rate: Marketer rate changed between collections changes the split on the next collection.
- **Explicitly not automated in this spec**: Auth register attribution, Ops/Marketer UI, nav visibility (manual or later). Attribution bugs are caught in review/QA against the register-only ADR, not this seam’s unit tests.

## Out of Scope

- Per-Referral custom payout percentages
- Frozen rate-at-signup on the Referral
- Self-referral / multi-wallet farming detection
- Referral code aliases (keeping old codes alive)
- Holding Marketer share off-chain until a collector is set
- Blocking User payments when Marketer is misconfigured
- Reassigning or deleting Referrals after creation (except disable stopping future payouts)
- Referred-User-facing “you were referred” UI
- Separate Marketer auth or non-User Marketer accounts
- Payout export, dispute flows, clawbacks, or multi-currency
- Changing the platform fee schedule itself
- Automated tests for auth attribution or UI

## Further Notes

- Query param: `ref=<referralCode>` on the auth URL.
- Nickname uniqueness is a convenience for Ops; enforce uniqueness if cheap, but the referral code is the identity that must be unique for URL resolution.
- When a Marketer changes their code, only the current code resolves; existing Referrals remain.
- Subscription and usage fees share one collection seam — that is why one test seam covers both commercial surfaces.
- Human runs Prisma migrations; agents only edit the schema and regenerate the client as appropriate per repo rules.
- Domain glossary and ADRs `0004` / `0005` should stay aligned if product rules change.
