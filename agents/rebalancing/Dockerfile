FROM node:20-slim AS execution-build
WORKDIR /execution
COPY agents/execution/package.json ./package.json
COPY agents/execution/tsconfig.json ./tsconfig.json
COPY agents/execution/src ./src
RUN npm install --no-audit --no-fund && npm run build
FROM python:3.12-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends nodejs npm && rm -rf /var/lib/apt/lists/*
COPY agents/rebalancing/requirements.txt ./requirements.txt
RUN python -m pip install --no-cache-dir --upgrade pip && python -m pip install --no-cache-dir -r requirements.txt
COPY agents/rebalancing/ ./agents/rebalancing/
COPY agents/execution_client.py ./agents/execution_client.py
COPY agents/erc8004_register.py ./erc8004_register.py
COPY agents/start_agent_v2.sh ./start_agent.sh
RUN chmod +x /app/start_agent.sh
COPY --from=execution-build /execution/package.json /execution/package.json
COPY --from=execution-build /execution/package-lock.json /execution/package-lock.json
COPY --from=execution-build /execution/dist /execution/dist
RUN mkdir -p /execution/node_modules && cd /execution && npm install --omit=dev --no-audit --no-fund
ENV PYTHONUNBUFFERED=1
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONPATH=/app/agents/rebalancing:/app
ENV PORT=8000
ENV EXECUTION_PORT=8788
ENV EXECUTION_AGENT_KIND=rebalancing
# Use the dedicated open entrypoint. It removes the legacy pre-job capability gate
# instead of relying on a startup monkeypatch.
ENV AGENT_APP_MODULE=app.service.open_main:app
ENV ALTANA_EXECUTION_INTERNAL_URL=http://127.0.0.1:8788
# Shared provider manifest launcher: /agent.json + /erc8183/agent.json.
# Force a fresh Railway build after runtime configuration correction.
EXPOSE 8000
CMD ["/app/start_agent.sh"]
