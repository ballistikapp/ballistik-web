# 05 — Route pump.fun through a shared lifecycle and Platform registry

**What to build:** Start, progress, logs, cancellation, retry lineage, terminal status mapping, and post-success fee orchestration run through a shared Launch lifecycle module that resolves pump.fun via a typed registry, initially delegating execution to compatibility code so behavior stays intact while seams are introduced.

**Blocked by:** 03 — Accept only versioned pump.fun Launch submissions

**Status:** ready-for-agent

- [ ] Launch start, status, cancel, retry, and active-process queries route through the shared lifecycle rather than ad hoc monolith entry points.
- [ ] The shared lifecycle owns Launch and LaunchLog persistence, progress, cancellation state, retry lineage, terminal mapping, and usage-fee collection timing.
- [ ] Pump.fun is resolved through the Platform registry using the small preview, plan, execute, and recover interface shape.
- [ ] Platform modules report progress and query cancellation through lifecycle contexts instead of writing Launch or LaunchLog rows directly.
- [ ] Initial pump.fun behavior remains functionally equivalent via compatibility delegates until later tickets move planning and execution out.
- [ ] Post-success usage-fee collection still runs only after Platform success and does not downgrade success when collection later fails.
