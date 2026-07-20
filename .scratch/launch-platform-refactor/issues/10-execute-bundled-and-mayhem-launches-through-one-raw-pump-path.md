# 10 — Execute bundled and Mayhem Launches through one raw pump path

**What to build:** Bundled buys, fixed-total variance, transaction-size and bundler-wallet limits, vanity mint reservation behavior, Mayhem Token-2022 and dynamic lookup-table strategy, distribution, and cleanup execute through the pump Platform module on the raw instruction path; PumpFunSDK and new system-Wallet branches are removed from launch execution.

**Blocked by:** 09 — Execute non-bundled pump.fun Launches through the Platform module

**Status:** ready-for-agent

- [ ] Bundled pump.fun Launches execute from the exact persisted plan using raw create and buy builders end to end.
- [ ] Fixed-total bundle variance preserves configured total spend without increasing funding requirements silently.
- [ ] Bundler-wallet limits and serialized transaction-size protections remain enforced before submission.
- [ ] Mayhem Launches retain Token-2022, fee-recipient, and dynamic lookup-table behavior needed for bundled execution.
- [ ] Vanity mint reservations are consumed only after confirmed creation and released on eligible failures without swapping mints mid-attempt.
- [ ] Distribution Wallet behavior and post-Launch SOL cleanup preserve current supported bundled outcomes.
- [ ] PumpFunSDK is removed from Launch execution paths and duplicated packing constants are consolidated where they affected behavior.
