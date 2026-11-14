#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

command -v docker >/dev/null || { echo "Docker is required." >&2; exit 1; }
if [[ ! -f .env.local ]]; then
  echo "Create .env.local from .env.example and configure Cognito, Airtable and agent credentials before deployment." >&2
  exit 1
fi

docker build -t cloudsentinels:local -f Dockerfile .
docker run --rm --name cloudsentinels-api \
  --env-file .env.local \
  -p 8082:8082 \
  cloudsentinels:local
