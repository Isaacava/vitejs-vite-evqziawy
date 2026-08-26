import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getAuthenticatedUser } from "../../src/server/authHandlers.js";

const GRID_AGENT_URL = "https://grid-agent-testnet-v4-production.up.railway.app";
const SHARED_SECRET = process.env.GRID_EXECUTION_SHARED_SECRET || "";

function validHash(value: string): value is `0x${string}` {
  return /^0x[a-fA-F0-9]{64}$/.test(value);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const auth = await getAuthenticatedUser(req);
  if (!auth) return res.status(401).json({ error: "Authentication required" });

  const txHash = typeof req.query.tx_hash === "string" ? req.query.tx_hash.trim() : "";
  if (!validHash(txHash)) {
    return res.status(400).json({ error: "tx_hash must be a 32-byte transaction hash" });
  }

  if (!SHARED_SECRET) {
    return res.status(503).json({ error: "Grid execution receipt verification is not configured" });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const response = await fetch(`${GRID_AGENT_URL}/erc8183/receipt/${txHash}`, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${SHARED_SECRET}`,
      },
      signal: controller.signal,
    });

    const body = await response.json().catch(() => null);
    if (!response.ok) {
      return res.status(response.status).json({
        error: body?.error || body?.detail || "Grid execution receipt observer failed",
      });
    }

    return res.status(200).json({
      ok: true,
      network: "bsc-testnet",
      chain_id: 97,
      transaction_hash: txHash,
      receipt: body?.result ?? body,
    });
  } catch (cause) {
    const detail = cause instanceof Error && cause.name === "AbortError"
      ? "Grid execution receipt observer timed out"
      : cause instanceof Error
        ? cause.message
        : "Grid execution receipt observer unavailable";
    return res.status(503).json({ error: detail });
  } finally {
    clearTimeout(timeout);
  }
}
