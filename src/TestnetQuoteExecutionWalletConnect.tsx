import { useEffect, useMemo, useState } from "react";
import { buildErc8183Plan, type Erc8183PreparedResponse } from "./lib/erc8183TransactionPlan";
import { connectTestnetWallet, getTestnetCurrentUser } from "./lib/testnetWalletAuth";
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

type ActiveResponse = {
  ok: boolean;
  network: string;
  chain_id: number;
  environment: string;
  mission: { id: string; status: string; goal: string };
  job: { id: string; status: string; chain_job_id: number | null };
  quote: Prepared["quote"];
};

type ReceiptSyncResponse = {
  ok: boolean;
  job?: { chain_job_id: number | null; chain_status: string };
  onchain_job?: { id: string } | null;
  error?: string;
};

const compact = (value?: string | null) => value ? `${value.slice(0, 8)}…${value.slice(-6)}` : "—";

function normalizeChain(value: unknown) {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return 0;
  if (raw.startsWith("0x")) return Number.parseInt(raw.slice(2), 16);
  return Number(raw);
}

async function jsonResponse(response: Response) {
  const raw = await response.text();
  let body: Record<string, unknown> = {};
  try {
    body = raw ? JSON.parse(raw) : {};
  } catch {
    throw new Error(`${response.status} ${response.statusText}: ${raw.slice(0, 240) || "Server returned a non-JSON response."}`);
  }
  return body;
}

export default function TestnetQuoteExecutionWalletConnect() {
  const [active, setActive] = useState<ActiveResponse | null>(null);
  const [data, setData] = useState<Prepared | null>(null);
  const [chainJobId, setChainJobId] = useState("");
  const [confirmed, setConfirmed] = useState<Record<string, boolean>>({});
  const [network, setNetwork] = useState("checking");
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState("");

  async function loadExecution() {
    setLoading(true);
    setError("");
    try {
      const user = await getTestnetCurrentUser();
      if (!user) throw new Error("Testnet wallet authentication is required. Return to the Testnet marketplace and sign in again.");

      setConnecting(true);
      const connected = await connectTestnetWallet();
      const chainId = normalizeChain(await connected.provider.request({ method: "eth_chainId" }));
      if (chainId !== 97) throw new Error(`WalletConnect is on chain ${chainId || "unknown"}. AgentMarket requires BSC Testnet (chain 97).`);
      const accounts = await connected.provider.request({ method: "eth_accounts" }) as string[];
      const clientAddress = accounts?.[0] || connected.address;
      if (!clientAddress) throw new Error("WalletConnect restored without an account.");
      setNetwork("bsc-testnet / 97");

      const activeResponse = await fetch("/api/testnet?route=active-quote", { credentials: "include" });
      const activeBody = await jsonResponse(activeResponse);
      if (!activeResponse.ok) throw new Error(String(activeBody.error || "No active Testnet quote was found."));
      if (Number(activeBody.chain_id) !== 97 || activeBody.environment !== "testnet") throw new Error("Active quote is not a BSC Testnet quote.");
      setActive(activeBody as unknown as ActiveResponse);
      const activeQuote = (activeBody as ActiveResponse).quote;

      if (activeQuote.status !== "accepted") {
        throw new Error(`The active provider quote is ${activeQuote.status}. Accept the provider quote before executing it.`);
      }

      const prepareResponse = await fetch("/api/testnet/prepare-quote", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mission_id: (activeBody as ActiveResponse).mission.id,
          quote_id: activeQuote.quote_id,
          client_address: clientAddress,
        }),
      });
      const preparedBody = await jsonResponse(prepareResponse);
      if (!prepareResponse.ok) throw new Error(String(preparedBody.error || "Unable to prepare the Testnet transaction plan."));
      if (preparedBody.network !== "bsc-testnet" || Number(preparedBody.chain_id) !== 97) throw new Error("Preparation returned non-Testnet data.");
      const prepared = preparedBody as unknown as Prepared;
      setData(prepared);

      const existingChainJob = (activeBody as ActiveResponse).job.chain_job_id;
      if (existingChainJob != null) setChainJobId(String(existingChainJob));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load Testnet execution plan");
    } finally {
      setConnecting(false);
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadExecution();
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

  const requiredSteps = useMemo(() => steps.filter((step) => Boolean(step.tx)), [steps]);
  const confirmedRequired = useMemo(
    () => requiredSteps.filter((step) => confirmed[step.id]).length,
    [requiredSteps, confirmed],
  );

  async function syncReceipt(step: TestnetTransactionStep, receipt: TestnetConfirmedReceipt) {
    if (!active) throw new Error("Active Testnet mission context is missing.");

    const response = await fetch("/api/testnet/erc8183", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "sync_receipt",
        mission_id: active.mission.id,
        job_id: active.job.id,
        phase: step.id,
        tx_hash: receipt.hash,
        chain_job_id: chainJobId || undefined,
      }),
    });
    const body = await jsonResponse(response) as ReceiptSyncResponse;
    if (!response.ok) throw new Error(body.error || "Testnet receipt synchronization failed");

    setConfirmed((current) => ({ ...current, [step.id]: true }));

    if (step.id === "create") {
      const discovered = body.job?.chain_job_id ?? body.onchain_job?.id;
      if (discovered != null) setChainJobId(String(discovered));
    }
  }

  async function reconnect() {
    setConnecting(true);
    setError("");
    try {
      const connected = await connectTestnetWallet();
      const chainId = normalizeChain(await connected.provider.request({ method: "eth_chainId" }));
      if (chainId !== 97) throw new Error("Approve BSC Testnet (chain 97) in your wallet before continuing.");
      await loadExecution();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to reconnect the Testnet wallet");
      setConnecting(false);
    }
  }

  return (
    <main className="console-page">
      <div className="console-shell">
        <header className="console-nav">
          <a href="/testnet" className="console-brand">AgentMarket</a>
          <span>TESTNET / WALLET EXECUTION</span>
          <a href="/app">Back to marketplace →</a>
        </header>

        {error && <div className="console-alert console-alert-error">{error}</div>}

        <section className="console-hero">
          <div>
            <span className="console-kicker">ERC-8183 / BSC TESTNET</span>
            <h1>Execute the accepted quote.</h1>
            <p>WalletConnect is restored directly on this page. Every transaction is signed by your wallet and confirmed on BSC Testnet before the next dependent step unlocks.</p>
          </div>
          <div className="console-state"><small>NETWORK</small><strong>{network}</strong><span>Mainnet contracts are unavailable from this screen.</span></div>
        </section>

        {(loading || connecting) && (
          <section className="console-card">
            <div className="console-section-head"><span>WALLETCONNECT / TESTNET</span><b>CONNECTING</b></div>
            <p className="console-evidence">Restoring the BSC Testnet WalletConnect session and loading the accepted quote…</p>
          </section>
        )}

        {!loading && !data && (
          <section className="console-card">
            <div className="console-section-head"><span>WALLETCONNECT / TESTNET</span><b>ACTION NEEDED</b></div>
            <p className="console-evidence">The execution page could not restore the Testnet wallet session.</p>
            <button className="console-brass-button" type="button" disabled={connecting} onClick={() => void reconnect()}>
              {connecting ? "Reconnecting…" : "Reconnect Testnet wallet →"}
            </button>
          </section>
        )}

        {!loading && data && active && (
          <>
            <section className="console-grid">
              <div className="console-card">
                <div className="console-section-head"><span>ACCEPTED QUOTE</span><b>{data.quote.status}</b></div>
                <div className="console-stat"><span>Mission</span><strong>{compact(active.mission.id)}</strong></div>
                <div className="console-stat"><span>Quote</span><strong>{compact(data.quote.quote_id)}</strong></div>
                <div className="console-stat"><span>Price</span><strong>{data.quote.price} {data.quote.currency}</strong></div>
                <div className="console-stat"><span>Provider</span><strong>{compact(data.agent.provider)}</strong></div>
                <div className="console-stat"><span>Chain</span><strong>BSC Testnet / 97</strong></div>
              </div>
              <div className="console-card">
                <div className="console-section-head"><span>PAYMENT PREFLIGHT</span><b>LIVE</b></div>
                <div className="console-stat"><span>Token</span><strong>{data.payment.symbol}</strong></div>
                <div className="console-stat"><span>Quoted budget</span><strong>{data.payment.budget_raw}</strong></div>
                <div className="console-stat"><span>Balance</span><strong>{data.payment.balance_formatted} {data.payment.symbol}</strong></div>
                <div className="console-stat"><span>Allowance</span><strong>{data.payment.allowance_formatted} {data.payment.symbol}</strong></div>
                <div className="console-stat"><span>Approval</span><strong>{approvalRequired ? "Required" : "Already sufficient"}</strong></div>
              </div>
            </section>

            <section className="console-card console-plan-card">
              <div className="console-section-head">
                <span>ON-CHAIN TESTNET EXECUTION</span>
                <b>{confirmedRequired}/{requiredSteps.length} REQUIRED CONFIRMED</b>
              </div>
              <p className="console-evidence">The first step creates the ERC-8183 job and establishes the real chain job ID. Register, budget, approval and funding remain locked until their dependencies are confirmed.</p>
              <TestnetOnchainTransactionRunner steps={steps} onConfirmed={syncReceipt} />
            </section>
          </>
        )}
      </div>
    </main>
  );
}
