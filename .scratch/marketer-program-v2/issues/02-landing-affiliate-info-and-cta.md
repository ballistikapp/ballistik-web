# 02 — Landing affiliate info + apply CTA

**What to build:** The public landing page explains the affiliate / referral program in a short section plus FAQ items: what it is, that Marketers earn a share of referred Users’ platform spend, and that interested Users apply in-app after login. No public fee-share percentage. CTA sends logged-out visitors through auth and returns them to `/referrals` so they can submit a Marketer Application. Marketing copy may say “Affiliate program”; product/Ops keep Marketer / Referral / Marketer Application.

**Blocked by:** None — can start immediately (most useful after 01 so `/referrals` accept Applications).

**Status:** ready-for-human

- [x] Landing has a short affiliate/referral program section (not a separate long page)
- [x] FAQ covers program basics and in-app apply; does not advertise a specific share %
- [x] CTA routes through auth with return to `/referrals` when a return path is supported
- [x] Copy does not invent new domain terms for Ops/product surfaces
