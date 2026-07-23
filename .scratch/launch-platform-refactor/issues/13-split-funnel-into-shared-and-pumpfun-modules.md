# 13 — Split the funnel into shared and pump.fun modules

**What to build:** Platform selection, shared Token metadata, navigation, submission, and review form a shared Launch funnel shell; pump.fun-specific settings and client configuration behavior live in a pump funnel module; supported presets and new-version clone behavior remain intact without EVM or system dev-wallet options.

**Blocked by:** 03 — Accept only versioned pump.fun Launch submissions; 06 — Provide normalized pump.fun preview and review

**Status:** resolved

- [x] Users select Platform in a shared funnel shell and see pump.fun as the working Platform with SPL shown as coming soon only.
- [x] Shared metadata fields remain consistent across Platform selection and are not duplicated per Platform module unnecessarily.
- [x] Pump.fun-specific settings render only when pump.fun is selected and do not leak into future SPL configuration space.
- [x] Submission and review flow through the shared shell using the normalized monetary review contract from ticket 06.
- [x] Supported launch presets and new-version clone behavior continue to work for permitted pump.fun settings.
- [x] EVM placeholder and system dev-wallet options are absent from new-version funnel configuration.

## Comments

- Decisions: 1B (`components/launch/` + `platforms/pumpfun/`), 2B (nested `{ platform, metadata, config }` form state), 3A (inline Review + overview both via `previewCosts` / `toPreviewMoneyDisplay`), 4A (shell-owned platform selection; pump config mounts only for PUMPFUN).
- Seams tested: platform availability, versioned payload assembly, flat preset/clone → nested mapping.
