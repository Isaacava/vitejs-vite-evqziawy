import { useEffect, useState } from "react";
import ERC8004DiscoveryPanel from "./ERC8004DiscoveryPanel";

type Match = {
  agent: { agent_id: string; name: string | null; description: string | null; category: string; status?: string | null; verification_status?: string | null };
  score: number;
  scoreConfidence?: string;
  hireability?: { status: string; canCreateJob: boolean };
  reasons?: string[];
  execution?: {
    wallet_provider: "altana" | "twak" | "evm" | "unknown";
    wallet_model: "agent_owned" | "external" | "unknown";
    transaction_authority: "scoped_session" | "agent_wallet" | "restricted_commands" | "unknown";
    supports_spend_cap: boolean;
    supports_call_allowlist: boolean;
    supports_expiry: boolean;
    supports_revocation: boolean;
    evidence?: string[];
  };
  commerce?: { erc8183: boolean; x402: boolean; b402: boolean };
  communication?: { a2a: boolean; mcp: boolean; http: boolean };
  onchain?: {
    totalJobs: number;
    completedJobs: number;
    submittedJobs: number;
    fundedJobs: number;
    terminalJobs: number;
    successRate: number | null;
    feedbackCount: number;
    reputationScore: number | null;
  } | null;
};

type MatchResponse = { bestMatch: Match | null; bestHireableMatch?: Match | null };

const goals = [
  "Manage my BNB portfolio conservatively",
  "Find a safe yield strategy for my idle assets",
  "Monitor my lending health factor and liquidation risk",
  "Run a controlled grid strategy",
];

const human = (v: string) => v.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
const badge = (m: Match) => m.hireability?.canCreateJob ? "Available" : m.hireability?.status === "degraded" ? "Busy" : "Discoverable";
const initials = (v: string) => v.split(/\s+/).map(s => s[0]).join("").slice(0, 2).toUpperCase() || "AM";

function capabilityPill(label: string, active: boolean) {
  return active ? <span key={label} className="px-2 py-1 rounded-full border border-[#b9d7c7] bg-[#edf6f0] text-[#2d6b4f] text-[9px] font-mono">{label}</span> : null;
}

function walletLabel(provider: Match["execution"] extends infer E ? E extends { wallet_provider: infer W } ? W : never : never) {
  if (provider === "altana") return "Altana";
  if (provider === "twak") return "TWAK";
  if (provider === "evm") return "EVM wallet";
  return "Wallet unknown";
}

export default function DiscoverPage() {
  const [matches, setMatches] = useState<Match[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    void (async () => {
      try {
        const values = await Promise.all(goals.map(async goal => {
          const r = await fetch("/api/testnet/match", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ goal }),
          });
          if (!r.ok) return null;
          const b = await r.json() as MatchResponse;
          return b.bestHireableMatch || b.bestMatch;
        }));
        const seen = new Set<string>();
        setMatches(values.filter((m): m is Match => !!m && !seen.has(m.agent.agent_id) && (seen.add(m.agent.agent_id), true)).slice(0, 8));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Unable to load marketplace inventory");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return <main className="max-w-[1240px] mx-auto px-6 md:px-8 py-8 font-[Manrope,sans-serif] text-[#171714]">
    <span className="block font-mono text-[9.5px] uppercase tracking-wide text-[#8a8477] mb-4">Marketplace / Discover</span>
    <div className="flex gap-2 flex-wrap mb-5 font-mono text-[10.5px]">
      <span className="px-3.5 py-1.5 rounded-full bg-[#171714] text-[#fbfaf5]">All roles</span>
      {["Data", "Content", "Smart contracts", "Research"].map(x => <span key={x} className="px-3.5 py-1.5 rounded-full border border-[#d5cfbf] bg-[#fbfaf5] text-[#6d6a61]">{x}</span>)}
    </div>
    {error && <div className="mb-4 border border-[#cfad9f] bg-[#f3e6e1] text-[#9b4733] rounded-[14px_8px_15px_9px] px-4 py-3 text-[12px]">{error}</div>}
    {loading ? <div className="py-16 text-[13px] text-[#6d6a61]">Discovering current Testnet agents…</div> : <div className="grid md:grid-cols-2 gap-4">
      {matches.map((m, i) => {
        const jobs = m.onchain?.totalJobs ?? 0;
        const completed = m.onchain?.completedJobs ?? 0;
        const successRate = m.onchain?.successRate;
        const execution = m.execution;
        const commerce = m.commerce;
        const communication = m.communication;
        return <div key={m.agent.agent_id} className={`bg-[#fbfaf5] border border-[#d5cfbf] rounded-[26px_10px_28px_13px] p-[19px] ${i % 2 ? "rotate-[1deg]" : "rotate-[-1deg]"}`}>
          <div className="flex items-center gap-2.5 mb-3">
            <div className="w-10 h-10 rounded-[12px_6px_13px_7px] bg-[#f7ecd3] text-[#9d7428] flex items-center justify-center font-bold text-[13px]">{initials(m.agent.name || m.agent.category)}</div>
            <div>
              <div className="flex items-center gap-1.5"><strong className="text-[14.5px] font-bold">{m.agent.name || `Agent #${m.agent.agent_id}`}</strong>{m.agent.verification_status === "verified" && <span className="text-[#2d6b4f] text-[12px]">✓</span>}</div>
              <div className="text-[11px] text-[#6d6a61]">{human(m.agent.category)}</div>
            </div>
          </div>

          <div className="grid grid-cols-[1fr_auto] gap-1.5 py-2 border-b border-[#e2ddcf]">
            <span className="text-[10.5px] text-[#6d6a61]">Trust score</span>
            <b className="font-mono text-[10.5px]">{Math.round(m.score)}</b>
            <i className="col-span-2 block h-[3px] bg-[#e2ddcf] rounded-full overflow-hidden"><u className="block h-full bg-[#9d7428] rounded-full" style={{ width: `${Math.min(100, Math.round(m.score))}%` }} /></i>
          </div>

          <div className="grid grid-cols-[1fr_auto] gap-1.5 py-2 border-b border-[#e2ddcf]">
            <span className="text-[10.5px] text-[#6d6a61]">Success rate</span>
            <b className="font-mono text-[10.5px]">{successRate === null || successRate === undefined ? "—" : `${Math.round(successRate)}%`}</b>
            <i className="col-span-2 block h-[3px] bg-[#e2ddcf] rounded-full overflow-hidden"><u className="block h-full bg-[#9d7428] rounded-full" style={{ width: `${successRate == null ? 0 : Math.min(100, Math.round(successRate))}%` }} /></i>
          </div>

          <div className="py-2 border-b border-[#e2ddcf]">
            <div className="flex justify-between gap-4 text-[10.5px] text-[#6d6a61]"><span>Completed jobs</span><b className="font-mono text-[10.5px] text-[#171714]">{completed}</b></div>
            <div className="flex justify-between gap-4 text-[10.5px] text-[#6d6a61] mt-1"><span>Total jobs</span><b className="font-mono text-[10.5px] text-[#171714]">{jobs}</b></div>
          </div>

          <div className="py-2 border-b border-[#e2ddcf]">
            <div className="flex items-center justify-between gap-2 mb-2">
              <span className="text-[10.5px] text-[#6d6a61]">Execution</span>
              <span className="font-mono text-[10px] text-[#171714]">{walletLabel(execution?.wallet_provider ?? "unknown")}</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {capabilityPill("ERC-8183", commerce?.erc8183 ?? false)}
              {capabilityPill("A2A", communication?.a2a ?? false)}
              {capabilityPill("MCP", communication?.mcp ?? false)}
              {capabilityPill("x402", commerce?.x402 ?? false)}
              {capabilityPill("B402", commerce?.b402 ?? false)}
              {capabilityPill("Scoped session", execution?.transaction_authority === "scoped_session")}
            </div>
            {execution?.wallet_provider === "unknown" && <div className="mt-2 text-[9.5px] leading-4 text-[#8a8477]">Execution wallet not declared by the agent; AgentMarket does not infer one.</div>}
          </div>

          <div className="flex justify-between items-center mt-3 pt-3 border-t border-dashed border-[#d5cfbf]">
            <span className="font-mono text-[11px] text-[#9d7428]">Testnet · ERC-8004</span>
            <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold text-[#6d6a61]"><i className={`w-1.5 h-1.5 rounded-full ${m.hireability?.canCreateJob ? "bg-[#2d6b4f]" : "bg-[#9d7428]"}`} />{badge(m)}</span>
          </div>
        </div>;
      })}
    </div>}

    <ERC8004DiscoveryPanel />
  </main>;
}
