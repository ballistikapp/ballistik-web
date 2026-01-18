# To Implement

## Pump IDL Consolidation
- Review `server/solana/pump-idl.ts` and `server/solana/pump-new-idl.ts` and decide whether to keep manual instruction builders or update the IDL/Anchor path so the duplication can be removed.

## Token Launch Extension Points
- Add distribution transfer logic to move tokens into distribution wallets.
- Add fee collection and Jito tip handling if needed.
- Reuse `Launch` and `LaunchLog` for volume-bot workflows.

## Bundle ALT Expansion
- Add ALT support to expand bundle capacity: build transactions to collect accounts, create the lookup table, wait for propagation, compile v0 messages, then increase per-transaction buys after size validation.

## Logging External Transport
- Add a logger transport that writes JSON log entries to an external source (database or log service).

## Wallet Balance Refresh
- Revert the temporary ATA-only balance refresh once index RPC methods are available, so non-ATA token accounts are included again.
