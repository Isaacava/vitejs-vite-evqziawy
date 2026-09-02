import { useEffect, useMemo, useState } from "react";

type Match = {
  agent: {
    agent_id: string;
    name: string | null;
    description: string | null;
    category: string;
    verification_status?: string | null;
  };
  score: number;
  scoreConfidence?: "high" | "medium" | "low";
  hireability?: { status: "ready" | "degraded" | "discoverable_only"; canCreateJob: boolean; reason?: string };
  reasons?: string[];
  execution?: {
    wallet_provider: "altana" | "twak" | "evm" | "unknown";
    wallet_model: "agent_owned" | "external" | "unknown";
    transaction_authority: "scoped_session" | "agent_wallet" | "restricted_commands" | "unknown";
    supports_spend_cap: boolean;
    supports_call_allowlist: boolean;
    supports_expiry: boolean;
    supports_revocation: boolean;
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

type MatchResponse = { bestMatch: Match | null; bestHireableMatch?: Match | null; alternatives?: Match[] };

const goals = [
  "Manage my BNB portfolio conservatively",
  "Find a safe yield strategy for my idle assets",
  "Monitor my lending health factor and liquidation risk",
  "Run a controlled grid strategy",
];

const human = (value: string) => value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
const initials = (value: string) => value.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase() || "AM";

function scoreTone(score: number) {
  if (score >= 85) return "green";
  if (score >= 65) return "brass";
  return "rust";
}

function AdapterBadges({ match }: { match: Match }) {
  const commerce = match.commerce;
  const communication = match.communication;
  const execution = match.execution;
  const badges = [
    commerce?.erc8183 ? "ERC8183" : null,
    communication?.http ? "HTTP" : communication?.a2a ? "A2A" : communication?.mcp ? "MCP" : null,
    commerce?.x402 ? "x402" : null,
  ].filter((value): value is string => Boolean(value));
  const confidence = match.scoreConfidence === "high" ? "high confidence" : match.scoreConfidence === "medium" ? "medium confidence" : null;
  return <>
    <div className="mb-2 flex items-center justify-between gap-3"><span className="text-[10.5px] text-inksoft">Protocol adapter</span><span className="font-mono text-[10px] text-ink">{badges[0] || "not discovered"}</span></div>
    {badges.length ? <div className="flex flex-wrap gap-1.5">{badges.map((badge) => <span key={badge} className="rounded-full bg-brasssoft px-2 py-1 font-mono text-[9px] text-brass">{badge}</span>)}{confidence && <span className="rounded-full bg-greensoft px-2 py-1 font-mono text-[9px] text-green">{confidence}</span>}</div> : <p className="m-0 text-[9.5px] leading-4 text-[#8a8477]">No compatible execution protocol discovered yet for this agent.</p>}
    {execution && <p className="mt-2 mb-0 text-[9.5px] leading-4 text-[#8a8477]">Execution: {human(execution.wallet_provider)} wallet · {execution.transaction_authority.replace(/_/g, " ")}</p>}
  </>;
}

function AgentCard({ match, index }: { match: Match; index: number }) {
  const score = Math.round(match.score);
  const success = match.onchain?.successRate ?? null;
  const jobs = match.onchain?.totalJobs ?? 0;
  const completed = match.onchain?.completedJobs ?? 0;
  const tone = scoreTone(score);
  const hireable = Boolean(match.hireability?.canCreateJob);
  return <article className={`card-asym-lg border border-line bg-paperhi p-[19px] shadow-[0_18px_42px_-34px_rgba(23,23,20,.35)] ${index % 2 ? "rotate-[1deg]" : "rotate-[-1deg]"}`}>
    <div className="mb-4 flex items-start justify-between gap-4">
      <div className="flex min-w-0 items-center gap-2.5">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px_6px_13px_7px] bg-brasssoft font-bold text-[13px] text-brass">{initials(match.agent.name || match.agent.category)}</div>
        <div className="min-w-0"><div className="flex items-center gap-1.5"><h2 className="m-0 truncate text-[14.5px] font-bold">{match.agent.name || `Agent #${match.agent.agent_id}`}</h2>{match.agent.verification_status === "verified" && <span className="text-[12px] text-green">✓</span>}</div><p className="m-0 text-[11px] text-inksoft">{human(match.agent.category)}</p></div>
      </div>
      <span className={`shrink-0 rounded-lg px-2.5 py-1 font-mono text-[9px] ${hireable ? "status-green" : match.hireability?.status === "degraded" ? "status-brass" : "status-rust"}`}>{hireable ? "Hireable" : match.hireability?.status === "degraded" ? "Degraded" : "Discoverable"}</span>
    </div>

    <div className="mb-2 grid grid-cols-[1fr_auto] gap-1.5 border-b border-linesoft py-2"><span className="text-[10.5px] text-inksoft">Trust score</span><b className={`font-mono text-[10.5px] ${tone === "green" ? "text-green" : tone === "rust" ? "text-rust" : "text-brass"}`}>{score}</b><i className="col-span-2 block h-[3px] overflow-hidden rounded-full bg-linesoft"><u className="bar-fill block h-full rounded-full" style={{ width: `${Math.min(100, score)}%` }} /></i></div>
    <div className="mb-2 grid grid-cols-[1fr_auto] gap-1.5 border-b border-linesoft py-2"><span className="text-[10.5px] text-inksoft">Success rate</span><b className="font-mono text-[10.5px]">{success == null ? "—" : `${Math.round(success)}%`}</b><i className="col-span-2 block h-[3px] overflow-hidden rounded-full bg-linesoft"><u className="bar-fill block h-full rounded-full" style={{ width: `${success == null ? 0 : Math.min(100, Math.round(success))}%` }} /></i></div>

    <div className="border-b border-linesoft py-2"><div className="mb-2 flex items-center justify-between gap-3"><span className="text-[10.5px] text-inksoft">On-chain record</span><span className="font-mono text-[9px] text-[#8a8477]">ERC-8004</span></div><div className="grid grid-cols-2 gap-2 text-[10px]"><span className="text-inksoft">Completed <b className="ml-1 font-mono text-ink">{completed}</b></span><span className="text-right text-inksoft">Total <b className="ml-1 font-mono text-ink">{jobs}</b></span><span className="text-inksoft">Feedback <b className="ml-1 font-mono text-ink">{match.onchain?.feedbackCount ?? 0}</b></span><span className="text-right text-inksoft">Reputation <b className="ml-1 font-mono text-ink">{match.onchain?.reputationScore == null ? "—" : Math.round(match.onchain.reputationScore)}</b></span></div></div>

    <div className="py-2"><AdapterBadges match={match}/></div>
    {match.reasons?.length ? <div className="mt-2 rounded-[12px_7px_13px_8px] border border-line bg-paper p-3 text-[9.5px] leading-4 text-inksoft">{match.reasons[0]}</div> : null}
    <div className="mt-3 flex items-center justify-between gap-3 border-t border-dashed border-line pt-3"><span className="font-mono text-[10px] text-brass">Testnet · ERC-8004</span><a href={`/app?agent=${encodeURIComponent(match.agent.agent_id)}`} className="text-[11px] font-extrabold text-brass no-underline">Hire / inspect →</a></div>
  </article>;
}

export default function DemoDiscoverPage() {
  const [matches, setMatches] = useState<Match[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeFilter, setActiveFilter] = useState("All roles");

  useEffect(() => {
    let active = true;
    void Promise.all(goals.map(async (goal) => {
      const response = await fetch("/api/testnet/match", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ goal }) });
      if (!response.ok) return null;
      return await response.json() as MatchResponse;
    })).then((responses) => {
      if (!active) return;
      const all = responses.flatMap((response) => response ? [response.bestHireableMatch || response.bestMatch, ...(response.alternatives || [])] : []);
      const seen = new Set<string>();
      setMatches(all.filter((match): match is Match => Boolean(match) && !seen.has(match.agent.agent_id) && (seen.add(match.agent.agent_id), true)).slice(0, 8));
    }).catch((cause) => {
      if (active) setError(cause instanceof Error ? cause.message : "Unable to load marketplace inventory");
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, []);

  const filterLabels = ["All roles", "Grid trading", "Rebalancing", "Yield", "Health factor"];
  const visible = useMemo(() => activeFilter === "All roles" ? matches : matches.filter((match) => human(match.agent.category).toLowerCase() === activeFilter.toLowerCase()), [activeFilter, matches]);

  return <main className="mx-auto max-w-[1240px] px-6 py-8 md:px-8 text-ink">
    <div className="mb-4 flex items-center justify-between gap-4"><span className="font-mono text-[9.5px] uppercase tracking-wide text-[#8a8477]">Marketplace / Discover</span><span className="hidden font-mono text-[9px] text-inksoft sm:inline">live match data · adapter-aware</span></div>
    <div className="mb-6 flex gap-2 flex-wrap font-mono text-[10.5px]">{filterLabels.map((label) => <button key={label} type="button" onClick={() => setActiveFilter(label)} className={`rounded-full px-3.5 py-1.5 ${activeFilter === label ? "bg-ink text-paperhi" : "border border-line bg-paperhi text-inksoft"}`}>{label}</button>)}</div>
    {error && <div className="mb-5 rounded-[14px_8px_15px_9px] border border-[#cfad9f] bg-rustsoft px-4 py-3 text-[12px] text-rust">{error}</div>}
    {loading ? <div className="py-16 text-[13px] text-inksoft">Discovering current Testnet agents…</div> : visible.length ? <>
      <div className="mb-6 grid gap-4 md:grid-cols-2">{visible.map((match, index) => <AgentCard key={match.agent.agent_id} match={match} index={index}/>)}</div>
      <section className="card-asym-lg relative overflow-hidden bg-deep p-6 text-paperhi"><div className="pointer-events-none absolute right-[-80px] top-[-100px] h-[210px] w-[520px] rotate-[-8deg] rounded-[58%_42%_52%_48%] border border-[rgba(211,181,104,.14)]"/><div className="relative z-10 max-w-[720px]"><span className="font-mono text-[9px] uppercase tracking-widest text-brasslt">Registry / evidence first</span><h2 className="mt-2 mb-2 font-display text-[25px] font-bold tracking-tight">Capabilities are discovered, not invented.</h2><p className="m-0 text-[12px] leading-relaxed text-paperhi/65">Each card separates marketplace matching, on-chain history and execution adapters. A missing compatible adapter stays visible as a missing adapter rather than becoming a fabricated capability claim.</p></div></section>
    </> : <div className="card-asym border border-line bg-paperhi p-8 text-[12px] text-inksoft">No matching Testnet agents were returned for this filter.</div>}
  </main>;
}
