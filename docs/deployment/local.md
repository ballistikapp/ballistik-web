# Local Development

## Prerequisites
- Solana RPC URL for on-chain calls

## Environment Variables
Create `.env.development` in the repo root.

### Option A: Local Postgres (Docker)
```
DATABASE_URL=postgresql://sollabs:sollabs@localhost:5432/sollabs
POSTGRES_USER=sollabs
POSTGRES_PASSWORD=sollabs
POSTGRES_DB=sollabs
SOLANA_RPC_URL=
NEXT_PUBLIC_APP_URL=http://localhost:3000
APP_URL=http://localhost:3000
ENV_FILE=.env.development
```

### Option B: Railway Test Database (Remote)
```
DATABASE_URL=<railway_test_database_url>
SOLANA_RPC_URL=
NEXT_PUBLIC_APP_URL=http://localhost:3000
APP_URL=http://localhost:3000
ENV_FILE=.env.development
```

## Run Locally (Recommended)
### Using Local Postgres
1. Ensure a local Postgres instance is running.
2. Apply existing migrations:
   `npm run db:migrate:deploy`
3. Start Next.js app:
   `npm run dev`
4. Start volume bot worker:
   `npm run worker:volume-bot`
5. Open app:
   `http://localhost:3000`

### Using Railway Test Database (Remote)
1. Ensure `DATABASE_URL` points to Railway test.
2. Do not run `db:migrate:dev` locally against Railway.
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

## Useful Commands (Local Postgres Only)
- `psql "$DATABASE_URL"`
