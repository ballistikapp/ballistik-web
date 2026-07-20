# 08 — Materialize and fund Managed Launch Wallets from the plan

**What to build:** Pump creator, bundler, and distribution Wallet identities and allocations are taken from the persisted plan; resource materialization completes before funding, and persisted funded caps constrain cleanup and recovery behavior.

**Blocked by:** 07 — Persist an authoritative plan before preflight effects

**Status:** ready-for-agent

- [ ] Managed Launch Wallets are prepared and tracked using Platform-defined role identifiers and the exact identities fixed in the persisted plan.
- [ ] Funding amounts and recovery caps recorded on Managed Launch Wallets match the authoritative plan rather than recomputed job-local values.
- [ ] Resource materialization completes before main-Wallet funding according to pump.fun policy encoded in the plan.
- [ ] Funding completes before venue submission according to pump.fun policy encoded in the plan.
- [ ] Failed Launch recovery and automatic reclaim respect the plan-funded cap per Managed Launch Wallet and do not sweep shared or imported Wallet balances beyond that cap.
