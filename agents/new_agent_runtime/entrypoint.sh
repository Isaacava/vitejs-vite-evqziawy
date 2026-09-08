#!/bin/sh
set -eu

# The isolated agents must stay within Render's 512 MiB free-plan memory limit.
# ERC-8004 registration and the Node execution engine are both lazy/managed by
# runtime.service so they do not all peak concurrently during container boot.
exec uvicorn runtime.service:app --host 0.0.0.0 --port "${PORT:-8000}" --workers 1
