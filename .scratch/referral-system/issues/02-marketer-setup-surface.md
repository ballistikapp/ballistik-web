# 02 — Marketer setup surface

**What to build:** An enabled Marketer sees a main-nav entry to a referral page where they can set/change their referral code, set/change their fee-collector public key, and copy an auth URL with `?ref=<code>`. Referred-users and payouts sections may be empty until later tickets fill them.

**Blocked by:** 01 — Ops designate Marketer

**Status:** resolved

- [x] Enabled Marketer sees the nav link; non-Marketers and disabled Marketers do not
- [x] Marketer can set a unique referral code and change it later
- [x] Marketer can set and change a valid fee-collector public key
- [x] Copyable auth link uses the current code as `ref`
- [x] Page shows referred-users and payouts areas (empty until data exists)

## Answer

Product Marketer setup is live at `/referrals` (Account nav item gated on `marketer.getMe`). Procedures: `marketer.getMe` (null when not an enabled Marketer), `marketer.updateSetup` (referral code slug + fee-collector pubkey). Share link: `{origin}/auth?ref=<code>`. Referred Users / Referral Payouts sections are empty placeholders for later slices.
