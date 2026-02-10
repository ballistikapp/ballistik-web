# Railway Deployment (Nixpacks)

## Overview
- Web app and worker run as two Railway services from the same repo.
- PostgreSQL is a managed Railway service.
- No Redis required.
- No Dockerfile required when using Nixpacks.

## Prerequisites
- Railway account with GitHub integration
- Solana RPC URL
- Access to Vercel Postgres connection strings for data migration

## Services per Environment
Create two Railway projects:
- `sollabs-test`
- `sollabs-prod`

Each project contains:
- `web` service (Next.js)
- `worker` service (polling worker)
- `postgres` service

## Web Service Settings
- Build Command: `npm run build`
- Start Command: `npm run start`
- Deploy Command: `npx prisma migrate deploy`
- Public Networking: enabled

Environment variables:
```
DATABASE_URL=${{Postgres.DATABASE_URL}}
SOLANA_RPC_URL=
NEXT_PUBLIC_APP_URL=https://${{RAILWAY_PUBLIC_DOMAIN}}
APP_URL=https://${{RAILWAY_PUBLIC_DOMAIN}}
VOLUME_BOT_POLL_INTERVAL_MS=5000
```

## Worker Service Settings
- Build Command: `npm run build`
- Start Command: `npm run worker:volume-bot`
- Public Networking: disabled
- Instances: 1

Environment variables:
```
DATABASE_URL=${{Postgres.DATABASE_URL}}
SOLANA_RPC_URL=
VOLUME_BOT_POLL_INTERVAL_MS=5000
```

## Data Migration (Vercel -> Railway)
1. Deploy the Railway test environment first.
2. Run migrations on Railway test (Deploy Command handles this).
3. Export Vercel test data:
   `pg_dump --data-only --no-owner --no-acl "$VERCEL_TEST_URL" > vercel-test.sql`
4. Import to Railway test:
   `psql "$RAILWAY_TEST_URL" < vercel-test.sql`
5. Validate row counts for key tables.
6. Repeat for production during cutover.

## Cutover Checklist
- Pause Vercel deployments
- Final prod export and import to Railway
- Update DNS to Railway domain
- Monitor logs for web and worker
