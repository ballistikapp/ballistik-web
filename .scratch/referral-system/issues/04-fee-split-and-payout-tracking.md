# 04 — Fee split + payout tracking

**What to build:** When a referred User pays a usage fee or subscription through the shared fee-collection path, a qualifying Marketer receives their live-rate share and the platform receives the remainder in one atomic dual-transfer transaction. Referral Payouts and aggregates appear on the Marketer surface. Non-qualifying cases (no Referral, disabled Marketer, no collector, rate/share zero) stay 100% platform with no Referral Payout. Seam tests cover the fee-collection entry.

**Blocked by:** 03 — Register-time Referral attribution

**Status:** resolved

- [x] Qualifying collection splits Marketer share + platform remainder in one transaction
- [x] Usage fees and subscription charges both go through the split
- [x] Missing collector / disabled Marketer / zero share → 100% platform, no Referral Payout
- [x] Live Marketer rate applies at each collection
- [x] Referral Payout recorded with amounts, rate, reason, signature, referred User
- [x] Marketer UI shows payouts plus aggregates (total earned, referral count, last payout)
- [x] Fee-collection seam tests cover the minimum behaviors from the spec

## Answer

Fee split lives in `usageFeeService.collectFromMainWallet`: qualifying Referrals get one Solana tx with Marketer share then platform remainder; `ReferralPayout` is written after confirm. Marketer surface: `marketer.listPayouts` + `marketer.getAggregates` power `/referrals` payouts UI. Seam tests in `server/services/usage-fee.service.test.ts`.

## Comments

- Ledger write failures after a confirmed on-chain split are logged and do not fail the payer (avoids double-charge on retry).
