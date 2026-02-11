# To Implement

## Deployment

- Set up S3 bucket in Railway for image storage

## Launch

- Implement two-step launch flow: Create token first, then launch separately
  - Add "Next Step" button with info text: "Token will be created in sollabs but won't be launched yet"
  - Support recovery and volume bot scheduling workflows
  - Add token statuses: `awaiting_launch`, `launched`, `graduated`, `dumped`
- Fix bundle size: Change from 11 to 10
- Post-launch improvements:
  - Update token selector when "Go to token" is clicked
  - Refresh wallet data after launch completes
  - Redirect to volume bot after completion
- PumpFun banner integration (IDL issue, currently not working)
- Failed & previous launch dialog:
  - Fix dialog UI/UX
  - Remove recovery feature (not working)

## Volume Bot

- Config UI improvements:
  - Show total and per-minute net SOL range for both range-based and session-based configs
  - Remove range-based probability (conflicts with time-based probability)

## Holdings & Transactions

- Display SOL prices in holdings and transactions
- Fix slow holdings refresh performance
- Remove monitoring feature (created under transactions, currently not working)

## Dashboard

- Implement on-demand real-time updates

## Buy & Sell (Exit Flow)

- Increase bundle size for exit transactions
- Fix ATA close (currently not working)
- Improve transaction speed

## Wallets

- Add missing details to wallet pages
- Separate token wallets and user wallets into different pages

## Other Pages

- Manage tokens page
- Account page
- Launches page

## Technical Debt

### Pump IDL Consolidation

- Review `server/solana/pump-idl.ts` and `server/solana/pump-new-idl.ts` and decide whether to keep manual instruction builders or update the IDL/Anchor path so the duplication can be removed.

### Token Launch Extension Points

- Add fee collection and Jito tip handling if needed.
- Document volume bot workflows in `docs/volume-bot-implementation.md`.

### Bundle ALT Expansion

- Add ALT support to expand bundle capacity: build transactions to collect accounts, create the lookup table, wait for propagation, compile v0 messages, then increase per-transaction buys after size validation.

### Logging External Transport

- Add a logger transport that writes JSON log entries to an external source (database or log service).

### Holdings Sell Enhancements

- Add Jito bundle dump flow for bulk holdings sells (tip + bundle confirmation).
