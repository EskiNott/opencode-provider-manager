#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "没有找到 Node.js。请先确认 Git Bash 中可以运行：node -v"
  exit 1
fi

node manager.mjs "$@"
