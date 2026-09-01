import type { VercelRequest, VercelResponse } from "@vercel/node";
import indexer from "../server/_testnet/erc8183-indexer.js";
import autoSettlement from "../server/_testnet/auto-settlement.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const mode = typeof req.query?.mode === "string" ? req.query.mode : "index";
  if (mode === "settlement") return autoSettlement(req, res);
  return indexer(req, res);
}
