import { useEffect, useMemo, useState } from "react";
import "./mission-console.css";
import { connectTestnetWalletAndSignIn, connectTestnetWallet, getTestnetConnectedProvider, getTestnetCurrentUser, resetTestnetWalletConnect } from "./lib/testnetWalletAuth";

const TESTNET_CHAIN_ID = "0x61";
const TESTNET_CONTRACTS = {
  commerce: "0xa206c0517b6371c6638cd9e4a42cc9f02a33b0de",
  router: "0xd7d36d66d2f1b608a0f943f722d27e3744f66f25",
  policy: "0x4f4678d4439fec812ac7674bb3efb4c8f5fb78a6",
};

const compact = (value?: string | null) => value ? `${value.slice(0, 8)}…${value.slice(-6)}` : "—";

type WalletState = { connected: boolean; address: string; chainId: string; };

export default function TestnetSandbox() {
  const [wallet, setWallet] = useState<WalletState>({ connected: false, address: "", chainId: "checking" });
  const [authState, setAuthState] = useState<"checking" | "ready" | "missing">("checking");
  const [error, setError] = useState("");
  const [connecting, setConnecting] = useState(false);

  const networkReady = wallet.chainId === TESTNET_CHAIN_ID;
  const walletReady = wallet.connected && networkReady;
  const explorerBase = "https://testnet.bscscan.com";

  const checks = useMemo(() => [
    { label: "WalletConnect session", ok: wallet.connected },
    { label: "BSC Testnet / chain 97", ok: networkReady },
    { label: "Marketplace authentication", ok: authState === "ready" },
  ], [wallet.connected, networkReady, authState]);

  async function refresh() {
    setError("");
    try {
      const provider = getTestnetConnectedProvider();
      const chainId = String(await provider.request({ method: "eth_chainId" })).toLowerCase();
      const accounts = (await provider.request({ method: "eth_accounts" })) as string[];
      setWallet({ connected: accounts.length > 0, address: accounts[0] || "", chainId });
      const auth = await getTestnetCurrentUser();
      setAuthState(auth ? "ready" : "missing");
    } catch {
      setWallet({ connected: false, address: "", chainId: "missing" });
      try {
        const auth = await getTestnetCurrentUser();
        setAuthState(auth ? "ready" : "missing");
      } catch {
        setAuthState("missing");
      }
    }
  }

  async function connect() {
    setError("");
    setConnecting(true);
    try {
      const current = await getTestnetCurrentUser();
      if (!current) await connectTestnetWalletAndSignIn();
      else await connectTestnetWallet();
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "WalletConnect connection failed");
    } finally {
      setConnecting(false);
    }
  }

  async function switchToTestnet() {
    setError("");
    try {
      await connectTestnetWallet();
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to switch WalletConnect to BSC Testnet");
    }
  }

  async function resetConnection() {
    setError("");
    setConnecting(true);
    try {
      await resetTestnetWalletConnect();
      const current = await getTestnetCurrentUser();
      if (!current) await connectTestnetWalletAndSignIn();
      else await connectTestnetWallet();
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to reset WalletConnect");
    } finally {
      setConnecting(false);
    }
  }

  useEffect(() => { void refresh(); }, []);

  return (
    <main className="console-page">
      <div className="console-shell">
        <header className="console-nav">
          <a href="/testnet" className="console-brand">AgentMarket Testnet</a>
          <span>TESTNET SANDBOX</span>
          <a href="/app">Open Testnet marketplace →</a>
        </header>

        {error && <div className="console-alert console-alert-error">{error}</div>}

        <section className="console-hero">
          <div>
            <span className="console-kicker">DEVELOPMENT ENVIRONMENT / CHAIN 97 / WALLETCONNECT</span>
            <h1>Test the entire marketplace safely.</h1>
            <p>This is the dedicated BSC Testnet preview. It uses WalletConnect, only accepts chain 97, and does not expose the production Mainnet marketplace routes.</p>
          </div>
          <div className="console-state"><small>ENVIRONMENT</small><strong>TESTNET ONLY</strong><span>Grid Agent + ERC-8004 + ERC-8183 + settlement</span></div>
        </section>

        <section className="console-grid">
          <div className="console-card">
            <div className="console-section-head"><span>WALLETCONNECT</span><b>{walletReady ? "READY" : "ACTION NEEDED"}</b></div>
            <div className="console-stat"><span>Account</span><strong>{compact(wallet.address)}</strong></div>
            <div className="console-stat"><span>Connection</span><strong>{wallet.connected ? "WalletConnect" : "Not connected"}</strong></div>
            <div className="console-stat"><span>Chain</span><strong>{wallet.chainId === "checking" ? "Checking…" : wallet.chainId}</strong></div>
            <div className="console-stat"><span>Required</span><strong>BSC Testnet / 97</strong></div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button className="console-brass-button" type="button" disabled={connecting} onClick={() => void connect()}>{connecting ? "Connecting…" : "Connect with WalletConnect"}</button>
              {!networkReady && <button className="console-brass-button" type="button" onClick={() => void switchToTestnet()}>Switch to Testnet</button>}
              <button className="console-dark-button" type="button" disabled={connecting} onClick={() => void resetConnection()}>Reset Testnet WalletConnect</button>
              <button className="console-brass-button" type="button" onClick={() => void refresh()}>Refresh checks</button>
            </div>
          </div>

          <div className="console-card">
            <div className="console-section-head"><span>READINESS CHECKS</span><b>{checks.filter((check) => check.ok).length}/{checks.length}</b></div>
            {checks.map((check) => <div className="console-stat" key={check.label}><span>{check.label}</span><strong>{check.ok ? "PASS" : "PENDING"}</strong></div>)}
            <p className="console-evidence">A restored WalletConnect session is never rejected just because it starts on another chain. The provider is explicitly switched to BSC Testnet before authentication.</p>
          </div>
        </section>

        <section className="console-card">
          <div className="console-section-head"><span>TESTNET CONTRACTS</span><b>CHAIN 97</b></div>
          <div className="console-stat"><span>ERC-8183 Commerce</span><strong><a href={`${explorerBase}/address/${TESTNET_CONTRACTS.commerce}`} target="_blank" rel="noreferrer">{compact(TESTNET_CONTRACTS.commerce)}</a></strong></div>
          <div className="console-stat"><span>ERC-8183 Router</span><strong><a href={`${explorerBase}/address/${TESTNET_CONTRACTS.router}`} target="_blank" rel="noreferrer">{compact(TESTNET_CONTRACTS.router)}</a></strong></div>
          <div className="console-stat"><span>Optimistic Policy</span><strong><a href={`${explorerBase}/address/${TESTNET_CONTRACTS.policy}`} target="_blank" rel="noreferrer">{compact(TESTNET_CONTRACTS.policy)}</a></strong></div>
        </section>

        <section className="console-card console-plan-card">
          <div className="console-section-head"><span>FULL TEST</span><b>{walletReady && authState === "ready" ? "READY TO START" : "COMPLETE CHECKS FIRST"}</b></div>
          <p className="console-evidence">The end-to-end Testnet flow is: discover Grid Agent → request quote → accept quote → create ERC-8183 job → register → budget → approve → fund → provider executes → submit deliverable → settle → evaluation → reputation.</p>
          <a className="console-brass-button" href="/app" style={{ pointerEvents: walletReady && authState === "ready" ? "auto" : "none", opacity: walletReady && authState === "ready" ? 1 : 0.45, display: "inline-flex", textDecoration: "none" }}>Enter Testnet marketplace →</a>
        </section>
      </div>
    </main>
  );
}
