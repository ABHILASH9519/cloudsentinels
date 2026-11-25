#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

command -v go >/dev/null || { echo "Go 1.23+ is required." >&2; exit 1; }
command -v pnpm >/dev/null || { echo "pnpm is required for the React UI." >&2; exit 1; }

echo "== Go format, tests and vet =="
test -z "$(gofmt -l cmd internal)"
go test -race ./...
go vet ./...
go build -trimpath ./cmd/cloudsentinels
go build -trimpath ./cmd/cloudsentinels-agent
GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build -tags lambda.norpc -trimpath -o /tmp/cloudsentinels-lambda ./cmd/cloudsentinels-lambda

echo "== React UI =="
pnpm install --frozen-lockfile
pnpm typecheck
pnpm check
pnpm build

echo "CloudSentinels Go backend, Kubernetes agent, Lambda adapter and React UI checks passed."
