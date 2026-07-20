# 01 — Expand Platform persistence and versioned contracts

**What to build:** Additive Launch and Token Platform identity, immutable plan storage fields, outcome classification fields, Platform-scoped Managed Launch Wallet role identifiers, discriminated pump.fun launch input types, normalized monetary summary types, and a pump.fun Platform registry contract—without rewriting legacy records or changing current execution behavior. Prepare Prisma schema and regenerated client types only; do not create or run database migrations.

**Blocked by:** None — can start immediately.

**Status:** resolved

- [x] Launch and Token models include nullable Platform identity and nullable Platform version markers suitable for treating null as legacy.
- [x] Launch can store a secret-free authoritative plan payload, plan schema version, and plan persisted timestamp as additive nullable fields.
- [x] Managed Launch Wallet persistence supports Platform-defined role identifiers without requiring a global enum of every future role.
- [x] New launch input is modeled as a discriminated structure with shared Token metadata and a pump.fun configuration branch; SPL and EVM are not valid persisted execution Platforms in this effort.
- [x] Normalized money types cover immediate required balance, temporary funding, permanent spend, expected return, main-Wallet deltas, usage fees, and labeled line items for preview and plan surfaces.
- [x] A typed Platform registry resolves pump.fun only; unsupported Platforms fail at validation before record creation.
- [x] Legacy rows remain readable without backfill or JSON-shape inference for version identity.
- [x] No agent creates, runs, or commits Prisma migration SQL as part of this ticket.

## Comments

- Implemented additive Prisma fields + regenerated client (no migration SQL). Versioned input / money Zod contracts and `resolveLaunchPlatform` registry land behind confirmed seams; legacy flat `launchTokenSchema` and execution paths unchanged. Human next: create/apply migration (ticket 02).
