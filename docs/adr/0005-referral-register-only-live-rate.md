# Register-only Referral; live Marketer rate

A Referral is created only when a brand-new User registers with a valid, enabled Marketer referral code. Logins and existing Users never gain or change a Referral via the query param. Invalid, missing, or disabled codes are ignored so signup is never blocked by a stale marketing link.

The fee-share rate lives only on the Marketer and is read at each fee collection. We rejected per-Referral frozen rates and per-Referral custom rates to keep Ops edits in one place; the trade-off is that changing a Marketer’s rate immediately affects all their existing Referrals’ future payouts.
