# 14 — Separate Launch history from My Tokens

**What to build:** Launch history shows every attempt and retry lineage, including pre-mint failures; My Tokens contains persisted Tokens only; active Launch progress remains visible in the app shell and navigation links resolve to the correct surfaces.

**Blocked by:** 04 — Enforce the legacy custody-safe capability policy; 07 — Persist an authoritative plan before preflight effects; 11 — Classify outcomes, cancellation, and recovery from durable evidence

**Status:** ready-for-agent

- [ ] Users have a Launch history surface that includes attempts without Tokens and preserves immutable failed or canceled attempts.
- [ ] My Tokens lists persisted owned Tokens only and does not present failed pre-mint attempts as assets.
- [ ] Retry lineage between attempts is visible in Launch history without rewriting prior attempts.
- [ ] Active Launch progress continues to appear in the app shell while history and asset surfaces are split.
- [ ] Progress, reclaim, and navigation copy link to the correct Launch history or Token surfaces rather than stale combined routes.
- [ ] Legacy viewing and custody-safe actions remain available under the policy from ticket 04 on the appropriate surface.
