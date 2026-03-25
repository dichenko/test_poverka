# API Contract

## GET /health

Response:

```json
{ "ok": true }
```

## POST /webhook/max

Headers:

- `x-max-secret: replace_me`

Request body:

```json
{
  "user_id": "1001",
  "text": "start"
}
```

Success responses:

- Active employee and any text other than `подтверждаю`:

```json
{
  "ok": true,
  "message": "Привет, Иван Петров. Открой miniapp: https://poverka-test-app.liven8n.site?user_id=1001&token=..."
}
```

- Confirmation with existing draft:

```json
{
  "ok": true,
  "message": "Все ок. Данные подтверждены и сохранены."
}
```

- Confirmation without draft:

```json
{
  "ok": true,
  "message": "У тебя нет данных для подтверждения."
}
```

- Unknown or inactive employee:

```json
{
  "ok": true,
  "message": "Доступ запрещен. Тебя нет в списке сотрудников."
}
```

## GET /api/miniapp/access

Query params:

- `user_id`
- `token`

Success response:

```json
{
  "ok": true,
  "employee": {
    "max_user_id": "1001",
    "full_name": "Иван Петров"
  }
}
```

Error responses:

- `401` for missing or invalid token
- `403` for missing employee or inactive employee

## POST /api/miniapp/submit

Request body:

```json
{
  "token": "....",
  "user_id": "1001",
  "full_name": "Иван Петров",
  "meter_number": "123456",
  "current_value": "88.5"
}
```

Success response:

```json
{
  "ok": true,
  "message_for_bot": "Проверь данные:\nФИО: Иван Петров\nНомер счетчика: 123456\nПоказание: 88.5\n\nЕсли все верно, напиши: подтверждаю",
  "submission": {
    "id": 1,
    "max_user_id": "1001",
    "full_name": "Иван Петров",
    "meter_number": "123456",
    "current_value": "88.5",
    "status": "draft",
    "created_at": "2026-03-25T00:00:00.000Z",
    "confirmed_at": null
  }
}
```

## GET /api/submissions/:userId

Success response:

```json
{
  "ok": true,
  "submissions": []
}
```
