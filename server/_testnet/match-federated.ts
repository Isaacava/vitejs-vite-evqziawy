import type { VercelRequest, VercelResponse } from "@vercel/node";
import baseMatch from "./match.js";
import { search8004scan, type ExternalAgent } from "../erc8004scan.js";

type Capture = {
  statusCode: number;
  body: any;
  response: VercelResponse;
};

function captureResponse(): Capture {
  const capture: Capture = {
    statusCode: 200,
    body: null,
    response: undefined as unknown as VercelResponse,
  };
  capture.response = {
    status(code: number) {
      capture.statusCode = code;
      return capture.response;
    },
    json(value: unknown) {
      capture.body = value;
      return capture.response;
    },
    setHeader() {
      return capture.response;
    },
  } as unknown as VercelResponse;
  return capture;
}

function cookieValue(req: VercelRequest, name: string) {
  const cookieHeader = String(req.headers.cookie || "");
  for (const part of cookieHeader.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key !== name) continue;
    try { return decodeURIComponent(rest.join("=")); } catch { return rest.join("="); }
  }
  return "";
}

function requestedAgentId(req: VercelRequest) {
  const body = req.body && typeof req.body === "object" ? req.body as Record<string, unknown> : {};
  const bodyAgent = typeof body.agent_id === "string" ? body.agent_id.trim() : "";
  if (bodyAgent) return bodyAgent;

  const cookie = cookieValue(req, "agentmarket_selected_agent").trim();
  if (cookie) return cookie;

  const direct = typeof req.query?.agent_id === "string" ? req.query.agent_id.trim() : "";
  if (direct) return direct;

  const referer = String(req.headers.referer || req.headers.referrer || "").trim();
  if (!referer) return "";
  try {
    const url = new URL(referer);
    return (url.searchParams.get("agent") || url.searchParams.get("agent_id") || "").trim();
  } catch {
    return "";
  }
}

function pinRequestedAgent(body: any, agentId: string) {
  if (!agentId || !body) return body;
  const pool = [body.bestMatch, body.bestHireableMatch, ...(body.alternatives ?? [])].filter(Boolean);
  const target = pool.find((match: any) => String(match?.agent?.agent_id ?? "") === agentId);
  if (!target) return body;

  const alternatives = pool.filter((match: any) => String(match?.agent?.agent_id ?? "") !== agentId);
  return {
    ...body,
    bestMatch: target,
    bestHireableMatch: target,
    alternatives,
    discovery: {
      ...(body.discovery ?? {}),
      requestedAgentId: agentId,
      requestedAgentPinned: true,
    },
  };
}

function supports(agent: ExternalAgent, matcher: RegExp) {
  return agent.services.some((service) => matcher.test(service.name) || matcher.test(service.endpoint));
}

function toMarketplaceMatch(agent: ExternalAgent) {
  const semanticScore = agent.search_score == null ? 0 : agent.search_score <= 1 ? agent.search_score * 100 : Math.min(100, agent.search_score);
  const erc8183 = supports(agent, /erc[- ]?8183|commerce/i);
  const a2a = supports(agent, /a2a|agent2agent/i);
  const mcp = supports(agent, /mcp|model context/i);
  const http = supports(agent, /^web$|http|https/i);
  const x402 = agent.x402_support === true || supports(agent, /x402/i);
  return {
    agent: {
      agent_id: agent.agent_id,
      name: agent.name,
      description: agent.description,
      category: "other",
      status: null,
      verification_status: "indexed",
    },
    score: Math.round(semanticScore * 100) / 100,
    scoreConfidence: "low",
    hireability: {
      status: "discoverable_only",
      canCreateJob: false,
    },
    reasons: [
      "Discovered via ERC-8004 semantic search (8004scan)",
      "External agent has not been independently verified by AgentMarket for Testnet hiring",
      ...(erc8183 ? ["ERC-8183 capability advertised"] : []),
      ...(a2a ? ["A2A service advertised"] : []),
      ...(mcp ? ["MCP service advertised"] : []),
    ].slice(0, 5),
    execution: {
      wallet_provider: "unknown",
      wallet_model: "unknown",
      transaction_authority: "unknown",
      supports_spend_cap: false,
      supports_call_allowlist: false,
      supports_expiry: false,
      supports_revocation: false,
      evidence: ["ERC-8004 registration discovered through 8004scan; execution authority is not inferred."],
    },
    commerce: { erc8183, x402, b402: false },
    communication: { a2a, mcp, http },
    onchain: null,
    federated: {
      source: "8004scan",
      agent_registry: agent.agent_registry,
      chain_id: agent.chain_id,
      chain_name: agent.chain_name,
      services: agent.services,
      supported_trust: agent.supported_trust,
      feedback_count: agent.feedback_count,
      reputation_score: agent.reputation_score,
    },
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const capture = captureResponse();
  await baseMatch(req, capture.response);

  if (capture.statusCode < 200 || capture.statusCode >= 300 || !capture.body || typeof req.body?.goal !== "string") {
    return res.status(capture.statusCode).json(capture.body ?? { error: "Testnet matching failed" });
  }

  const requested = requestedAgentId(req);
  const pinnedBody = pinRequestedAgent(capture.body, requested);
  if (pinnedBody !== capture.body) capture.body = pinnedBody;

  const goal = req.body.goal.trim();
  try {
    const external = await search8004scan(goal, 6);
    const currentIds = new Set<string>(
      [capture.body.bestMatch, capture.body.bestHireableMatch, ...(capture.body.alternatives ?? [])]
        .filter(Boolean)
        .map((match: any) => String(match.agent?.agent_id ?? ""))
        .filter(Boolean),
    );
    const federatedMatches = external
      .filter((agent) => !currentIds.has(agent.agent_id))
      .map(toMarketplaceMatch)
      .slice(0, 6);

    const responseBody = {
      ...capture.body,
      federatedMatches,
      discovery: {
        ...(capture.body.discovery ?? {}),
        federatedSources: ["agentmarket_local_registry", "erc8004_8004scan_semantic_search"],
        externalAgentsAreDiscoverableOnly: true,
        externalHireabilityPolicy: "An external ERC-8004 agent is never automatically hireable from 8004scan alone; AgentMarket requires independent execution-protocol and endpoint verification first.",
      },
    };

    if (requested) responseBody.discovery = { ...(responseBody.discovery ?? {}), requestedAgentId: requested, requestedAgentPinned: Boolean(pinnedBody !== capture.body) };
    if (requested) res.setHeader("Set-Cookie", "agentmarket_selected_agent=; Path=/; Max-Age=0; SameSite=Lax");
    return res.status(200).json(responseBody);
  } catch (error) {
    if (requested) res.setHeader("Set-Cookie", "agentmarket_selected_agent=; Path=/; Max-Age=0; SameSite=Lax");
    return res.status(200).json({
      ...capture.body,
      federatedMatches: [],
      discovery: {
        ...(capture.body.discovery ?? {}),
        federatedSources: ["agentmarket_local_registry"],
        federatedError: error instanceof Error ? error.message : "8004scan federation unavailable",
      },
    });
  }
}
