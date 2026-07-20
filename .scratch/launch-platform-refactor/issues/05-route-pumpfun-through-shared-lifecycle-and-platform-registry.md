# 05 — Route pump.fun through a shared lifecycle and Platform registry

**What to build:** Start, progress, logs, cancellation, retry lineage, terminal status mapping, and post-success fee orchestration run through a shared Launch lifecycle module that resolves pump.fun via a typed registry, initially delegating execution to compatibility code so behavior stays intact while seams are introduced.

**Blocked by:** 03 — Accept only versioned pump.fun Launch submissions

**Status:** resolved

- [x] Launch start, status, cancel, retry, and active-process queries route through the shared lifecycle rather than ad hoc monolith entry points.
- [x] The shared lifecycle owns Launch and LaunchLog persistence, progress, cancellation state, retry lineage, terminal mapping, and usage-fee collection timing.
- [x] Pump.fun is resolved through the Platform registry using the small preview, plan, execute, and recover interface shape.
- [x] Platform modules report progress and query cancellation through lifecycle contexts instead of writing Launch or LaunchLog rows directly.
- [x] Initial pump.fun behavior remains functionally equivalent via compatibility delegates until later tickets move planning and execution out.
- [x] Post-success usage-fee collection still runs only after Platform success and does not downgrade success when collection later fails.

## Comments

- Thin cut (agreed 1A/2A/3A): `launchLifecycle` is the router entry for start/status/cancel/retry/getActive (bodies still in `launch.service` via compat re-export); schedules `resolveLaunchPlatform(...).execute(ctx)`; owns typed outcome mapping + `collectUsageFeeAfterSuccess`. Pump module is compat (`runPumpfunLaunchJobCompat` → `runLaunchJob`); preview/plan/recover throw 501 until later tickets. Lifecycle context is passed into execute and exercised by fake-Platform tests; the pump compat path still writes logs/progress/cancel checks inside `runLaunchJob` until execution extraction. Fee helper used from `finalizeLaunch` on compat success and from lifecycle on typed `succeeded` outcomes.
