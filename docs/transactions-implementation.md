# Transactions Implementation

## Overview

Transactions track per-wallet buy, sell, and create activity for a token. Each row stores SOL amount, token amount, and a derived price per token.

## tRPC Procedures

- `transaction.listByToken` returns stored transactions for a token with wallet metadata.
- `transaction.refreshByToken` scans recent on-chain signatures for allowed wallets and persists new or updated rows.
- `transaction.liveByToken` streams recent transactions for a token across all wallets using RabbitStream.

## Live Monitoring

- RabbitStream gRPC subscriptions include the token mint and bonding curve accounts.
- Live results include owned/foreign wallet labels plus per-item SOL/token amounts.
- Totals include `totalLiquiditySol` and `foreignLiquiditySol` for the current feed window.

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
- `RefreshCache` is updated on each refresh to support client staleness checks.

## Access Rules

- Allowed wallets are the main wallet, token dev wallet, and token operational wallets.
