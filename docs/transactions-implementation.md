# Transactions Implementation

## Overview

Transactions track per-wallet buy, sell, and create activity for a token. Each row stores SOL amount, token amount, and a derived price per token.

## tRPC Procedures

- `transaction.listByToken` returns stored transactions for a token with wallet metadata.
- `transaction.refreshByToken` scans recent on-chain signatures for allowed wallets and persists new or updated rows.
- `transaction.liveByToken` streams recent transactions for a token across all wallets using RabbitStream.

## Live Monitoring

- RabbitStream gRPC subscriptions (via centralized `grpc-manager.ts`) include the token mint and bonding curve accounts.
- Live results include owned/foreign wallet labels plus per-item SOL/token amounts.
- Totals include `totalLiquiditySol` and `foreignLiquiditySol` for the current feed window.
- tRPC subscription `subscription.onNewTransaction` pushes new transaction signatures in real-time via SSE. The client uses this to trigger a data refetch instead of polling every 2 seconds.
- When subscriptions are active, polling interval drops to 30s as a fallback; without subscriptions it remains at 2s.

## Price Calculation

- Token deltas come from pre/post token balances for the owner and the token mint.
- SOL deltas come from the wallet system account when present.
- If the wrapped SOL (wSOL) token balance delta is larger than the system account delta, use the wSOL delta instead.
- Price per token is calculated as `solAmount / tokenAmount`.

## Refresh Behavior

- Refresh scans each allowed wallet independently, fetching a limited batch of recent signatures.
- When `SHYFT_API_KEY` is set, uses Shyft Transaction History API (`GET /transaction/history`) instead of `getSignaturesForAddress` for pre-parsed results. Falls back to raw RPC on failure.
- Existing rows with zero SOL or price are queued for backfill by signature.
- Parsed transactions are batched to reduce RPC calls.
- New transactions are inserted and stale rows are updated when recalculated values are available.
- `RefreshCache` is updated on each refresh to support client staleness checks.

## Access Rules

- Allowed wallets are the main wallet, token dev wallet, and token operational wallets.
