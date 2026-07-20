# 13 — Split the funnel into shared and pump.fun modules

**What to build:** Platform selection, shared Token metadata, navigation, submission, and review form a shared Launch funnel shell; pump.fun-specific settings and client configuration behavior live in a pump funnel module; supported presets and new-version clone behavior remain intact without EVM or system dev-wallet options.

**Blocked by:** 03 — Accept only versioned pump.fun Launch submissions; 06 — Provide normalized pump.fun preview and review

**Status:** ready-for-agent

- [ ] Users select Platform in a shared funnel shell and see pump.fun as the working Platform with SPL shown as coming soon only.
- [ ] Shared metadata fields remain consistent across Platform selection and are not duplicated per Platform module unnecessarily.
- [ ] Pump.fun-specific settings render only when pump.fun is selected and do not leak into future SPL configuration space.
- [ ] Submission and review flow through the shared shell using the normalized monetary review contract from ticket 06.
- [ ] Supported launch presets and new-version clone behavior continue to work for permitted pump.fun settings.
- [ ] EVM placeholder and system dev-wallet options are absent from new-version funnel configuration.
