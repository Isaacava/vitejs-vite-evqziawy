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

    return res.status(200).json({
      ...capture.body,
      federatedMatches,
      discovery: {
        ...(capture.body.discovery ?? {}),
        federatedSources: ["agentmarket_local_registry", "erc8004_8004scan_semantic_search"],
        externalAgentsAreDiscoverableOnly: true,
        externalHireabilityPolicy: "An external ERC-8004 agent is never automatically hireable from 8004scan alone; AgentMarket requires independent execution-protocol and endpoint verification first.",
      },
    });
  } catch (error) {
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
