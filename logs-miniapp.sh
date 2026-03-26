#!/usr/bin/env bash
set -euo pipefail

cd /opt/test_poverka
docker compose logs -f --tail=200 miniapp