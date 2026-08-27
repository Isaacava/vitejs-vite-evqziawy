import { useMemo, useState } from "react";
import type { Address } from "viem";
import type { ExecutionCapitalRequest } from "./lib/executionCapital";
import { getExecutionCapability, TESTNET_U_TOKEN_ADDRESS } from "./lib/executionCapital";
import { confirmTestnetExecutionReceipt, waitForTestnetExecutionReceipt, type TestnetExecutionReceipt } from "./lib/executionReceipt";

type Props = {
  request: ExecutionCapitalRequest;
};

type PreflightResponse = {
  ok: boolean;
  request_id: string;
  chain_id: number;
  preflight: {
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
    checks?: {
      token_in_balance?: string;
      token_in_allowance?: string;
      token_in_balance_ok?: boolean;
      token_in_allowance_ok?: boolean;
    };
  };
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

const TESTNET_CHAIN_ID = 97;
const TESTNET_WBNB_ADDRESS = "0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd" as Address;
const CONTROLLED_CAPITAL_RAW = "1000000000000000000";
const CONTROLLED_FEE = 2500;

function validAddress(value: string) {
  return /^0x[a-fA-F0-9]{40}$/.test(value);
}

function validHash(value: string) {
  return /^0x[a-fA-F0-9]{64}$/.test(value);
}

function validRaw(value: string, positive = false) {
  if (!/^\d+$/.test(value)) return false;
  if (positive && BigInt(value) <= 0n) return false;
  return true;
}

function compact(value?: string | null) {
  return value ? `${value.slice(0, 10)}…${value.slice(-8)}` : "—";
}

function requestCapitalToken(request: ExecutionCapitalRequest) {
  const evidence = request.evidence && typeof request.evidence === "object"
    ? request.evidence as Record<string, unknown>
    : {};
  const raw = typeof evidence.capital_token === "string" ? evidence.capital_token.trim() : request.capital_token?.trim() || "";
  if (!raw || raw.toLowerCase() === "bnb" || raw.toLowerCase() === "tbnb" || raw.toLowerCase() === "tbn") {
    return TESTNET_U_TOKEN_ADDRESS;
  }
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
  const [receipt, setReceipt] = useState<TestnetExecutionReceipt | null>(null);
  const [transactionHash, setTransactionHash] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const canUse = Boolean(
    capability
      && (request.status === "authorized" || request.status === "active")
      && capability.network === "bsc-testnet"
      && Number(capability.chainId) === TESTNET_CHAIN_ID
      && capability.allowed_targets?.length
      && capability.allowed_selectors?.length,
  );

  const selectorList = useMemo(
    () => (capability?.allowed_selectors || []).map(String).join(", "),
    [capability],
  );

  if (!canUse || !capability) return null;

  function resetPreflight() {
    setPreflight(null);
    setReceipt(null);
    setTransactionHash("");
    setError("");
  }

  async function runPreflight() {
    setLoading(true);
    setError("");
    setMessage("");
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
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          request_id: request.id,
          router,
          tokenIn,
          tokenOut,
          recipient: request.user_execution_wallet,
          fee: Number(fee),
          amountIn,
          amountOutMinimum,
        }),
      });
      const body = await response.json().catch(() => null) as PreflightResponse | null;
      if (!response.ok) throw new Error(body?.error || `Preflight failed with HTTP ${response.status}`);
      if (!body?.ok || !body.preflight || body.chain_id !== TESTNET_CHAIN_ID) throw new Error("Preflight did not return a valid BSC Testnet plan");
      if (body.preflight.broadcast !== false) throw new Error("Preflight did not prove that no transaction was broadcast");
      setPreflight(body.preflight);
      const checks = body.preflight.checks;
      if (checks && checks.token_in_balance_ok === false) {
        setMessage("Preflight stopped before broadcast: the authorized execution wallet does not have enough input-token balance.");
      } else if (checks && checks.token_in_allowance_ok === false) {
        setMessage("Preflight stopped before broadcast: the execution wallet has not approved enough input tokens for the router.");
      } else {
        setMessage("Read-only preflight passed. No transaction was broadcast.");
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to run Testnet preflight");
      setPreflight(null);
    } finally {
      setLoading(false);
    }
  }

  async function execute() {
    if (!preflight) return;
    setLoading(true);
    setError("");
    setMessage("");
    setReceipt(null);
    try {
      const response = await fetch("/api/testnet?route=execution-capital-execute", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          request_id: request.id,
          execution_id: crypto.randomUUID(),
          calls: [preflight.call],
        }),
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
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to complete Testnet execution");
    } finally {
      setLoading(false);
    }
  }

  const balanceSummary = preflight?.checks
    ? `balance=${preflight.checks.token_in_balance || "—"} · allowance=${preflight.checks.token_in_allowance || "—"}`
    : "balance/allowance not yet checked";

  return (
    <section className="border border-line rounded-[16px_8px_18px_9px] bg-paper p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <small className="block font-mono text-[8.5px] uppercase tracking-widest text-brass mb-1">Live execution · Testnet</small>
          <h3 className="font-display text-[18px] font-bold m-0">Run the authorized Grid scope</h3>
          <p className="text-[10.5px] text-inksoft mt-1">The controlled Testnet proof uses the authorized U capital, the documented BSC Testnet WBNB asset, and a fixed fee tier. Read-only preflight is mandatory before broadcast.</p>
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
        <div className="mt-1"><strong>Testnet WBNB token out:</strong> {TESTNET_WBNB_ADDRESS}</div>
        <div className="mt-1"><strong>Authorized amount cap:</strong> {CONTROLLED_CAPITAL_RAW} raw units (1 U)</div>
        <div className="mt-1"><strong>Allowed targets:</strong> {capability.allowed_targets.map(String).join(", ")}</div>
        <div className="mt-1"><strong>Allowed selectors:</strong> {selectorList}</div>
        <div className="mt-1"><strong>Recipient:</strong> {request.user_execution_wallet}</div>
        <div className="mt-1"><strong>Preflight asset state:</strong> {balanceSummary}</div>
      </div>

      {error && <div className="console-alert console-alert-error mt-4">{error}</div>}
      {message && <div className="mt-4 text-[10.5px] text-inksoft">{message}</div>}

      <div className="mt-4 flex flex-wrap gap-2">
        <button className="console-brass-button" type="button" onClick={() => void runPreflight()} disabled={loading}>{loading ? "Working…" : "Run read-only preflight →"}</button>
        {preflight && preflight.checks?.token_in_balance_ok !== false && preflight.checks?.token_in_allowance_ok !== false && <button className="console-brass-button" type="button" onClick={() => void execute()} disabled={loading}>{loading ? "Executing…" : "Execute authorized Testnet call →"}</button>}
      </div>

      {preflight && (
        <div className="mt-4 border border-line rounded-lg bg-paperhi p-3 text-[10px] font-mono break-all">
          <div>PRECHECK: broadcast={String(preflight.broadcast)}</div>
          <div>selector={preflight.selector}</div>
          <div>to={preflight.call.to}</div>
          <div>data={preflight.call.data}</div>
          <div>{balanceSummary}</div>
        </div>
      )}

      {transactionHash && (
        <div className="mt-4 border border-line rounded-lg p-3 text-[10px] font-mono break-all">
          <div>transaction={compact(transactionHash)}</div>
          <div>chain_id=97</div>
          <div>receipt={receipt ? `${receipt.status} / block ${receipt.block_number}` : "waiting"}</div>
          {receipt && <div>gas_used={receipt.gas_used || "—"}</div>}
        </div>
      )}
    </section>
  );
}
