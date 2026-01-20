# To Implement

## Pump IDL Consolidation
- Review `server/solana/pump-idl.ts` and `server/solana/pump-new-idl.ts` and decide whether to keep manual instruction builders or update the IDL/Anchor path so the duplication can be removed.

## Token Launch Extension Points
- Add distribution transfer logic to move tokens into distribution wallets.
- Add fee collection and Jito tip handling if needed.
- Document volume bot workflows in `docs/volume-bot-implementation.md`.

## Bundle ALT Expansion
- Add ALT support to expand bundle capacity: build transactions to collect accounts, create the lookup table, wait for propagation, compile v0 messages, then increase per-transaction buys after size validation.

## Logging External Transport
- Add a logger transport that writes JSON log entries to an external source (database or log service).

## Launch Confirmation Streaming
- Use Shyft gRPC confirmation with RPC polling fallback for bundle transactions.

## Wallet Balance Refresh
- Use indexed token-account scans (non-ATA) with ATA fallback and batched SOL refreshes.

## Holdings Sell Enhancements
- Add Jito bundle dump flow for bulk holdings sells (tip + bundle confirmation).
