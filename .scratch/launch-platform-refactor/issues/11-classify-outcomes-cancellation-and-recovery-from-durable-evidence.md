# 11 — Classify outcomes, cancellation, and recovery from durable evidence

**What to build:** Pump execution returns typed success, canceled, failed, and partial or indeterminate outcomes; late cancellation checks on-chain evidence instead of falsely reporting cancel after irreversible success; post-confirm persistence degradation preserves on-chain success; manual recovery reconstructs from the persisted plan and never exceeds funded caps.

**Blocked by:** 09 — Execute non-bundled pump.fun Launches through the Platform module; 10 — Execute bundled and Mayhem Launches through one raw pump path

**Status:** ready-for-agent

- [ ] Platform success is defined by pump.fun completion criteria rather than mint existence alone.
- [ ] Cooperative cancellation stops at Platform-defined safe points and, once irreversible submission may have landed, classifies the actual outcome from chain evidence.
- [ ] Partial or indeterminate on-chain evidence maps to safe terminal states and recovery policy rather than silent loss of funds or Tokens.
- [ ] Confirmed on-chain success remains successful if later persistence or cleanup steps degrade.
- [ ] Manual recovery works from persisted Launch state and transaction evidence after the original process is gone.
- [ ] Recovery never returns more than the plan-funded cap for a Managed Launch Wallet.
- [ ] Expected operational failures are typed outcomes; contract violations and implementation defects remain exceptional internal failures.
