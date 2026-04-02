# Admin Panel

Internal web admin panel for `organizations` and `users`.

## Features

- env-based login/password authentication;
- server-side signed cookie session (default 30 days);
- protected routes;
- CRUD for:
  - `organizations`
  - `users`
- Prisma access to existing PostgreSQL schema.

## Required environment variables

```env
NODE_ENV=production
DATABASE_URL=postgres://maxuser:change_me@db:5432/maxapp
ADMIN_PANEL_PUBLIC_URL=https://admin.poverka-bot.ru
ADMIN_AUTH_LOGIN=admin
ADMIN_AUTH_PASSWORD=change_me_to_strong_password
ADMIN_SESSION_SECRET=change_me_to_long_random_secret
ADMIN_SESSION_DURATION_DAYS=30
```

## Local run

```bash
cd admin-panel
cp .env.example .env
npm install
npm run prisma:generate
npm run dev
```

Open: `http://localhost:3000`

## Build and start

```bash
cd admin-panel
npm run prisma:generate
npm run build
npm run check-env
npm run start
```

## Deploy on VPS with Docker Compose

From project root:

```bash
git pull --ff-only origin main
docker compose up -d --build admin-panel
docker compose ps admin-panel
docker compose logs --tail=200 admin-panel
```

