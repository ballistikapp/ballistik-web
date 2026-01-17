# Wallets Implementation (Token-Scoped)

## Overview

Wallets are token-scoped for operational usage, while the main wallet is user-scoped. The wallets page and wallet detail pages separate operational wallets (bundler/volume/distribution) from the main and dev wallets, with different fetch paths and behavior.

## Data Model

- `Wallet.tokenPublicKey` is used for operational wallets (bundler/volume/distribution).
- Dev wallets are shared across tokens via `TokenDevWallet` join model.
- Main wallet is user-scoped via `User.mainWallet`.

Prisma changes:
- `Wallet.tokenPublicKey` (nullable)
- `Token.operationalWallets` (relation to `Wallet`)
- `TokenDevWallet` join model for dev wallet sharing

## Queries and Services

tRPC procedures:
- `wallet.getOperationalByToken` fetches operational wallets by `tokenPublicKey`.
- `wallet.getDevByToken` fetches dev wallet for a token via `TokenDevWallet`.
- `wallet.getMain` fetches the user main wallet.
- `wallet.getByPublicKey` fetches a single wallet with token ownership checks.
- `wallet.refreshBalances` refreshes balances via server-side RPC with a 15s debounce.
- `wallet.sendSol` sends SOL from main wallet to selected token wallets.
- `wallet.returnSol` returns SOL from selected token wallets to main wallet.

Service rules:
- Operational wallets must match `Wallet.tokenPublicKey`.
- Dev wallet access is validated through `TokenDevWallet`.
- Main wallet is always user-scoped via `User.mainWallet`.

## Access Rules

- Token ownership is verified on all wallet reads and mutations
- Main wallet access is validated via `User.mainWallet`
- Dev wallet access is validated via `TokenDevWallet`
- Operational wallets must match the requested `tokenPublicKey`

## RPC Usage

- All Solana RPC calls are server-side only
- RPC URL and credentials are never exposed to the client
- Balance refresh is initiated from the UI but executed on the server

## Data Fetch Patterns

- Main wallet: `wallet.getMain`
- Dev wallet: `wallet.getDevByToken`
- Operational wallets: `wallet.getOperationalByToken`

## UI Behavior

Wallets list page:
- Main and dev wallets are shown as cards at the top.
- Operational wallets are listed in the table.
- Refresh buttons are disabled if `balanceRefreshedAt` is within 15 seconds.
- Bulk actions: refresh all, send, return.

Wallet detail page:
- Main wallet shows a user-style page.
- Non-main wallets allow send/return actions.

## Balance Strategy

- DB stores `balanceSol`, `tokenBalance`, `balanceRefreshedAt`.
- Refresh is on-demand only; no background auto-refresh.
- Server enforces a 15-second debounce per wallet.

## Migrations

Use `prisma migrate dev` to generate migrations after schema changes. Do not create migration files manually.
