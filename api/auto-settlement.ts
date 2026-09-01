import type { VercelRequest, VercelResponse } from "@vercel/node";
import autoSettlement from "../server/_testnet/auto-settlement.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  return autoSettlement(req, res);
}
