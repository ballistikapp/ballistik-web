# 09 — Execute non-bundled pump.fun Launches through the Platform module

**What to build:** Standard non-bundled create and dev-buy Launches execute the exact persisted plan through pump-owned metadata publication, raw Solana transaction builders, confirmation, AppTransaction bookkeeping, and success handling without PumpFunSDK or new system-Wallet execution paths.

**Blocked by:** 08 — Materialize and fund Managed Launch Wallets from the plan

**Status:** resolved

- [x] Non-bundled pump.fun execution reads and validates the persisted plan version before running.
- [x] Create and dev-buy flows use the custom raw pump.fun instruction path rather than PumpFunSDK for launch buys.
- [x] Pump.fun venue metadata publication remains owned by the pump Platform module while shared media storage remains separate from venue publish.
- [x] Confirmation, Token activation, distribution hooks, and post-success SOL cleanup preserve current supported non-bundled outcomes.
- [x] Launch AppTransaction meanings for non-bundled paths remain owned by Launch callers rather than the Jito transport module.
- [x] New-version execution rejects the system dev-wallet path even if legacy stored input still describes it elsewhere.

## Comments

- Decisions: 1C / 2A — direct cut (Platform execute owns non-bundled; `runLaunchJob` is bundled-only and hard-fails non-bundled); outcomes stay `{ kind: "compat" }` (typed outcomes = ticket 11). PumpFunSDK removed from Launch service non-bundled path; sequential post-create SDK buys deleted. Bundled remains compat job until ticket 10.
- Seams tested: `requirePumpfunExecutePlan` / `runPumpfunNonBundledExecute` / `createPumpfunPlatformModule.execute` routing (missing/invalid plan, bundled vs non-bundled deps, system creator rejection).
