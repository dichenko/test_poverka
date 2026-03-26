# Poverka Bot MAX

Production-ready baseline for MAX bot + miniapp + PostgreSQL.

## Stack

- Backend: Express + TypeScript + Prisma + Zod
- Miniapp: React + Vite (built static + nginx)
- DB: PostgreSQL 16
- Infra: Docker Compose

## Services

- `db` -> `127.0.0.1:5432`
- `pgadmin` -> `127.0.0.1:5050`
- `backend` -> `127.0.0.1:3000`
- `miniapp` -> `127.0.0.1:8080`

## Important infra decision

`pgadmin` is part of the default stack and starts with normal `docker compose up -d --build`.
This avoids `502` on `pgadmin.poverka-bot.ru` when Caddy route is enabled.

## Environment

Use `.env.example` as template:

```bash
cp .env.example .env
```

## Local/Server start

```bash
docker compose up -d --build
```

## Health checks

```bash
curl http://127.0.0.1:3000/health/live
curl http://127.0.0.1:3000/health/ready
curl http://127.0.0.1:8080/health
```

## Deploy

Use `deploy.sh`:

```bash
./deploy.sh
```

It runs:

- `git pull`
- `docker compose up -d --build db pgadmin backend miniapp`

## Logs

```bash
./logs-backend.sh
./logs-miniapp.sh
./logs.sh
```

## Prisma commands

```bash
cd backend
npm run prisma:generate
npm run prisma:migrate
npm run prisma:seed
```

## Note

Old MVP URL token auth is removed. Miniapp auth is based on MAX `initData` server-side verification.
