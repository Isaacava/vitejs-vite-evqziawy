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

const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "create", "do", "for", "from", "get", "give",
  "has", "have", "how", "i", "in", "include", "into", "is", "it", "me", "my", "named", "of", "on",
  "or", "please", "provide", "that", "the", "this", "to", "user", "with", "you", "your",
]);

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

  const words = text.split(" ").filter((word) => (word.length >= 3 || word === "cv") && !STOP_WORDS.has(word));
  const phraseKeywords = CATEGORY_RULES.flatMap((rule) => rule.terms.filter((term) => text.includes(term)));
  const keywords = Array.from(
    new Set([
      ...words,
      ...phraseKeywords,
      ...(category !== "other" ? [category] : []),
    ])
  ).slice(0, 16);

  return {
    raw,
    goal: raw || "Find an agent for my DeFi goal",
    category,
    risk,
    keywords,
  };
}
