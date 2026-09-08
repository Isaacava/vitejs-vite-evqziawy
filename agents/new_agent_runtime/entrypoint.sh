#!/bin/sh
set -eu

python /app/erc8004_register.py > /tmp/erc8004-registration.log 2>&1 &
REGISTER_PID=$!
node --enable-source-maps /execution/dist/server.js > /tmp/execution-runtime.log 2>&1 &
NODE_PID=$!

cleanup() {
  kill "$NODE_PID" 2>/dev/null || true
  kill "$REGISTER_PID" 2>/dev/null || true
  wait "$NODE_PID" 2>/dev/null || true
  wait "$REGISTER_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

exec uvicorn runtime.service:app --host 0.0.0.0 --port "${PORT:-8000}"
