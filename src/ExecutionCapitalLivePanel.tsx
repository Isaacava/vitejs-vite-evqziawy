import { useEffect, useMemo, useState } from "react";
import type { Address } from "viem";
import type { ExecutionCapitalRequest } from "./lib/executionCapital";
import { getExecutionCapability } from "./lib/executionCapital";
import { confirmTestnetExecutionReceipt, waitForTestnetExecutionReceipt, type TestnetExecutionReceipt } from "./lib/executionReceipt";
import { ensureAltanaTokenAllowance } from "./lib/altanaAllowance";

type Props = { request: ExecutionCapitalRequest };
type AssetChecks = { token_in_balance?: string; token_in_allowance?: string; token_in_balance_ok?: boolean; token_in_allowance_ok?: boolean; sufficient_balance?: boolean; sufficient_allowance?: boolean };
type PreflightResponse = { ok: boolean; request_id?: string; chain_id?: number; preflight?: { router: Address; tokenIn: Address; tokenOut: Address; recipient: Address; fee: number; amountIn: string; amountOutMinimum: string; selector: string; broadcast: false; call: { to: Address; data: `0x${string}`; value?: string }; checks?: AssetChecks }; asset_state?: AssetChecks; error?: string };
type ExecuteResponse = { ok?: boolean; error?: string; execution?: { execution_id?: string; calls_id?: string | null; transaction_hash?: string | null; executor_status?: string | null; receipt_verified?: boolean; receipt?: unknown } };
type ApprovalState = { token: Address; owner: Address; spender: Address; amount: string };
type Requirement = { execution_market?: { token_in?: string | null; token_out?: string | null; token_in_symbol?: string | null; token_out_symbol?: string | null; fee?: number | null }; execution_capital?: { token?: string | null; symbol?: string | null; decimals?: number | null; required_amount?: string | null; required_amount_raw?: string | null } };

const TESTNET_CHAIN_ID = 97;
function validAddress(value: string) { return /^0x[a-fA-F0-9]{40}$/.test(value); }
function validHash(value: string) { return /^0x[a-fA-F0-9]{64}$/.test(value); }
function validRaw(value: string, positive = false) { if (!/^\d+$/.test(value)) return false; if (positive && BigInt(value) <= 0n) return false; return true; }
function compact(value?: string | null) { return value ? `${value.slice(0, 10)}…${value.slice(-8)}` : "—"; }

export default function ExecutionCapitalLivePanel({ request }: Props) {
  const capability = getExecutionCapability(request);
  const [requirement, setRequirement] = useState<Requirement | null>(null);
  const [requirementError, setRequirementError] = useState("");
  const defaultRouter = capability?.allowed_targets?.length === 1 ? String(capability.allowed_targets[0]) : "";
  const [router, setRouter] = useState(defaultRouter);
  const [tokenIn, setTokenIn] = useState(request.capital_token || "");
  const [tokenOut, setTokenOut] = useState("");
  const [amountIn, setAmountIn] = useState("");
  const [amountOutMinimum, setAmountOutMinimum] = useState("0");
  const [fee, setFee] = useState("");
  const [loading, setLoading] = useState(false);
  const [preflight, setPreflight] = useState<PreflightResponse["preflight"] | null>(null);
  const [approval, setApproval] = useState<ApprovalState | null>(null);
  const [approvalHash, setApprovalHash] = useState("");
  const [approvalReceipt, setApprovalReceipt] = useState<TestnetExecutionReceipt | null>(null);
  const [receipt, setReceipt] = useState<TestnetExecutionReceipt | null>(null);
  const [transactionHash, setTransactionHash] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const response = await fetch(`/api/testnet?route=execution-capital-requirement&job=${encodeURIComponent(request.job_id)}`, { credentials: "include", cache: "no-store" });
        const body = await response.json().catch(() => null) as Requirement & { error?: string };
        if (!response.ok) throw new Error(body?.error || "Unable to resolve provider execution market");
        if (!active) return;
        setRequirement(body);
        const market = body.execution_market || {};
        const capital = body.execution_capital || {};
        if (market.token_in) setTokenIn(market.token_in);
        if (market.token_out) setTokenOut(market.token_out);
        if (market.fee !== null && market.fee !== undefined) setFee(String(market.fee));
        if (capital.required_amount_raw) setAmountIn(capital.required_amount_raw);
        setRequirementError("");
      } catch (cause) {
        if (active) setRequirementError(cause instanceof Error ? cause.message : "Unable to resolve provider execution market");
      }
    })();
    return () => { active = false; };
  }, [request.job_id]);

  const canUse = Boolean(capability && (request.status === "authorized" || request.status === "active") && capability.network === "bsc-testnet" && Number(capability.chainId) === TESTNET_CHAIN_ID && capability.allowed_targets?.length && capability.allowed_selectors?.length);
  const selectorList = useMemo(() => (capability?.allowed_selectors || []).map(String).join(", "), [capability]);
  if (!canUse || !capability) return null;

  function resetPreflight() { setPreflight(null); setApproval(null); setApprovalHash(""); setApprovalReceipt(null); setReceipt(null); setTransactionHash(""); setError(""); }

  async function runPreflight() {
    setLoading(true); setError(""); setMessage(""); setPreflight(null); setApproval(null); setApprovalHash(""); setApprovalReceipt(null); setReceipt(null); setTransactionHash("");
    try {
      if (!validAddress(router)) throw new Error("Router must be a valid BSC Testnet address");
      if (!validAddress(tokenIn)) throw new Error("Token in must be a valid BSC Testnet address");
      if (!validAddress(tokenOut)) throw new Error("Token out must be a valid BSC Testnet address");
      if (!request.user_execution_wallet || !validAddress(request.user_execution_wallet)) throw new Error("Authorized execution wallet is not available");
      if (!validRaw(amountIn, true)) throw new Error("The provider did not supply a valid execution amount");
      if (!validRaw(amountOutMinimum)) throw new Error("Minimum out must be a raw integer");
      if (!fee || !Number.isInteger(Number(fee))) throw new Error("The provider did not supply a valid execution fee tier");

      const response = await fetch("/api/testnet?route=execution-capital-preflight", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ request_id: request.id, router, tokenIn, tokenOut, recipient: request.user_execution_wallet, fee: Number(fee), amountIn, amountOutMinimum }) });
      const body = await response.json().catch(() => null) as PreflightResponse | null;
      const checks = body?.asset_state;
      if (!response.ok) {
        if (body?.error === "Execution router allowance is below the requested execution amount" && checks?.sufficient_balance !== false && checks?.sufficient_allowance === false) {
          setApproval({ token: tokenIn as Address, owner: request.user_execution_wallet as Address, spender: router as Address, amount: amountIn });
          setMessage("Preflight stopped before broadcast: the router needs an ERC-20 approval from the authorized execution wallet.");
          return;
        }
        throw new Error(body?.error || `Preflight failed with HTTP ${response.status}`);
      }
      if (!body?.ok || !body.preflight || body.chain_id !== TESTNET_CHAIN_ID) throw new Error("Preflight did not return a valid BSC Testnet plan");
      if (body.preflight.broadcast !== false) throw new Error("Preflight did not prove that no transaction was broadcast");
      setPreflight(body.preflight);
      if (body.preflight.checks?.token_in_balance_ok === false) setMessage("Preflight stopped before broadcast: the execution wallet does not have enough input-token balance.");
      else setMessage("Read-only preflight passed. No transaction was broadcast.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to run Testnet preflight"); }
    finally { setLoading(false); }
  }

  async function approveRouter() {
    if (!approval) return;
    setLoading(true); setError(""); setMessage("");
    try {
      const result = await ensureAltanaTokenAllowance(approval.token, approval.spender, BigInt(approval.amount));
      if (result.transactionHash) setApprovalHash(result.transactionHash);
      setApproval(null); setApprovalReceipt(null); setMessage("Router approval confirmed from the authorized Altana execution wallet. Run read-only preflight again to verify the allowance.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to approve router from the execution wallet"); }
    finally { setLoading(false); }
  }

  async function execute() {
    if (!preflight) return;
    setLoading(true); setError(""); setMessage(""); setReceipt(null);
    try {
      const response = await fetch("/api/testnet?route=execution-capital-execute", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ request_id: request.id, execution_id: crypto.randomUUID(), calls: [preflight.call] }) });
      const body = await response.json().catch(() => null) as ExecuteResponse | null;
      if (!response.ok) throw new Error(body?.error || `Execution failed with HTTP ${response.status}`);
      const hash = body?.execution?.transaction_hash;
      if (!hash || !validHash(hash)) throw new Error("Executor accepted the request but did not return a valid transaction hash");
      setTransactionHash(hash); setMessage("Transaction broadcast. Waiting for an independently observed BSC Testnet receipt…");
      const observed = await waitForTestnetExecutionReceipt(hash, { intervalMs: 1_500, timeoutMs: 90_000 });
      setReceipt(observed);
      if (observed.status !== "success") throw new Error(`BSC Testnet transaction was observed with status ${observed.status}`);
      await confirmTestnetExecutionReceipt(request.id, hash); setMessage("Execution receipt confirmed and persisted as independent Testnet evidence.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to complete Testnet execution"); }
    finally { setLoading(false); }
  }

  const balanceSummary = preflight?.checks ? `balance=${preflight.checks.token_in_balance || "—"} · allowance=${preflight.checks.token_in_allowance || "—"}` : "balance/allowance not yet checked";
  const tokenSymbol = requirement?.execution_capital?.symbol || requirement?.execution_market?.token_in_symbol || "execution token";
  const tokenOutSymbol = requirement?.execution_market?.token_out_symbol || "output token";

  return (
    <section className="border border-line rounded-[16px_8px_18px_9px] bg-paper p-5">
      <div className="flex items-start justify-between gap-4"><div><small className="block font-mono text-[8.5px] uppercase tracking-widest text-brass mb-1">Live execution · Testnet</small><h3 className="font-display text-[18px] font-bold m-0">Run the authorized execution scope</h3><p className="text-[10.5px] text-inksoft mt-1">Preflight validates the provider-declared execution scope, asset state, and transaction before any broadcast.</p></div><span className="status-green font-mono text-[9px] px-2.5 py-1 rounded-lg">AUTHORIZED</span></div>

      <div className="mt-4 border border-line rounded-lg bg-paperhi p-3 text-[10px]"><div><strong>Execution asset:</strong> {tokenSymbol} → {tokenOutSymbol}</div><div className="mt-1"><strong>Token in:</strong> {tokenIn || "resolving…"}</div><div className="mt-1"><strong>Token out:</strong> {tokenOut || "resolving…"}</div><div className="mt-1"><strong>Required amount:</strong> {requirement?.execution_capital?.required_amount || "resolving…"} {tokenSymbol}</div><div className="mt-1"><strong>Pool fee:</strong> {fee || "resolving…"}</div><div className="mt-1"><strong>Execution wallet:</strong> {request.user_execution_wallet}</div><div className="mt-1"><strong>Preflight asset state:</strong> {balanceSummary}</div></div>
      {requirementError && <div className="mt-3 text-[10px] text-rust">Execution-market requirement could not be refreshed: {requirementError}</div>}

      <div className="grid sm:grid-cols-2 gap-3 mt-4">
        <label className="block"><span className="block font-mono text-[8px] uppercase text-[#8a8477] mb-1">Router</span><input value={router} onChange={(event) => { setRouter(event.target.value.trim()); resetPreflight(); }} className="w-full bg-transparent border border-line rounded-lg px-3 py-2 font-mono text-[10px]" /></label>
        <label className="block"><span className="block font-mono text-[8px] uppercase text-[#8a8477] mb-1">Pool fee</span><input value={fee} onChange={(event) => { setFee(event.target.value.replace(/\D/g, "")); resetPreflight(); }} inputMode="numeric" className="w-full bg-transparent border border-line rounded-lg px-3 py-2 font-mono" /></label>
        <label className="block"><span className="block font-mono text-[8px] uppercase text-[#8a8477] mb-1">Token in</span><input value={tokenIn} onChange={(event) => { setTokenIn(event.target.value.trim()); resetPreflight(); }} className="w-full bg-transparent border border-line rounded-lg px-3 py-2 font-mono text-[10px]" /></label>
        <label className="block"><span className="block font-mono text-[8px] uppercase text-[#8a8477] mb-1">Token out</span><input value={tokenOut} onChange={(event) => { setTokenOut(event.target.value.trim()); resetPreflight(); }} className="w-full bg-transparent border border-line rounded-lg px-3 py-2 font-mono text-[10px]" /></label>
        <label className="block"><span className="block font-mono text-[8px] uppercase text-[#8a8477] mb-1">Amount in · raw units</span><input value={amountIn} onChange={(event) => { setAmountIn(event.target.value.replace(/\D/g, "")); resetPreflight(); }} inputMode="numeric" className="w-full bg-transparent border border-line rounded-lg px-3 py-2 font-mono" /></label>
        <label className="block"><span className="block font-mono text-[8px] uppercase text-[#8a8477] mb-1">Minimum out · raw units</span><input value={amountOutMinimum} onChange={(event) => { setAmountOutMinimum(event.target.value.replace(/\D/g, "")); resetPreflight(); }} inputMode="numeric" className="w-full bg-transparent border border-line rounded-lg px-3 py-2 font-mono" /></label>
      </div>

      <div className="mt-4 border border-line rounded-lg bg-paperhi p-3 text-[10px]"><div><strong>Authorized targets:</strong> {capability.allowed_targets.map(String).join(", ")}</div><div className="mt-1"><strong>Allowed selectors:</strong> {selectorList}</div></div>
      {error && <div className="console-alert console-alert-error mt-4">{error}</div>}
      {message && <div className="mt-4 text-[10.5px] text-inksoft">{message}</div>}

      {approval && <div className="mt-4 border border-line rounded-lg bg-paperhi p-4"><small className="block font-mono text-[8px] uppercase tracking-widest text-brass mb-1">Approval required</small><strong className="block text-[13px]">Approve the verified router for the exact execution amount</strong><div className="mt-2 text-[10px] font-mono break-all">token={approval.token}</div><div className="mt-1 text-[10px] font-mono break-all">spender={approval.spender}</div><div className="mt-1 text-[10px] font-mono">amount_raw={approval.amount}</div><button className="console-brass-button mt-3" type="button" onClick={() => void approveRouter()} disabled={loading}>{loading ? "Waiting for approval…" : "Approve router for swap →"}</button></div>}

      <div className="mt-4 flex flex-wrap gap-2"><button className="console-brass-button" type="button" onClick={() => void runPreflight()} disabled={loading || !tokenIn || !tokenOut || !amountIn || !fee}>{loading ? "Working…" : "Run read-only preflight →"}</button>{preflight && preflight.checks?.token_in_balance_ok !== false && preflight.checks?.token_in_allowance_ok !== false && <button className="console-brass-button" type="button" onClick={() => void execute()} disabled={loading}>{loading ? "Executing…" : "Execute authorized Testnet call →"}</button>}</div>
      {preflight && <div className="mt-4 border border-line rounded-lg bg-paperhi p-3 text-[10px] font-mono break-all"><div>PRECHECK: broadcast={String(preflight.broadcast)}</div><div>selector={preflight.selector}</div><div>to={preflight.call.to}</div><div>data={preflight.call.data}</div><div>{balanceSummary}</div></div>}
      {approvalHash && <div className="mt-4 border border-line rounded-lg p-3 text-[10px] font-mono break-all"><div>approval_transaction={compact(approvalHash)}</div><div>chain_id=97</div><div>receipt={approvalReceipt ? `${approvalReceipt.status} / block ${approvalReceipt.block_number}` : "waiting"}</div></div>}
      {transactionHash && <div className="mt-4 border border-line rounded-lg p-3 text-[10px] font-mono break-all"><div>transaction={compact(transactionHash)}</div><div>chain_id=97</div><div>receipt={receipt ? `${receipt.status} / block ${receipt.block_number}` : "waiting"}</div>{receipt && <div>gas_used={receipt.gas_used || "—"}</div>}</div>}
    </section>
  );
}
