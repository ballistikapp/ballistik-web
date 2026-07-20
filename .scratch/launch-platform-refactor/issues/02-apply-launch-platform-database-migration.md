# 02 — Apply the Launch Platform database migration

**What to build:** Human-reviewed database rollout that applies the additive Launch Platform persistence from ticket 01 to the target PostgreSQL environments, so application code can rely on the new columns and indexes in staging and production.

**Blocked by:** 01 — Expand Platform persistence and versioned contracts

**Status:** resolved

- [x] A migration is authored, reviewed, and applied for the additive Launch, Token, and Managed Launch Wallet fields from ticket 01.
- [x] Staging and production rollout order matches the project’s Railway deployment practice without rewriting legacy Launch or Token input JSON.
- [x] Deployed databases expose the new nullable columns before dependent application tickets merge that read or write them.
- [x] Rollback or forward-fix expectations are documented for operators if a deploy must pause mid-rollout.
- [x] No legacy authoritative plans are backfilled; null Platform version continues to mean legacy.

## Comments

- Human applied `prisma/migrations/20260720193140_launch_platform`. Migration SQL is untracked in git until committed with follow-on work.
