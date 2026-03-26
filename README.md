# poverka-bot-max

Минимальный full-stack MVP для тестирования сценария MAX bot + miniapp + PostgreSQL.

Проект делает только базовый поток:

1. бот получает сообщение от пользователя;
2. backend проверяет сотрудника в PostgreSQL;
3. если сотрудник активен, backend возвращает ссылку на miniapp;
4. miniapp сохраняет форму в PostgreSQL со статусом `draft`;
5. backend возвращает текст для подтверждения;
6. после сообщения `подтверждаю` backend переводит последнюю черновую запись в `confirmed`.

## Стек

- Node.js 20
- Express
- pg
- dotenv
- React
- Vite
- PostgreSQL 16
- pgAdmin 4
- Docker Compose

## Структура сервисов

- `db`: PostgreSQL на `localhost:5432`
- `pgadmin`: pgAdmin на `http://localhost:5050`
- `backend`: API на `http://localhost:3000`
- `miniapp`: React miniapp на `http://localhost:5173`

## Переменные окружения

Шаблон находится в `.env.example`.

Для локального старта `docker-compose.yml` уже содержит значения по умолчанию, поэтому можно запускать без `.env`.

Для VPS удобно сделать так:

```bash
cp .env.example .env
```

И затем заменить секреты и публичные URL на свои реальные значения.

## Быстрый запуск локально

Требования:

- Docker
- Docker Compose

Запуск:

```bash
docker compose up --build
```

После старта будут доступны:

- backend: `http://localhost:3000`
- miniapp: `http://localhost:5173`
- pgAdmin: `http://localhost:5050`
- PostgreSQL: `localhost:5432`

## Запуск на VPS

1. Установить Docker и Docker Compose.
2. Скопировать проект на сервер.
3. Создать `.env` на основе `.env.example`.
4. Указать реальные публичные домены:
   - `BACKEND_PUBLIC_URL=https://api.example.com`
   - `MINIAPP_PUBLIC_URL=https://app.example.com`
   - `PGADMIN_PUBLIC_URL=https://pgadmin.example.com`
   - `MAX_WEBHOOK_SECRET=...`
   - `MINIAPP_SHARED_SECRET=...`
5. Запустить:

```bash
docker compose up --build -d
```

Если используется reverse proxy, направь:

- `https://api.example.com` -> backend port `3000`
- `https://app.example.com` -> miniapp port `5173`
- `https://pgadmin.example.com` -> pgAdmin port `5050`

## Тестовые сотрудники

- `1001` / `Иван Петров`
- `1002` / `Мария Сидорова`
- `1003` / `Тестовый Сотрудник`

## API и curl примеры

### 1. Health

```bash
curl http://localhost:3000/health
```

### 2. Старт сценария

```bash
curl -X POST http://localhost:3000/webhook/max \
  -H "Content-Type: application/json" \
  -H "x-max-secret: replace_me" \
  -d '{
    "user_id": "1001",
    "text": "start"
  }'
```

### 3. Подтверждение

```bash
curl -X POST http://localhost:3000/webhook/max \
  -H "Content-Type: application/json" \
  -H "x-max-secret: replace_me" \
  -d '{
    "user_id": "1001",
    "text": "подтверждаю"
  }'
```

### 4. Просмотр отправок

```bash
curl http://localhost:3000/api/submissions/1001
```

## Ручной тест полного потока

1. Подними проект командой `docker compose up --build`.
2. Отправь запрос в `POST /webhook/max` с `user_id=1001` и текстом `start`.
3. Скопируй miniapp URL из ответа backend.
4. Открой ссылку в браузере.
5. Заполни поля `ФИО`, `Номер счетчика`, `Текущее показание`.
6. Нажми `Отправить`.
7. Miniapp покажет `message_for_bot` с текстом для подтверждения.
8. Отправь в `POST /webhook/max` сообщение `подтверждаю` для того же `user_id`.
9. Backend вернет `Все ок. Данные подтверждены и сохранены.`
10. Проверь `GET /api/submissions/1001` или таблицу `form_submissions` в pgAdmin.

## Доступ к pgAdmin

- URL: `http://localhost:5050`
- Login: `admin@example.com`
- Password: `change_me`

Чтобы подключить базу внутри pgAdmin:

1. Создай новый Server.
2. В `General` задай любое имя, например `poverka-bot-max`.
3. Во вкладке `Connection` укажи:
   - Host name/address: `db`
   - Port: `5432`
   - Maintenance database: `maxapp`
   - Username: `maxuser`
   - Password: `change_me`

## Что важно про MVP

- Нет Redis, ORM, JWT, TypeScript, Next.js, Tailwind, Redux/Zustand.
- Нет загрузки фото.
- Нет production-grade auth.
- `MAX_BOT_TOKEN` пока не используется, он оставлен как точка расширения под реальную отправку сообщений в MAX.
- Токен miniapp специально сделан простым, чтобы позже было легко заменить его на реальную проверку MAX init-data.

## Документация

- `docs/architecture.md`
- `docs/api-contract.md`
- `docs/db-schema.md`
