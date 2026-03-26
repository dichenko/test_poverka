#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="/opt/test_poverka"

echo "==> Переходим в каталог проекта"
cd "$PROJECT_DIR"

echo "==> Тянем изменения из Git"
git pull

echo "==> Пересобираем и перезапускаем backend"
docker compose up -d --build backend

echo "==> Пересобираем и перезапускаем miniapp"
docker compose up -d --build miniapp

echo "==> Готово"
docker compose ps