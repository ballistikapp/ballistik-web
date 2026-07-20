# 16 — Contract compatibility code and document the architecture

**What to build:** Remove obsolete lifecycle delegates, flat-input assumptions, duplicated constants, dead system and PumpFunSDK launch paths, and stale docs; update Launch, bundle/Jito, pricing, Ops, Wallet/recovery, and project overview implementation documentation to describe the final lifecycle, Platform, plan, Jito, legacy, and removed system-path invariants.

**Blocked by:** 11 — Classify outcomes, cancellation, and recovery from durable evidence; 12 — Deepen Jito submission and return bookkeeping to callers; 13 — Split the funnel into shared and pump.fun modules; 14 — Separate Launch history from My Tokens; 15 — Expose safe Platform diagnostics in the Ops Console

**Status:** ready-for-agent

- [ ] Compatibility delegates and dead modules from the staged refactor are removed without regressing supported pump.fun Launch behavior.
- [ ] New-version Launch flows no longer depend on flat pump-only input assumptions or removed system dev-wallet execution branches.
- [ ] Duplicated launch packing or funding constants that existed only for transitional compatibility are removed or unified without changing supported outcomes.
- [ ] Implementation documentation for Launch, bundles/Jito, pricing, Ops, Wallet/recovery, and project overview reflects the shared lifecycle, Platform seam, authoritative plan, Managed Launch Wallet model, legacy policy, and removed system path.
- [ ] Domain vocabulary in project context remains aligned with the implemented architecture after cleanup.
- [ ] The refactor is reviewable as completed stages rather than leaving hidden transitional behavior in production paths.
