## Bundle Launch Implementation

This document describes the current Jito bundle launch flow used by `sollabs-web` and how it can be extended with Address Lookup Tables (ALT) in the future.

### Current Behavior (ALT Disabled)

### Trigger Conditions
- Bundle launch is used when `bundleBuyEnabled` is true.
- Buyers include the dev wallet if `devBuyAmountSol > 0`, plus all bundler wallets.
- Maximum buyer wallets per launch: 11.

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
- Subsequent transactions include up to 3 buys each.
- The last transaction may also include the Jito tip transfer.
 - Each bundle transaction adds a compute budget instruction for consistency.

Transaction packing layout (max buyers):

1. Create + 1 buy
2. 3 buys
3. 3 buys
4. 3 buys
5. 1 buy (+ tip if enabled)

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
- Bundle confirmation timeout: `120_000ms` (`server/solana/jito-bundle.ts`).
- Resend interval before blockhash expiry: `5_000ms` when signatures are still not found.
- Blockhash max age before rebuild: `55_000ms`.
- Maximum blockhash rebuilds: `2`.
- Launch bundle execution is Jito-only with bounded retries (no fallback execution path).

### Diagnostics Logging
- Bundle send and confirmation telemetry is persisted to `LaunchLog` so operators can inspect delivery behavior in launch activity, including:
  - endpoint
  - bundle id
  - create signature
  - resend/rebuild counters
  - blockhash age
  - confirmation summary (`found/confirmed/failed/not_found`)
  - normalized error/rejection messages

### Key Files
- `server/solana/bundle-create-and-buy.ts`
- `server/solana/bundle-transaction-builder.ts`
- `server/solana/pump-transaction-builders.ts`
- `server/solana/jito-bundle.ts`
- `server/solana/jito-client.ts`

