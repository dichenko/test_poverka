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
- `photo-worker` -> background service (no public port)
- `miniapp` -> `127.0.0.1:8080`

## Important infra decision

`pgadmin` is part of the default stack and starts with normal `docker compose up -d --build`.
This avoids `502` on `pgadmin.poverka-bot.ru` when Caddy route is enabled.

## Environment

Use `.env.example` as template:

```bash
cp .env.example .env
```

Time zone for all services is controlled by:

```bash
APP_TIMEZONE=Europe/Moscow
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
- `docker compose up -d --build db pgadmin backend photo-worker miniapp`

## Logs

```bash
./logs-backend.sh
./logs-miniapp.sh
./logs.sh
docker compose logs -f photo-worker
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

## Photo Worker

`photo-worker` is a dedicated background service for image post-processing.

Flow:

1. Polls DB (`files`) every `PHOTO_WORKER_POLL_INTERVAL_MS` (default `5000`).
2. Takes first unprocessed image (`mime_type` starts with `image/`, `processed_at IS NULL`, `processing_error IS NULL`).
3. Reads original from disk.
4. Processes image with `sharp`:
   - auto-orient (`rotate()`)
   - strip metadata
   - resize long edge to `1800` (no upscale)
   - convert to JPEG quality `50`
5. Saves compressed file to `PHOTO_COMPRESSED_DIR`.
6. Updates file record: `storage_key`, `compressed_path`, `public_url`, `processed_at`.
7. Deletes original file from disk.
8. On error, writes `processing_error` and continues.

Required env vars:

```bash
PHOTO_WORKER_POLL_INTERVAL_MS=5000
PHOTO_ORIGINAL_DIR=/app/storage/photos/original
PHOTO_COMPRESSED_DIR=/app/storage/photos/compressed
PUBLIC_FILES_BASE_URL=https://api.example.com/uploads
```

Public file serving:

- API serves files from `STORAGE_LOCAL_PATH` via:
  - `/static` (legacy)
  - `/uploads` (used by photo-worker public URLs)

Quick check after deploy:

1. Upload photo through bot flow.
2. `docker compose logs -f photo-worker` and wait for `Photo processed successfully`.
3. In DB, check `files.processed_at`, `files.compressed_path`, `files.public_url`, `files.processing_error`.
