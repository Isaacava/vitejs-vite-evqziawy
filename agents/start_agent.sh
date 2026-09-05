#!/bin/sh
set -eu

# Start the provider HTTP surface first so Railway health checks are never
# blocked by an on-chain ERC-8004 registration/repair transaction. Registration
# remains automatic and runs in the background with its own retry policy.
(
  python /app/erc8004_register.py
) > /tmp/erc8004-registration.log 2>&1 &
REGISTER_PID=$!

node --enable-source-maps /execution/dist/server.js &
NODE_PID=$!

cleanup() {
  kill "$NODE_PID" 2>/dev/null || true
  kill "$REGISTER_PID" 2>/dev/null || true
  wait "$NODE_PID" 2>/dev/null || true
  wait "$REGISTER_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# The provider application owns its ERC-8183 HTTP surface. Each agent service
# may select its own compatible entrypoint through AGENT_APP_MODULE; no
# marketplace-specific monkeypatch is required here.
exec python -c "import os, uvicorn; uvicorn.run(os.environ['AGENT_APP_MODULE'], host='0.0.0.0', port=int(os.environ.get('PORT', 8000)))"
