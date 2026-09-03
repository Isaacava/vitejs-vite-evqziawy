#!/bin/sh
set -eu

python /app/erc8004_register.py

node --enable-source-maps /execution/dist/server.js &
NODE_PID=$!

cleanup() {
  kill "$NODE_PID" 2>/dev/null || true
  wait "$NODE_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

exec python -c "import os, uvicorn; uvicorn.run(os.environ['AGENT_APP_MODULE'], host='0.0.0.0', port=int(os.environ.get('PORT', 8000)))"
