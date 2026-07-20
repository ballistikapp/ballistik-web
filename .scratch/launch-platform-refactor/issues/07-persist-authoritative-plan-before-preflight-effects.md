# 07 — Persist an authoritative plan before preflight effects

**What to build:** A schema-valid submission creates visible Launch history before Platform planning begins; an exact secret-free plan is persisted before funding or on-chain work; planning and insufficient-funds failures become visible retryable failed attempts; retry creates a fresh linked Launch and a new authoritative plan without mutating the prior attempt.

**Blocked by:** 05 — Route pump.fun through a shared lifecycle and Platform registry; 06 — Provide normalized pump.fun preview and review

**Status:** ready-for-agent

- [ ] Any request that passes the external input schema creates a Launch record before Platform planning runs.
- [ ] Planning validation failures and insufficient main-Wallet funds transition the attempt to visible, retryable failed history with a safe specific reason.
- [ ] The persisted plan contains public identities, allocations, normalized money, intended effects, recovery caps, and opaque pump.fun payload without private keys or raw secret material.
- [ ] The shared lifecycle persists the exact plan before execute is invoked; execute cannot silently replan or alter allocations.
- [ ] If durable plan persistence fails, pump.fun planning compensates local key references and reservations created during planning.
- [ ] Retry creates a new Launch linked to the failed attempt, reuses saved new-version input, and produces a fresh plan while the prior Launch and plan remain immutable history.
