import { useEffect, useMemo, useState } from "react";
import OnchainTransactionRunner, { type ConfirmedRunnerReceipt, type TransactionStep } from "./OnchainTransactionRunner";
import { buildErc8183Plan, type Erc8183PreparedResponse } from "./lib/erc8183TransactionPlan";
import "./mission-console.css";

type PreparedResponse = Erc8183PreparedResponse & {
  ok: boolean;
  environment: string;
  mission: { id: string; status: string };
  quote: { quote_id: string; price: string; currency: string; quote_hash: string; expires_at: string; status: string };
  agent: { agent_id: string; name: string | null; provider: string };
  job_description: string;
};

type ReceiptSyncResponse = {
  ok: boolean;
  phase: string;
  tx_hash: string;
  block_number: string;
  job?: { chain_job_id: number | null; chain_status: string };
  onchain_job?: { id: string; status: number; budget: string; provider: string; client: string } | null;
  note?: string;
};

type ProviderJobStatus = {
  status_name: string;
  status: number;
  provider: string;
  budget: string;
  deliverable_hash: string;
  submitted_at: string | null;
  expired_at: string;
};

const TESTNET_CHAIN_ID = "0x61";
const compact = (value?: string | null) => value ? `${value.slice(0, 8)}…${value.slice(-6)}` : "—";

export default function TestnetQuoteExecution() {
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const missionId = params.get("mission") || "";
  const quoteId = params.get("quote") || "";
  const marketplaceJobId = params.get("job") || "";
  const [data, setData] = useState<PreparedResponse | null>(null);
  const [chainJobId, setChainJobId] = useState("");
  const [confirmed, setConfirmed] = useState<Record<string, boolean>>({});
  const [providerStatus, setProviderStatus] = useState<ProviderJobStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [network, setNetwork] = useState("checking");
  const [loadingPlan, setLoadingPlan] = useState(false);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        if (!missionId || !quoteId) throw new Error("mission and quote query parameters are required");
        const ethereum = window.ethereum;
        if (!ethereum) throw new Error("Connect a compatible browser wallet before executing the Testnet job.");
        const chainId = String(await ethereum.request({ method: "eth_chainId" })).toLowerCase();
        if (chainId !== TESTNET_CHAIN_ID) throw new Error("Wrong network. Switch your wallet to BSC Testnet (chain 97) before continuing.");
        if (active) setNetwork("bsc-testnet / 97");

        const accounts = (await ethereum.request({ method: "eth_accounts" })) as string[];
        const clientAddress = accounts[0];
        if (!clientAddress) throw new Error("No wallet account is connected. Connect the wallet and retry.");

        const auth = await fetch("/api/auth/me", { credentials: "include" });
        if (!auth.ok) throw new Error("Wallet authentication is required before signing the Testnet job.");

        const response = await fetch("/api/testnet/prepare-quote", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mission_id: missionId, quote_id: quoteId, client_address: clientAddress }),
        });
        const body = await response.json();
        if (!response.ok) throw new Error(body?.error || "Unable to prepare the accepted Testnet quote");
        if (body.network !== "bsc-testnet" || Number(body.chain_id) !== 97) throw new Error("Preparation response is not BSC Testnet data.");
        if (active) setData(body as PreparedResponse);
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : "Unable to load Testnet execution plan");
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => { active = false; };
  }, [missionId, quoteId]);

  const rawPlan = useMemo(() => data ? buildErc8183Plan(data, chainJobId || undefined) : [], [data, chainJobId]);
  const approvalRequired = useMemo(() => {
    if (!data) return false;
    return BigInt(data.payment.allowance_raw) < BigInt(data.payment.budget_raw);
  }, [data]);
  const steps = useMemo<TransactionStep[]>(() => {
    const order = ["create", "register", "set_budget", "approve", "fund"];
    return rawPlan.map((step) => ({
      id: step.id,
      label: step.label,
      description: step.description,
      tx: step.transaction || undefined,
      disabled:
        (step.id === "register" && !confirmed.create) ||
        (step.id === "set_budget" && !confirmed.register) ||
        (step.id === "approve" && (!confirmed.set_budget || !approvalRequired)) ||
        (step.id === "fund" && (!confirmed.set_budget || (approvalRequired && !confirmed.approve) || step.transaction == null)) ||
        order.indexOf(step.id) < 0,
    }));
  }, [rawPlan, confirmed, approvalRequired]);

  async function syncReceipt(step: TransactionStep, receipt: ConfirmedRunnerReceipt) {
    if (!marketplaceJobId) {
      setError("Execution needs the marketplace job ID in the URL to persist each receipt.");
      return;
    }
    const phase = step.id;
    const response = await fetch("/api/testnet/erc8183", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "sync_receipt",
        mission_id: missionId,
        job_id: marketplaceJobId,
        phase,
        tx_hash: receipt.hash,
        chain_job_id: chainJobId || undefined,
      }),
    });
    const body = await response.json() as ReceiptSyncResponse & { error?: string };
    if (!response.ok) throw new Error(body.error || "Testnet receipt synchronization failed");
    setConfirmed((current) => ({ ...current, [step.id]: true }));
    if (step.id === "create") {
      const discovered = body.job?.chain_job_id ?? body.onchain_job?.id;
      if (discovered != null) setChainJobId(String(discovered));
    }
  }

  useEffect(() => {
    if (!confirmed.fund || !chainJobId || !marketplaceJobId) return;
    let active = true;
    let timer: number | undefined;

    const poll = async () => {
      try {
        const query = new URLSearchParams({
          mission_id: missionId,
          marketplace_job_id: marketplaceJobId,
          job_id: chainJobId,
        });
        const response = await fetch(`/api/testnet/job-status?${query.toString()}`, { credentials: "include" });
        const body = await response.json();
        if (!response.ok) throw new Error(body?.error || "Unable to read Testnet provider status");
        if (!active) return;
        setProviderStatus({
          status_name: body.job.status_name,
          status: Number(body.job.status),
          provider: body.job.provider,
          budget: body.job.budget,
          deliverable_hash: body.job.deliverable_hash,
          submitted_at: body.job.submitted_at,
          expired_at: body.job.expired_at,
        });

        if (["COMPLETED", "REJECTED", "EXPIRED"].includes(body.job.status_name)) return;
        timer = window.setTimeout(poll, 10000);
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : "Unable to poll Testnet provider status");
        timer = window.setTimeout(poll, 15000);
      }
    };

    void poll();
    return () => {
      active = false;
      if (timer) window.clearTimeout(timer);
    };
  }, [confirmed.fund, chainJobId, marketplaceJobId, missionId]);

  async function confirmNetworkAgain() {
    const ethereum = window.ethereum;
    if (!ethereum) throw new Error("No browser wallet detected.");
    const chainId = String(await ethereum.request({ method: "eth_chainId" })).toLowerCase();
    if (chainId !== TESTNET_CHAIN_ID) throw new Error("Switch the connected wallet to BSC Testnet (chain 97).");
    setNetwork("bsc-testnet / 97");
  }

  async function reloadPlan() {
    setLoadingPlan(true);
    setError("");
    try {
      await confirmNetworkAgain();
      const accounts = (await window.ethereum!.request({ method: "eth_accounts" })) as string[];
      const clientAddress = accounts[0];
      if (!clientAddress) throw new Error("No wallet account is connected. Connect the wallet and retry.");
      const response = await fetch("/api/testnet/prepare-quote", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mission_id: missionId, quote_id: quoteId, client_address: clientAddress }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error || "Unable to refresh Testnet plan");
      if (body.network !== "bsc-testnet" || Number(body.chain_id) !== 97) throw new Error("Refresh response is not BSC Testnet data.");
      setData(body as PreparedResponse);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to refresh Testnet plan");
    } finally {
      setLoadingPlan(false);
    }
  }

  return (
    <main className="console-page">
      <div className="console-shell">
        <header className="console-nav">
          <a href="/" className="console-brand">AgentMarket</a>
          <span>TESTNET / QUOTE EXECUTION</span>
          <a href="/app">Back to marketplace →</a>
        </header>

        {error && <div className="console-alert console-alert-error">{error}</div>}

        <section className="console-hero">
          <div>
            <span className="console-kicker">ERC-8183 / BSC TESTNET</span>
            <h1>Execute the accepted quote.</h1>
            <p>Each transaction is signed by your wallet, confirmed on BSC Testnet, and synchronized back into AgentMarket before the next dependent step becomes available.</p>
          </div>
          <div className="console-state"><small>NETWORK</small><strong>{network}</strong><span>Production Mainnet contracts are unavailable from this screen.</span></div>
        </section>

        {loading ? (
          <section className="console-card"><p className="console-evidence">Loading the accepted Testnet quote and transaction plan…</p></section>
        ) : data ? (
          <>
            <section className="console-grid">
              <div className="console-card">
                <div className="console-section-head"><span>ACCEPTED QUOTE</span><b>{data.quote.status}</b></div>
                <div className="console-stat"><span>Quote</span><strong>{compact(data.quote.quote_id)}</strong></div>
                <div className="console-stat"><span>Price</span><strong>{data.quote.price} {data.quote.currency}</strong></div>
                <div className="console-stat"><span>Hash</span><strong>{compact(data.quote.quote_hash)}</strong></div>
                <div className="console-stat"><span>Provider</span><strong>{compact(data.agent.provider)}</strong></div>
                <div className="console-stat"><span>Chain</span><strong>BSC Testnet / 97</strong></div>
              </div>
              <div className="console-card">
                <div className="console-section-head"><span>PAYMENT PREFLIGHT</span><b>LIVE</b></div>
                <div className="console-stat"><span>Token</span><strong>{data.payment.symbol}</strong></div>
                <div className="console-stat"><span>Quoted budget</span><strong>{data.payment.budget_raw}</strong></div>
                <div className="console-stat"><span>Balance</span><strong>{data.payment.balance_formatted} {data.payment.symbol}</strong></div>
                <div className="console-stat"><span>Allowance</span><strong>{data.payment.allowance_formatted} {data.payment.symbol}</strong></div>
                <div className="console-stat"><span>Approval required</span><strong>{approvalRequired ? "Yes" : "No"}</strong></div>
                <button className="console-brass-button" type="button" disabled={loadingPlan} onClick={() => void reloadPlan()}>{loadingPlan ? "Refreshing…" : "Refresh Testnet preflight →"}</button>
              </div>
            </section>

            {providerStatus && (
              <section className="console-card">
                <div className="console-section-head"><span>PROVIDER EXECUTION</span><b>{providerStatus.status_name}</b></div>
                <div className="console-stat"><span>Provider</span><strong>{compact(providerStatus.provider)}</strong></div>
                <div className="console-stat"><span>On-chain budget</span><strong>{providerStatus.budget}</strong></div>
                <div className="console-stat"><span>Deliverable hash</span><strong>{compact(providerStatus.deliverable_hash)}</strong></div>
                <div className="console-stat"><span>Submitted</span><strong>{providerStatus.submitted_at ? new Date(providerStatus.submitted_at).toLocaleString() : "Waiting for provider"}</strong></div>
                <p className="console-evidence">AgentMarket is reading the actual BSC Testnet Commerce job. The provider status cannot be advanced by the client UI.</p>
              </section>
            )}

            <section className="console-card console-plan-card">
              <div className="console-section-head"><span>WALLET EXECUTION</span><b>{chainJobId ? `JOB ${chainJobId}` : "AWAITING createJob"}</b></div>
              <p className="console-evidence">Sequence is enforced: createJob → registerJob → setBudget → approve (when needed) → fund. Dependent steps remain locked until their prerequisite receipt is synchronized.</p>
              <OnchainTransactionRunner
                steps={steps}
                onConfirmed={(step, receipt) => {
                  void syncReceipt(step, receipt).catch((cause) => setError(cause instanceof Error ? cause.message : "Receipt synchronization failed"));
                }}
              />
            </section>

            <section className="console-card">
              <div className="console-section-head"><span>QUOTE ANCHOR</span><b>IMMUTABLE INPUT</b></div>
              <p className="console-evidence">The ERC-8183 description sent by the preparation API contains the accepted quote hash and the Grid Agent strategy parameters. The wallet runner cannot replace them with a different client-supplied budget.</p>
              <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", margin: 0, fontSize: 12 }}>{data.job_description}</pre>
            </section>
          </>
        ) : null}
      </div>
    </main>
  );
}
