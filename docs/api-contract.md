# API Contract (high level)

## Health

- `GET /health/live`
- `GET /health/ready`
- `GET /health`

## Auth

- `POST /api/auth/max/handshake` body: `{ initData }`
- `POST /api/auth/refresh`
- `POST /api/auth/logout`
- `GET /api/auth/me`

## User submissions

- `POST /api/submissions/draft`
- `POST /api/submissions/:id/confirm`
- `GET /api/submissions/me`

## Admin

- `GET /api/admin/organizations`
- `GET /api/admin/users`
- `POST /api/admin/users`
- `PATCH /api/admin/users/:id`
- `GET /api/admin/submissions`
- `GET /api/admin/submissions/:id/history`
- `GET /api/admin/audit-logs`

## Storage

- `POST /api/files/upload`

## MAX Webhook

- `POST /webhook/max` with header `X-Max-Bot-Api-Secret`