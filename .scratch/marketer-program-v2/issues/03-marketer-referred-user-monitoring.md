# 03 — Marketer per-referred-User monitoring

**What to build:** On the Marketer Referrals surface, the referred Users list shows light money monitoring drawn only from Referral Payouts: total earned from each referred User, last payout time, and payout count (zeros / null when they never paid). No charts, time series, or product-activity telemetry beyond the payout ledger. Extends the existing referred-Users projection; service-level tests cover the aggregates.

**Blocked by:** None — can start immediately.

**Status:** done

- [x] Each referred User row exposes totalEarnedLamports, lastPayoutAt, and payoutCount for that Marketer
- [x] Users with no Referral Payouts show zero earned, null/empty last payout, and payout count 0
- [x] UI surfaces the new fields on the referred Users table without adding charts
- [x] Service-level tests assert the projection from known Referral Payout fixtures
- [x] Disabled Marketer read-only view (from 01) includes these fields when both land
