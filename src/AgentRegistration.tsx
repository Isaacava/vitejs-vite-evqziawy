import { useMemo, useState } from "react";
import "./agent-registration.css";

type FormState = {
  agentId: string;
  owner: string;
  name: string;
  description: string;
  endpoint: string;
  category: string;
  capabilities: string;
};

type DiscoveryResult = {
  manifest?: {
    manifest_name?: string;
    description?: string | null;
    manifest_version?: string;
    manifest_protocols?: string[];
    manifest_endpoints?: Record<string, unknown>;
    hiring?: Record<string, unknown>;
  };
  capabilities?: Array<{ id?: string; name?: string; description?: string }>;
  requiredHiringOperations?: string[];
  operations?: Record<string, unknown>;
};

const initial: FormState = {
  agentId: "",
  owner: "",
  name: "",
  description: "",
  endpoint: "",
  category: "rebalancing",
  capabilities: "rebalancing, portfolio monitoring",
};

function categoryFromCapabilities(values: string[]) {
  const text = values.join(" ").toLowerCase();
  if (text.includes("grid")) return "grid_trading";
  if (text.includes("yield")) return "yield";
  if (text.includes("risk") || text.includes("health")) return "health_factor";
  if (text.includes("rebalance")) return "rebalancing";
  return "other";
}

export default function AgentRegistration() {
  const [form, setForm] = useState<FormState>(initial);
  const [busy, setBusy] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [discovery, setDiscovery] = useState<DiscoveryResult | null>(null);

  const capabilityList = useMemo(
    () => form.capabilities.split(",").map((value) => value.trim()).filter(Boolean),
    [form.capabilities],
  );

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function discover() {
    setDiscovering(true);
    setError("");
    setMessage("");
    setDiscovery(null);
    try {
      const response = await fetch("/api/discover-agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: form.endpoint }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error || "Provider discovery failed");
      const capabilities = Array.isArray(body?.capabilities) ? body.capabilities : [];
      const capabilityNames = capabilities.map((item: { name?: unknown; id?: unknown }) => String(item?.name || item?.id || "")).filter(Boolean);
      setDiscovery(body);
      setForm((current) => ({
        ...current,
        name: current.name || body?.manifest?.manifest_name || "",
        description: current.description || body?.manifest?.description || "",
        category: categoryFromCapabilities(capabilityNames),
        capabilities: capabilityNames.length ? capabilityNames.join(", ") : current.capabilities,
      }));
      setMessage(`Provider discovered: ${body?.manifest?.manifest_name || "agent provider"}. AgentMarket can now see its declared capabilities and operations.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Provider discovery failed");
    } finally {
      setDiscovering(false);
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");

    try {
      const response = await fetch("/api/agents/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agent_id: form.agentId,
          owner: form.owner,
          name: form.name,
          description: form.description,
          endpoint: form.endpoint,
          category: form.category,
          capabilities: capabilityList,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error || "Unable to connect agent");
      setMessage("Agent claimed in AgentMarket. Discovery is the source of marketplace inventory; wallet verification and endpoint health remain separate gates.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to connect agent");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="agent-register-page">
      <div className="agent-register-curve agent-register-curve-a" aria-hidden="true" />
      <div className="agent-register-curve agent-register-curve-b" aria-hidden="true" />

      <div className="agent-register-shell">
        <header className="agent-register-nav">
          <a href="/" className="agent-register-brand">AgentMarket</a>
          <span>AGENT / CLAIM & CONNECT</span>
          <a href="/app">Marketplace →</a>
        </header>

        <section className="agent-register-hero">
          <div>
            <span className="agent-register-kicker">OPTIONAL PROVIDER ONBOARDING</span>
            <h1>Claim an agent already discovered on BNB Chain.</h1>
            <p>AgentMarket discovers ERC-8004 identities automatically, then reads a provider manifest to understand capabilities, hiring operations, and runtime endpoints. This page lets an operator inspect that contract before claiming the identity.</p>
          </div>
          <div className="agent-register-note">
            <small>INVENTORY SOURCE</small>
            <strong>ERC-8004 + provider manifest</strong>
            <span>Discovery does not require AgentMarket-specific API code inside the agent.</span>
          </div>
        </section>

        <form className="agent-register-form" onSubmit={submit}>
          <section className="agent-register-card">
            <div className="agent-register-head"><span>01 / PROVIDER DISCOVERY</span><b>agent-provider/v1</b></div>
            <label className="agent-register-wide">PROVIDER ENDPOINT
              <div className="agent-register-inline">
                <input required value={form.endpoint} onChange={(event) => update("endpoint", event.target.value)} placeholder="https://agent.example.com/erc8183" />
                <button type="button" className="agent-register-secondary" onClick={discover} disabled={discovering}>{discovering ? "Discovering…" : "Discover provider"}</button>
              </div>
            </label>
            {discovery?.manifest && (
              <div className="agent-register-alert agent-register-alert-success">
                <strong>{discovery.manifest.manifest_name || "Provider"}</strong>
                <span> {discovery.manifest.manifest_version || ""} · {discovery.manifest.manifest_protocols?.join(", ") || "HTTP"}</span>
                {discovery.requiredHiringOperations?.length ? <span> · hiring: {discovery.requiredHiringOperations.join(", ")}</span> : null}
              </div>
            )}
          </section>

          <section className="agent-register-card agent-register-card-offset">
            <div className="agent-register-head"><span>02 / DISCOVERED IDENTITY</span><b>ERC-8004</b></div>
            <div className="agent-register-fields">
              <label>ERC-8004 AGENT ID<input required value={form.agentId} onChange={(event) => update("agentId", event.target.value)} placeholder="e.g. 3821" /></label>
              <label>OWNER WALLET<input required value={form.owner} onChange={(event) => update("owner", event.target.value)} placeholder="0x…" /></label>
              <label>AGENT NAME<input value={form.name} onChange={(event) => update("name", event.target.value)} placeholder="Auto-filled from provider manifest when available" /></label>
              <label>CATEGORY<select value={form.category} onChange={(event) => update("category", event.target.value)}><option value="grid_trading">Grid trading</option><option value="rebalancing">Rebalancing</option><option value="yield">Yield</option><option value="health_factor">Health factor / monitoring</option><option value="other">Other</option></select></label>
            </div>
          </section>

          <section className="agent-register-card agent-register-card-offset">
            <div className="agent-register-head"><span>03 / OPTIONAL ENRICHMENT</span><b>DECLARED DATA</b></div>
            <label className="agent-register-wide">DESCRIPTION<textarea value={form.description} onChange={(event) => update("description", event.target.value)} rows={4} placeholder="Provider manifest description or marketplace override" /></label>
            <label className="agent-register-wide">CAPABILITIES<input value={form.capabilities} onChange={(event) => update("capabilities", event.target.value)} placeholder="Discovered capabilities appear here automatically" /></label>
          </section>

          {error && <div className="agent-register-alert agent-register-alert-error">{error}</div>}
          {message && !discovery && <div className="agent-register-alert agent-register-alert-success">{message}</div>}

          <div className="agent-register-actions">
            <a className="agent-register-secondary" href="/app">Cancel</a>
            <button className="agent-register-primary" disabled={busy}>{busy ? "Claiming…" : "Claim discovered agent →"}</button>
          </div>
        </form>
      </div>
    </main>
  );
}
