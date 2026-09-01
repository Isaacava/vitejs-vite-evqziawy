import { useState } from "react";

type ExternalAgent = {
  id: string;
  name: string;
  description: string;
  chain: string;
  service: string;
  score: number | null;
  feedback: number | null;
  owner: string;
};

function firstArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  for (const key of ["agents", "data", "items", "results"]) {
    if (Array.isArray(record[key])) return record[key] as unknown[];
    if (record[key] && typeof record[key] === "object") {
      const nested = firstArray(record[key]);
      if (nested.length) return nested;
    }
  }
  return [];
}

function text(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function numberOrNull(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeAgent(value: unknown, index: number): ExternalAgent {
  const a = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const chain = a.chain && typeof a.chain === "object" ? a.chain as Record<string, unknown> : {};
  const owner = text(a.owner, text(a.owner_address, text(a.ownerAddress, "")));
  return {
    id: text(a.agent_id, text(a.agentId, text(a.id, String(index)))),
    name: text(a.name, `ERC-8004 Agent #${text(a.agent_id, text(a.agentId, String(index)))}`),
    description: text(a.description, "No description supplied."),
    chain: text(a.chainName, text(chain.name, text(a.network, "ERC-8004"))),
    service: text(a.service, text(a.service_type, text(a.serviceType, "Agent"))),
    score: numberOrNull(a.score ?? a.reputationScore ?? a.reputation_score),
    feedback: numberOrNull(a.feedbackCount ?? a.feedback_count ?? a.feedbacks),
    owner,
  };
}

export default function ERC8004DiscoveryPanel() {
  const [query, setQuery] = useState("");
  const [agents, setAgents] = useState<ExternalAgent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function searchAgents() {
    const q = query.trim();
    if (!q) return;
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/8004scan?q=${encodeURIComponent(q)}&limit=8`);
      const body = await response.json() as { data?: unknown; error?: string };
      if (!response.ok) throw new Error(body.error || "8004scan search failed");
      setAgents(firstArray(body.data).map(normalizeAgent));
    } catch (e) {
      setAgents([]);
      setError(e instanceof Error ? e.message : "Unable to search ERC-8004 agents");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="mt-8 bg-[#fbfaf5] border border-[#d5cfbf] rounded-[26px_10px_28px_13px] p-5">
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 mb-4">
        <div>
          <div className="font-mono text-[9.5px] uppercase tracking-wide text-[#8a8477]">External agent inventory</div>
          <h2 className="text-[20px] font-bold mt-1">Search the ERC-8004 ecosystem</h2>
          <p className="text-[11px] text-[#6d6a61] mt-1 max-w-[720px]">
            AgentMarket can discover agents registered outside our first-party inventory. Results come through our server-side 8004scan adapter, so credentials never live in the browser.
          </p>
        </div>
        <span className="font-mono text-[10px] text-[#6d6a61]">ERC-8004 · 8004scan</span>
      </div>

      <form
        className="flex flex-col sm:flex-row gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void searchAgents();
        }}
      >
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="e.g. BNB portfolio risk monitoring"
          className="flex-1 rounded-[12px_6px_13px_7px] border border-[#d5cfbf] bg-white px-3 py-2.5 text-[12px] outline-none"
        />
        <button
          type="submit"
          disabled={loading || !query.trim()}
          className="rounded-[12px_6px_13px_7px] bg-[#171714] text-[#fbfaf5] px-5 py-2.5 text-[11px] font-semibold disabled:opacity-50"
        >
          {loading ? "Searching…" : "Search ecosystem"}
        </button>
      </form>

      {error && <div className="mt-3 text-[11px] text-[#9b4733]">{error}</div>}

      {!loading && agents.length > 0 && (
        <div className="grid md:grid-cols-2 gap-3 mt-5">
          {agents.map((agent) => (
            <article key={`${agent.id}-${agent.owner}`} className="border border-[#e2ddcf] rounded-[16px_7px_17px_8px] p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <strong className="text-[13px]">{agent.name}</strong>
                  <div className="text-[10px] text-[#8a8477] mt-0.5">#{agent.id} · {agent.chain}</div>
                </div>
                <span className="font-mono text-[9px] text-[#6d6a61]">{agent.service}</span>
              </div>
              <p className="text-[10.5px] leading-4 text-[#6d6a61] mt-2 line-clamp-3">{agent.description}</p>
              <div className="flex flex-wrap gap-3 mt-3 pt-3 border-t border-dashed border-[#d5cfbf] font-mono text-[9.5px] text-[#6d6a61]">
                <span>Score: {agent.score == null ? "—" : Math.round(agent.score)}</span>
                <span>Feedback: {agent.feedback == null ? "—" : agent.feedback}</span>
                {agent.owner && <span>{agent.owner.slice(0, 6)}…{agent.owner.slice(-4)}</span>}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
