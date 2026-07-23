# 18 — Finish Launch Options mint identity and fee/money locality

**What to build:** Make ticket 17’s claimed architecture true before production: plan-time mint identity for every Launch via a new planned-mint entity; one fee-composition owner above the Platform module; envelope `money` as the only authoritative summary. Defer deep extraction of mint/vanity out of `launch.service`.

**Blocked by:** 17 — Extract Launch Options from pump.fun config

**Status:** done

- [x] Prisma: add `LaunchPlannedMint` (or equivalent) with `launchId` (unique), `publicKey`, `privateKey`, nullable `vanityMintId`, consumed/abandoned timestamps; agent updates schema + generate; human owns migration.
- [x] Lifecycle materializes mint for every Launch: vanity reserves pool then writes planned-mint row; fresh generates keypair and writes planned-mint row. Envelope stays secret-free.
- [x] `optionsOutcomes` always carries `mintPublicKey` + `plannedMintId` (plus `vanityMint` / `removeAttribution` and nullable `reservedVanityMintId`). Clean cut; no dual envelope migrators.
- [x] Execute resolves mint only via `plannedMintId` (verify public key). No generate-at-execute for non-vanity.
- [x] On plan persist failure / insufficient funds, lifecycle compensates: abandon planned mint + release vanity reservation when present (not via Platform compensate ownership for options resources).
- [x] Shared options-money helper remains the single composition path; remove options fee merge from pump Platform `preview`. Preview entry above Platform composes after `platform.preview`.
- [x] Envelope `money` is the only final summary for preflight / review / ops; `platformPlan.money` is Platform-internal only.
- [x] Ship gate: production waits on tickets `01`–`18`. Update `spec.md`, ADR 0006, `launch-implementation.md`, and `CONTEXT.md` to match.
- [x] Out of scope: deep `launch.service` mint/vanity extraction; broad Platform plan-result fee-policy redesign; dual validators for old envelopes.

## Comments

### Decisions (grilling 2026-07-23)
- Direction: finish claimed architecture (not docs-only truth-up; not full module deepening).
- Fresh mint secret store: **new entity**, not `Wallet`, not overloaded `VanityMint` pool rows.
- Planned-mint row for **every** Launch; vanity pool is sourcing only; one execute resolve path.
- `optionsOutcomes` always includes `mintPublicKey`.
- Fee composition: shared helper; Platform module does not import/compose options fees.
- Money authority: envelope `money` final; `platformPlan.money` Platform-internal.
- Lifecycle owns compensation for abandoned planned mints.
- Track as issue 18; 17 remains done.
- Assumptions: clean cut / staging wipe OK; execute helper may remain in `launch.service` for this ticket; human owns migration.
