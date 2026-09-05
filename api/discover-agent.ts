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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const endpoint = req.body?.endpoint;
    if (!validHttps(endpoint)) return res.status(400).json({ error: "endpoint must be a valid HTTPS URL" });

    const source = { endpoint_url: endpoint.trim(), metadata: {} };
    const manifest = await discoverAgentProviderManifest(source);
    if (!manifest) {
      return res.status(422).json({
        ok: false,
        error: "No valid agent-provider/v1 manifest was discovered from this endpoint.",
        compatibility: "The endpoint may still be usable through an explicitly declared legacy protocol, but AgentMarket cannot safely infer an arbitrary private API.",
      });
    }

    const operations: Record<string, unknown> = {};
    for (const action of ["quote", "decision", "authorization", "preflight", "execute", "result", "health"] as const) {
      try {
        const operation = await resolveProviderOperation(source as never, action);
        operations[action] = operation
          ? { endpoint: operation.endpoint, method: operation.method, transport: operation.transport, capability: operation.capability ?? null, name: operation.name ?? null }
          : null;
      } catch {
        operations[action] = null;
      }
    }

    const required = requiredHiringOperations(manifest, manifest.hiring?.protocol);
    const capabilities = manifest.capabilities.map((capability) => manifestToMetadata(manifest).capabilities).flat();
    return res.status(200).json({
      ok: true,
      endpoint: endpoint.trim(),
      manifest: {
        ...manifestToMetadata(manifest),
        discovery: manifest.discovery,
        networks: manifest.networks ?? [],
        hiring: manifest.hiring ?? {},
        execution: manifest.execution ?? {},
      },
      requiredHiringOperations: required,
      operations,
      capabilities,
      next: "Register or claim the ERC-8004 identity, then AgentMarket can independently verify liveness and required operation reachability.",
    });
  } catch (error) {
    return res.status(502).json({ error: error instanceof Error ? error.message : "Unable to discover provider" });
  }
}
