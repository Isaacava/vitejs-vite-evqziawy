import type { VercelRequest, VercelResponse } from "@vercel/node";
import matchHandler from "../match.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  req.body = {
    ...(req.body && typeof req.body === "object" ? req.body : {}),
    environment: "testnet",
  };
  return matchHandler(req, res);
}
