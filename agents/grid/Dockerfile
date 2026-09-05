FROM node:20-slim AS execution-build

WORKDIR /execution
COPY agents/grid/execution/package.json ./package.json
COPY agents/grid/execution/tsconfig.json ./tsconfig.json
COPY agents/grid/execution/src ./src
RUN npm install --no-audit --no-fund \
    && npm run build

FROM python:3.11-slim

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends nodejs npm \
    && rm -rf /var/lib/apt/lists/*

COPY agents/grid/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY agents/grid/app ./app
COPY agents/erc8004_register.py ./erc8004_register.py
COPY agents/start_agent_v2.sh ./start_agent.sh
RUN chmod +x /app/start_agent.sh

COPY --from=execution-build /execution/package.json /execution/package.json
COPY --from=execution-build /execution/package-lock.json /execution/package-lock.json
COPY --from=execution-build /execution/dist /execution/dist
RUN mkdir -p /execution/node_modules \
    && cd /execution \
    && npm install --omit=dev --no-audit --no-fund

ENV PYTHONUNBUFFERED=1
ENV PYTHONDONTWRITEBYTECODE=1
ENV PORT=8000
ENV AGENT_APP_MODULE=app.service.main:app
ENV GRID_EXECUTION_INTERNAL_URL=http://127.0.0.1:8788

# Shared provider manifest launcher: /agent.json + /erc8183/agent.json.
EXPOSE 8000

CMD ["/app/start_agent.sh"]
