# Database Schema

## employees

- `id`: `BIGSERIAL` primary key
- `max_user_id`: unique MAX user identifier
- `full_name`: employee full name
- `is_active`: access flag
- `created_at`: row creation timestamp

## form_submissions

- `id`: `BIGSERIAL` primary key
- `max_user_id`: MAX user identifier
- `full_name`: full name submitted from the miniapp
- `meter_number`: meter number string
- `current_value`: current meter value string
- `status`: `draft` or `confirmed`
- `created_at`: draft creation timestamp
- `confirmed_at`: confirmation timestamp, nullable

## Seed Data

- `1001` / `Иван Петров`
- `1002` / `Мария Сидорова`
- `1003` / `Тестовый Сотрудник`
