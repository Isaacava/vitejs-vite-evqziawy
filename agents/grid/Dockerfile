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

COPY --from=execution-build /execution/package.json /execution/package.json
COPY --from=execution-build /execution/package-lock.json /execution/package-lock.json
COPY --from=execution-build /execution/dist /execution/dist
RUN mkdir -p /execution/node_modules \
    && cd /execution \
    && npm install --omit=dev --no-audit --no-fund

ENV PYTHONUNBUFFERED=1
ENV PYTHONDONTWRITEBYTECODE=1
ENV PORT=8000
ENV GRID_EXECUTION_INTERNAL_URL=http://127.0.0.1:8788

EXPOSE 8000

CMD ["sh", "-c", "node --enable-source-maps /execution/dist/server.js & exec python -c \"import os, uvicorn; uvicorn.run('app.service.main:app', host='0.0.0.0', port=int(os.environ.get('PORT', 8000)))\""]
