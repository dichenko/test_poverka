# Architecture

## Stack

- Backend: Express + TypeScript + Prisma + Zod
- Miniapp: React + Vite
- DB: PostgreSQL
- Infra: Docker Compose

## Core modules

- Auth: MAX initData validation + JWT access + refresh sessions.
- RBAC: `USER`, `ADMIN` roles.
- Submissions: draft/pending-confirmation -> confirmed/rejected.
- Bot webhook: inbound MAX updates + outbound message adapter.
- Audit: centralized business action logging.
- Storage: provider interface + local provider.

## Security controls

- Strict server-side initData hash verification.
- auth_date TTL check.
- Replay protection via `init_data_replays` table.
- HttpOnly refresh cookie and DB token rotation.
- Rate limiting on sensitive endpoints.
- Helmet + CORS allow-list + centralized error handling.

## Deployment model

- VPS + `git pull` + `docker compose up -d --build`.
- Backend runs DB migrations on startup.
- Miniapp is static bundle served by nginx.