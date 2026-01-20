# VPS Deployment (Ubuntu + Docker Compose)

## Services
- Next.js web container
- Volume bot worker container
- Redis
- Postgres

## Required Infrastructure
- Ubuntu VPS with Docker and Docker Compose installed
- SSH access from GitHub Actions
- DNS optional (HTTP-only in current plan)

## Environment Variables
Create `.env.production` on the VPS with:

```
DATABASE_URL=postgresql://sollabs:sollabs@db:5432/sollabs
POSTGRES_USER=sollabs
POSTGRES_PASSWORD=sollabs
POSTGRES_DB=sollabs
REDIS_URL=redis://redis:6379
SOLANA_RPC_URL=
NEXT_PUBLIC_APP_URL=http://your-vps-ip:3000
ENV_FILE=.env.production
```

## First-Time Setup
1. Clone repo to the VPS
2. Create `.env.production` in repo root
3. Run `chmod +x scripts/deploy.sh`
4. Run `./scripts/deploy.sh`

## GitHub Actions Deployment
Required GitHub secrets:
- `VPS_HOST`
- `VPS_USER`
- `VPS_SSH_KEY`
- `VPS_APP_PATH`

On push to `main`, Actions will SSH and run `scripts/deploy.sh`.

## Migrations
- Production migrations are applied by `scripts/deploy.sh` via `npm run db:migrate:deploy`.
- Do not use `db:migrate:dev` on the VPS.

## Operational Commands
- `docker compose ps`
- `docker compose logs -f web`
- `docker compose logs -f worker`
- `docker compose down`

## Backups
- Snapshot the Postgres volume regularly
- Store DB credentials in a secure secrets manager
