# 04 — Fee split + payout tracking

**What to build:** When a referred User pays a usage fee or subscription through the shared fee-collection path, a qualifying Marketer receives their live-rate share and the platform receives the remainder in one atomic dual-transfer transaction. Referral Payouts and aggregates appear on the Marketer surface. Non-qualifying cases (no Referral, disabled Marketer, no collector, rate/share zero) stay 100% platform with no Referral Payout. Seam tests cover the fee-collection entry.

**Blocked by:** 03 — Register-time Referral attribution

**Status:** ready-for-agent

- [ ] Qualifying collection splits Marketer share + platform remainder in one transaction
- [ ] Usage fees and subscription charges both go through the split
- [ ] Missing collector / disabled Marketer / zero share → 100% platform, no Referral Payout
- [ ] Live Marketer rate applies at each collection
- [ ] Referral Payout recorded with amounts, rate, reason, signature, referred User
- [ ] Marketer UI shows payouts plus aggregates (total earned, referral count, last payout)
- [ ] Fee-collection seam tests cover the minimum behaviors from the spec
