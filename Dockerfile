FROM node:20-slim AS execution-build

WORKDIR /execution
COPY agents/grid/execution/package.json ./package.json
COPY agents/grid/execution/tsconfig.json ./tsconfig.json
COPY agents/grid/execution/src ./src
RUN npm install --no-audit --no-fund \
    && npm run build \
    && npm prune --omit=dev --no-audit --no-fund

FROM python:3.11-slim

WORKDIR /app

COPY agents/grid/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY agents/grid/app ./app
COPY agents/erc8004_register.py ./erc8004_register.py
COPY agents/start_agent_v2.sh ./start_agent.sh
RUN chmod +x /app/start_agent.sh \
    && python - <<'PY'
from pathlib import Path
p = Path('/app/start_agent.sh')
s = p.read_text()
old = '''# Provider HTTP starts immediately; ERC-8004 registration stays in the background.\n(\n  python /app/erc8004_register.py\n) > /tmp/erc8004-registration.log 2>&1 &\nREGISTER_PID=$!\n\nnode --enable-source-maps /execution/dist/server.js &\n'''
new = '''# On constrained Render instances, complete ERC-8004 registration before\n# starting the long-lived Node and FastAPI processes. This prevents the\n# registration SDK from competing for the 512 MiB runtime memory budget.\npython /app/erc8004_register.py > /tmp/erc8004-registration.log 2>&1\nREGISTER_PID=""\n\nnode --enable-source-maps /execution/dist/server.js &\n'''
if old not in s:
    raise SystemExit('expected startup block not found')
p.write_text(s.replace(old, new, 1))
PY

# Reuse the exact Node 20 runtime and pruned production dependencies from the
# builder without installing the full Debian node/npm dependency tree here.
COPY --from=execution-build /usr/local/bin/node /usr/local/bin/node
COPY --from=execution-build /execution/package.json /execution/package.json
COPY --from=execution-build /execution/package-lock.json /execution/package-lock.json
COPY --from=execution-build /execution/node_modules /execution/node_modules
COPY --from=execution-build /execution/dist /execution/dist

ENV PYTHONUNBUFFERED=1
ENV PYTHONDONTWRITEBYTECODE=1
ENV NODE_OPTIONS=--max-old-space-size=128
ENV PORT=8000
ENV EXECUTION_AGENT_KIND=grid
ENV AGENT_DISPLAY_NAME="Grid Strategy Agent"
ENV AGENT_APP_MODULE=app.service.main:app
ENV GRID_EXECUTION_INTERNAL_URL=http://127.0.0.1:8788

EXPOSE 8000

CMD ["/app/start_agent.sh"]
