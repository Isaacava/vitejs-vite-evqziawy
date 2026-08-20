import type { VercelRequest, VercelResponse } from "@vercel/node";

import agentJobsHandler from "../src/server/legacy-api/agent-jobs.js";
import agentHandler from "../src/server/legacy-api/agent.js";
import registerAgentHandler from "../src/server/legacy-api/agents/register.js";
import authHandler from "../src/server/legacy-api/auth.js";
import checkAgentEndpointsHandler from "../src/server/legacy-api/check-agent-endpoints.js";
import dashboardHandler from "../src/server/legacy-api/dashboard.js";
import erc8183SettlementHandler from "../src/server/legacy-api/erc8183-settlement.js";
import erc8183Handler from "../src/server/legacy-api/erc8183.js";
import erc8183PrepareHandler from "../src/server/legacy-api/erc8183/prepare.js";
import indexAgentsHandler from "../src/server/legacy-api/index-agents.js";
import jobsHandler from "../src/server/legacy-api/jobs.js";
import matchHandler from "../src/server/legacy-api/match.js";
import sessionPermissionsHandler from "../src/server/legacy-api/session-permissions.js";
import testnetMatchHandler from "../src/server/legacy-api/testnet/match.js";
import testnetErc8183Handler from "../src/server/legacy-api/testnet/erc8183.js";
import testnetSettlementHandler from "../src/server/legacy-api/testnet/erc8183-settlement.js";

type Handler = (req: VercelRequest, res: VercelResponse) => unknown | Promise<unknown>;

function normalizePath(req: VercelRequest) {
  const raw = typeof req.query.__path === "string"
    ? req.query.__path
    : typeof req.url === "string"
      ? new URL(req.url, `https://${req.headers.host || "localhost"}`).pathname.replace(/^\/?api\/?/, "")
      : "";
  return raw.replace(/^\/+|\/+$/g, "");
}

function setQuery(req: VercelRequest, values: Record<string, string>) {
  Object.assign(req.query, values);
}

function routeHandler(req: VercelRequest): Handler | null {
  const path = normalizePath(req);

  if (path === "auth" || path.startsWith("auth/")) {
    const action = path.slice("auth".length).replace(/^\//, "");
    if (action) setQuery(req, { action });
    return authHandler;
  }

  if (path === "agent") return agentHandler;
  if (path === "agent-actions") {
    setQuery(req, { route: "actions" });
    return agentHandler;
  }
  if (path === "agent-jobs") return agentJobsHandler;
  if (path === "agent-jobs/watch") {
    setQuery(req, { route: "watch" });
    return agentHandler;
  }
  if (path === "agent-runtimes/risk-guardian") {
    setQuery(req, { route: "risk-runtime" });
    return agentHandler;
  }
  if (path === "agent/heartbeat") {
    setQuery(req, { route: "heartbeat" });
    return agentHandler;
  }
  if (path === "risk-guardian") {
    setQuery(req, { route: "risk-policy" });
    return agentHandler;
  }

  if (path === "agents/register") return registerAgentHandler;
  if (path === "check-agent-endpoints") return checkAgentEndpointsHandler;
  if (path === "dashboard" || path.startsWith("dashboard/")) {
    const route = path.slice("dashboard".length).replace(/^\//, "");
    if (route) setQuery(req, { route });
    return dashboardHandler;
  }
  if (path === "missions") {
    setQuery(req, { route: "missions" });
    return dashboardHandler;
  }

  if (path === "erc8183") return erc8183Handler;
  if (path === "erc8183/prepare") return erc8183PrepareHandler;
  if (path === "erc8183-settlement") return erc8183SettlementHandler;
  if (path === "index-agents") return indexAgentsHandler;
  if (path === "jobs") return jobsHandler;
  if (path === "match") return matchHandler;
  if (path === "session-permissions") return sessionPermissionsHandler;
  if (path === "testnet/match") return testnetMatchHandler;
  if (path === "testnet/erc8183") return testnetErc8183Handler;
  if (path === "testnet/erc8183-settlement") return testnetSettlementHandler;

  return null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const route = routeHandler(req);
  if (!route) return res.status(404).json({ error: "Unknown AgentMarket API route" });

  try {
    return await route(req, res);
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause || "Unknown server error");
    console.error("AgentMarket API handler failed", {
      path: normalizePath(req),
      method: req.method,
      error: detail,
    });

    if (res.headersSent) return;
    return res.status(500).json({
      error: "AgentMarket API request failed",
      detail,
    });
  }
}
