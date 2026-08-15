import { useEffect, useState } from "react";
import "./mission-console.css";

type Provider = {
  id: string;
  agent_id: string | null;
  name: string | null;
  owner: string | null;
  status: string | null;
  verification_status: string | null;
  chain: string;
  identity_ready: boolean;
  service_ready: boolean;
  marketplace_ready: boolean;
  endpoint: { url: string; protocol: string | null; version: string | null; status: string | null; status_code: number | null; latency_ms: number | null; last_checked_at: string | null } | null;
  updated_at: string | null;
};

const compact = (value?: string | null) => value ? `${value.slice(0, 8)}…${value.slice(-6)}` : "—";
const time = (value?: string | null) => value ? new Date(value).toLocaleString() : "Never";

export default function TestnetProviderReadiness() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [summary, setSummary] = useState({ total: 0, ready: 0, online: 0, revoked: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/testnet/providers", { credentials: "include" });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error || "Unable to load Testnet providers");
      if (body.network !== "bsc-testnet" || Number(body.chain_id) !== 97) throw new Error("Provider readiness returned a non-Testnet environment.");
      setProviders(Array.isArray(body.providers) ? body.providers : []);
      setSummary(body.summary || { total: 0, ready: 0, online: 0, revoked: 0 });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load Testnet provider readiness");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  return (
    <main className="console-page">
      <div className="console-shell">
        <header className="console-nav">
          <a href="/" className="console-brand">AgentMarket</a>
          <span>TESTNET PROVIDERS</span>
          <a href="/testnet">Sandbox →</a>
        </header>
        {error && <div className="console-alert console-alert-error">{error}</div>}
        <section className="console-hero">
          <div>
            <span className="console-kicker">ERC-8004 / ERC-8183 / BSC TESTNET / 97</span>
            <h1>Provider readiness before hiring.</h1>
            <p>Only providers with a valid Testnet identity and a recent online service check should be eligible for the marketplace hire path.</p>
          </div>
          <div className="console-state"><small>READY</small><strong>{summary.ready}/{summary.total}</strong><span>{summary.online} services online</span></div>
        </section>
        <section className="console-grid">
          <div className="console-card"><div className="console-section-head"><span>IDENTITIES</span><b>{summary.total}</b></div><p className="console-evidence">Agents indexed on BSC Testnet.</p></div>
          <div className="console-card"><div className="console-section-head"><span>MARKETPLACE READY</span><b>{summary.ready}</b></div><p className="console-evidence">Identity + service health + non-revoked status.</p></div>
          <div className="console-card"><div className="console-section-head"><span>REVOKED</span><b>{summary.revoked}</b></div><p className="console-evidence">Excluded from hiring.</p></div>
        </section>
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 16 }}>
          <button className="console-brass-button" type="button" disabled={loading} onClick={() => void load()}>{loading ? "Checking…" : "Refresh readiness →"}</button>
        </div>
        {loading ? <section className="console-card"><p className="console-evidence">Loading Testnet provider state…</p></section> : providers.length === 0 ? <section className="console-card"><p className="console-evidence">No Testnet providers are indexed yet. Register the Grid Agent identity and service first.</p></section> : (
          <section className="console-grid">
            {providers.map((provider) => (
              <article className="console-card" key={provider.id}>
                <div className="console-section-head"><span>{provider.marketplace_ready ? "READY TO HIRE" : "NOT READY"}</span><b>{provider.status || "unknown"}</b></div>
                <h2 style={{ marginTop: 0 }}>{provider.name || "Unnamed agent"}</h2>
                <div className="console-stat"><span>ERC-8004 agent</span><strong>{compact(provider.agent_id)}</strong></div>
                <div className="console-stat"><span>Owner</span><strong>{compact(provider.owner)}</strong></div>
                <div className="console-stat"><span>Identity</span><strong>{provider.identity_ready ? "Ready" : "Missing / revoked"}</strong></div>
                <div className="console-stat"><span>Service</span><strong>{provider.service_ready ? "Online" : provider.endpoint?.status || "Not checked"}</strong></div>
                <div className="console-stat"><span>Last health check</span><strong>{time(provider.endpoint?.last_checked_at)}</strong></div>
                <div className="console-stat"><span>Latency</span><strong>{provider.endpoint?.latency_ms != null ? `${provider.endpoint.latency_ms} ms` : "—"}</strong></div>
                <p className="console-evidence">This view does not probe provider URLs from the browser. It uses the latest server-side health record and Testnet identity data.</p>
              </article>
            ))}
          </section>
        )}
      </div>
    </main>
  );
}
