# Holdings Implementation

## Overview

Holdings show per-wallet token balances, aggregated buy/sell totals, and last activity for a selected token. The holdings page supports refresh and bulk sell actions.

## tRPC Procedures

- `holding.listByToken` fetches holdings for a token (optionally filtered by wallet).
- `holding.refreshByToken` refreshes holdings via RPC balance scans.
- `holding.sellByToken` submits sell transactions for selected wallets at a percentage of on-chain token balances.

## Access Rules

- Token ownership is verified on every holdings read and mutation.
- Allowed wallets are the main wallet, token dev wallet, and token operational wallets.
- Sell actions only execute for allowed wallets with private keys.

## Sell Flow

1. User selects holdings rows and opens the Sell dialog.
2. Client sends `holding.sellByToken` with token public key, wallet public keys, and sell percentage.
3. Service fetches on-chain token balances, computes sell amounts, and submits RPC sell transactions per wallet.
4. Client refreshes holdings after mutations complete.

## UI Behavior

- Bulk sell action operates on selected holdings rows.
- Manual refresh is available; auto refresh uses `RefreshCache` staleness.