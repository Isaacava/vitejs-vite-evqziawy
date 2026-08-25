import type { VercelRequest, VercelResponse } from "@vercel/node";

type Handler = (req: VercelRequest, res: VercelResponse) => unknown;

async function loadHandler(route: string): Promise<Handler | null> {
  switch (route) {
    case "active-quote": return (await import("../server/_testnet/active-quote.js")).default as Handler;
    case "auto-settlement": return (await import("../server/_testnet/auto-settlement.js")).default as Handler;
    case "erc8183-settlement": return (await import("../server/_testnet/erc8183-settlement.js")).default as Handler;
    case "erc8183": return (await import("../server/_testnet/erc8183.js")).default as Handler;
    case "execution-capital":
    case "execution-capital-verify": return (await import("../server/_testnet/execution-capital.js")).default as Handler;
    case "execution-capital-execute": return (await import("../server/_testnet/grid-execute.js")).default as Handler;
    case "job-result": return (await import("../server/_testnet/job-result.js")).default as Handler;
    case "job-status": return (await import("../server/_testnet/job-status.js")).default as Handler;
    case "jobs-history": return (await import("../server/_testnet/jobs-history.js")).default as Handler;
    case "match": return (await import("../server/_testnet/match.js")).default as Handler;
    case "prepare-quote": return (await import("../server/_testnet/prepare-quote.js")).default as Handler;
    case "providers": return (await import("../server/_testnet/providers.js")).default as Handler;
    case "quotes": return (await import("../server/_testnet/quotes.js")).default as Handler;
    case "recover-job": return (await import("../server/_testnet/recover-job.js")).default as Handler;
    case "settle-plan": return (await import("../server/_testnet/settle-plan.js")).default as Handler;
    case "sync-agent": return (await import("../server/_testnet/sync-agent.js")).default as Handler;
    case "transaction-preflight": return (await import("../server/_testnet/transaction-preflight.js")).default as Handler;
    default: return null;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const route = typeof req.query?.route === "string" ? req.query.route : "";
  try {
    const target = await loadHandler(route);
    if (!target) return res.status(404).json({ error: "Unknown Testnet API route", route });
    return await target(req, res);
  } catch (error) {
    console.error("Testnet API route failed", { route, error });
    return res.status(500).json({ error: error instanceof Error ? error.message : "Testnet API route failed", route });
  }
}
