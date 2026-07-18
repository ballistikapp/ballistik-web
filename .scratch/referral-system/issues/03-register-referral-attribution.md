# 03 — Register-time Referral attribution

**What to build:** A brand-new User who registers via an auth link with a valid, enabled Marketer referral code gets a sticky Referral to that Marketer. Missing, unknown, or disabled codes are ignored and registration still succeeds. Login with a code does not create or change a Referral. The Marketer’s referred-users list shows attributed Users.

**Blocked by:** 02 — Marketer setup surface

**Status:** resolved

- [x] New registration with valid enabled code creates a Referral
- [x] Missing / unknown / disabled code → register with no Referral
- [x] Login with a code does not create or reassign a Referral
- [x] Code change stops new attributions on the old code; existing Referrals remain
- [x] Marketer referred-users list shows identity and join time for attributed Users

## Answer

Register-time sticky Referral attribution is live (ADR 0005). `/auth?ref=` is passed into `auth.loginWithWalletSignature`; a Referral is created in the User-create transaction only when the code matches an enabled Marketer. Fail-open for missing/unknown/disabled/malformed codes. Existing-User login ignores `ref`. `marketer.listReferredUsers` powers the Referred Users table on `/referrals`.
