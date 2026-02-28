# Railway Deployment

## Platform

- The app is deployed on Railway
- The Next.js service is connected using Railway's GitHub repository deployment flow

## Environments

- There are two Railway environments: `staging` and `production`
- `staging` deploys from the `staging` branch
- `production` deploys from the `main` branch

## Database

- Each Railway environment has its own PostgreSQL database
- The app uses `DATABASE_URL` provided by that environment at deploy/runtime

## Local Development

- Local development currently uses the staging database connection
- For local runs, set `DATABASE_URL` to the staging PostgreSQL instance
- Be aware this means local writes affect staging data unless a separate local database is configured
