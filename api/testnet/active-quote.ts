import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getAuthenticatedUser, serverClient } from "../../src/server/authHandlers.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  try {
    const auth = await getAuthenticatedUser(req);
    if (!auth) return res.status(401).json({ error: "Authentication required" });
    const supabase = serverClient();

    const { data: quote, error: quoteError } = await supabase
      .from("marketplace_quotes")
      .select("quote_id,agent_id,requester_wallet,goal,request_metadata,price,currency,provider_quote,quote_hash,status,expires_at,accepted_at,created_at")
      .eq("requester_wallet", auth.user.wallet_address)
      .eq("chain_id", 97)
      .eq("environment", "testnet")
      .in("status", ["accepted", "offered"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (quoteError) throw new Error(quoteError.message);
    if (!quote) return res.status(404).json({ error: "No active Testnet quote found for this wallet" });

    const { data: missions, error: missionError } = await supabase
      .from("missions")
      .select("id,user_id,goal,status,created_at")
      .eq("user_id", auth.user.id)
      .eq("goal", quote.goal)
      .order("created_at", { ascending: false })
      .limit(1);
    if (missionError) throw new Error(missionError.message);
    const mission = missions?.[0];
    if (!mission) return res.status(404).json({ error: "No matching Testnet mission found for the active quote" });

    const { data: jobs, error: jobError } = await supabase
      .from("jobs")
      .select("id,mission_task_id,status,chain_job_id,created_at")
      .eq("client_wallet", auth.user.wallet_address)
      .order("created_at", { ascending: false })
      .limit(20);
    if (jobError) throw new Error(jobError.message);

    const { data: tasks, error: taskError } = await supabase
      .from("mission_tasks")
      .select("id,mission_id,agent_id")
      .eq("mission_id", mission.id);
    if (taskError) throw new Error(taskError.message);
    const taskIds = new Set((tasks || []).map((task) => task.id));
    const job = (jobs || []).find((candidate) => taskIds.has(candidate.mission_task_id));
    if (!job) return res.status(404).json({ error: "No marketplace job found for the active Testnet mission" });

    return res.status(200).json({ ok: true, network: "bsc-testnet", chain_id: 97, environment: "testnet", mission, job, quote });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : "Unable to load active Testnet quote" });
  }
}
