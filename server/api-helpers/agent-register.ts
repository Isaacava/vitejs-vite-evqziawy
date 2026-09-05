import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import { discoverAgentProviderManifest, manifestToMetadata } from "../_testnet/agent-provider-manifest.js";

function serverClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase server configuration is missing");
  return createClient(url, key, { auth: { persistSession: false } });
}

function requiredString(value: unknown, field: string, max = 500) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} is required`);
  const result = value.trim();
  if (result.length > max) throw new Error(`${field} is too long`);
  return result;
}

function optionalString(value: unknown, max = 500) {
  if (typeof value !== "string" || !value.trim()) return "";
  return value.trim().slice(0, max);
}

function evmAddress(value: unknown, field: string) {
  const result = requiredString(value, field, 42);
  if (!/^0x[a-fA-F0-9]{40}$/.test(result)) throw new Error(`${field} must be a valid EVM address`);
  return result;
}

function list(value: unknown) {
  if (!Array.isArray(value)) return [] as string[];
  return [...new Set(value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim()))].slice(0, 20);
}

function identityFromManifest(manifest: Awaited<ReturnType<typeof discoverAgentProviderManifest>>) {
  const agent = manifest?.agent && typeof manifest.agent === "object" ? manifest.agent : {};
  const record = agent as Record<string, unknown>;
  const id = optionalString(record.id ?? record.agent_id ?? record.agentId, 80);
  const owner = optionalString(record.owner ?? record.owner_address ?? record.ownerAddress ?? record.address, 42);
  return { id, owner };
}

function capabilityNames(manifest: Awaited<ReturnType<typeof discoverAgentProviderManifest>>) {
  if (!manifest) return [] as string[];
  return manifest.capabilities
    .map((item) => {
      const record = item && typeof item === "object" ? item as Record<string, unknown> : {};
      return optionalString(record.name ?? record.id ?? record.kind, 160);
    })
    .filter(Boolean);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const endpoint = requiredString(req.body?.endpoint, "endpoint", 1000);
    let parsedEndpoint: URL;
    try {
      parsedEndpoint = new URL(endpoint);
    } catch {
      throw new Error("endpoint must be a valid URL");
    }
    if (parsedEndpoint.protocol !== "https:") throw new Error("endpoint must use HTTPS");

    const source = { endpoint_url: endpoint, metadata: {}, protocol: "http", status: "unknown" };
    const manifest = await discoverAgentProviderManifest(source);
    if (!manifest) {
      return res.status(422).json({
        error: "No valid agent-provider/v1 manifest was discovered from this endpoint.",
        next_step: "Publish a provider manifest so AgentMarket can safely infer the agent identity, capabilities, protocols, and hiring operations.",
      });
    }

    const declaredIdentity = identityFromManifest(manifest);
    const agentId = optionalString(req.body?.agent_id, 80) || declaredIdentity.id;
    const ownerInput = optionalString(req.body?.owner, 42) || declaredIdentity.owner;
    if (!agentId) throw new Error("agent_id is required or must be declared by the provider manifest");
    if (!ownerInput) throw new Error("owner is required or must be declared by the provider manifest");
    const owner = evmAddress(ownerInput, "owner");

    const requestedName = optionalString(req.body?.name, 120);
    const requestedDescription = optionalString(req.body?.description, 2000);
    const requestedCategory = optionalString(req.body?.category, 80);
    const suppliedCapabilities = list(req.body?.capabilities);
    const discoveredCapabilities = capabilityNames(manifest);
    const capabilities = [...new Set([...discoveredCapabilities, ...suppliedCapabilities])].slice(0, 20);

    const supabase = serverClient();
    const { data: existing, error: existingError } = await supabase
      .from("agents")
      .select("id,agent_id,source,verification_status,owner,name,description,category,uri,last_indexed_at")
      .eq("agent_id", agentId)
      .maybeSingle();
    if (existingError) throw new Error(existingError.message);

    if (!existing) {
      return res.status(404).json({
        error: "Agent has not been discovered yet. AgentMarket inventory comes from ERC-8004 indexing; the provider identity must be discovered before it can be claimed.",
        next_step: "discovery",
        discovered_identity: declaredIdentity,
      });
    }

    if (existing.owner?.toLowerCase() !== owner.toLowerCase()) {
      return res.status(409).json({ error: "Agent ID is owned by a different wallet. Connect the wallet that currently owns the ERC-8004 identity." });
    }

    const now = new Date().toISOString();
    const nextName = requestedName || existing.name || manifest.name || `Agent #${agentId}`;
    const nextDescription = requestedDescription || existing.description || manifest.description || null;
    const nextCategory = requestedCategory || existing.category || "other";
    const manifestAgent = manifest.agent && typeof manifest.agent === "object" ? manifest.agent as Record<string, unknown> : {};
    const nextUri = optionalString(manifestAgent.uri ?? manifestAgent.agent_uri ?? manifestAgent.agentURI, 1000) || existing.uri || manifest.manifestUrl;
    const agentPayload: Record<string, unknown> = {
      name: nextName,
      description: nextDescription,
      category: nextCategory,
      uri: nextUri,
      last_indexed_at: existing.source === "indexed" ? existing.last_indexed_at : now,
      metadata: {
        claim: "self_service",
        claimed_at: now,
        verification: existing.verification_status,
        provider_manifest: manifestToMetadata(manifest),
      },
    };

    const { data: agentRow, error: updateError } = await supabase
      .from("agents")
      .update(agentPayload as never)
      .eq("id", existing.id)
      .select("id,agent_id,name,source,verification_status,status,owner,uri,category")
      .single();
    if (updateError) throw new Error(updateError.message);

    for (const capability of capabilities) {
      const { error } = await supabase.from("agent_capabilities").upsert({
        agent_id: existing.id,
        capability,
        source: "self_registered",
        confidence: discoveredCapabilities.includes(capability) ? 1 : 0.7,
        metadata: { claimed_at: now, agentId, manifest_url: manifest.manifestUrl },
        updated_at: now,
      }, { onConflict: "agent_id,capability,source" });
      if (error) throw new Error(error.message);
    }

    const hiringProtocol = typeof manifest.hiring?.protocol === "string" ? manifest.hiring.protocol.trim() : "";
    const providerProtocol = hiringProtocol || manifest.protocols[0] || "http";
    const endpointMetadata = {
      source: "self_claimed",
      claimed_at: now,
      manifest_url: manifest.manifestUrl,
      manifest: manifestToMetadata(manifest),
    };
    const { error: endpointError } = await supabase.from("agent_endpoints").upsert({
      agent_id: existing.id,
      endpoint_url: endpoint,
      protocol: providerProtocol,
      status: "unknown",
      metadata: endpointMetadata,
      updated_at: now,
    }, { onConflict: "agent_id,endpoint_url,protocol" });
    if (endpointError) throw new Error(endpointError.message);

    return res.status(200).json({
      ok: true,
      agent: agentRow,
      manifest: manifestToMetadata(manifest),
      capabilities,
      next_step: "wallet_signature_verification",
      message: "Discovered provider claimed. AgentMarket will continue to treat manifest declarations, endpoint liveness, and job evidence as separate verification signals.",
    });
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : "Unable to claim agent" });
  }
}
