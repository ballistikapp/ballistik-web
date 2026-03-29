# To Implement

- fee'ler ve paid feature'lar belirlenecek

---

## Deployment

## Launch

- Implement two-step launch flow: Create token first, then launch separately
  - Add "Next Step" button with info text: "Token will be created in sollabs but won't be launched yet"
  - Support recovery and volume bot scheduling workflows
  - Add token statuses: `awaiting_launch`, `launched`, `graduated`, `dumped`
- Fix bundle size: Change from 11 to 10
- Post-launch improvements:
  - Redirect to volume bot after completion
- PumpFun banner integration (IDL issue, currently not working)
- Failed & previous launch dialog:
  - Fix dialog UI/UX
  - Remove recovery feature (not working)

## Volume Bot

- Restart stopped/failed sessions (see `docs/backlog/volume-bot-restart.md`)
- Config UI improvements:
  - Show total and per-minute net SOL range for both range-based and session-based configs
  - Remove range-based probability (conflicts with time-based probability)

## Holdings & Transactions

- Display SOL prices in holdings and transactions
- Fix slow holdings refresh performance
- Remove monitoring feature (created under transactions, currently not working)

## Dashboard

- ~~Implement on-demand real-time updates~~ (Done: Monitoring Mode with SSE + polling, see `docs/implementation/dashboard-monitoring.md`)
- ~~Fix wrong data: P&L, volumes, market cap, graduated token pricing~~ (Done: Full rework — switched to TokenTransaction, fixed holdings filtering, circulating supply market cap, DeFi pool price for graduated tokens)
- ~~Fix price chart 1m candle interval~~ (Done: Server now sends 1-minute candles, client re-aggregates)
- ~~SSE error handling~~ (Done: Monitoring panel shows disconnected state)
- Future: Incremental SSE updates instead of full refetch on every event
- Future: Error boundaries for partial dashboard failure (individual section fallback)

## Buy & Sell (Exit Flow)

- Increase bundle size for exit transactions
- Fix ATA close (currently not working)
- Improve transaction speed

## Wallets

- Add missing details to wallet pages
- Separate token wallets and user wallets into different pages

## Other Pages

- Manage tokens page
- ~~Account page~~ (Done: `/account` with account info, main wallet, send SOL dialog — see `docs/implementation/wallets-implementation.md`)
- Launches page

## Technical Debt

### Pump IDL Consolidation

- Review `server/solana/pump-idl.ts` and `server/solana/pump-new-idl.ts` and decide whether to keep manual instruction builders or update the IDL/Anchor path so the duplication can be removed.

### Token Launch Extension Points

- Add fee collection and Jito tip handling if needed.
- Document volume bot workflows in `docs/implementation/volume-bot-implementation.md`.

### Bundle ALT Expansion

- Add ALT support to expand bundle capacity: build transactions to collect accounts, create the lookup table, wait for propagation, compile v0 messages, then increase per-transaction buys after size validation.

### Logging External Transport

- Add a logger transport that writes JSON log entries to an external source (database or log service).

### Holdings Sell Enhancements

- Add Jito bundle dump flow for bulk holdings sells (tip + bundle confirmation).
