# 05 — Wallet balance refresh

**What to build:** Operators can refresh stored Wallet SOL balances from Ops: on Wallet detail (single), on the Wallets table for selected rows, and via a separate “refresh matches” action for the current search/filter result (including empty filter = all Wallets). Filter-wide refresh uses its own button and a warning confirmation dialog that shows the exact Wallet count. Execution is chunked. This is an allowed Ops side-effect (updates stored balances), not a business mutation like cancel/edit plan. Authz and scope stay behind the ops service seam; reuse existing wallet balance-fetch/persist logic rather than reimplementing RPC.

**Blocked by:** 03 — Browse Tokens & Wallets + detail pages

**Status:** done

- [x] Wallet detail has an explicit single-Wallet balance refresh that updates stored balance + refreshed-at
- [x] Wallets table supports selected-row refresh with a sane selection cap
- [x] Separate “refresh matches” action refreshes all Wallets in the current filter/search result
- [x] Empty filter is allowed (all Wallets); confirm dialog shows the exact count before running
- [x] Filter-wide refresh is chunked and does not require a hard max refuse (dialog + chunking is the safety)
- [x] Non-Operator cannot refresh (not-found)
- [x] Refresh does not return or expose private keys
