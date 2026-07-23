# 07 — Persist an authoritative plan before preflight effects

**What to build:** A schema-valid submission creates visible Launch history before Platform planning begins; an exact secret-free plan is persisted before funding or on-chain work; planning and insufficient-funds failures become visible retryable failed attempts; retry creates a fresh linked Launch and a new authoritative plan without mutating the prior attempt.

**Blocked by:** 05 — Route pump.fun through a shared lifecycle and Platform registry; 06 — Provide normalized pump.fun preview and review

**Status:** resolved

- [x] Any request that passes the external input schema creates a Launch record before Platform planning runs.
- [x] Planning validation failures and insufficient main-Wallet funds transition the attempt to visible, retryable failed history with a safe specific reason.
- [x] The persisted plan contains public identities, allocations, normalized money, intended effects, recovery caps, and opaque pump.fun payload without private keys or raw secret material.
- [x] The shared lifecycle persists the exact plan before execute is invoked; execute cannot silently replan or alter allocations.
- [x] If durable plan persistence fails, pump.fun planning compensates local key references and reservations created during planning.
- [x] Retry creates a new Launch linked to the failed attempt, reuses saved new-version input, and produces a fresh plan while the prior Launch and plan remain immutable history.

## Comments

- Decisions: 1A/2A/3A/4A — lifecycle owns plan→persist→execute; full secret-free plan with unfunded key refs/vanity; compat execute reuses plan identities/vanity but may still recompute funding until ticket 08; sync funding preflight removed so underfunded attempts become visible FAILED history.
- Seams tested: `createLaunchLifecycle` (ordering, FAILED mapping, compensate on persist failure, skip re-plan when persisted); `assemblePumpfunLaunchPlan` / Platform `plan` (secret-free shape, insufficient-funds outcome).
