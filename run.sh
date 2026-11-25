#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
case "${1:-help}" in
  build) shift; exec python3 scripts/build-artifacts.py "$@" ;;
  up|down|smoke|init|agent) exec python3 scripts/local.py "$@" ;;
  *) printf '%s\n' "Usage: ./run.sh build [--frontend] | init | up | down | smoke | agent <context>" ;;
esac
