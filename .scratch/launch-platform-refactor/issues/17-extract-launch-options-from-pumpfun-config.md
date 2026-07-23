# 17 — Extract Launch Options from pump.fun config

**What to build:** Move vanity mint and Launch Attribution out of pump.fun Platform `config` into shared Launch Options; make the shared lifecycle own mint identity, attribution-at-publish, and related fees; persist plans as an envelope with `optionsOutcomes` + `platformPlan`; regroup the funnel so Launch Options are shared and pump fields live under “pump.fun Configuration.”

**Blocked by:** 16 — Contract compatibility code and document the architecture

**Status:** done

- [x] Versioned Launch input v1 is revised in place to `{ platform, metadata, options, config }`; `options` holds `vanityMint` and `removeAttribution`; pump `config` no longer includes those flags (Mayhem and buys/wallets/tips remain pump-only).
- [x] Preview input includes Launch Options so vanity/attribution fees quote correctly without requiring full metadata.
- [x] Shared lifecycle materializes mint identity for every Launch (vanity pool reserve or fresh mint key); Platforms receive the intended mint identity rather than owning key creation.
- [x] Launch Attribution: stored metadata keeps the user-authored description; publish applies or omits the Ballistik line from metadata + `removeAttribution`.
- [x] Vanity and attribution usage fees are composed by shared pricing/lifecycle into normalized money; pump preview/plan money no longer invents those line items.
- [x] `Launch.plan` persists an envelope (`shellVersion`, `optionsOutcomes`, `platformPlan`); pump plan schema no longer stores vanity/attribution flags or reservation ids in `intendedEffects` / `opaque`.
- [x] Clean cut: no dual validators or bare-pump-plan read migrators for post-refactor shapes (refactor not in production); staging rows may be wiped/ignored.
- [x] Funnel: shared **Launch Options** section for vanity + remove attribution; pump module section renamed to **pump.fun Configuration** (Mayhem and remaining pump fields only).
- [x] Presets, clone, review, and compat mappers read/write `options` instead of pump `config` for those two flags.
- [x] Implementation docs and `CONTEXT.md` / ADR language stay aligned (Launch Options, Launch Attribution, Vanity Mint).

## Comments

### Follow-up (UI 2026-07-23)
- Funnel UI later moved Mayhem under **Launch Options** via a platform-options slot and removed the standalone “pump.fun Configuration” section. Domain/API split unchanged: vanity/attribution stay in `options`; Mayhem stays in pump `config`. Dev Wallet / Bundler remain separate sections.

### Decisions (grilling 2026-07-21)
- Domain + UI + contract (not UI-only).
- Attribution is its own product concern (not metadata, not vanity); both live in one pragmatic `options` bag named **Launch Options**.
- Lifecycle owns Options work (mint identity always, attribution publish, fees); Platforms consume results.
- Plan persistence: envelope in `Launch.plan`.
- Input: revise schemaVersion 1 in place; clean cut (no prod post-refactor rows).
- Funnel: shared Launch Options + rename pump section to pump.fun Configuration.
- Track as follow-up issue 17; ticket 16 remains complete.
- ADR: `docs/adr/0006-launch-options-shared-mint-identity.md`.
