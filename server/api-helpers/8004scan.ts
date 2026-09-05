import type { VercelRequest, VercelResponse } from "@vercel/node";

const BASE_URL = "https://api.8004scan.io/api/v1";

function clean(value: unknown, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const q = clean(req.query?.q);
  const chainId = clean(req.query?.chainId);
  const limit = Math.min(Math.max(Number(req.query?.limit || 8), 1), 24);
  const page = Math.max(Number(req.query?.page || 1), 1);

  try {
    const apiKey = process.env.EIGHT004SCAN_API_KEY || process.env.ERC8004SCAN_API_KEY || "";
    const headers: Record<string, string> = { Accept: "application/json" };
    if (apiKey) headers["X-API-Key"] = apiKey;

    const url = q
      ? new URL(`${BASE_URL}/agents/search/semantic`)
      : new URL(`${BASE_URL}/agents`);

    if (q) {
      url.searchParams.set("q", q);
      url.searchParams.set("limit", String(limit));
    } else {
      url.searchParams.set("page", String(page));
      url.searchParams.set("limit", String(limit));
      if (chainId) url.searchParams.set("chainId", chainId);
    }

    const upstream = await fetch(url, { headers });
    const text = await upstream.text();
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      body = { raw: text };
    }

    if (!upstream.ok) {
      return res.status(upstream.status).json({
        error: "8004scan request failed",
        upstream: body,
      });
    }

    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=300");
    return res.status(200).json({
      source: "8004scan",
      query: q || null,
      chainId: chainId || null,
      page,
      limit,
      data: body,
    });
  } catch (error) {
    return res.status(502).json({
      error: error instanceof Error ? error.message : "Unable to reach 8004scan",
    });
  }
}
