import { useEffect, useState } from "react";
import { keccak256, type Hex } from "viem";
import { COMMERCE_ABI, ERC8183_ADDRESSES, publicClient } from "./lib/erc8183";
import "./mission-console.css";

type ChainJob = {
  id: bigint;
  client: `0x${string}`;
  provider: `0x${string}`;
  status: number;
  submittedAt: bigint;
  deliverable: Hex;
};

const STATUS: Record<number, string> = { 0: "OPEN", 1: "FUNDED", 2: "SUBMITTED", 3: "COMPLETED", 4: "REJECTED", 5: "EXPIRED" };
const short = (value: string) => value.length > 18 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value;
const zeroHash = "0x0000000000000000000000000000000000000000000000000000000000000000" as Hex;

async function readChainJob(jobId: bigint): Promise<ChainJob> {
  return publicClient.readContract({ address: ERC8183_ADDRESSES.commerce, abi: COMMERCE_ABI, functionName: "getJob", args: [jobId] }) as Promise<ChainJob>;
}

async function resolveAgentEndpoint(provider: string): Promise<string> {
  const response = await fetch(`/api/agent-by-provider?provider=${encodeURIComponent(provider)}`, { credentials: "include" });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "Agent endpoint is unavailable.");
  if (!body.endpoint) throw new Error("No public ERC-8183 endpoint is registered for this provider.");
  return String(body.endpoint).replace(/\/$/, "");
}

export default function TestnetJobResult() {
  const params = new URLSearchParams(window.location.search);
  const jobParam = params.get("job") || "";
  const [job, setJob] = useState<ChainJob | null>(null);
  const [result, setResult] = useState<unknown>(null);
  const [rawBytes, setRawBytes] = useState<Uint8Array | null>(null);
  const [computedHash, setComputedHash] = useState<Hex | null>(null);
  const [endpoint, setEndpoint] = useState("");
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
        const chainJob = await readChainJob(BigInt(jobParam));
        if (chainJob.id === 0n) throw new Error("The ERC-8183 job does not exist.");
        if (chainJob.status !== 2 && chainJob.status !== 3) throw new Error(`Job #${jobParam} is ${STATUS[chainJob.status] || "not submitted"}. A deliverable is not available yet.`);

        const providerEndpoint = await resolveAgentEndpoint(chainJob.provider);
        const response = await fetch(`${providerEndpoint}/job/${jobParam}/response`, { cache: "no-store" });
        if (!response.ok) throw new Error(`Agent result endpoint returned HTTP ${response.status}.`);
        const bytes = new Uint8Array(await response.arrayBuffer());
        const hash = keccak256(bytes);
        const text = new TextDecoder().decode(bytes);
        let parsed: unknown = text;
        try { parsed = JSON.parse(text); } catch { /* keep raw text */ }

        if (cancelled) return;
        setJob(chainJob);
        setEndpoint(providerEndpoint);
        setRawBytes(bytes);
        setComputedHash(hash);
        setResult(parsed);
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Unable to load the submitted result.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [jobParam]);

  const verified = !!job && !!computedHash && job.deliverable.toLowerCase() === computedHash.toLowerCase();

  return (
    <main className="console-page">
      <div className="console-shell">
        <header className="console-nav"><a href="/missions" className="console-brand">← Missions</a><span>ERC-8183 RESULT EVIDENCE</span><a href="/testnet">Sandbox →</a></header>
        {error && <div className="console-alert console-alert-error">{error}</div>}
        <section className="console-hero">
          <div><span className="console-kicker">BSC TESTNET / CHAIN 97 / ERC-8183</span><h1>Agent result &amp; proof</h1><p>The full deliverable is read from the provider's public ERC-8183 endpoint. AgentMarket computes keccak256 over the exact response bytes and compares it with the hash anchored on-chain.</p></div>
          <div className="console-state"><small>CHAIN JOB</small><strong>#{jobParam || "—"}</strong><span>{job ? STATUS[job.status] || "UNKNOWN" : loading ? "READING…" : "UNAVAILABLE"}</span></div>
        </section>
        {job && <section className="console-grid">
          <article className="console-card"><div className="console-section-head"><span>ON-CHAIN PROOF</span><b>{verified ? "VERIFIED" : "MISMATCH"}</b></div><div className="console-stat"><span>Provider / Agent</span><strong>{short(job.provider)}</strong></div><div className="console-stat"><span>Client</span><strong>{short(job.client)}</strong></div><div className="console-stat"><span>Chain state</span><strong>{STATUS[job.status] || "UNKNOWN"}</strong></div><div className="console-stat"><span>On-chain deliverable</span><strong>{job.deliverable === zeroHash ? "Missing" : short(job.deliverable)}</strong></div><div className="console-stat"><span>Computed from result bytes</span><strong>{computedHash ? short(computedHash) : "—"}</strong></div></article>
          <article className="console-card"><div className="console-section-head"><span>PROVIDER EVIDENCE</span><b>{verified ? "MATCH" : "UNVERIFIED"}</b></div><div className="console-stat"><span>Endpoint</span><strong>{endpoint || "—"}</strong></div><div className="console-stat"><span>Response bytes</span><strong>{rawBytes ? rawBytes.length.toLocaleString() : "—"}</strong></div><p className="console-evidence">A match means the exact bytes returned by the provider hash to the same deliverable commitment stored by ERC-8183. A mismatch means the returned artifact must not be treated as verified.</p></article>
        </section>}
        {result !== null && <section className="console-card"><div className="console-section-head"><span>AGENT DELIVERABLE</span><b>{verified ? "CHAIN VERIFIED" : "DO NOT TRUST"}</b></div><pre style={{ margin: 0, padding: 16, overflowX: "auto", whiteSpace: "pre-wrap", wordBreak: "break-word", borderRadius: 12, background: "rgba(0,0,0,.05)" }}>{typeof result === "string" ? result : JSON.stringify(result, null, 2)}</pre></section>}
        {!loading && !error && !result && <section className="console-card"><p className="console-evidence">No result artifact is currently available from the provider.</p></section>}
      </div>
    </main>
  );
}
