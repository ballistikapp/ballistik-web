#!/bin/bash
set -euo pipefail

git pull

ENV_FILE=${ENV_FILE:-.env.production}

docker compose --env-file $ENV_FILE -f docker-compose.yml -f docker-compose.prod.yml build
docker compose --env-file $ENV_FILE -f docker-compose.yml -f docker-compose.prod.yml run --rm web npm run db:migrate:deploy
docker compose --env-file $ENV_FILE -f docker-compose.yml -f docker-compose.prod.yml up -d

docker image prune -f
