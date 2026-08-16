import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import { createPublicClient, http, type Address } from "viem";
import { bscTestnet } from "viem/chains";

const REGISTRY = "0x8004A818BFB912233c491871b3d84c89A494BD9e" as Address;
const publicClient = createPublicClient({ chain: bscTestnet, transport: http() });
const OWNER_OF_ABI = [{ type: "function", name: "ownerOf", stateMutability: "view", inputs: [{ name: "tokenId", type: "uint256" }], outputs: [{ type: "address" }] }] as const;
const TOKEN_URI_ABI = [{ type: "function", name: "tokenURI", stateMutability: "view", inputs: [{ name: "tokenId", type: "uint256" }], outputs: [{ type: "string" }] }] as const;

function serverClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase server configuration is missing");
  return createClient(url, key, { auth: { persistSession: false } });
}

function address(value: unknown, field: string) {
  if (typeof value !== "string" || !/^0x[a-fA-F0-9]{40}$/.test(value.trim())) throw new Error(`${field} must be a valid EVM address`);
  return value.trim() as Address;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return res.status(405).json({ error: "Method not allowed" }); }
  const agentIdValue = typeof req.body?.agent_id === "string" ? req.body.agent_id.trim() : "";
  const owner = address(req.body?.owner, "owner");
  if (!/^\d+$/.test(agentIdValue)) return res.status(400).json({ error: "agent_id must be a numeric ERC-8004 token ID" });

  try {
    const agentId = BigInt(agentIdValue);
    const [onchainOwner, uri] = await Promise.all([
      publicClient.readContract({ address: REGISTRY, abi: OWNER_OF_ABI, functionName: "ownerOf", args: [agentId], authorizationList: [] }),
      publicClient.readContract({ address: REGISTRY, abi: TOKEN_URI_ABI, functionName: "tokenURI", args: [agentId], authorizationList: [] }),
    ]);
    if (String(onchainOwner).toLowerCase() !== owner.toLowerCase()) return res.status(403).json({ error: "Owner does not match the BSC Testnet ERC-8004 identity" });

    const supabase = serverClient();
    const now = new Date().toISOString();
    const { data: existing, error: existingError } = await supabase.from("agents").select("id,metadata,name,description,category,is_first_party,indexed_at").eq("agent_id", agentIdValue).maybeSingle();
    if (existingError) throw new Error(existingError.message);

    const patch = { owner: String(onchainOwner), uri: String(uri), chain: "bsc-testnet", source: "testnet_indexed", verification_status: "indexed", status: "unknown", indexed_at: existing?.indexed_at || now, last_indexed_at: now, metadata: { ...(existing?.metadata || {}), environment: "testnet", registry: REGISTRY, synced_at: now } };
    let rowId: string;
    if (existing) {
      const { data, error } = await supabase.from("agents").update(patch as never).eq("id", existing.id).select("id,agent_id,name,chain,status,verification_status,owner,uri,category,is_first_party").single();
      if (error) throw new Error(error.message);
      rowId = data.id;
    } else {
      const { data, error } = await supabase.from("agents").insert({ agent_id: agentIdValue, owner: String(onchainOwner), uri: String(uri), name: `Testnet Agent #${agentIdValue}`, description: "ERC-8004 agent discovered on BSC Testnet.", category: "grid_trading", chain: "bsc-testnet", source: "testnet_indexed", verification_status: "indexed", status: "unknown", is_first_party: true, indexed_at: now, last_indexed_at: now, metadata: { environment: "testnet", registry: REGISTRY, synced_at: now } }).select("id,agent_id,name,chain,status,verification_status,owner,uri,category,is_first_party").single();
      if (error) throw new Error(error.message);
      rowId = data.id;
    }
    const { error: capabilityError } = await supabase.from("agent_capabilities").upsert({ agent_id: rowId, capability: "grid_trading", source: "testnet_registration", confidence: 1, metadata: { environment: "testnet", agentId: agentIdValue }, updated_at: now }, { onConflict: "agent_id,capability,source" });
    if (capabilityError) throw new Error(capabilityError.message);
    return res.status(200).json({ ok: true, network: "bsc-testnet", chain_id: 97, registry: REGISTRY, agent_id: agentIdValue, owner: String(onchainOwner), uri: String(uri), note: "Testnet identity synced. Provider endpoint liveness remains a separate hireability gate." });
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : "Unable to sync Testnet agent" });
  }
}
