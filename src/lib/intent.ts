export type MarketplaceIntent = {
  raw: string;
  goal: string;
  category: string;
  risk: "low" | "medium" | "high";
  keywords: string[];
};

const CATEGORY_RULES: Array<{ category: string; terms: string[] }> = [
  { category: "rebalancing", terms: ["rebalance", "rebalancing", "portfolio", "allocation", "balance"] },
  { category: "grid_trading", terms: ["grid", "range", "trading bot", "trade automatically"] },
  { category: "yield", terms: ["yield", "apy", "earn", "lending", "liquidity", "interest"] },
  { category: "health_factor", terms: ["health factor", "borrow", "lending", "liquidation", "leverage", "risk"] },
];

const RISK_TERMS = {
  low: ["conservative", "safe", "protect", "low risk", "preserve"],
  high: ["aggressive", "leverage", "maximum", "high risk", "high return"],
};

function normalize(text: string) {
  return text.toLowerCase().replace(/[^a-z0-9\s-]/g, " ").replace(/\s+/g, " ").trim();
}

export function parseMarketplaceIntent(input: string): MarketplaceIntent {
  const raw = input.trim();
  const text = normalize(raw);

  let category = "other";
  let bestHits = 0;

  for (const rule of CATEGORY_RULES) {
    const hits = rule.terms.filter((term) => text.includes(term)).length;
    if (hits > bestHits) {
      bestHits = hits;
      category = rule.category;
    }
  }

  const highRisk = RISK_TERMS.high.some((term) => text.includes(term));
  const lowRisk = RISK_TERMS.low.some((term) => text.includes(term));
  const risk: MarketplaceIntent["risk"] = highRisk ? "high" : lowRisk ? "low" : "medium";

  const keywords = Array.from(
    new Set([
      ...text.split(" ").filter((word) => word.length >= 4),
      ...(category !== "other" ? [category] : []),
    ])
  ).slice(0, 12);

  return {
    raw,
    goal: raw || "Find an agent for my DeFi goal",
    category,
    risk,
    keywords,
  };
}
