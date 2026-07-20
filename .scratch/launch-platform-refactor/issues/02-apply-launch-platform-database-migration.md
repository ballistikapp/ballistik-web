# 02 — Apply the Launch Platform database migration

**What to build:** Human-reviewed database rollout that applies the additive Launch Platform persistence from ticket 01 to the target PostgreSQL environments, so application code can rely on the new columns and indexes in staging and production.

**Blocked by:** 01 — Expand Platform persistence and versioned contracts

**Status:** ready-for-human

- [ ] A migration is authored, reviewed, and applied for the additive Launch, Token, and Managed Launch Wallet fields from ticket 01.
- [ ] Staging and production rollout order matches the project’s Railway deployment practice without rewriting legacy Launch or Token input JSON.
- [ ] Deployed databases expose the new nullable columns before dependent application tickets merge that read or write them.
- [ ] Rollback or forward-fix expectations are documented for operators if a deploy must pause mid-rollout.
- [ ] No legacy authoritative plans are backfilled; null Platform version continues to mean legacy.
