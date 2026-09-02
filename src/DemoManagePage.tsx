import { useState } from "react";

type DemoManageKind = "testnet" | "register" | "permissions";

export default function DemoManagePage({ kind }: { kind: DemoManageKind }) {
  if (kind === "register") return <RegisterAgentPage />;
  if (kind === "permissions") return <PermissionsPage />;
  return <TestnetManagementPage />;
}

function TestnetManagementPage() {
  return (
    <main className="mx-auto max-w-[1240px] px-6 py-8 md:px-8">
      <div className="am-page-head">
        <span className="am-kicker">Testnet</span>
        <h1>Testnet console</h1>
        <p>Run jobs against the BSC Testnet sandbox. Testnet balances, agents and contracts stay isolated from Mainnet.</p>
      </div>
      <section className="am-wide-card">
        <div>
          <strong>BSC Testnet · Chain 97</strong>
          <span>Faucet funds only · ERC-8004 discovery · ERC-8183 commerce</span>
        </div>
        <span className="env-badge"><span className="am-dot-brass" /> TESTNET</span>
      </section>
    </main>
  );
}

function RegisterAgentPage() {
  const [submitted, setSubmitted] = useState(false);
  return (
    <main className="mx-auto max-w-[1240px] px-6 py-8 md:px-8">
      <div className="am-page-head">
        <span className="am-kicker">Management</span>
        <h1>Register an agent</h1>
        <p>ERC-8004 identity, endpoint, capabilities and network. A new listing remains self-registered until independent verification is available.</p>
      </div>
      <section className="am-form-card">
        <div className="am-form-grid">
          <label><span>ERC-8004 Agent ID</span><input placeholder="Agent ID" /></label>
          <label><span>Owner wallet</span><input className="am-mono-input" placeholder="0x…" /></label>
          <label className="am-span-2"><span>Agent URI</span><input placeholder="Registration URI" /></label>
          <label className="am-span-2"><span>Endpoint URL</span><input placeholder="https://…" /></label>
          <label className="am-span-2"><span>Description</span><textarea rows={4} placeholder="Describe what this agent does and what it can deliver." /></label>
        </div>
        {submitted ? (
          <div className="am-inline-success">✓ Registration submitted — pending capability discovery</div>
        ) : (
          <button className="am-primary-action am-form-action" onClick={() => setSubmitted(true)}>Submit registration</button>
        )}
      </section>
    </main>
  );
}

function PermissionsPage() {
  const [revoked, setRevoked] = useState(false);
  return (
    <main className="mx-auto max-w-[1240px] px-6 py-8 md:px-8">
      <div className="am-page-head">
        <span className="am-kicker">Permissions</span>
        <h1>Scoped delegated execution</h1>
        <p>Different from wallet authentication. Permissions govern what an agent may spend, where it may execute, when authority expires, and whether it can be revoked.</p>
      </div>
      <section className="am-permission-card">
        <div className="am-wide-card am-wide-card-inner">
          <div><strong>Execution permission — Grid Agent</strong><span>Network: BSC Testnet</span></div>
          <span className={`am-status ${revoked ? "status-rust" : "status-green"}`}>{revoked ? "Revoked" : "Active"}</span>
        </div>
        <div className="am-permission-grid">
          <div><span>Allowed protocols</span><b>Not available</b></div>
          <div><span>Maximum spend</span><b>Not available</b></div>
          <div><span>Expires</span><b>Not available</b></div>
          <div><span>Status</span><b>{revoked ? "Revoked" : "Active"}</b></div>
        </div>
        <button className="am-secondary-action am-danger am-button-reset" disabled={revoked} onClick={() => setRevoked(true)}>{revoked ? "Revoked" : "Revoke"}</button>
      </section>
    </main>
  );
}
