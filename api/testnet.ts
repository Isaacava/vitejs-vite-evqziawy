import type { VercelRequest, VercelResponse } from "@vercel/node";
import { serverClient } from "../server/_auth.js";

type Handler = (req: VercelRequest, res: VercelResponse) => unknown;

async function normalizeExecutionEvidenceJob(req: VercelRequest, route: string) {
  if (route !== "execution-evidence") return;
  const rawJob = typeof req.query?.job === "string" ? req.query.job.trim() : "";
  if (!rawJob || /^\d+$/.test(rawJob)) return;

  const supabase = serverClient();
  const { data, error } = await supabase
    .from("jobs")
    .select("id,chain_job_id")
    .eq("id", rawJob)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (data?.chain_job_id === null || data?.chain_job_id === undefined) {
    throw new Error("Marketplace job has no ERC-8183 chain job ID yet");
  }

  req.query = { ...req.query, job: String(data.chain_job_id) };
}

async function normalizeExecutionCapitalJob(req: VercelRequest, route: string) {
  if (!new Set(["execution-capital-requirement", "execution-authorization-status"]).has(route)) return;
  const rawJob = typeof req.query?.job === "string" ? req.query.job.trim() : "";
  if (!rawJob || !/^\d+$/.test(rawJob)) return;

  const supabase = serverClient();
  const { data, error } = await supabase
    .from("jobs")
    .select("id,chain_job_id")
    .eq("chain_job_id", Number(rawJob))
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data?.id) throw new Error("Marketplace job could not be resolved from the ERC-8183 chain job ID");

  req.query = { ...req.query, job: String(data.id) };
}

async function loadHandler(route: string): Promise<Handler | null> {
  switch (route) {
    case "active-quote": return (await import("../server/_testnet/active-quote.js")).default as Handler;
    case "auto-settlement": return (await import("../server/_testnet/auto-settlement.js")).default as Handler;
    case "erc8183-indexer": return (await import("../server/_testnet/erc8183-indexer.js")).default as Handler;
    case "erc8183-settlement": return (await import("../server/_testnet/erc8183-settlement.js")).default as Handler;
    case "erc8183": return (await import("../server/_testnet/erc8183.js")).default as Handler;
    case "execution-capital":
      return (await import("../server/_testnet/execution-capital.js")).default as Handler;
    case "execution-capital-verify": return (await import("../server/_testnet/execution-capital.js")).default as Handler;
    case "execution-capital-verify-passkey": return (await import("../server/_testnet/execution-capital-verify-passkey.js")).default as Handler;
    case "execution-capital-preflight": return (await import("../server/_testnet/execution-capital-preflight.js")).default as Handler;
    case "execution-capital-requirement": return (await import("../server/_testnet/execution-capital-requirement.js")).default as Handler;
    case "execution-decision": return (await import("../server/_testnet/execution-decision.js")).default as Handler;
    case "execution-evidence": return (await import("../server/_testnet/execution-evidence-fixed.js")).default as Handler;
    case "execution-authorization-prepare": return (await import("../server/_testnet/execution-authorization-prepare.js")).default as Handler;
    case "execution-authorization-status": return (await import("../server/_testnet/execution-authorization-status.js")).default as Handler;
    case "execution-wallet": return (await import("../server/_testnet/execution-wallet.js")).default as Handler;
    case "provider-operations": return (await import("../server/_testnet/provider-operations.js")).default as Handler;
    case "job-result": return (await import("../server/_testnet/job-result.js")).default as Handler;
    case "job-status": return (await import("../server/_testnet/job-status.js")).default as Handler;
    case "jobs-history": return (await import("../server/_testnet/jobs-history.js")).default as Handler;
    case "match": return (await import("../server/_testnet/match-federated.js")).default as Handler;
    case "prepare-quote": return (await import("../server/_testnet/prepare-quote-open.ts")).default as Handler;
    case "providers": return (await import("../server/_testnet/providers.js")).default as Handler;
    case "quotes": return (await import("../server/_testnet/quotes.js")).default as Handler;
    case "recover-job": return (await import("../server/_testnet/recover-job.js")).default as Handler;
    case "settle-plan": return (await import("../server/_testnet/settle-plan.js")).default as Handler;
    case "sync-agent": return (await import("../server/_testnet/sync-agent.js")).default as Handler;
    case "transaction-preflight": return (await import("../server/_testnet/transaction-preflight.js")).default as Handler;
    case "agent-adapter-resolution": return (await import("../server/_testnet/agent-adapter-resolution.js")).default as Handler;
    case "capabilities": return (await import("../server/_testnet/capabilities.js")).default as Handler;
    default: return null;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const route = typeof req.query?.route === "string" ? req.query.route : "";
  try {
    await normalizeExecutionEvidenceJob(req, route);
    await normalizeExecutionCapitalJob(req, route);
    const target = !((req.method === "GET") || req.query?.action === "verify" || req.body?.action === "verify") && route === "execution-capital"
      ? (await import("../server/_testnet/execution-authorization-prepare.js")).default as Handler
      : await loadHandler(route);
    if (!target) return res.status(404).json({ error: "Unknown Testnet API route", route });
    return await target(req, res);
  } catch (error) {
    console.error("Testnet API route failed", { route, error });
    return res.status(500).json({ error: error instanceof Error ? error.message : "Testnet API route failed", route });
  }
}
