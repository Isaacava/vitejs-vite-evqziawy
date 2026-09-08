#!/bin/sh
set -eu

REGISTER_PID=""
if [ -n "${PRIVATE_KEY:-}" ]; then
  python /app/erc8004_register.py > /tmp/erc8004-registration.log 2>&1 &
  REGISTER_PID=$!
else
  echo "ERC-8004 registration skipped: PRIVATE_KEY is not configured in this isolated service."
fi

node --enable-source-maps /execution/dist/server.js > /tmp/execution-runtime.log 2>&1 &
NODE_PID=$!

cleanup() {
  kill "$NODE_PID" 2>/dev/null || true
  if [ -n "$REGISTER_PID" ]; then kill "$REGISTER_PID" 2>/dev/null || true; fi
  wait "$NODE_PID" 2>/dev/null || true
  if [ -n "$REGISTER_PID" ]; then wait "$REGISTER_PID" 2>/dev/null || true; fi
}
trap cleanup EXIT INT TERM

exec uvicorn runtime.service:app --host 0.0.0.0 --port "${PORT:-8000}"
