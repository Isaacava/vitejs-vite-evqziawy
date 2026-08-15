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

const initial: FormState = {
  agentId: "",
  owner: "",
  name: "",
  description: "",
  endpoint: "",
  category: "rebalancing",
  capabilities: "rebalancing, portfolio monitoring",
};

export default function AgentRegistration() {
  const [form, setForm] = useState<FormState>(initial);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const capabilityList = useMemo(
    () => form.capabilities.split(",").map((value) => value.trim()).filter(Boolean),
    [form.capabilities],
  );

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
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
      if (!response.ok) throw new Error(body?.error || "Unable to register agent");
      setMessage("Registered in marketplace inventory. Wallet verification and endpoint health remain separate gates.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to register agent");
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
          <span>AGENT / REGISTRATION</span>
          <a href="/app">Marketplace →</a>
        </header>

        <section className="agent-register-hero">
          <div>
            <span className="agent-register-kicker">SELF-SERVE REGISTRATION</span>
            <h1>Bring an existing ERC-8004 agent into the marketplace.</h1>
            <p>Registration adds the agent to the same inventory used by passive indexing. It starts as pending verification; AgentMarket never invents a verified status.</p>
          </div>
          <div className="agent-register-note">
            <small>STATUS MODEL</small>
            <strong>indexed → verified</strong>
            <span>Identity control and endpoint liveness are checked independently.</span>
          </div>
        </section>

        <form className="agent-register-form" onSubmit={submit}>
          <section className="agent-register-card">
            <div className="agent-register-head"><span>01 / IDENTITY</span><b>PUBLIC DATA ONLY</b></div>
            <div className="agent-register-fields">
              <label>ERC-8004 AGENT ID<input value={form.agentId} onChange={(event) => update("agentId", event.target.value)} placeholder="e.g. 3821" /></label>
              <label>OWNER WALLET<input value={form.owner} onChange={(event) => update("owner", event.target.value)} placeholder="0x…" /></label>
              <label>AGENT NAME<input value={form.name} onChange={(event) => update("name", event.target.value)} placeholder="Rebalancing Agent" /></label>
              <label>CATEGORY<select value={form.category} onChange={(event) => update("category", event.target.value)}><option value="grid_trading">Grid trading</option><option value="rebalancing">Rebalancing</option><option value="yield">Yield</option><option value="health_factor">Health factor / monitoring</option><option value="other">Other</option></select></label>
            </div>
          </section>

          <section className="agent-register-card agent-register-card-offset">
            <div className="agent-register-head"><span>02 / CAPABILITIES</span><b>DISCOVERY SIGNALS</b></div>
            <label className="agent-register-wide">DESCRIPTION<textarea value={form.description} onChange={(event) => update("description", event.target.value)} rows={4} placeholder="What jobs can this agent perform?" /></label>
            <label className="agent-register-wide">CAPABILITIES<input value={form.capabilities} onChange={(event) => update("capabilities", event.target.value)} placeholder="rebalancing, monitoring, risk checks" /></label>
            <label className="agent-register-wide">ERC-8183 ENDPOINT<input value={form.endpoint} onChange={(event) => update("endpoint", event.target.value)} placeholder="https://agent.example.com/jobs" /></label>
          </section>

          {error && <div className="agent-register-alert agent-register-alert-error">{error}</div>}
          {message && <div className="agent-register-alert agent-register-alert-success">{message}</div>}

          <div className="agent-register-actions">
            <a className="agent-register-secondary" href="/app">Cancel</a>
            <button className="agent-register-primary" disabled={busy}>{busy ? "Registering…" : "Register agent →"}</button>
          </div>
        </form>
      </div>
    </main>
  );
}
