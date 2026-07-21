## Bundle Launch Implementation

This document describes the current Jito bundle launch flow used by `ballistik-web` and how it can be extended with Address Lookup Tables (ALT) in the future.

### Current Behavior (ALT Disabled)

### Trigger Conditions
- Bundle launch is used when the persisted pump.fun plan has `intendedEffects.bundleBuyEnabled` true (Platform execute → `runBundledPumpfunLaunchJob` → `createAndBuyInBundle`).
- Buyers include the creator Wallet if planned creator buy > 0, plus all bundler wallets from the plan.
- Maximum buyer wallets per launch: 9 (1 creator + `MAX_BUNDLE_WALLETS` bundlers from `lib/config/launch.config.ts`, currently 8).
- All pump.fun Launch buys use the custom raw-instruction path (no PumpFunSDK on Launch).

### Core Flow (High Level)
1. Platform execute validates the persisted plan and loads Managed Launch Wallet keypairs / allocations from it.
2. Build the token create transaction and buy transactions for each planned buyer.
3. Pack transactions into a Jito bundle (`bundle-transaction-builder` owns packing constants).
4. Submit through the deep Jito transport (`sendJitoBundle` in `server/solana/jito-bundle.ts`). Tip placement, versioning, lookup-table compilation, simulation, endpoint rotation, resend/rebuild, and confirmation stay inside that module.
5. Callers receive `{ bundleId, signatures, confirmation, telemetry }` and create/settle their own `AppTransaction` rows. Jito never writes Launch or Exit bookkeeping.

### Deep Jito submission interface
- Public input: legacy `Transaction[]` + per-tx signer groups + tipper + tip lamports, plus narrow options (`enableAdaptiveTip`, `enableGrpc`, `launchId`, `altAccounts`, optional progressive `onEvent`).
- Adaptive tip multipliers/max escalations, tip account selection, blockhash rebuild bounds, resend intervals, and confirmation polling are owned by Jito (not caller knobs).
- Authoritative simulation failure (first-tx profile failure, or sequential `simulateBundle` failure when that path is enabled) aborts before `sendBundle`.
- Result includes:
  - `signatures` — final landed signature set (order matches packed transactions)
  - `bundleId` / `confirmation` — accepting endpoint, confirmation source (`grpc` | `inflight` | `rpc_status` | `bundle_statuses`), landed slot when known, status counts, resend/rebuild counts, final tip lamports
  - `telemetry` — accumulated structured events (also streamed via `onEvent` for live LaunchLog writes)
- Pump Launch (`createAndBuyInBundle`) and Holding Exit create PENDING AppTransaction rows before submit, then confirm/settle from returned signatures. Mayhem ALT packing uses shared `bundleBuyerTransactionIndex` so buy and tip rows align with the landed bundle structure.
- Tests inject RPC/Jito boundaries through `sendJitoBundleForTests`; production callers use `sendJitoBundle` only.

### Transaction Packing Rules
- The bundle can contain up to 5 transactions.
- Transaction 1 includes:
  - Compute budget instruction (400k units)
  - Token create instructions
  - Up to 1 buy
- Subsequent transactions include up to 2 buys each (4 when a launch ALT is supplied — see below).
  - Caps and buyer→tx index mapping are exported from `bundle-transaction-builder.ts` (`bundleBuysPerFollowUpTransaction` / `bundleBuyerTransactionIndex` / `MAX_RAW_TRANSACTION_BYTES`) and reused by `bundle-create-and-buy.ts` so AppTransaction signature mapping stays ALT-aware.
  - Capped at 2/tx because the new pump IDL's `buy_exact_sol_in` uses 18 accounts per buy; 3/tx overflows the 1232-byte versioned transaction limit without an address lookup table.
- The last transaction may also include the Jito tip transfer.
 - Each bundle transaction adds a compute budget instruction for consistency.
- Every follow-up transaction's real serialized size (with the ALT applied, if any) is validated before being added to the bundle; oversized transactions raise a clear error rather than being sent and failing on-chain.

Transaction packing layout (max buyers, no ALT):

1. Create + 1 buy
2. 2 buys
3. 2 buys
4. 2 buys
5. 2 buys (+ tip if enabled)

### Per-Launch Dynamic Address Lookup Table (ALT)

`server/solana/pump/launch-alt.ts` builds a **per-launch, one-off ALT** containing the launch's dynamic addresses (mint, bonding curve, associated bonding curve, bonding curve v2, creator vault, the resolved token program, and all candidate fee recipients — buyback pool always, plus the Mayhem reserved pool and Mayhem PDAs for Mayhem launches). Because a buy instruction picks one fee recipient at random, the ALT includes every candidate so whichever gets picked at build time is already resolvable.

- Creating and extending the ALT, then waiting for on-chain propagation (at least one slot), adds roughly 1-2s of latency to the create step before any buy transactions can be built. This happens once per launch, before building the bundle.
- `bundle-transaction-builder.ts` accepts an optional `altAccounts` list; when present it raises the follow-up-transaction buy cap from 2 to 4 (most of `buy_exact_sol_in`'s 18 accounts per buy become 1-byte table lookups instead of 32-byte inline keys) and validates the real serialized size of every transaction, including the first.
- `jito-bundle.ts`'s `buildVersionedTransactions`/`sendJitoBundle` accept the same `altAccounts` and pass them to `compileToV0Message` for every transaction in the bundle (not just the ones with the extra buys).
- **Current wiring**: `bundle-create-and-buy.ts` only builds and threads this ALT when `isMayhemMode` is set — this is the wiring the Mayhem mode launch needed. Extending it to all bundle launches (not just Mayhem ones) to close the `Bundle ALT Expansion` backlog item for everyone is a natural, low-risk follow-up (same code path, just build the ALT unconditionally).
- The existing **static** `LAUNCH_LOOKUP_TABLE_ADDRESS` (`lookup-table.ts`) is unrelated and unchanged — it's used only by the non-bundle create+dev-buy versioned transaction path for accounts that never change (Pump program id, event authority, mint authority, program ids, fee config, standard buyback recipients).

### Mayhem Mode

Mayhem-mode launches (`Token.isMayhemMode`) use `create_v2` (Token-2022) instead of `create`, and route protocol fees to `Global.reserved_fee_recipient(s)` instead of the standard fixed recipient. See `docs/implementation/launch-implementation.md` for the full create_v2/Mayhem flow. The bundle path always builds a per-launch ALT for Mayhem launches (see above) because `create_v2` adds ~5 extra fixed accounts (Mayhem program, global params, sol vault, mayhem state, mayhem token vault) on top of an already tight budget.

### Buy Amounts
- Bundle buy uses a fixed total spend:
  - `totalBundleSpend = bundlerWalletCount * bundlerBuyAmountSol`
- Variance changes how that fixed total is distributed across bundler wallets.
- The `0.05 SOL` minimum applies to the user's configured `bundlerBuyAmountSol`, not to each randomized buy amount.
- Buy amounts represent the raw pump buy spend; wallet balance deltas may be higher because account rent, program fees, and transaction fees are charged separately.

### Jito Tip
- If `jitoTipAmountSol > 0`, a SOL transfer is appended to the last transaction.
- Tipper is the main wallet; the tip is sent to a Jito tip account.
- Launch form default tip is `0.005 SOL` (`components/launch/launch-funnel-form-values.ts`).
- If bundle signatures are still not found on-chain during confirmation, launch applies a one-time adaptive tip escalation by doubling the configured tip for subsequent rebuild/send attempts in the same launch attempt.

### Delivery Hardening
- Bundle confirmation timeout: `180_000ms` (`server/solana/jito-bundle.ts`).
- Resend interval before blockhash expiry: `5_000ms` when signatures are still not found.
- Blockhash max age before rebuild: `55_000ms`.
- Maximum blockhash rebuilds: `2`.
- Per-endpoint `sendBundle` timeout: `4_000ms` (`BUNDLE_SEND_ENDPOINT_TIMEOUT_MS` in `server/solana/jito-client.ts`). Timed-out or unreachable regions continue to the next regional endpoint instead of hanging the walk.
- Transport-failure cooldown: `20_000ms` (`BUNDLE_SEND_TRANSPORT_COOLDOWN_MS`) for `ETIMEDOUT` / unavailable / send-timeout failures so the next walk prefers recently working regions. Rate-limit cooldowns remain separate (parsed `Retry after Xms`, default `5_000ms`, cap `120_000ms`).
- Send walk deadline: stops trying further regions once `blockhashFetchedAt + 55_000ms - 10_000ms` is reached (`BUNDLE_SEND_WALK_MARGIN_MS`), so a slow failover cannot burn the remaining blockhash lifetime.
- Rebuild on total resend failure: if a confirm-loop resend is rejected by every region (including `expired blockhash`), confirmation rebuilds with a fresh blockhash (and adaptive tip when enabled) instead of polling the dead bundle until the 3-minute timeout.
- Launch bundle execution is Jito-only with bounded retries (no fallback execution path).
- Only regional Jito block-engine endpoints are used (`lib/config/jito.config.ts`). The global LB `mainnet.block-engine.jito.wtf` is intentionally excluded because it does not preserve bundle tracking across its backing regions — polling inflight at the LB can return `Invalid` for bundles that landed via the same LB.
- Each accepted bundle is pinned to the regional Jito endpoint that issued its `bundleId`. `getInflightBundleStatuses` queries that exact region first, falling back to other regions only on error. Different Jito regions do not share bundle tracking. On resend/rebuild the pinned endpoint is refreshed to whichever region accepted the new bundle. Successful sends also update the process-wide preferred endpoint so subsequent walks start at the last working region.
- Per-endpoint cooldowns (`server/solana/jito-client.ts`): rate-limit and transport failures skip endpoints for their cooldown window. If every endpoint is in cooldown the loop still tries them in soonest-to-recover order so the confirmation loop is never fully blocked.
- Cross-region landing confirmation via Jito `getBundleStatuses`: alongside the per-region inflight poll, the confirmation loop calls `getBundleStatuses` every `3_000ms` to ask "is this bundle on-chain anywhere?". A `confirmed`/`finalized` response wins regardless of which region answered — this hedges against per-region inflight returning `Invalid` for landed bundles.
- `getBundleStatuses` `err` handling: only real transaction errors (`{ Err: { InstructionError: … } }` etc.) abort confirmation as "landed but failed on-chain". `{ Err: { Retryable: "…" } }` is a Jito status-API infrastructure failure (e.g. cluster lookup timeout) — log and keep polling; do not treat it as an on-chain revert.

### Diagnostics Logging
- Bundle send and confirmation telemetry is persisted to `LaunchLog` so operators can inspect delivery behavior in launch activity, including:
  - `bundleEndpoint` (the Jito region the current bundleId was sent to)
  - `inflightEndpoint` (the Jito region that answered the inflight poll — should match `bundleEndpoint`)
  - `statusEndpoint` (the region that answered the `getBundleStatuses` cross-region check)
  - bundle id, create signature
  - resend/rebuild counters
  - blockhash age
  - confirmation summary (`found/confirmed/failed/not_found`)
  - inflight status (`Pending`/`Landed`/`Failed`/`Invalid`)
  - bundle-status check (slot, `confirmationStatus`, on-chain `err`)
  - normalized error/rejection messages
- New telemetry event `bundle_status_check` records each cross-region landing-status response, including the slot the bundle landed in when confirmed.

### Key Files
- `server/solana/bundle-create-and-buy.ts`
- `server/solana/bundle-transaction-builder.ts`
- `server/solana/pump/transactions.ts`
- `server/solana/pump/launch-alt.ts`
- `server/solana/jito-bundle.ts`
- `server/solana/jito-client.ts`

