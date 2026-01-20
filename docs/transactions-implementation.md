# Transactions Implementation

## Overview

Transactions track per-wallet buy, sell, and create activity for a token. Each row stores SOL amount, token amount, and a derived price per token.

## tRPC Procedures

- `transaction.listByToken` returns stored transactions for a token with wallet metadata.
- `transaction.refreshByToken` scans recent on-chain signatures for allowed wallets and persists new or updated rows.

## Price Calculation

- Token deltas come from pre/post token balances for the owner and the token mint.
- SOL deltas come from the wallet system account when present.
- If the wrapped SOL (wSOL) token balance delta is larger than the system account delta, use the wSOL delta instead.
- Price per token is calculated as `solAmount / tokenAmount`.

## Refresh Behavior

- Refresh scans each allowed wallet independently, fetching a limited batch of recent signatures.
- Existing rows with zero SOL or price are queued for backfill by signature.
- Parsed transactions are batched to reduce RPC calls.
- New transactions are inserted and stale rows are updated when recalculated values are available.
- `RefreshCache` is updated on each refresh to drive UI staleness checks and the header timestamp.
- Auto refresh waits for `RefreshCache` to load and runs only when stale.
- Manual refresh is always available (disabled only while a request is in flight) and shows toast feedback.
- Header timestamp mapping: 0-15s just refreshed, 15-90s minute ago, <5m couple minutes, <1h N minutes, <3h hour/couple hours, 3-12h N hours, 12h+ full datetime.

## Access Rules

- Allowed wallets are the main wallet, token dev wallet, and token operational wallets.
