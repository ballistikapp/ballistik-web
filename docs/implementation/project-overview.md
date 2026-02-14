# Project Overview

## Purpose

sollabs-web is the modern successor to sollabv0. It reimplements core launch, wallet, and token workflows with clearer architecture, stronger type safety, and improved error handling.

## Core Features

- Token launch workflow with progress tracking
- Token-scoped wallets and operational wallet management
- Solana RPC integrations for balance refresh and transactions
- Transaction tracking and token holdings
- Holdings and transactions refresh flows mirror wallet balance refresh behavior
- Real-time streaming via Shyft gRPC (RabbitStream / Yellowstone) with tRPC subscriptions
- Dashboard trade updates via `subscription.onVolumeBotUpdate` (in-memory EventEmitter bridge)
- Shyft REST APIs for enriched wallet, token, and transaction data
- Shyft Callback webhooks for passive event monitoring

## Architecture

- Next.js App Router for pages and layouts
- tRPC for API layer (HTTP batch + SSE subscriptions)
- Prisma + PostgreSQL for data layer
- Service layer for business logic
- Zod schemas for validation
- React Query for client data caching (5 min default staleTime)
- Shyft gRPC manager for real-time on-chain streaming
- Shyft REST/DeFi/Callback APIs for enriched data

## Directory Structure

```
app/
  (app)/
  api/
    trpc/          # tRPC HTTP + SSE handler
    webhooks/      # Shyft callback webhook endpoint
components/
  dashboard/
  ui/
  wallets/
docs/
lib/
  config/          # env, rpc, cache, launch configs
  solana/          # Solana connection singleton
  trpc/            # tRPC client + provider with splitLink
  utils/
prisma/
server/
  events/
  schemas/
  services/        # Business logic + Shyft API/callback/DeFi services
  solana/          # gRPC manager, gRPC utils, pump quotes, volume bot gRPC
  trpc/
    routers/       # Feature routers + subscription router
```

## Conventions

- Business logic lives in `server/services`
- Routers are thin, validating input and calling services
- Schemas are centralized in `server/schemas`
- UI components fetch via tRPC hooks
- Use absolute imports with `@/`
- Use Prisma migrations for schema changes

## Environment Variables

- `DATABASE_URL` — Prisma connection string
- `SOLANA_RPC_URL` — required, Solana RPC endpoint
- `SHYFT_API_KEY` — optional, enables Shyft gRPC streaming and REST APIs
- `SHYFT_CALLBACK_SECRET` — optional, validates incoming Shyft webhook requests
- `APP_URL` — optional, base URL for Shyft callback webhook registration (e.g. `https://app.example.com`)
- `NEXT_PUBLIC_*` as needed for client-only configuration

## Deployment and Build

- Run `prisma generate` after schema changes
- Use `prisma migrate dev` to generate migrations locally
- Run `npm run lint` before deploys
- Run `next build` for production builds

## Auth Model

- Users are identified by the main wallet (`User.mainWallet`)
- Main wallet is user-scoped and used for authorization
- Token operational wallets are token-scoped and tied to a single token
- Auth proxy is optimistic (checks token presence only, not validity)
- Protected layouts (`(app)/layout.tsx`, `page.tsx`) perform server-side user
  lookup and redirect to `/auth` when unauthenticated
- `/auth` layout redirects to `/` when a valid user is present
- Auth cookies use `secure` only for non-local hosts (including private IPs)

## Docs Discipline

Always consult and update `docs/` when making changes or adding features, except for small insignificant development. These docs are the reference point for future agents to keep the project consistent and bug-free.
