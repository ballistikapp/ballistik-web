# 10 — Execute bundled and Mayhem Launches through one raw pump path

**What to build:** Bundled buys, fixed-total variance, transaction-size and bundler-wallet limits, vanity mint reservation behavior, Mayhem Token-2022 and dynamic lookup-table strategy, distribution, and cleanup execute through the pump Platform module on the raw instruction path; PumpFunSDK and new system-Wallet branches are removed from launch execution.

**Blocked by:** 09 — Execute non-bundled pump.fun Launches through the Platform module

**Status:** resolved

- [x] Bundled pump.fun Launches execute from the exact persisted plan using raw create and buy builders end to end.
- [x] Fixed-total bundle variance preserves configured total spend without increasing funding requirements silently.
- [x] Bundler-wallet limits and serialized transaction-size protections remain enforced before submission.
- [x] Mayhem Launches retain Token-2022, fee-recipient, and dynamic lookup-table behavior needed for bundled execution.
- [x] Vanity mint reservations are consumed only after confirmed creation and released on eligible failures without swapping mints mid-attempt.
- [x] Distribution Wallet behavior and post-Launch SOL cleanup preserve current supported bundled outcomes.
- [x] PumpFunSDK is removed from Launch execution paths and duplicated packing constants are consolidated where they affected behavior.

## Comments

- Decisions: 1A / 2A / 3A / 4 — mirror ticket 09 (Platform `runPumpfunBundledExecute` → `runBundledPumpfunLaunchJob`); hard-require persisted plan (no recompute fallback); consolidate packing helpers in `bundle-transaction-builder`; keep `{ kind: "compat" }` until ticket 11. Seams tested: `runPumpfunBundledExecute` / Platform execute routing / shared packing buyer→tx helpers.
