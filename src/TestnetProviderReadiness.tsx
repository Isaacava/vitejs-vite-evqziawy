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
  verification_ready: boolean;
  service_ready: boolean;
  marketplace_ready: boolean;
  blocking_reasons: string[];
  endpoint: {
    url: string;
    protocol: string | null;
    version: string | null;
    status: string | null;
    status_code: number | null;
    latency_ms: number | null;
    last_checked_at: string | null;
    checked_url: string | null;
  } | null;
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
            <p>Only providers with a valid Testnet identity, non-revoked status and a recent online service check should be eligible for the hire path.</p>
          </div>
          <div className="console-state"><small>READY</small><strong>{summary.ready}/{summary.total}</strong><span>{summary.online} services online</span></div>
        </section>
        <section className="console-grid">
          <div className="console-card"><div className="console-section-head"><span>IDENTITIES</span><b>{summary.total}</b></div><p className="console-evidence">Agents indexed on BSC Testnet.</p></div>
          <div className="console-card"><div className="console-section-head"><span>MARKETPLACE READY</span><b>{summary.ready}</b></div><p className="console-evidence">Identity + verification + service health + active status.</p></div>
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
                <div className="console-stat"><span>Identity</span><strong>{provider.identity_ready ? "Ready" : "Missing"}</strong></div>
                <div className="console-stat"><span>Verification</span><strong>{provider.verification_ready ? provider.verification_status || "Ready" : "Revoked"}</strong></div>
                <div className="console-stat"><span>Service</span><strong>{provider.service_ready ? "Online" : provider.endpoint?.status || "Not checked"}</strong></div>
                <div className="console-stat"><span>HTTP check</span><strong>{provider.endpoint?.status_code != null ? String(provider.endpoint.status_code) : "—"}</strong></div>
                <div className="console-stat"><span>Latency</span><strong>{provider.endpoint?.latency_ms != null ? `${provider.endpoint.latency_ms} ms` : "—"}</strong></div>
                <div className="console-stat"><span>Last health check</span><strong>{time(provider.endpoint?.last_checked_at)}</strong></div>
                {!provider.marketplace_ready && provider.blocking_reasons.length > 0 && (
                  <div className="console-alert console-alert-error" style={{ marginTop: 16 }}>
                    <strong>Why it cannot be hired</strong>
                    <div style={{ marginTop: 6 }}>{provider.blocking_reasons.join(" · ")}</div>
                  </div>
                )}
                {provider.marketplace_ready && (
                  <p className="console-evidence">Provider identity and service health passed the Testnet hireability gate.</p>
                )}
                {provider.endpoint?.checked_url && <p className="console-evidence"><small>CHECKED</small> {provider.endpoint.checked_url}</p>}
                <p className="console-evidence">Health is recorded server-side. The browser never probes the provider endpoint directly.</p>
              </article>
            ))}
          </section>
        )}
      </div>
    </main>
  );
}
