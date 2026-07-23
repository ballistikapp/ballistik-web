# 16 — Contract compatibility code and document the architecture

**What to build:** Remove obsolete lifecycle delegates, flat-input assumptions, duplicated constants, dead system and PumpFunSDK launch paths, and stale docs; update Launch, bundle/Jito, pricing, Ops, Wallet/recovery, and project overview implementation documentation to describe the final lifecycle, Platform, plan, Jito, legacy, and removed system-path invariants.

**Blocked by:** 11 — Classify outcomes, cancellation, and recovery from durable evidence; 12 — Deepen Jito submission and return bookkeeping to callers; 13 — Split the funnel into shared and pump.fun modules; 14 — Separate Launch history from My Tokens; 15 — Expose safe Platform diagnostics in the Ops Console

**Status:** resolved

- [x] Compatibility delegates and dead modules from the staged refactor are removed without regressing supported pump.fun Launch behavior.
- [x] New-version Launch flows no longer depend on flat pump-only input assumptions or removed system dev-wallet execution branches.
- [x] Duplicated launch packing or funding constants that existed only for transitional compatibility are removed or unified without changing supported outcomes.
- [x] Implementation documentation for Launch, bundles/Jito, pricing, Ops, Wallet/recovery, and project overview reflects the shared lifecycle, Platform seam, authoritative plan, Managed Launch Wallet model, legacy policy, and removed system path.
- [x] Domain vocabulary in project context remains aligned with the implemented architecture after cleanup.
- [x] After this final ticket, no transitional compatibility delegates or dead paths remain that would ship to production; earlier tickets were allowed to break Launch until this gate.

## Comments

### Decisions
- Keep lifecycle as router entry; delete dead aliases/helpers only (not full body extract).
- Medium flatten cut: plan/start use versioned `metadata`/`config`; keep `launch-input-compat` for legacy/clone/`resolveStoredLaunchInput`.
- Unify buy/bundle limits via `lib/config/launch.config.ts` (`MIN_BUY_AMOUNT_SOL`, `MAX_BUNDLE_WALLETS`) across schemas, service, and funnel.
- Update Launch, bundle/Jito, pricing, Ops, Wallet/recovery, project overview docs + `CONTEXT.md`.

## Answer

Removed dead `runLaunchJob` / flat MLW persistence helpers and new-path system creator branches; plan/start work from versioned config/metadata; buy/bundle limits unified on `launch.config`; implementation docs and `CONTEXT.md` updated for the final lifecycle/Platform/plan/MLW/legacy/system-removal invariants. Lifecycle router entry and Platform→job wiring remain by design (bodies still in `launch.service`).
