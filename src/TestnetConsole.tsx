import "./mission-console.css";

const actions = [
  { label: "Swap tBNB → CAKE2", detail: "Open PancakeSwap Testnet with the Grid Agent's test asset preselected", href: "/testnet/swap", tone: "brass" },
  { label: "Run a Testnet job", detail: "Create and execute a controlled sandbox mission", href: "/testnet/run", tone: "dark" },
  { label: "Provider readiness", detail: "Check identities, verification and service health", href: "/testnet/providers", tone: "outline" },
  { label: "Job history", detail: "Review active and chain-verified Testnet jobs", href: "/testnet/jobs", tone: "outline" },
  { label: "Transaction preflight", detail: "Validate a quoted job before any signature", href: "/testnet/preflight", tone: "outline" },
];

export default function TestnetConsole() {
  return (
    <main className="console-page">
      <div className="console-shell">
        <header className="console-nav">
          <a href="/dashboard" className="console-brand">AgentMarket</a>
          <span>WORKSPACE / TESTNET</span>
          <a href="/app">Marketplace →</a>
        </header>

        <section className="console-hero">
          <div>
            <span className="console-kicker">BSC TESTNET / CHAIN 97</span>
            <h1>Test the marketplace without touching Mainnet.</h1>
            <p>Use the Testnet sandbox to discover providers, create missions, inspect execution readiness, run wallet-signed transactions, and verify ERC-8183 outcomes. Faucet assets only.</p>
          </div>
          <div className="console-state">
            <small>ENVIRONMENT</small>
            <strong>TESTNET ONLY</strong>
            <span>Chain 97 · U payment token · sandbox contracts and providers</span>
          </div>
        </section>

        <section className="console-card">
          <div className="console-section-head"><span>TESTNET TOOLKIT</span><b>LIVE SANDBOX</b></div>
          <div className="console-grid">
            {actions.map((action) => (
              <article className="console-card" key={action.href}>
                <div className="console-section-head"><span>TESTNET</span><b>{action.tone === "brass" ? "OPTIONAL" : "READY"}</b></div>
                <h2 style={{ margin: "0 0 8px", fontSize: 22 }}>{action.label}</h2>
                <p className="console-evidence">{action.detail}</p>
                <a
                  className={action.tone === "brass" ? "console-brass-button" : action.tone === "dark" ? "console-dark-button" : "console-outline-button"}
                  href={action.href}
                  style={{ display: "inline-flex" }}
                >
                  Open →
                </a>
              </article>
            ))}
          </div>
        </section>

        <section className="console-card console-plan-card">
          <div className="console-section-head"><span>TESTNET PRINCIPLES</span><b>ISOLATED</b></div>
          <ul className="console-sequence">
            <li><span>01</span><div><strong>Wallet</strong><small>Use BSC Testnet only. Mainnet balances are never used by this workspace.</small></div></li>
            <li><span>02</span><div><strong>Marketplace</strong><small>Provider discovery, mission creation, quoting and settlement stay in the marketplace layer.</small></div></li>
            <li><span>03</span><div><strong>Agent execution</strong><small>The selected agent declares its own execution capability and venue. Grid is one provider, not the marketplace itself.</small></div></li>
            <li><span>04</span><div><strong>Evidence</strong><small>Unknown on-chain state remains unknown until independently observed and verified.</small></div></li>
          </ul>
        </section>
      </div>
    </main>
  );
}
