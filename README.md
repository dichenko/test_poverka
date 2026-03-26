# Поверка Бот MAX (production-ready baseline)

Репозиторий модернизирован из MVP в production-ready baseline для запуска на VPS.

## Что реализовано

- Backend: `Express + TypeScript + Prisma + Zod`.
- Безопасная auth miniapp через серверную проверку `initData` (`WebAppData` HMAC flow).
- Access token (short-lived) + refresh token rotation (HttpOnly cookie + DB sessions).
- RBAC (`USER` / `ADMIN`) и защищенный admin API.
- MAX webhook модуль (`/webhook/max`) с проверкой `X-Max-Bot-Api-Secret`.
- Новая БД схема: организации, пользователи, заявки, история статусов, аудит, auth sessions, files.
- Miniapp (React/Vite): безопасный handshake, user flow (draft -> confirm), базовый admin UI.
- Storage foundation: адаптер + local provider + static public URLs.
- Docker Compose production profile с healthchecks.

## Структура

- `backend/`
  - `src/modules/auth` — auth handshake/refresh/logout/me
  - `src/modules/bot` — webhook + MAX outbound adapter
  - `src/modules/submissions` — user submissions flow
  - `src/modules/admin` — admin API
  - `src/modules/storage` — storage adapter/foundation
  - `prisma/schema.prisma` — целевая production схема
  - `prisma/migrations/*` — миграции
  - `prisma/seed.ts` — seed
- `miniapp/`
  - `src/pages/App.jsx` — user/admin контуры
  - `src/lib/maxWebApp.js` — bridge/initData bootstrap
  - `src/api/*` — API клиенты
- `docker-compose.yml` — production compose

## Переменные окружения

См. `.env.example`.

Ключевые:
- `DATABASE_URL`
- `JWT_ACCESS_SECRET`
- `MAX_BOT_TOKEN`
- `MAX_WEBHOOK_SECRET`
- `MINIAPP_PUBLIC_URL`
- `BACKEND_PUBLIC_URL`
- `CORS_ORIGINS`

## Локальный запуск (dev)

1. Установить зависимости:

```bash
cd backend && npm install
cd ../miniapp && npm install
```

2. Поднять PostgreSQL:

```bash
docker compose up -d db
```

3. Применить миграции и seed:

```bash
cd backend
npm run prisma:generate
npm run prisma:migrate
npm run prisma:seed
```

4. Запустить backend и miniapp:

```bash
cd backend && npm run dev
cd miniapp && npm run dev
```

## Production запуск на VPS

1. Подготовить `.env`:

```bash
cp .env.example .env
```

2. Заполнить реальные секреты и домены.

3. Запуск:

```bash
docker compose up -d --build
```

4. Проверки:

```bash
curl http://localhost:3000/health/live
curl http://localhost:3000/health/ready
```

## Команды

Backend:
- `npm run dev`
- `npm run build`
- `npm run start`
- `npm run prisma:migrate`
- `npm run prisma:seed`

Miniapp:
- `npm run dev`
- `npm run build`
- `npm run preview`

## MAX miniapp auth flow

1. Miniapp вызывает `window.WebApp.ready()`.
2. Берет `initData` из `window.WebApp.initData`.
3. Отправляет `POST /api/auth/max/handshake`.
4. Backend валидирует подпись (`WebAppData` + `MAX_BOT_TOKEN`) и `auth_date` TTL.
5. Backend проверяет replay и создает auth session.
6. Возвращается `accessToken`, refresh хранится в `HttpOnly` cookie.

## Admin функции (MVP+)

- Просмотр пользователей + фильтры.
- Создание/редактирование/активация пользователей.
- Просмотр заявок + фильтры.
- Просмотр истории статусов заявок.
- Базовый просмотр audit logs.

## Важно

- Старый URL-token доступ miniapp удален.
- Старые SQL init-таблицы (`employees/form_submissions`) больше не используются.
- Для production нужен корректный MAX Bot API endpoint (`MAX_BOT_API_BASE_URL`).

## Next TODO

- Добавить интеграционные тесты webhook/auth/submissions.
- Доработать outbound adapter под точный контракт MAX Bot API в вашем окружении.
- Расширить admin UI (пагинация, сортировки, отчеты, лимиты/баланс).
- Добавить полноценный upload workflow фото поверки (привязка к submission + moderation).