FROM node:20-slim AS execution-build

WORKDIR /execution
COPY agents/grid/execution/package.json ./package.json
COPY agents/grid/execution/tsconfig.json ./tsconfig.json
COPY agents/grid/execution/src ./src
RUN npm install --omit=dev --no-audit --no-fund \
    && npm run build

FROM python:3.11-slim

WORKDIR /app

COPY agents/grid/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY agents/grid/app ./app
COPY agents/erc8004_register.py ./erc8004_register.py
COPY agents/start_agent_v2.sh ./start_agent.sh
RUN chmod +x /app/start_agent.sh

# Reuse the exact Node 20 runtime from the builder without installing the full
# Debian node/npm dependency tree in the 512 MiB Render runtime.
COPY --from=execution-build /usr/local/bin/node /usr/local/bin/node
COPY --from=execution-build /execution/package.json /execution/package.json
COPY --from=execution-build /execution/package-lock.json /execution/package-lock.json
COPY --from=execution-build /execution/node_modules /execution/node_modules
COPY --from=execution-build /execution/dist /execution/dist

ENV PYTHONUNBUFFERED=1
ENV PYTHONDONTWRITEBYTECODE=1
ENV NODE_OPTIONS=--max-old-space-size=192
ENV PORT=8000
ENV EXECUTION_AGENT_KIND=grid
ENV AGENT_DISPLAY_NAME="Grid Strategy Agent"
ENV AGENT_APP_MODULE=app.service.main:app
ENV GRID_EXECUTION_INTERNAL_URL=http://127.0.0.1:8788

EXPOSE 8000

CMD ["/app/start_agent.sh"]
