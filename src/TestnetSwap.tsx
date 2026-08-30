import { useMemo, useState } from "react";
import "./mission-console.css";

const TESTNET_CHAIN_ID = "0x61";
const CAKE2_TOKEN = "0x8d008B313C1d6C7fE2982F62d32Da7507cF43551";
const PANCAKESWAP_SWAP_URL = `https://pancakeswap.finance/swap?chain=bscTestnet&inputCurrency=BNB&outputCurrency=${CAKE2_TOKEN}`;

function short(value: string) {
  return `${value.slice(0, 8)}…${value.slice(-6)}`;
}

export default function TestnetSwap() {
  const [wallet, setWallet] = useState("");
  const [network, setNetwork] = useState("not connected");
  const [copied, setCopied] = useState(false);

  const tokenLink = useMemo(
    () => `https://testnet.bscscan.com/token/${CAKE2_TOKEN}`,
    [],
  );

  async function inspectWallet() {
    const ethereum = window.ethereum;
    if (!ethereum) {
      setNetwork("No compatible browser wallet detected");
      return;
    }

    try {
      const chainId = String(await ethereum.request({ method: "eth_chainId" })).toLowerCase();
      const accounts = (await ethereum.request({ method: "eth_accounts" })) as string[];
      setNetwork(chainId === TESTNET_CHAIN_ID ? "BSC Testnet / chain 97" : `Wrong network (${chainId})`);
      setWallet(accounts[0] || "");
    } catch (error) {
      setNetwork(error instanceof Error ? error.message : "Unable to inspect wallet");
    }
  }

  async function copyToken() {
    await navigator.clipboard.writeText(CAKE2_TOKEN);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  return (
    <main className="console-page">
      <div className="console-shell">
        <header className="console-nav">
          <a href="/testnet" className="console-brand">AgentMarket</a>
          <span>WORKSPACE / TESTNET / SWAP</span>
          <a href="/testnet">Sandbox →</a>
        </header>

        <section className="console-hero">
          <div>
            <span className="console-kicker">BSC TESTNET / CHAIN 97</span>
            <h1>Get the token the Grid Agent uses.</h1>
            <p>
              This is a Testnet convenience page. The actual swap is performed by PancakeSwap using your connected wallet; AgentMarket never receives custody of your funds.
            </p>
          </div>
          <div className="console-state">
            <small>TARGET ASSET</small>
            <strong>CAKE2</strong>
            <span>Official PancakeSwap BSC Testnet token</span>
          </div>
        </section>

        <section className="console-grid">
          <article className="console-card">
            <div className="console-section-head"><span>SWAP ROUTE</span><b>TESTNET</b></div>
            <div className="console-stat"><span>From</span><strong>tBNB / BNB</strong></div>
            <div className="console-stat"><span>To</span><strong>CAKE2</strong></div>
            <div className="console-stat"><span>CAKE2 contract</span><strong>{short(CAKE2_TOKEN)}</strong></div>
            <button className="console-outline-button" type="button" onClick={() => void copyToken()}>
              {copied ? "Copied ✓" : "Copy CAKE2 address"}
            </button>
            <a
              className="console-brass-button"
              href={PANCAKESWAP_SWAP_URL}
              target="_blank"
              rel="noreferrer"
              style={{ display: "inline-flex", marginTop: 10, textDecoration: "none" }}
            >
              Open PancakeSwap Testnet →
            </a>
          </article>

          <article className="console-card">
            <div className="console-section-head"><span>WALLET CHECK</span><b>OPTIONAL</b></div>
            <p className="console-evidence">
              Check the active wallet/network before opening the swap. You should use BSC Testnet only.
            </p>
            <div className="console-stat"><span>Network</span><strong>{network}</strong></div>
            <div className="console-stat"><span>Wallet</span><strong>{wallet ? short(wallet) : "Not inspected"}</strong></div>
            <button className="console-dark-button" type="button" onClick={() => void inspectWallet()}>
              Inspect connected wallet
            </button>
          </article>
        </section>

        <section className="console-card">
          <div className="console-section-head"><span>WHY CAKE2</span><b>GRID PROVIDER</b></div>
          <p className="console-evidence">
            The Grid Agent's Testnet execution declaration is configured for the existing PancakeSwap Testnet WBNB/CAKE2 market rather than the marketplace creating its own U token pool. This page only helps a tester acquire the declared testnet asset.
          </p>
          <a href={tokenLink} target="_blank" rel="noreferrer" className="console-outline-button" style={{ display: "inline-flex", textDecoration: "none" }}>
            View CAKE2 on BSC Testnet Explorer →
          </a>
        </section>
      </div>
    </main>
  );
}
