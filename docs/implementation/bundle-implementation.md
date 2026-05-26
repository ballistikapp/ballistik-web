## Bundle Launch Implementation

This document describes the current Jito bundle launch flow used by `ballistik-web` and how it can be extended with Address Lookup Tables (ALT) in the future.

### Current Behavior (ALT Disabled)

### Trigger Conditions
- Bundle launch is used when `bundleBuyEnabled` is true.
- Buyers include the dev wallet if `devBuyAmountSol > 0`, plus all bundler wallets.
- Maximum buyer wallets per launch: 9 (1 dev + 8 bundler wallets).

### Core Flow (High Level)
1. Build the token create transaction.
2. Build buy transactions for each buyer wallet.
3. Pack transactions into a Jito bundle.
4. Add a Jito tip transfer to the last transaction (if `jitoTipAmountSol > 0`).
5. Send the bundle via the Jito block engine.

### Transaction Packing Rules
- The bundle can contain up to 5 transactions.
- Transaction 1 includes:
  - Compute budget instruction (800k units)
  - Token create instructions
  - Up to 1 buy
- Subsequent transactions include up to 2 buys each.
  - Capped at 2/tx because the new pump IDL's `buy_exact_sol_in` uses 18 accounts per buy; 3/tx overflows the 1232-byte versioned transaction limit without an address lookup table.
- The last transaction may also include the Jito tip transfer.
 - Each bundle transaction adds a compute budget instruction for consistency.

Transaction packing layout (max buyers):

1. Create + 1 buy
2. 2 buys
3. 2 buys
4. 2 buys
5. 2 buys (+ tip if enabled)

### Buy Amounts
- Bundle buy uses a fixed total spend:
  - `totalBundleSpend = bundlerWalletCount * bundlerBuyAmountSol`
- Variance changes how that fixed total is distributed across bundler wallets.
- The `0.05 SOL` minimum applies to the user's configured `bundlerBuyAmountSol`, not to each randomized buy amount.
- Buy amounts represent the raw pump buy spend; wallet balance deltas may be higher because account rent, program fees, and transaction fees are charged separately.

### Jito Tip
- If `jitoTipAmountSol > 0`, a SOL transfer is appended to the last transaction.
- Tipper is the main wallet; the tip is sent to a Jito tip account.
- If bundle signatures are still not found on-chain during confirmation, launch applies a one-time adaptive tip escalation by doubling the configured tip for subsequent rebuild/send attempts in the same launch attempt.

### Delivery Hardening
- Bundle confirmation timeout: `180_000ms` (`server/solana/jito-bundle.ts`).
- Resend interval before blockhash expiry: `5_000ms` when signatures are still not found.
- Blockhash max age before rebuild: `55_000ms`.
- Maximum blockhash rebuilds: `2`.
- Launch bundle execution is Jito-only with bounded retries (no fallback execution path).
- Only regional Jito block-engine endpoints are used (`lib/config/jito.config.ts`). The global LB `mainnet.block-engine.jito.wtf` is intentionally excluded because it does not preserve bundle tracking across its backing regions — polling inflight at the LB can return `Invalid` for bundles that landed via the same LB.
- Each accepted bundle is pinned to the regional Jito endpoint that issued its `bundleId`. `getInflightBundleStatuses` queries that exact region first, falling back to other regions only on error. Different Jito regions do not share bundle tracking. On resend/rebuild the pinned endpoint is refreshed to whichever region accepted the new bundle.
- Per-endpoint cooldowns (`server/solana/jito-client.ts`): when an endpoint returns `Retry after Xms` or `Network congested. Endpoint is globally rate limited.`, that endpoint is skipped for the cooldown window (parsed from the response, capped at `120_000ms`, default `5_000ms` when no time is provided). If every endpoint is in cooldown the loop still tries them in soonest-to-recover order so the confirmation loop is never fully blocked.
- Cross-region landing confirmation via Jito `getBundleStatuses`: alongside the per-region inflight poll, the confirmation loop calls `getBundleStatuses` every `3_000ms` to ask "is this bundle on-chain anywhere?". A `confirmed`/`finalized` response wins regardless of which region answered — this hedges against per-region inflight returning `Invalid` for landed bundles.

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
- `server/solana/jito-bundle.ts`
- `server/solana/jito-client.ts`

