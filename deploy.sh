#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="/opt/test_poverka"

echo "==> Enter project directory"
cd "$PROJECT_DIR"

echo "==> Pull latest changes"
git pull

echo "==> Build and run production stack"
docker compose up -d --build db pgadmin backend photo-worker miniapp

echo "==> Current services"
docker compose ps
