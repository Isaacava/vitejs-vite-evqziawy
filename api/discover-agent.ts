import type { VercelRequest, VercelResponse } from "@vercel/node";
import { discoverAgentProviderManifest, requiredHiringOperations, manifestToMetadata } from "../server/_testnet/agent-provider-manifest.js";
import { resolveProviderOperation } from "../server/_testnet/provider-operation.js";

function validHttps(value: unknown): value is string {
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:";
  } catch {
    return false;
  }
}

const DISCOVERY_ACTIONS = ["quote", "decision", "authorization", "preflight", "execute", "result", "health"] as const;
type DiscoveryAction = typeof DISCOVERY_ACTIONS[number];

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const endpoint = req.body?.endpoint;
    if (!validHttps(endpoint)) return res.status(400).json({ error: "endpoint must be a valid HTTPS URL" });

    const source = { endpoint_url: endpoint.trim(), metadata: {}, protocol: "http", status: "unknown" };
    const manifest = await discoverAgentProviderManifest(source);
    if (!manifest) {
      return res.status(422).json({
        ok: false,
        error: "No valid agent-provider/v1 manifest was discovered from this endpoint.",
        compatibility: "The endpoint may still be usable through an explicitly declared legacy protocol, but AgentMarket cannot safely infer an arbitrary private API.",
      });
    }

    const operations: Record<DiscoveryAction, unknown> = {
      quote: null,
      decision: null,
      authorization: null,
      preflight: null,
      execute: null,
      result: null,
      health: null,
    };

    for (const action of DISCOVERY_ACTIONS) {
      try {
        const operation = await resolveProviderOperation(source, action);
        operations[action] = operation
          ? {
              endpoint: operation.endpoint,
              method: operation.method,
              transport: operation.transport,
              name: operation.name ?? null,
              input_schema: operation.inputSchema ?? null,
              metadata: operation.metadata ?? {},
            }
          : null;
      } catch {
        operations[action] = null;
      }
    }

    const metadata = manifestToMetadata(manifest);
    const protocol = typeof manifest.hiring?.protocol === "string" ? manifest.hiring.protocol : "";
    const required = requiredHiringOperations(manifest, protocol);
    return res.status(200).json({
      ok: true,
      endpoint: endpoint.trim(),
      manifest: {
        ...metadata,
        description: manifest.description ?? null,
        agent: manifest.agent ?? {},
        networks: manifest.networks ?? [],
        hiring: manifest.hiring ?? {},
        execution: manifest.execution ?? {},
        discovery: manifest.discovery ?? {},
      },
      requiredHiringOperations: required,
      operations,
      capabilities: manifest.capabilities,
      next: "Register or claim the ERC-8004 identity, then AgentMarket can independently verify liveness and required operation reachability.",
    });
  } catch (error) {
    return res.status(502).json({ error: error instanceof Error ? error.message : "Unable to discover provider" });
  }
}
