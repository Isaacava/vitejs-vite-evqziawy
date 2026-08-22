import type { VercelRequest, VercelResponse } from "@vercel/node";
import { serverClient } from "../../src/server/authHandlers.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const provider = typeof req.query.provider === "string" ? req.query.provider.trim() : "";
  if (!/^0x[a-fA-F0-9]{40}$/.test(provider)) {
    return res.status(400).json({ error: "Invalid provider address" });
  }

  try {
    const supabase = serverClient();
    const { data, error } = await supabase
      .from("agents")
      .select("agent_id,owner,uri,name,status,verification_status,metadata")
      .ilike("owner", provider)
      .limit(1)
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!data) return res.status(404).json({ error: "No registered agent found for this provider" });

    let endpoint = data.uri;
    const metadata = data.metadata && typeof data.metadata === "object" ? data.metadata as Record<string, unknown> : null;
    if (metadata && typeof metadata.endpoint === "string") endpoint = metadata.endpoint;
    if (metadata && typeof metadata.url === "string") endpoint = metadata.url;
    if (!endpoint) return res.status(404).json({ error: "Agent has no public endpoint" });

    return res.status(200).json({
      ok: true,
      agent_id: data.agent_id,
      name: data.name,
      provider: data.owner,
      endpoint: String(endpoint).replace(/\/$/, ""),
      status: data.status,
      verification_status: data.verification_status,
    });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : "Unable to resolve provider endpoint" });
  }
}
