import { useEffect, useMemo, useState } from "react";
import { buildErc8183Plan, type Erc8183PreparedResponse } from "./lib/erc8183TransactionPlan";
import { getTestnetConnectedProvider } from "./lib/testnetWalletAuth";
import TestnetOnchainTransactionRunner, { type TestnetConfirmedReceipt, type TestnetTransactionStep } from "./TestnetOnchainTransactionRunner";
import "./mission-console.css";

type Prepared = Erc8183PreparedResponse & {
  ok: boolean;
  network: string;
  environment: string;
  mission: { id: string; status: string };
  quote: { quote_id: string; price: string; currency: string; quote_hash: string; expires_at: string; status: string };
  agent: { agent_id: string; name: string | null; provider: string };
  job_description: string;
};

type ActiveResponse = { ok: boolean; mission: { id: string; status: string; goal: string }; job: { id: string; status: string; chain_job_id: number | null }; quote: Prepared["quote"] };

const compact = (value?: string | null) => value ? `${value.slice(0, 8)}…${value.slice(-6)}` : "—";
function normalizeChain(value: unknown) { const raw = String(value ?? "").toLowerCase(); return raw.startsWith("0x") ? Number.parseInt(raw.slice(2), 16) : Number(raw); }

export default function TestnetQuoteExecutionWalletConnect() {
  const [active, setActive] = useState<ActiveResponse | null>(null);
  const [data, setData] = useState<Prepared | null>(null);
  const [chainJobId, setChainJobId] = useState("");
  const [confirmed, setConfirmed] = useState<Record<string, boolean>>({});
  const [network, setNetwork] = useState("checking");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let mounted = true;
    async function load() {
      try {
        const provider = getTestnetConnectedProvider();
        const chain = normalizeChain(await provider.request({ method: "eth_chainId" }));
        if (chain !== 97) throw new Error("WalletConnect must be on BSC Testnet (chain 97).");
        const accounts = await provider.request({ method: "eth_accounts" }) as string[];
        if (!accounts?.[0]) throw new Error("No Testnet wallet account is connected.");
        setNetwork("bsc-testnet / 97");

        const response = await fetch("/api/testnet?route=active-quote", { credentials: "include" });
        const body = await response.json();
        if (!response.ok) throw new Error(body?.error || "No active Testnet quote was found.");
        if (mounted) setActive(body as ActiveResponse);

        const prepare = await fetch("/api/testnet/prepare-quote", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mission_id: body.mission.id, quote_id: body.quote.quote_id, client_address: accounts[0] }),
        });
        const prepared = await prepare.json();
        if (!prepare.ok) throw new Error(prepared?.error || "Unable to prepare the Testnet transaction plan.");
        if (prepared.network !== "bsc-testnet" || Number(prepared.chain_id) !== 97) throw new Error("Preparation returned non-Testnet data.");
        if (mounted) {
          setData(prepared as Prepared);
          if (prepared.mission?.chain_job_id != null) setChainJobId(String(prepared.mission.chain_job_id));
        }
      } catch (cause) {
        if (mounted) setError(cause instanceof Error ? cause.message : "Unable to load Testnet execution plan");
      } finally {
        if (mounted) setLoading(false);
      }
    }
    void load();
    return () => { mounted = false; };
  }, []);

  const rawSteps = useMemo(() => data ? buildErc8183Plan(data, chainJobId || undefined) : [], [data, chainJobId]);
  const approvalRequired = Boolean(data && BigInt(data.payment.allowance_raw) < BigInt(data.payment.budget_raw));
  const steps = useMemo<TestnetTransactionStep[]>(() => rawSteps.map((step) => ({
    id: step.id,
    label: step.label,
    description: step.description,
    tx: step.transaction || undefined,
    disabled:
      (step.id === "register" && !confirmed.create) ||
      (step.id === "set_budget" && !confirmed.register) ||
      (step.id === "approve" && (!confirmed.set_budget || !approvalRequired)) ||
      (step.id === "fund" && (!confirmed.set_budget || (approvalRequired && !confirmed.approve))),
  })), [rawSteps, confirmed, approvalRequired]);

  async function syncReceipt(step: TestnetTransactionStep, receipt: TestnetConfirmedReceipt) {
    if (!active) throw new Error("Active Testnet mission context is missing.");
    const response = await fetch("/api/testnet/erc8183", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "sync_receipt", mission_id: active.mission.id, job_id: active.job.id, phase: step.id, tx_hash: receipt.hash, chain_job_id: chainJobId || undefined }),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body?.error || "Testnet receipt synchronization failed");
    setConfirmed((current) => ({ ...current, [step.id]: true }));
    if (step.id === "create") {
      const discovered = body.job?.chain_job_id ?? body.onchain_job?.id;
      if (discovered != null) setChainJobId(String(discovered));
    }
  }

  return (
    <main className="console-page">
      <div className="console-shell">
        <header className="console-nav"><a href="/testnet" className="console-brand">AgentMarket</a><span>TESTNET / WALLET EXECUTION</span><a href="/app">Back to marketplace →</a></header>
        {error && <div className="console-alert console-alert-error">{error}</div>}
        <section className="console-hero">
          <div><span className="console-kicker">ERC-8183 / BSC TESTNET</span><h1>Execute the accepted quote.</h1><p>WalletConnect is used directly. Every transaction is signed by your wallet and confirmed on BSC Testnet before the next dependent step unlocks.</p></div>
          <div className="console-state"><small>NETWORK</small><strong>{network}</strong><span>Mainnet contracts are unavailable from this screen.</span></div>
        </section>
        {loading ? <section className="console-card"><p className="console-evidence">Loading the accepted Testnet quote and preparing the transaction plan…</p></section> : data && active ? <>
          <section className="console-grid">
            <div className="console-card"><div className="console-section-head"><span>ACCEPTED QUOTE</span><b>{data.quote.status}</b></div><div className="console-stat"><span>Mission</span><strong>{compact(active.mission.id)}</strong></div><div className="console-stat"><span>Quote</span><strong>{compact(data.quote.quote_id)}</strong></div><div className="console-stat"><span>Price</span><strong>{data.quote.price} {data.quote.currency}</strong></div><div className="console-stat"><span>Provider</span><strong>{compact(data.agent.provider)}</strong></div><div className="console-stat"><span>Chain</span><strong>BSC Testnet / 97</strong></div></div>
            <div className="console-card"><div className="console-section-head"><span>PAYMENT PREFLIGHT</span><b>LIVE</b></div><div className="console-stat"><span>Token</span><strong>{data.payment.symbol}</strong></div><div className="console-stat"><span>Budget</span><strong>{data.payment.balance_formatted ? data.payment.budget_raw : "—"}</strong></div><div className="console-stat"><span>Balance</span><strong>{data.payment.balance_formatted} {data.payment.symbol}</strong></div><div className="console-stat"><span>Allowance</span><strong>{data.payment.allowance_formatted} {data.payment.symbol}</strong></div><div className="console-stat"><span>Approval</span><strong>{approvalRequired ? "Required" : "Already sufficient"}</strong></div></div>
          </section>
          <section className="console-card console-plan-card"><div className="console-section-head"><span>ON-CHAIN TESTNET EXECUTION</span><b>{Object.values(confirmed).filter(Boolean).length}/5 CONFIRMED</b></div><p className="console-evidence">The first step creates the real ERC-8183 job and establishes the chain job ID. Register, budget, approval and funding remain locked until their dependencies are confirmed.</p><TestnetOnchainTransactionRunner steps={steps} onConfirmed={syncReceipt} /></section>
        </> : null}
      </div>
    </main>
  );
}
