# 01 — Ops designate Marketer

**What to build:** An Operator can designate an existing User as a Marketer in the Ops Console, set an Ops-only nickname and fee-share rate (0–1), enable/disable them, and list Marketers (including read-only whether a referral code and fee-collector are set). Schema for Marketer, Referral, and Referral Payout exists so later slices can attach attribution and payouts without reshuffling tables.

**Blocked by:** None — can start immediately.

**Status:** resolved

- [x] Operator can create a Marketer from an existing User with nickname and fee-share rate
- [x] Operator can edit nickname, rate, and enabled/disabled
- [x] Disabled Marketer is distinguishable in the Ops list/detail
- [x] Ops list shows nickname, rate, enabled, and whether code/collector are configured (read-only)
- [x] Non-Operators cannot manage Marketers
- [x] Prisma models for Marketer, Referral, and Referral Payout are in the schema (migration left to human)

## Answer

Ops Console Marketer management is live at `/ops/marketers` (list/create/detail). Schema adds `Marketer`, `Referral`, and `ReferralPayout`. Procedures: `ops.listMarketers`, `ops.getMarketer`, `ops.createMarketer`, `ops.updateMarketer` (all Operator-gated via `requireOperator`). Human still needs to run the Prisma migration.
