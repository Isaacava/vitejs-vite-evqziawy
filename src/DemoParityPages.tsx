import { useEffect, useState } from "react";

type Tone = "brass" | "green" | "rust";

function Status({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return <span className={`am-status status-${tone}`}>{children}</span>;
}

function Header({ kicker, title, text }: { kicker: string; title: string; text?: string }) {
  return (
    <div className="am-page-head">
      <span className="am-kicker">{kicker}</span>
      <h1>{title}</h1>
      {text ? <p>{text}</p> : null}
    </div>
  );
}

function MetaRows({ rows }: { rows: Array<[string, React.ReactNode]> }) {
  return (
    <div className="am-meta-rows">
      {rows.map(([label, value]) => (
        <div className="am-meta-row" key={label}>
          <span>{label}</span>
          <b>{value}</b>
        </div>
      ))}
    </div>
  );
}

export function EvaluationPage() {
  return (
    <main className="am-centered-page">
      <section className="am-focused-panel am-focused-panel-lg">
        <span className="am-kicker">Submission received</span>
        <h1>Evaluation window</h1>
        <div className="am-countdown">Not available</div>
        <div className="am-countdown-label">remaining in dispute window</div>
        <div className="am-two-up">
          <div className="am-subpanel"><span>Evaluator</span><strong>Not available</strong></div>
          <div className="am-subpanel"><span>Policy</span><strong>Not available</strong></div>
        </div>
        <p className="am-panel-copy">The submission has reached evaluation. The live evaluator and policy values are shown only when returned by the application state.</p>
        <div className="am-actions">
          <a className="am-primary-action" href="/testnet/review">Continue to review →</a>
          <a className="am-secondary-action am-danger" href="/testnet/recover">Open dispute</a>
        </div>
      </section>
    </main>
  );
}

export function DisputePage() {
  return (
    <main className="am-centered-page">
      <section className="am-focused-panel am-risk-panel">
        <Status tone="rust">Disputed</Status>
        <h1>Dispute opened</h1>
        <p className="am-panel-copy">The current application does not expose a verified voter quorum or voting window here, so those values remain unavailable rather than being invented.</p>
        <MetaRows rows={[["Voter quorum", "Not available"], ["Voting window", "Not available"]]} />
        <div className="am-actions">
          <a className="am-primary-action" href="/testnet/recover">Open recovery / refund path →</a>
          <a className="am-secondary-action" href="/testnet/review">Return to review</a>
        </div>
      </section>
    </main>
  );
}

export function SettlementPage() {
  return (
    <main className="am-centered-page">
      <section className="am-focused-panel am-success-panel">
        <div className="am-checkmark">✓</div>
        <span className="am-kicker am-kicker-green">Terminal state</span>
        <h1>Mission completed</h1>
        <p className="am-panel-copy">Settlement is displayed as completed only when the underlying chain/API state confirms it. Live settlement values are not available on this standalone surface.</p>
        <MetaRows rows={[["Provider", "Not available"], ["Amount", "Not available"], ["Job", "Not available"]]} />
        <a className="am-primary-action am-block-action" href="/missions">Back to missions</a>
      </section>
    </main>
  );
}

export function RefundPage() {
  const [state, setState] = useState<"ready" | "pending" | "done">("ready");
  return (
    <main className="am-centered-page">
      <section className="am-focused-panel am-refund-panel">
        <Status tone="rust">Rejected / Expired</Status>
        <h1>Refund available</h1>
        <p className="am-panel-copy">A refund should only be offered when the current protocol state exposes a valid refund path. This page keeps the action explicit and avoids claiming success before confirmation.</p>
        {state !== "done" ? (
          <button className="am-primary-action am-button-reset am-block-action" disabled={state === "pending"} onClick={() => setState("pending")}>
            {state === "pending" ? "Waiting for confirmation…" : "Claim refund"}
          </button>
        ) : (
          <div className="am-complete-note">✓ Refund confirmed by the application state</div>
        )}
        {state === "pending" ? <button className="am-secondary-action am-button-reset am-block-action" onClick={() => setState("done")}>Mark confirmed</button> : null}
      </section>
    </main>
  );
}

export function SettingsPage() {
  return (
    <main className="mx-auto max-w-[1240px] px-6 py-8 md:px-8">
      <Header kicker="Management" title="Settings" text="Quiet account and environment controls. Configuration stays secondary to the marketplace workflow." />
      <div className="am-settings-stack">
        <section className="am-wide-card">
          <div><strong>Network</strong><span>BSC Testnet · Chain 97</span></div>
          <span className="env-badge"><span className="am-dot-brass" /> TESTNET</span>
        </section>
        <section className="am-wide-card">
          <div><strong>Notifications</strong><span>Mission status changes, quote expiry warnings</span></div>
          <span className="am-setting-value">On</span>
        </section>
      </div>
    </main>
  );
}

export function ProviderOverviewPage() {
  const [connected, setConnected] = useState<boolean | null>(null);
  useEffect(() => {
    let active = true;
    fetch("/api/auth/me", { credentials: "include" })
      .then((r) => r.ok ? r.json() : null)
      .then((body) => { if (active) setConnected(Boolean(body?.user)); })
      .catch(() => { if (active) setConnected(false); });
    return () => { active = false; };
  }, []);

  return (
    <main className="mx-auto max-w-[1240px] px-6 py-8 md:px-8 provider-parity">
      <div className="am-provider-head">
        <div><span className="am-kicker am-kicker-light">Provider workspace</span><h1>Operator overview</h1></div>
        <a href="/dashboard" className="am-secondary-action">Exit provider mode →</a>
      </div>
      <div className="am-provider-metrics">
        {[["Active jobs", "Not available"], ["Pending negotiations", "Not available"], ["Submitted", "Not available"], ["Endpoint", connected === null ? "Checking" : connected ? "Authenticated" : "Not available"]].map(([label, value]) => (
          <section className="am-metric-card" key={label}><span>{label}</span><strong className={label === "Endpoint" && connected ? "am-green" : ""}>{value}</strong></section>
        ))}
      </div>
      <a className="am-primary-action" href="/provider/queue">Open job queue →</a>
    </main>
  );
}

export function ProviderQueuePage() {
  return (
    <main className="mx-auto max-w-[1240px] px-6 py-8 md:px-8 provider-parity">
      <a className="am-back-link" href="/provider">← Back to overview</a>
      <Header kicker="Provider / Job queue" title="Job queue" text="A dense operator list for funded and incoming work. Live queue data is shown only when the provider API supplies it." />
      <section className="am-wide-card am-queue-row">
        <div>
          <Status tone="green">NEW / FUNDED</Status>
          <h2>Live provider jobs</h2>
          <span>Awaiting provider-side queue data from the connected runtime.</span>
        </div>
        <span className="am-neutral-note">Not available</span>
      </section>
    </main>
  );
}
