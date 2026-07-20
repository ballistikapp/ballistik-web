# 04 — Enforce the legacy custody-safe capability policy

**What to build:** A single eligibility seam treats null-version Launches and Tokens as legacy: history, viewing, exits, reclaim, and permitted key access remain available; retry, clone, new buys, and automation are denied with user-safe explanations.

**Blocked by:** 02 — Apply the Launch Platform database migration

**Status:** ready-for-agent

- [ ] Null Platform version is treated as legacy for Launch and Token eligibility checks without inferring version from arbitrary JSON shape.
- [ ] Legacy Launches and Tokens remain viewable in history and detail surfaces that already expose custody-safe reads.
- [ ] Legacy Users can still perform permitted exits, SOL reclaim, and key access where today allowed.
- [ ] Retry, clone, new buys, and automation entry points are denied for legacy records with consistent user-safe messaging at API and UI seams.
- [ ] New-version records cannot enter legacy-only denial paths, and legacy records cannot enter new-version-only operations such as versioned retry or clone.
