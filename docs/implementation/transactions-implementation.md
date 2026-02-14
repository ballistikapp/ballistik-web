# Transactions Implementation

## Overview

Transactions are split into two storage layers:

- `TokenTransaction` stores token-wide activity and is the source for the `/[tokenPublicKey]/transactions` page.
- `Transaction` (legacy/current table) remains for wallet-scoped pages and workflows.

Rows are stored per action (wallet + signature + action type), with SOL amount, token amount, and derived price per token.

## tRPC Procedures

- `transaction.listByToken` returns a pumpfun-like list view: rows are grouped by signature into a single display row, excluding bonding-curve side when present and preferring owned wallet identity when available.
- `transaction.refreshByToken` fetches token-related signatures and persists unseen or stale action rows.

## Price Calculation

- Token deltas come from pre/post token balances for the owner and the token mint.
- SOL deltas come from the wallet system account when present.
- If the wrapped SOL (wSOL) token balance delta is larger than the system account delta, use the wSOL delta instead.
- Price per token is calculated as `solAmount / tokenAmount`.

## Refresh Behavior

The `refreshByToken` service is optimized for speed and incremental updates:

1. Signature discovery uses token-related sources (Shyft callbacks/history and token-linked accounts such as mint + bonding curve).
2. Existing latest rows are loaded first; refresh fetches newest signatures first and stops once already-known signatures dominate the window.
3. Parsed transaction fetching uses batched RPC parsing, then converts each signature into one or more per-owner action rows.
4. Writes are idempotent with unique dedupe keys, so overlap/retries are safe.
5. `RefreshCache` is touched after refresh so the UI can decide staleness and trigger background refetch.

### Database Indexes

`TokenTransaction` uses indexes for token-wide list and dedupe:

- list/read index on `tokenPublicKey + createdAt`.
- unique dedupe on `tokenPublicKey + transactionSignature + walletPublicKey + transactionType`.

`Transaction` indexes remain unchanged for wallet-scoped workflows.

## Access Rules

- Token-wide list includes owned and external wallets.
- Owned rows are marked using wallet metadata when a matching local wallet exists.
