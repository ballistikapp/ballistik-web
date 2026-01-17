## Bundle Launch Implementation

This document describes the current Jito bundle launch flow used by `sollabs-web` and how it can be extended with Address Lookup Tables (ALT) in the future.

### Current Behavior (ALT Disabled)

- Launch uses Jito bundles for create + dev buy + bundle buys when `bundleBuyEnabled` is true.
- The create transaction and the first buy are packed into the same transaction.
- Additional buys are packed 3 per transaction.
- The last transaction includes one buy plus the Jito tip transfer.
- Maximum buyer wallets per launch: 11 (matching v0 working behavior).
- Tipper is the main wallet, and the tip is sent to a Jito tip account.

Transaction packing layout:

1. Create + 1 buy
2. 3 buys
3. 3 buys
4. 3 buys
5. 1 buy + tip

### How ALT Would Extend Capacity

ALT reduces transaction size by moving account addresses into a lookup table and referencing them by index. This does not reduce the number of instructions, but it allows more accounts and instructions to fit within the transaction size limit.

If ALT is enabled later:

- Build all transactions first to collect the full account set.
- Create a lookup table containing all required addresses.
- Wait for ALT propagation on the network.
- Compile each bundle transaction to v0 messages using the ALT.
- Increase the per-transaction buy packing once size tests confirm it fits.

The existing packing strategy can stay as a baseline, and ALT can be introduced to safely increase the number of buyers per bundle without changing the Jito bundle size limit of 5 transactions.
