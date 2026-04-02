FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci

FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ARG DATABASE_URL=postgres://maxuser:change_me@db:5432/maxapp
ARG ADMIN_PANEL_PUBLIC_URL=https://admin.poverka-bot.ru
ARG ADMIN_AUTH_LOGIN=build_admin
ARG ADMIN_AUTH_PASSWORD=build_password
ARG ADMIN_SESSION_SECRET=build_secret_1234567890
ARG ADMIN_SESSION_DURATION_DAYS=30
ENV DATABASE_URL=${DATABASE_URL}
ENV ADMIN_PANEL_PUBLIC_URL=${ADMIN_PANEL_PUBLIC_URL}
ENV ADMIN_AUTH_LOGIN=${ADMIN_AUTH_LOGIN}
ENV ADMIN_AUTH_PASSWORD=${ADMIN_AUTH_PASSWORD}
ENV ADMIN_SESSION_SECRET=${ADMIN_SESSION_SECRET}
ENV ADMIN_SESSION_DURATION_DAYS=${ADMIN_SESSION_DURATION_DAYS}
RUN npm run prisma:generate
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app ./
EXPOSE 3000
CMD ["sh", "-c", "npm run check-env && npm run start"]
