# Architecture

## Components

- `db`: PostgreSQL 16 with automatic schema initialization from `infra/postgres/init/001_init.sql`.
- `backend`: Express API for bot webhook processing, miniapp access, form submission, and submission history.
- `miniapp`: Single-screen React + Vite application that reads `user_id` and `token` from query params.
- `pgadmin`: pgAdmin 4 for manual database inspection.

## Main Flow

1. MAX bot sends `POST /webhook/max` with `user_id` and user text.
2. Backend checks `employees.max_user_id`.
3. If employee exists and is active, backend returns a miniapp URL with `user_id` and a shared token.
4. Miniapp calls `GET /api/miniapp/access` to validate token and employee access.
5. User fills the form and sends `POST /api/miniapp/submit`.
6. Backend stores a row in `form_submissions` with `status = 'draft'` and returns `message_for_bot`.
7. User sends `подтверждаю` to the bot.
8. Backend finds the latest draft submission for that user, updates it to `confirmed`, and returns a confirmation message.

## Notes

- No Redis, ORM, JWT, or complex auth is used.
- The miniapp access token is a deterministic SHA-256 hash of `user_id` plus `MINIAPP_SHARED_SECRET`.
- `MAX_BOT_TOKEN` is present in config as a placeholder for future outbound bot integrations.
