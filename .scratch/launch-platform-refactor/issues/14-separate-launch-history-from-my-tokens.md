# 14 — Separate Launch history from My Tokens

**What to build:** Launch history shows every attempt and retry lineage, including pre-mint failures; My Tokens contains persisted Tokens only; active Launch progress remains visible in the app shell and navigation links resolve to the correct surfaces.

**Blocked by:** 04 — Enforce the legacy custody-safe capability policy; 07 — Persist an authoritative plan before preflight effects; 11 — Classify outcomes, cancellation, and recovery from durable evidence

**Status:** resolved

- [x] Users have a Launch history surface that includes attempts without Tokens and preserves immutable failed or canceled attempts.
- [x] My Tokens lists persisted owned Tokens only and does not present failed pre-mint attempts as assets.
- [x] Retry lineage between attempts is visible in Launch history without rewriting prior attempts.
- [x] Active Launch progress continues to appear in the app shell while history and asset surfaces are split.
- [x] Progress, reclaim, and navigation copy link to the correct Launch history or Token surfaces rather than stale combined routes.
- [x] Legacy viewing and custody-safe actions remain available under the policy from ticket 04 on the appropriate surface.

## Comments

- Decisions: 1A (`/launches` history + `/tokens` assets), 2A (history: retry/reclaim/lineage; tokens: dashboard/key/reclaim-by-token), 3A (nav labels), 4A (simple lineage column), 5A (failure CTA → Launch history).
- Seams tested: failure guidance href/copy; launch→history row mapping + lineage labels; token→asset row mapping.
