#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MOC_PATH="${MOC_PATH:-/home/ubuntu/.motoko/moc/0.16.3-implicits-26/bin/moc}"
MOTOKO_CORE="${MOTOKO_CORE:-/home/ubuntu/.motoko/core/implicits-20}"

cd "$REPO_ROOT"

if [ ! -x "$MOC_PATH" ]; then
    echo "Error: Motoko compiler not found at $MOC_PATH" >&2
    exit 1
fi

if [ ! -d "$MOTOKO_CORE" ]; then
    echo "Error: Motoko core library not found at $MOTOKO_CORE" >&2
    exit 1
fi

pnpm install --frozen-lockfile --prefer-offline --child-concurrency 2 --network-concurrency 6
pnpm --filter '@cloudsentinels/frontend' build:skip-bindings
node scripts/prune-unused-images.js
node scripts/resize-images.js

# Run backend authorization unit tests before producing the canister artifact.
"$MOC_PATH" -r --package core "$MOTOKO_CORE" src/backend/tests/access-control.test.mo

"$MOC_PATH" --implicit-package core --default-persistent-actors -no-check-ir -E M0236 -E M0235 -E M0223 -E M0237 --actor-idl src/backend/system-idl --package core "$MOTOKO_CORE" src/backend/main.mo -o src/backend/backend.wasm

echo "CloudSentinels frontend assets and Motoko backend compiled successfully."
