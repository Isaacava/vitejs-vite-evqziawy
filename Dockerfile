FROM node:20-slim AS execution-build
WORKDIR /execution
COPY agents/new_agent_runtime/execution/package.json ./package.json
COPY agents/new_agent_runtime/execution/tsconfig.json ./tsconfig.json
COPY agents/new_agent_runtime/execution/src ./src
RUN npm install --no-audit --no-fund && npm run build && npm prune --omit=dev --no-audit --no-fund

FROM python:3.11-slim
WORKDIR /app
COPY agents/new_agent_runtime/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt
COPY agents/new_agent_runtime ./runtime
COPY agents/new_agents ./new_agents
COPY agents/erc8004_register.py ./erc8004_register.py
COPY --from=execution-build /usr/local/bin/node /usr/local/bin/node
COPY --from=execution-build /execution/package.json /execution/package.json
COPY --from=execution-build /execution/package-lock.json /execution/package-lock.json
COPY --from=execution-build /execution/node_modules /execution/node_modules
COPY --from=execution-build /execution/dist /execution/dist
COPY agents/new_agent_runtime/entrypoint.sh ./entrypoint.sh
RUN chmod +x /app/entrypoint.sh
ENV PYTHONUNBUFFERED=1
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONPATH=/app
ENV NODE_PATH=/execution/node_modules
EXPOSE 8000
CMD ["/app/entrypoint.sh"]
