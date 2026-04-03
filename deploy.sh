#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="/opt/test_poverka"

echo "==> Enter project directory"
cd "$PROJECT_DIR"

echo "==> Pull latest changes"
git pull --ff-only origin main

echo "==> Build and run production stack"
docker compose up -d --build db pgadmin backend photo-worker payment-worker cleanup-worker report-worker mail-worker admin-panel miniapp

echo "==> Current services"
docker compose ps
