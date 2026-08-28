import { useMemo, useState } from "react";
import { encodeFunctionData, type Address, type Hex } from "viem";
import type { ExecutionCapitalRequest } from "./lib/executionCapital";
import { getExecutionCapability, TESTNET_U_TOKEN_ADDRESS } from "./lib/executionCapital";
import { confirmTestnetExecutionReceipt, waitForTestnetExecutionReceipt, type TestnetExecutionReceipt } from "./lib/executionReceipt";
import { connectTestnetWallet } from "./lib/testnetWalletAuth";

type Props = { request: ExecutionCapitalRequest };

type AssetChecks = {
  token_in_balance?: string;
  token_in_allowance?: string;
  token_in_balance_ok?: boolean;
  token_in_allowance_ok?: boolean;
};

type PreflightResponse = {
  ok: boolean;
  request_id?: string;
  chain_id?: number;
  preflight?: {
    router: Address;
    tokenIn: Address;
    tokenOut: Address;
    recipient: Address;
    fee: number;
    amountIn: string;
    amountOutMinimum: string;
    selector: string;
    broadcast: false;
    call: { to: Address; data: `0x${string}`; value?: string };
    checks?: AssetChecks;
  };
  asset_state?: AssetChecks;
  error?: string;
};

type ExecuteResponse = {
  ok?: boolean;
  error?: string;
  execution?: {
    execution_id?: string;
    calls_id?: string | null;
    transaction_hash?: string | null;
    executor_status?: string | null;
    receipt_verified?: boolean;
    receipt?: unknown;
  };
};

type ApprovalState = {
  token: Address;
  owner: Address;
  spender: Address;
  amount: string;
  data: Hex;
};

const TESTNET_CHAIN_ID = 97;
const TESTNET_WBNB_ADDRESS = "0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd" as Address;
const CONTROLLED_CAPITAL_RAW = "1000000000000000000";
const CONTROLLED_FEE = 2500;
const ERC20_APPROVE_ABI = [{
  type: "function",
  name: "approve",
  stateMutability: "nonpayable",
  inputs: [
    { name: "spender", type: "address" },
    { name: "amount", type: "uint256" },
  ],
  outputs: [{ name: "approved", type: "bool" }],
}] as const;

function validAddress(value: string) { return /^0x[a-fA-F0-9]{40}$/.test(value); }
function validHash(value: string) { return /^0x[a-fA-F0-9]{64}$/.test(value); }
function validRaw(value: string, positive = false) {
  if (!/^\d+$/.test(value)) return false;
  if (positive && BigInt(value) <= 0n) return false;
  return true;
}
function compact(value?: string | null) { return value ? `${value.slice(0, 10)}…${value.slice(-8)}` : "—"; }
function requestCapitalToken(request: ExecutionCapitalRequest) {
  const evidence = request.evidence && typeof request.evidence === "object" ? request.evidence as Record<string, unknown> : {};
  const raw = typeof evidence.capital_token === "string" ? evidence.capital_token.trim() : request.capital_token?.trim() || "";
  if (!raw || ["bnb", "tbnb", "tbn"].includes(raw.toLowerCase())) return TESTNET_U_TOKEN_ADDRESS;
  return raw;
}

export default function ExecutionCapitalLivePanel({ request }: Props) {
  const capability = getExecutionCapability(request);
  const defaultRouter = capability?.allowed_targets?.length === 1 ? String(capability.allowed_targets[0]) : "";
  const defaultTokenIn = requestCapitalToken(request);
  const [router, setRouter] = useState(defaultRouter);
  const [tokenIn, setTokenIn] = useState(defaultTokenIn);
  const [tokenOut, setTokenOut] = useState(String(TESTNET_WBNB_ADDRESS));
  const [amountIn, setAmountIn] = useState(CONTROLLED_CAPITAL_RAW);
  const [amountOutMinimum, setAmountOutMinimum] = useState("0");
  const [fee, setFee] = useState(String(CONTROLLED_FEE));
  const [loading, setLoading] = useState(false);
  const [preflight, setPreflight] = useState<PreflightResponse["preflight"] | null>(null);
  const [approval, setApproval] = useState<ApprovalState | null>(null);
  const [approvalHash, setApprovalHash] = useState("");
  const [approvalReceipt, setApprovalReceipt] = useState<TestnetExecutionReceipt | null>(null);
  const [receipt, setReceipt] = useState<TestnetExecutionReceipt | null>(null);
  const [transactionHash, setTransactionHash] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const canUse = Boolean(
    capability && (request.status === "authorized" || request.status === "active") &&
    capability.network === "bsc-testnet" && Number(capability.chainId) === TESTNET_CHAIN_ID &&
    capability.allowed_targets?.length && capability.allowed_selectors?.length,
  );
  const selectorList = useMemo(() => (capability?.allowed_selectors || []).map(String).join(", "), [capability]);
  if (!canUse || !capability) return null;

  function resetPreflight() {
    setPreflight(null);
    setApproval(null);
    setApprovalHash("");
    setApprovalReceipt(null);
    setReceipt(null);
    setTransactionHash("");
    setError("");
  }

  async function runPreflight() {
    setLoading(true);
    setError("");
    setMessage("");
    setPreflight(null);
    setApproval(null);
    setApprovalHash("");
    setApprovalReceipt(null);
    setReceipt(null);
    setTransactionHash("");
    try {
      if (!validAddress(router)) throw new Error("Router must be a valid BSC Testnet address");
      if (!validAddress(tokenIn)) throw new Error("Token in must be a valid BSC Testnet address");
      if (!validAddress(tokenOut)) throw new Error("Token out must be a valid BSC Testnet address");
      if (!request.user_execution_wallet || !validAddress(request.user_execution_wallet)) throw new Error("Authorized execution wallet is not available");
      if (!validRaw(amountIn, true)) throw new Error("Amount in must be a positive raw token amount");
      if (BigInt(amountIn) > BigInt(CONTROLLED_CAPITAL_RAW)) throw new Error("Amount in cannot exceed the controlled 1 U Testnet cap");
      if (!validRaw(amountOutMinimum)) throw new Error("Minimum out must be a raw integer");
      if (Number(fee) !== CONTROLLED_FEE) throw new Error(`The controlled Testnet proof requires pool fee ${CONTROLLED_FEE}`);

      const response = await fetch("/api/testnet?route=execution-capital-preflight", {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ request_id: request.id, router, tokenIn, tokenOut, recipient: request.user_execution_wallet, fee: Number(fee), amountIn, amountOutMinimum }),
      });
      const body = await response.json().catch(() => null) as PreflightResponse | null;
      const checks = body?.asset_state;
      if (!response.ok) {
        if (body?.error === "Execution router allowance is below the requested execution amount" && checks?.sufficient_balance !== false && checks?.sufficient_allowance === false) {
          const owner = request.user_execution_wallet as Address;
          const spender = router as Address;
          const token = tokenIn as Address;
          const data = encodeFunctionData({ abi: ERC20_APPROVE_ABI, functionName: "approve", args: [spender, BigInt(amountIn)] });
          setApproval({ token, owner, spender, amount: amountIn, data });
          setMessage("Preflight stopped before broadcast: the router needs an ERC-20 approval from the authorized execution wallet.");
          return;
        }
        throw new Error(body?.error || `Preflight failed with HTTP ${response.status}`);
      }
      if (!body?.ok || !body.preflight || body.chain_id !== TESTNET_CHAIN_ID) throw new Error("Preflight did not return a valid BSC Testnet plan");
      if (body.preflight.broadcast !== false) throw new Error("Preflight did not prove that no transaction was broadcast");
      setPreflight(body.preflight);
      const resultChecks = body.preflight.checks;
      if (resultChecks?.token_in_balance_ok === false) setMessage("Preflight stopped before broadcast: the execution wallet does not have enough input-token balance.");
      else setMessage("Read-only preflight passed. No transaction was broadcast.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to run Testnet preflight");
    } finally { setLoading(false); }
  }

  async function approveRouter() {
    if (!approval) return;
    setLoading(true);
    setError("");
    setMessage("");
    try {
      const { provider, address } = await connectTestnetWallet();
      if (address.toLowerCase() !== approval.owner.toLowerCase()) throw new Error("Connected wallet does not match the authorized execution wallet");
      const hash = await provider.request({ method: "eth_sendTransaction", params: [{ from: approval.owner, to: approval.token, data: approval.data, value: "0x0" }] }) as string;
      if (!hash || !validHash(hash)) throw new Error("Wallet returned an invalid approval transaction hash");
      setApprovalHash(hash);
      setMessage("Router approval broadcast. Waiting for an independently observed BSC Testnet receipt…");
      const observed = await waitForTestnetExecutionReceipt(hash, { intervalMs: 1_500, timeoutMs: 90_000 });
      setApprovalReceipt(observed);
      if (observed.status !== "success") throw new Error(`BSC Testnet approval transaction was observed with status ${observed.status}`);
      setApproval(null);
      setMessage("Router approval confirmed. Run read-only preflight again to verify the new allowance.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to approve router");
    } finally { setLoading(false); }
  }

  async function execute() {
    if (!preflight) return;
    setLoading(true); setError(""); setMessage(""); setReceipt(null);
    try {
      const response = await fetch("/api/testnet?route=execution-capital-execute", {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ request_id: request.id, execution_id: crypto.randomUUID(), calls: [preflight.call] }),
      });
      const body = await response.json().catch(() => null) as ExecuteResponse | null;
      if (!response.ok) throw new Error(body?.error || `Execution failed with HTTP ${response.status}`);
      const hash = body?.execution?.transaction_hash;
      if (!hash || !validHash(hash)) throw new Error("Executor accepted the request but did not return a valid transaction hash");
      setTransactionHash(hash);
      setMessage("Transaction broadcast. Waiting for an independently observed BSC Testnet receipt…");
      const observed = await waitForTestnetExecutionReceipt(hash, { intervalMs: 1_500, timeoutMs: 90_000 });
      setReceipt(observed);
      if (observed.status !== "success") throw new Error(`BSC Testnet transaction was observed with status ${observed.status}`);
      await confirmTestnetExecutionReceipt(request.id, hash);
      setMessage("Execution receipt confirmed and persisted as independent Testnet evidence.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to complete Testnet execution"); }
    finally { setLoading(false); }
  }

  const balanceSummary = preflight?.checks ? `balance=${preflight.checks.token_in_balance || "—"} · allowance=${preflight.checks.token_in_allowance || "—"}` : "balance/allowance not yet checked";

  return (
    <section className="border border-line rounded-[16px_8px_18px_9px] bg-paper p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <small className="block font-mono text-[8.5px] uppercase tracking-widest text-brass mb-1">Live execution · Testnet</small>
          <h3 className="font-display text-[18px] font-bold m-0">Run the authorized execution scope</h3>
          <p className="text-[10.5px] text-inksoft mt-1">Preflight validates the provider-declared execution scope, asset state, and transaction before any broadcast.</p>
        </div>
        <span className="status-green font-mono text-[9px] px-2.5 py-1 rounded-lg">AUTHORIZED</span>
      </div>

      <div className="grid sm:grid-cols-2 gap-3 mt-5">
        <label className="block"><span className="block font-mono text-[8px] uppercase text-[#8a8477] mb-1">Router</span><input value={router} onChange={(event) => { setRouter(event.target.value.trim()); resetPreflight(); }} className="w-full bg-transparent border border-line rounded-lg px-3 py-2 font-mono text-[10px]" /></label>
        <label className="block"><span className="block font-mono text-[8px] uppercase text-[#8a8477] mb-1">Pool fee</span><input value={fee} onChange={(event) => { setFee(event.target.value.replace(/\D/g, "")); resetPreflight(); }} inputMode="numeric" className="w-full bg-transparent border border-line rounded-lg px-3 py-2 font-mono" /></label>
        <label className="block"><span className="block font-mono text-[8px] uppercase text-[#8a8477] mb-1">Token in</span><input value={tokenIn} onChange={(event) => { setTokenIn(event.target.value.trim()); resetPreflight(); }} className="w-full bg-transparent border border-line rounded-lg px-3 py-2 font-mono text-[10px]" /></label>
        <label className="block"><span className="block font-mono text-[8px] uppercase text-[#8a8477] mb-1">Token out</span><input value={tokenOut} onChange={(event) => { setTokenOut(event.target.value.trim()); resetPreflight(); }} className="w-full bg-transparent border border-line rounded-lg px-3 py-2 font-mono text-[10px]" /></label>
        <label className="block"><span className="block font-mono text-[8px] uppercase text-[#8a8477] mb-1">Amount in · raw units</span><input value={amountIn} onChange={(event) => { setAmountIn(event.target.value.replace(/\D/g, "")); resetPreflight(); }} inputMode="numeric" className="w-full bg-transparent border border-line rounded-lg px-3 py-2 font-mono" /></label>
        <label className="block"><span className="block font-mono text-[8px] uppercase text-[#8a8477] mb-1">Minimum out · raw units</span><input value={amountOutMinimum} onChange={(event) => { setAmountOutMinimum(event.target.value.replace(/\D/g, "")); resetPreflight(); }} inputMode="numeric" className="w-full bg-transparent border border-line rounded-lg px-3 py-2 font-mono" /></label>
      </div>

      <div className="mt-4 border border-line rounded-lg bg-paperhi p-3 text-[10px]">
        <div><strong>Authorized token in:</strong> {defaultTokenIn}</div>
        <div className="mt-1"><strong>Token out:</strong> {tokenOut}</div>
        <div className="mt-1"><strong>Authorized amount cap:</strong> {CONTROLLED_CAPITAL_RAW} raw units</div>
        <div className="mt-1"><strong>Allowed targets:</strong> {capability.allowed_targets.map(String).join(", ")}</div>
        <div className="mt-1"><strong>Allowed selectors:</strong> {selectorList}</div>
        <div className="mt-1"><strong>Execution wallet:</strong> {request.user_execution_wallet}</div>
        <div className="mt-1"><strong>Preflight asset state:</strong> {balanceSummary}</div>
      </div>

      {error && <div className="console-alert console-alert-error mt-4">{error}</div>}
      {message && <div className="mt-4 text-[10.5px] text-inksoft">{message}</div>}

      {approval && (
        <div className="mt-4 border border-line rounded-lg bg-paperhi p-4">
          <small className="block font-mono text-[8px] uppercase tracking-widest text-brass mb-1">Approval required</small>
          <strong className="block text-[13px]">Approve the verified router for the exact execution amount</strong>
          <div className="mt-2 text-[10px] font-mono break-all">token={approval.token}</div>
          <div className="mt-1 text-[10px] font-mono break-all">spender={approval.spender}</div>
          <div className="mt-1 text-[10px] font-mono">amount_raw={approval.amount}</div>
          <button className="console-brass-button mt-3" type="button" onClick={() => void approveRouter()} disabled={loading}>{loading ? "Waiting for approval…" : "Approve router for swap →"}</button>
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <button className="console-brass-button" type="button" onClick={() => void runPreflight()} disabled={loading}>{loading ? "Working…" : "Run read-only preflight →"}</button>
        {preflight && preflight.checks?.token_in_balance_ok !== false && preflight.checks?.token_in_allowance_ok !== false && <button className="console-brass-button" type="button" onClick={() => void execute()} disabled={loading}>{loading ? "Executing…" : "Execute authorized Testnet call →"}</button>}
      </div>

      {preflight && <div className="mt-4 border border-line rounded-lg bg-paperhi p-3 text-[10px] font-mono break-all"><div>PRECHECK: broadcast={String(preflight.broadcast)}</div><div>selector={preflight.selector}</div><div>to={preflight.call.to}</div><div>data={preflight.call.data}</div><div>{balanceSummary}</div></div>}
      {approvalHash && <div className="mt-4 border border-line rounded-lg p-3 text-[10px] font-mono break-all"><div>approval_transaction={compact(approvalHash)}</div><div>chain_id=97</div><div>receipt={approvalReceipt ? `${approvalReceipt.status} / block ${approvalReceipt.block_number}` : "waiting"}</div></div>}
      {transactionHash && <div className="mt-4 border border-line rounded-lg p-3 text-[10px] font-mono break-all"><div>transaction={compact(transactionHash)}</div><div>chain_id=97</div><div>receipt={receipt ? `${receipt.status} / block ${receipt.block_number}` : "waiting"}</div>{receipt && <div>gas_used={receipt.gas_used || "—"}</div>}</div>}
    </section>
  );
}
