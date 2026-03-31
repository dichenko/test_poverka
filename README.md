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
- `payment-worker` -> background service (no public port)
- `report-worker` -> background service + internal HTTP `127.0.0.1:3010`
- `mail-worker` -> background SMTP delivery service (no public port)
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
- `docker compose up -d --build db pgadmin backend photo-worker payment-worker report-worker mail-worker miniapp`

## Logs

```bash
./logs-backend.sh
./logs-miniapp.sh
./logs.sh
docker compose logs -f photo-worker
docker compose logs -f payment-worker
docker compose logs -f report-worker
docker compose logs -f mail-worker
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

## Report Worker (Excel reports)

`report-worker` is a dedicated service for scheduled Excel generation.

Implemented now:

- Report registry with sequential execution: `arshin` -> `balance_arshin`
- Daily cron run via `REPORTS_CRON` (default `5 22 * * *`)
- Timezone-aware logic via `REPORTS_TZ` (default `Europe/Moscow`)
- PostgreSQL advisory lock + in-memory guard against parallel runs
- Metadata tracking in DB table `generated_reports`
- Daily run marker in DB table `report_runs`
- Automatic enqueue of mail delivery run (`mail_runs`) only after full successful daily generation
- File storage per report code directory
- Public report links without authorization
- Manual run both via CLI and internal HTTP endpoint

### Required env vars

```bash
REPORTS_STORAGE_DIR=/app/storage/reports
REPORTS_PUBLIC_BASE_URL=https://api.example.com/uploads/reports
REPORTS_CRON=5 22 * * *
REPORTS_TZ=Europe/Moscow
REPORTS_HTTP_PORT=3010
REPORTS_LOCK_ID=7342052205
INTERNAL_API_TOKEN=replace_me_internal_token
```

If `REPORTS_PUBLIC_BASE_URL` is empty, report-worker builds it from `PUBLIC_FILES_BASE_URL` as:
`<PUBLIC_FILES_BASE_URL>/reports` (same approach as photo URLs).

`backend` serves generated files from:

- `/public/reports` -> `REPORTS_STORAGE_DIR`

Example output path:

- `/app/storage/reports/arshin/Arshin_2026-03-30.xlsx`
- `/app/storage/reports/balance_arshin/Balance_Arshin_2026-03-30.xlsx`

Example public URL:

- `https://api.example.com/uploads/reports/arshin/Arshin_2026-03-30.xlsx`
- `https://api.example.com/uploads/reports/balance_arshin/Balance_Arshin_2026-03-30.xlsx`

### Manual run (CLI)

```bash
docker exec poverka-bot-max-report-worker \
  node dist/report-worker.js generate-report arshin 2026-03-30

docker exec poverka-bot-max-report-worker \
  node dist/report-worker.js generate-report balance_arshin 2026-03-30

# local backend folder
npm run reports:generate -- --report=balance_arshin --date=2026-03-30
```

### Manual run (HTTP)

```bash
curl -X POST "http://127.0.0.1:3010/internal/reports/run" \
  -H "Content-Type: application/json" \
  -H "X-Internal-Token: <INTERNAL_API_TOKEN>" \
  -d '{"reportCode":"arshin","date":"2026-03-30"}'

curl -X POST "http://127.0.0.1:3010/internal/reports/run" \
  -H "Content-Type: application/json" \
  -H "X-Internal-Token: <INTERNAL_API_TOKEN>" \
  -d '{"reportCode":"balance_arshin","date":"2026-03-30"}'
```

If `date` is omitted, report-worker uses current date in `REPORTS_TZ`.

### What `arshin` report does

- File name: `Arshin_YYYY-MM-DD.xlsx`
- Worksheet name: `Arshin`
- One row = one `meter_submissions` package
- Time window by `confirmed_at` (timezone `REPORTS_TZ`):
  - from `00:01:00`
  - to `21:59:59`
- Sort: `confirmed_at ASC`, then `meter_submissions.id ASC`
- Photos are aggregated into one cell (`string_agg(..., E'\n')`) to avoid duplicate rows.
- For one `report_code + date`, only one file/record is stored: repeated run rewrites the same file and updates metadata in `generated_reports`.

### What `balance_arshin` report does

- File name: `Balance_Arshin_YYYY-MM-DD.xlsx`
- Worksheet name: `Balance_Arshin`
- One row = one organization (`organizations`)
- Date window for day metrics in `REPORTS_TZ`: `00:00:00` - `23:59:59.999`
- Columns:
  - `Наименование организации`
  - `Сумма на начало дня`
  - `Сумма на конец дня`
  - `Количество пакетов`
  - `Цена за пакет`
  - `Поступление за день`
  - `Количество пакетов передано`
- `Поступление за день` is aggregated from successful YooKassa payments (`organization_topups`) by `paid_at`.
- `Количество пакетов передано` is aggregated from confirmed `meter_submissions` by `confirmed_at` and `organization_id`.

## Mail Worker (SMTP report delivery)

`mail-worker` is a dedicated service for email delivery of already generated report files.

Flow:

1. `report-worker` finishes full daily run successfully.
2. `report-worker` stores/updates marker in `report_runs`.
3. `report-worker` enqueues mail run in `mail_runs` (`trigger=auto-after-report`).
4. `mail-worker` picks queued run, classifies file names by strict patterns, resolves recipients, sends emails, stores statuses in `report_email_deliveries`.

Routing rules:

- Admin reports by file pattern:
  - `Arshin_YYYY-MM-DD.xlsx`
  - `Balance_Arshin_YYYY-MM-DD.xlsx`
  - Sent to all emails from `REPORT_ADMIN_EMAILS`.
- Organization reports by file pattern:
  - `Otchet_metrolog_{org_id}_{DD-MM-YYYY}.xlsx`
  - Sent to organization email from `organizations.org_email` by `org_id`.

Idempotency:

- Unique delivery scope key: `report_date + report_type + file_name + recipient_key`.
- Re-run without `force`: already `sent` deliveries are skipped.
- `force=true`: allows resend; each attempt is additionally logged in `report_email_delivery_attempts`.

Retry policy:

- Controlled by `MAIL_MAX_ATTEMPTS` and `MAIL_RETRY_DELAY_MS`.
- Failed recipient/email resolution does not stop whole run.
- SMTP errors are stored per-delivery and other deliveries continue.

Required env vars:

```bash
SMTP_HOST=smtp.timeweb.ru
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=...
SMTP_PASSWORD=...
SMTP_FROM=reports@example.com
REPORT_ADMIN_EMAILS=admin1@example.com,admin2@example.com
MAIL_MAX_ATTEMPTS=3
MAIL_RETRY_DELAY_MS=5000
MAIL_WORKER_POLL_INTERVAL_MS=5000
REPORTS_BASE_DIR=/app/storage/reports
MAIL_API_TOKEN=replace_me_mail_api_token
```

Manual API (token protected):

```bash
# Run full mail delivery for date
curl -X POST "http://127.0.0.1:3000/api/reports/mail/run" \
  -H "Content-Type: application/json" \
  -H "X-Mail-Api-Token: <MAIL_API_TOKEN>" \
  -d '{"date":"2026-03-31","force":false}'

# Send one report by file name (all recipients for this file)
curl -X POST "http://127.0.0.1:3000/api/reports/mail/send-one" \
  -H "Content-Type: application/json" \
  -H "X-Mail-Api-Token: <MAIL_API_TOKEN>" \
  -d '{"date":"2026-03-31","fileName":"Arshin_2026-03-31.xlsx","force":true}'

# Status by date
curl "http://127.0.0.1:3000/api/reports/mail/status?date=2026-03-31" \
  -H "X-Mail-Api-Token: <MAIL_API_TOKEN>"
```

## YooKassa Topups

Implemented flow:

- User presses `Пополнить баланс` in profile message.
- Bot asks for package count and creates YooKassa payment (`POST /payments`) with `confirmation_url` and TTL 3 minutes.
- Webhook (`POST /api/payments/yookassa/webhook`) is the primary payment truth source.
- `payment-worker` reconciles pending topups as fallback.
- While active topup exists (`awaiting_payment`), submission flow is blocked on both bot and backend API levels (`ACTIVE_TOPUP_PENDING`).

### Required env vars

```bash
YOOKASSA_API_BASE_URL=https://api.yookassa.ru/v3
YOOKASSA_SHOP_ID=...
YOOKASSA_SECRET_KEY=...
YOOKASSA_CURRENCY=RUB
YOOKASSA_RETURN_URL=https://<miniapp-or-landing>/payment-return
YOOKASSA_WEBHOOK_URL=https://<backend-domain>/api/payments/yookassa/webhook
YOOKASSA_HTTP_TIMEOUT_MS=10000
YOOKASSA_WEBHOOK_ALLOWED_IPS=185.71.76.0/27,185.71.77.0/27,77.75.153.0/25,77.75.156.11,77.75.156.35,77.75.154.128/25,2a02:5180::/32

PAYMENT_MIN_PACKAGES_PER_TOPUP=1
PAYMENT_MAX_PACKAGES_PER_TOPUP=1000
TOPUP_LINK_TTL_SECONDS=180
PAYMENT_POLL_INTERVAL_SECONDS=10
PAYMENT_POLL_BATCH_SIZE=50
PAYMENT_POLL_BACKOFF_BASE_SECONDS=5
PAYMENT_POLL_BACKOFF_MAX_SECONDS=120
```

### Webhook setup in YooKassa

In YooKassa dashboard configure webhook URL:

```text
https://<your-backend-domain>/api/payments/yookassa/webhook
```

Subscribe to events:

- `payment.succeeded`
- `payment.canceled`

### DB migration

Run Prisma migration before enabling topups:

```bash
cd backend
npm run prisma:migrate
npm run prisma:generate
```
