import { useEffect, useState } from "react";
import type { Hex } from "viem";
import "./mission-console.css";

type ResultResponse = {
  chain_job_id: number;
  chain_status: number;
  provider: `0x${string}`;
  client: `0x${string}`;
  submitted_at: number;
  onchain_deliverable_hash: Hex;
  computed_deliverable_hash: Hex;
  verified: boolean;
  response_bytes: number;
  endpoint: string;
  agent_id: string;
  agent_name: string | null;
  content: unknown;
};

const STATUS: Record<number, string> = { 0: "OPEN", 1: "FUNDED", 2: "SUBMITTED", 3: "COMPLETED", 4: "REJECTED", 5: "EXPIRED" };
const short = (value: string) => value.length > 18 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value;

export default function TestnetJobResult() {
  const params = new URLSearchParams(window.location.search);
  const jobParam = params.get("job") || "";
  const [data, setData] = useState<ResultResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!/^\d+$/.test(jobParam)) {
        setError("Missing or invalid Testnet chain job ID.");
        setLoading(false);
        return;
      }
      try {
        const response = await fetch(`/api/testnet/job-result?job=${encodeURIComponent(jobParam)}`, { credentials: "include", cache: "no-store" });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error || "Unable to verify the submitted result.");
        if (!cancelled) setData(body as ResultResponse);
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Unable to verify the submitted result.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [jobParam]);

  return (
    <main className="console-page">
      <div className="console-shell">
        <header className="console-nav"><a href="/missions" className="console-brand">← Missions</a><span>ERC-8183 RESULT EVIDENCE</span><a href="/testnet">Sandbox →</a></header>
        {error && <div className="console-alert console-alert-error">{error}</div>}
        <section className="console-hero">
          <div><span className="console-kicker">BSC TESTNET / CHAIN 97 / ERC-8183</span><h1>Agent result &amp; proof</h1><p>The provider's public result is fetched server-side. AgentMarket computes keccak256 over the exact response bytes and compares it with the deliverable hash anchored on ERC-8183 before showing the result as verified.</p></div>
          <div className="console-state"><small>CHAIN JOB</small><strong>#{jobParam || "—"}</strong><span>{data ? STATUS[data.chain_status] || "UNKNOWN" : loading ? "READING…" : "UNAVAILABLE"}</span></div>
        </section>
        {data && <>
          <section className="console-grid">
            <article className="console-card"><div className="console-section-head"><span>ON-CHAIN PROOF</span><b>{data.verified ? "VERIFIED" : "MISMATCH"}</b></div><div className="console-stat"><span>Provider / Agent</span><strong>{short(data.provider)}</strong></div><div className="console-stat"><span>Agent</span><strong>{data.agent_name || `Agent ${data.agent_id}`}</strong></div><div className="console-stat"><span>Client</span><strong>{short(data.client)}</strong></div><div className="console-stat"><span>Chain state</span><strong>{STATUS[data.chain_status] || "UNKNOWN"}</strong></div><div className="console-stat"><span>On-chain deliverable</span><strong>{short(data.onchain_deliverable_hash)}</strong></div><div className="console-stat"><span>Computed hash</span><strong>{short(data.computed_deliverable_hash)}</strong></div></article>
            <article className="console-card"><div className="console-section-head"><span>PROVIDER EVIDENCE</span><b>{data.verified ? "MATCH" : "DO NOT TRUST"}</b></div><div className="console-stat"><span>Endpoint</span><strong>{data.endpoint}</strong></div><div className="console-stat"><span>Response bytes</span><strong>{data.response_bytes.toLocaleString()}</strong></div><p className="console-evidence">A match means the exact bytes returned by the provider hash to the same commitment stored by the ERC-8183 Commerce contract. The server verifies the bytes before returning the artifact to this page.</p></article>
          </section>
          <section className="console-card"><div className="console-section-head"><span>AGENT DELIVERABLE</span><b>{data.verified ? "CHAIN VERIFIED" : "DO NOT TRUST"}</b></div><pre style={{ margin: 0, padding: 16, overflowX: "auto", whiteSpace: "pre-wrap", wordBreak: "break-word", borderRadius: 12, background: "rgba(0,0,0,.05)" }}>{typeof data.content === "string" ? data.content : JSON.stringify(data.content, null, 2)}</pre></section>
        </>}
        {!loading && !error && !data && <section className="console-card"><p className="console-evidence">No verified provider result is currently available.</p></section>}
      </div>
    </main>
  );
}
