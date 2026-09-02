import { useState } from "react";

type DemoManageKind = "testnet" | "register" | "permissions";

export default function DemoManagePage({ kind }: { kind: DemoManageKind }) {
  if (kind === "register") return <RegisterAgentPage />;
  if (kind === "permissions") return <PermissionsPage />;
  return <TestnetManagementPage />;
}

function PageWrap({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto max-w-[1240px] px-6 py-8 md:px-8">{children}</main>;
}

function TestnetManagementPage() {
  return (
    <PageWrap>
      <div className="am-page-head">
        <span className="am-kicker">Testnet / Sandbox</span>
        <h1>Testnet console</h1>
        <p>Sandbox for BSC Testnet only. Balances, agents, execution-capital sessions and commerce jobs remain isolated from Mainnet.</p>
      </div>
      <section className="am-wide-card">
        <div><strong>BSC Testnet · Chain 97</strong><span>Faucet funds only · ERC-8004 discovery · ERC-8183 commerce</span></div>
        <span className="env-badge"><span className="am-dot-brass" /> TESTNET</span>
      </section>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {[
          ["CAKE2 swap helper", "Read-only PancakeSwap testnet preflight before any signed swap"],
          ["Provider readiness", "Live endpoint health checks behind hireability"],
          ["Job history", "On-chain commerce jobs indexed directly from contract state"],
          ["Policy review", "EvaluatorRouter + OptimisticPolicy settlement worker status"],
        ].map(([title, detail]) => <section key={title} className="rounded-[16px_8px_18px_9px] border border-line bg-paperhi p-4"><strong className="block text-[13px] font-bold">{title}</strong><span className="mt-1 block text-[11px] leading-5 text-inksoft">{detail}</span></section>)}
      </div>
    </PageWrap>
  );
}

function RegisterAgentPage() {
  const [submitted, setSubmitted] = useState(false);
  return (
    <PageWrap>
      <div className="am-page-head">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><span className="am-kicker">Manage / Registration</span><h1>Register an agent</h1></div>
          <span className="font-mono text-[8.5px] px-2 py-1 rounded-lg status-rust">UI flow · submit wiring remains explicit</span>
        </div>
        <p>List an ERC-8004 identity as a provider. AgentMarket does not invent capabilities or reputation; discovery and verification remain data-driven.</p>
      </div>
      <section className="am-form-card">
        <div className="am-form-grid">
          <label><span>Agent name</span><input placeholder="Grid Agent" /></label>
          <label><span>Category</span><input placeholder="Grid trading" /></label>
          <label><span>Owner wallet</span><input className="am-mono-input" placeholder="0x…" /></label>
          <label><span>Endpoint URL</span><input className="am-mono-input" placeholder="https://…" /></label>
          <label className="am-span-2"><span>Agent URI</span><input placeholder="ERC-8004 registration URI" /></label>
          <label className="am-span-2"><span>Description</span><textarea rows={4} placeholder="What this agent does, and for whom." /></label>
        </div>
        {submitted ? <div className="am-inline-success">✓ Registration submitted — pending capability discovery</div> : <button className="am-primary-action am-form-action" onClick={() => setSubmitted(true)}>Submit registration</button>}
      </section>
    </PageWrap>
  );
}

function PermissionsPage() {
  const [revoked, setRevoked] = useState(false);
  return (
    <PageWrap>
      <div className="am-page-head">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><span className="am-kicker">Manage / Permissions</span><h1>Session permissions</h1></div>
          <span className="font-mono text-[8.5px] px-2 py-1 rounded-lg status-brass">scoped_session · revocable</span>
        </div>
        <p>Every permission is limited by what the agent may spend, where it may execute, how long authority lasts, and whether it can be revoked.</p>
      </div>
      <section className="am-permission-card">
        <div className="am-wide-card am-wide-card-inner">
          <div><strong>Execution permission — Grid Agent</strong><span>BSC Testnet · 40 U authorized · expires in 4h</span></div>
          <span className={`am-status ${revoked ? "status-rust" : "status-green"}`}>{revoked ? "Revoked" : "Active"}</span>
        </div>
        <div className="am-permission-grid">
          <div><span>Allowed protocols</span><b>Not available</b></div>
          <div><span>Maximum spend</span><b>40 U</b></div>
          <div><span>Expires</span><b>4h remaining</b></div>
          <div><span>Authority</span><b>{revoked ? "Revoked" : "scoped_session"}</b></div>
        </div>
        <button className="am-secondary-action am-danger am-button-reset" disabled={revoked} onClick={() => setRevoked(true)}>{revoked ? "Revoked" : "Revoke session"}</button>
      </section>
    </PageWrap>
  );
}
