# 03 — Register-time Referral attribution

**What to build:** A brand-new User who registers via an auth link with a valid, enabled Marketer referral code gets a sticky Referral to that Marketer. Missing, unknown, or disabled codes are ignored and registration still succeeds. Login with a code does not create or change a Referral. The Marketer’s referred-users list shows attributed Users.

**Blocked by:** 02 — Marketer setup surface

**Status:** ready-for-agent

- [ ] New registration with valid enabled code creates a Referral
- [ ] Missing / unknown / disabled code → register with no Referral
- [ ] Login with a code does not create or reassign a Referral
- [ ] Code change stops new attributions on the old code; existing Referrals remain
- [ ] Marketer referred-users list shows identity and join time for attributed Users
