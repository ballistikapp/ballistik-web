# 04 — Enforce the legacy custody-safe capability policy

**What to build:** A single eligibility seam treats null-version Launches and Tokens as legacy: history, viewing, exits, reclaim, and permitted key access remain available; retry, clone, new buys, and automation are denied with user-safe explanations.

**Blocked by:** 02 — Apply the Launch Platform database migration

**Status:** resolved

- [x] Null Platform version is treated as legacy for Launch and Token eligibility checks without inferring version from arbitrary JSON shape.
- [x] Legacy Launches and Tokens remain viewable in history and detail surfaces that already expose custody-safe reads.
- [x] Legacy Users can still perform permitted exits, SOL reclaim, and key access where today allowed.
- [x] Retry, clone, new buys, and automation entry points are denied for legacy records with consistent user-safe messaging at API and UI seams.
- [x] New-version records cannot enter legacy-only denial paths, and legacy records cannot enter new-version-only operations such as versioned retry or clone.

## Comments

- Single seam: `assertNonLegacyPlatformCapability` (`server/services/launch-capability.ts`) + shared copy in `lib/launch/legacy-capability.ts`. Wired into `retryLaunch`, `getCloneInput`, `buyByToken`, `createBuyerWalletsByToken`, `volumeBot.startSession`. Reads expose `isLegacy`/`platformVersion`; legacy clone input stripped from `getUserLaunches`. UI gates retry/clone/buy/volume-bot new with the same messaging. Exits, reclaim, and key access left open.
