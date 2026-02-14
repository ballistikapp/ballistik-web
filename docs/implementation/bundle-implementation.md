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
- Each bundler buy uses random variance:
  - `amount = bundlerBuyAmountSol ± (bundlerBuyAmountSol * bundlerBuyVariancePercent / 100)`
- Buys with non-positive amounts are skipped.

### Jito Tip
- If `jitoTipAmountSol > 0`, a SOL transfer is appended to the last transaction.
- Tipper is the main wallet; the tip is sent to a Jito tip account.

### Key Files
- `server/solana/bundle-create-and-buy.ts`
- `server/solana/bundle-transaction-builder.ts`
- `server/solana/pump-transaction-builders.ts`
- `server/solana/jito-bundle.ts`
- `server/solana/jito-client.ts`

