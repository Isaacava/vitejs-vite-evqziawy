import type { VercelRequest, VercelResponse } from "@vercel/node";
import indexer from "../server/_testnet/erc8183-indexer.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  return indexer(req, res);
}
