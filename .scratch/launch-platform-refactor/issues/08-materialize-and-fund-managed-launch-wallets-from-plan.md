# 08 — Materialize and fund Managed Launch Wallets from the plan

**What to build:** Pump creator, bundler, and distribution Wallet identities and allocations are taken from the persisted plan; resource materialization completes before funding, and persisted funded caps constrain cleanup and recovery behavior.

**Blocked by:** 07 — Persist an authoritative plan before preflight effects

**Status:** resolved

- [x] Managed Launch Wallets are prepared and tracked using Platform-defined role identifiers and the exact identities fixed in the persisted plan.
- [x] Funding amounts and recovery caps recorded on Managed Launch Wallets match the authoritative plan rather than recomputed job-local values.
- [x] Resource materialization completes before main-Wallet funding according to pump.fun policy encoded in the plan.
- [x] Funding completes before venue submission according to pump.fun policy encoded in the plan.
- [x] Failed Launch recovery and automatic reclaim respect the plan-funded cap per Managed Launch Wallet and do not sweep shared or imported Wallet balances beyond that cap.

## Comments

- Decisions: 1C/2A/3B/4A — pure plan→funding-targets + MLW-row helpers wired into compat `runLaunchJob`; fund to plan required targets; reclaim keyed to actual top-up (`fundedLamports`); MLW rows materialized from plan at execute before fund; manual `recoverSol` uses same funded-cap drain when validated plan policy or recorded top-up is present (legacy full-balance reclaim preserved when neither applies). Bundle tip and auto-reclaim managed set also follow the plan when present.
- Seams tested: `buildFundingTargetsFromPumpfunPlan` / `buildManagedLaunchWalletRowsFromPumpfunPlan` / `launchUsesPlanFundedCapRecovery`; `computeFailedLaunchDrainLamports` capped-drain cases.
