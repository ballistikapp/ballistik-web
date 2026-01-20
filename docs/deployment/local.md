# Local Development (Docker Compose)

## Prerequisites
- Docker + Docker Compose installed
- Solana RPC URL for on-chain calls

## Environment Variables
Create `.env.development` in the repo root:

```
DATABASE_URL=postgresql://sollabs:sollabs@localhost:5432/sollabs
POSTGRES_USER=sollabs
POSTGRES_PASSWORD=sollabs
POSTGRES_DB=sollabs
REDIS_URL=redis://redis:6379
SOLANA_RPC_URL=
NEXT_PUBLIC_APP_URL=http://localhost:3000
ENV_FILE=.env.development
```

## Run Locally (Recommended)
1. Start Postgres + Redis:
   `docker compose --env-file .env.development up -d db redis`
2. Apply existing migrations:
   `npm run db:migrate:deploy`
3. Start Next.js app:
   `npm run dev`
4. Start volume bot worker:
   `npm run worker:volume-bot`
5. Open app:
   `http://localhost:3000`

## Creating New Migrations
When you change Prisma schema locally:
1. Update `prisma/schema.prisma`
2. Run `npm run db:migrate:dev`

## Useful Commands
- `docker compose --env-file .env.development ps`
- `docker compose --env-file .env.development logs -f db`
- `docker compose --env-file .env.development logs -f redis`
- `docker compose --env-file .env.development down`
