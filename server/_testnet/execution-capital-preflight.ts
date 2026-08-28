import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createPublicClient, encodeFunctionData, http, type Address, type Hex } from "viem";
import { bscTestnet } from "viem/chains";
import { getAuthenticatedUser, serverClient } from "../_auth.js";
import { runGridPreflight, assertGridExecutionCapability, type GridPreflightInput } from "./gridExecutionAdapter.js";

const MAX_BODY_BYTES = 64 * 1024;
const MAX_CAPABILITY_BYTES = 64 * 1024;
const CAPABILITY_TIMEOUT_MS = 8_000;
const TESTNET_CHAIN_ID = 97;
const TESTNET_U_TOKEN = "0xc70B8741B8B07A6d61E54fd4B20f22Fa648E5565" as Address;
const TESTNET_WBNB_TOKEN = "0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd" as Address;
const CONTROLLED_FEE = 2500;
const CONTROLLED_CAPITAL_RAW = 1_000_000_000_000_000_000n;

const ERC20_BALANCE_ALLOWANCE_ABI = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "owner", type: "address" }], outputs: [{ name: "balance", type: "uint256" }] },
  { type: "function", name: "allowance", stateMutability: "view", inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }], outputs: [{ name: "remaining", type: "uint256" }] },
] as const;

const ERC20_APPROVE_ABI = [{
  type: "function",
  name: "approve",
  stateMutability: "nonpayable",
  inputs: [
    { name: "spender", type: "address" },
    { name: "amount", type: "uint256" },
  ],
  outputs: [{ name: "success", type: "bool" }],
}] as const;

const publicClient = createPublicClient({
  chain: bscTestnet,
  transport: http(process.env.BSC_TESTNET_RPC_URL || "https://bsc-testnet-rpc.publicnode.com"),
});

function object(value: unknown) {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function isAddress(value: unknown): value is Address {
  return typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value);
}

function isHex(value: unknown): value is Hex {
  return typeof value === "string" && /^0x[a-fA-F0-9]*$/.test(value);
}

function selectorOf(value: string) {
  return value.slice(0, 10).toLowerCase();
}

function normalizedSelectors(value: unknown) {
  if (!Array.isArray(value)) return [] as string[];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim().toLowerCase())
    .filter((item) => /^0x[a-f0-9]{8}$/.test(item));
}

function normalizedTargets(value: unknown) {
  if (!Array.isArray(value)) return [] as Address[];
  return value.filter(isAddress);
}

function rawInteger(value: unknown, field: string, positive = false) {
  const text = typeof value === "string" ? value.trim() : String(value ?? "");
  if (!/^\d+$/.test(text)) throw new Error(`${field} must be an integer raw amount`);
  const parsed = BigInt(text);
  if (positive && parsed <= 0n) throw new Error(`${field} must be greater than zero`);
  return parsed;
}

async function readJson(req: VercelRequest) {
  if (req.body && typeof req.body === "object") return req.body as Record<string, unknown>;
  let raw = "";
  for await (const chunk of req) {
    raw += String(chunk);
    if (Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) throw new Error("Preflight request body is too large");
  }
  return JSON.parse(raw || "{}") as Record<string, unknown>;
}

async function fetchLiveExecutionCapability(storedCapability: Record<string, unknown>) {
  const sourceUrl = typeof storedCapability.source_url === "string" ? storedCapability.source_url.trim() : "";
  if (!sourceUrl) return storedCapability;

  let parsed: URL;
  try {
    parsed = new URL(sourceUrl);
  } catch {
    return storedCapability;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return storedCapability;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CAPABILITY_TIMEOUT_MS);
  try {
    const response = await fetch(parsed.toString(), {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) return storedCapability;
    const contentLength = Number(response.headers.get("content-length") || 0);
    if (Number.isFinite(contentLength) && contentLength > MAX_CAPABILITY_BYTES) return storedCapability;
    const raw = await response.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_CAPABILITY_BYTES) return storedCapability;
    const live = raw ? object(JSON.parse(raw)) : {};

    const liveSelectors = normalizedSelectors(live.allowed_selectors);
    const liveTargets = normalizedTargets(live.allowed_targets);
    if (liveSelectors.length === 0 || liveTargets.length === 0) return storedCapability;

    return {
      ...storedCapability,
      ...live,
      allowed_selectors: liveSelectors,
      allowed_targets: liveTargets,
      refreshed_at: new Date().toISOString(),
    };
  } catch {
    return storedCapability;
  } finally {
    clearTimeout(timeout);
  }
}

async function readExecutionAssetState(token: Address, owner: Address, spender: Address, requiredAmount: bigint) {
  try {
    const [balance, allowance] = await Promise.all([
      publicClient.readContract({
        address: token,
        abi: ERC20_BALANCE_ALLOWANCE_ABI,
        functionName: "balanceOf",
        args: [owner],
      }),
      publicClient.readContract({
        address: token,
        abi: ERC20_BALANCE_ALLOWANCE_ABI,
        functionName: "allowance",
        args: [owner, spender],
      }),
    ]);

    return {
      balance_raw: balance.toString(),
      allowance_raw: allowance.toString(),
      required_raw: requiredAmount.toString(),
      sufficient_balance: balance >= requiredAmount,
      sufficient_allowance: allowance >= requiredAmount,
    };
  } catch {
    throw new Error("Unable to independently read the execution token balance and router allowance on BSC Testnet");
  }
}

function buildScopedApproval(token: Address, owner: Address, spender: Address, amount: bigint) {
  return {
    chain_id: TESTNET_CHAIN_ID,
    token,
    owner,
    spender,
    amount_raw: amount.toString(),
    data: encodeFunctionData({
      abi: ERC20_APPROVE_ABI,
      functionName: "approve",
      args: [spender, amount],
    }),
    note: "Approve exactly the requested execution amount for the verified provider target. AgentMarket never requires an unlimited approval.",
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const auth = await getAuthenticatedUser(req);
    if (!auth) return res.status(401).json({ error: "Authenticated AgentMarket session required" });
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ error: "Method not allowed" });
    }

    const input = await readJson(req);
    const requestId = typeof input.request_id === "string" ? input.request_id.trim() : "";
    if (!requestId) return res.status(400).json({ error: "request_id is required" });

    const supabase = serverClient();
    const { data: request, error: requestError } = await supabase.from("execution_capital_requests").select("*").eq("id", requestId).maybeSingle();
    if (requestError) return res.status(500).json({ error: requestError.message });
    if (!request) return res.status(404).json({ error: "Execution capital request not found" });

    const { data: job, error: jobError } = await supabase.from("jobs").select("id,client_wallet").eq("id", request.job_id).maybeSingle();
    if (jobError) return res.status(500).json({ error: jobError.message });
    if (!job || String(job.client_wallet || "").toLowerCase() !== auth.user.wallet_address.toLowerCase()) {
      return res.status(403).json({ error: "You do not own this execution-capital request" });
    }
    if (request.status !== "authorized" && request.status !== "active") {
      return res.status(409).json({ error: `Execution capital request must be authorized before Testnet preflight; current status is ${request.status}` });
    }
    if (!request.authorization_verified_at || !request.session_key_id || !request.user_execution_wallet || !request.agent_session_key) {
      return res.status(409).json({ error: "Execution-capital request is missing independently verified session identity" });
    }

    const executionWallet = request.user_execution_wallet as Address;
    const authenticatedWallet = auth.user.wallet_address as Address;

    const evidence = object(request.evidence);
    const storedCapability = object(evidence.execution_capability);
    assertGridExecutionCapability(storedCapability);

    const capability = await fetchLiveExecutionCapability(storedCapability);
    assertGridExecutionCapability(capability);

    const allowedTargets = normalizedTargets(capability.allowed_targets);
    const allowedSelectors = normalizedSelectors(capability.allowed_selectors);
    if (allowedTargets.length === 0 || allowedSelectors.length === 0) return res.status(409).json({ error: "Provider execution capability has no usable target/selector scope" });
    if (capability.network !== "bsc-testnet" || Number(capability.chainId) !== TESTNET_CHAIN_ID) return res.status(409).json({ error: "Provider execution capability is not BSC Testnet" });

    const protocol = typeof capability.protocol === "string" && capability.protocol.trim()
      ? capability.protocol.trim().toLowerCase()
      : "pancake-v3-swap";
    const isPancakeSwapProtocol = protocol === "pancake-v3-swap";

    const expectedTokenIn = typeof request.capital_token === "string" && isAddress(request.capital_token)
      ? request.capital_token as Address
      : typeof evidence.capital_token === "string" && isAddress(evidence.capital_token)
        ? evidence.capital_token as Address
        : TESTNET_U_TOKEN;
    const expectedCapital = CONTROLLED_CAPITAL_RAW;

    const requestedTokenIn = input.tokenIn;
    const requestedTokenOut = input.tokenOut;
    const requestedAmountIn = rawInteger(input.amountIn, "amountIn", true);
    const requestedMinimumOut = rawInteger(input.amountOutMinimum ?? "0", "amountOutMinimum");
    const requestedFee = rawInteger(input.fee, "fee", true);
    const recipient = input.recipient || executionWallet;

    if (!isAddress(authenticatedWallet)) return res.status(403).json({ error: "Authenticated wallet identity is invalid" });
    if (!isAddress(executionWallet)) return res.status(409).json({ error: "Verified execution wallet identity is invalid" });
    if (!isAddress(requestedTokenIn)) return res.status(400).json({ error: "tokenIn must be a valid EVM address" });
    if (requestedTokenIn.toLowerCase() !== expectedTokenIn.toLowerCase()) return res.status(409).json({ error: "tokenIn must match the authorized execution-capital token" });
    if (!isAddress(requestedTokenOut)) return res.status(400).json({ error: "tokenOut must be a valid EVM address" });
    if (isPancakeSwapProtocol && requestedTokenOut.toLowerCase() !== TESTNET_WBNB_TOKEN.toLowerCase()) return res.status(409).json({ error: "Controlled Testnet proof requires WBNB as tokenOut" });
    if (requestedAmountIn > expectedCapital) return res.status(409).json({ error: "amountIn must not exceed the authorized 1 U capital" });
    if (requestedMinimumOut < 0n) return res.status(400).json({ error: "amountOutMinimum must be a non-negative raw integer" });
    if (isPancakeSwapProtocol && requestedFee !== BigInt(CONTROLLED_FEE)) return res.status(409).json({ error: `Controlled Testnet proof requires pool fee ${CONTROLLED_FEE}` });
    if (!isAddress(recipient)) return res.status(400).json({ error: "recipient must be a valid EVM address" });
    if (recipient.toLowerCase() !== executionWallet.toLowerCase()) return res.status(409).json({ error: "recipient must equal the independently verified execution wallet" });

    const routerInput = input.router;
    if (routerInput !== undefined && routerInput !== null && routerInput !== "" && !isAddress(routerInput)) return res.status(400).json({ error: "router must be a valid EVM address" });
    const router = routerInput || (allowedTargets.length === 1 ? allowedTargets[0] : undefined);
    if (!isAddress(router)) return res.status(400).json({ error: "router must be a valid EVM address" });
    if (!allowedTargets.some((target) => target.toLowerCase() === router.toLowerCase())) return res.status(409).json({ error: "Requested execution target is outside the verified provider capability target allowlist" });

    const assetState = await readExecutionAssetState(requestedTokenIn, executionWallet, router, requestedAmountIn);
    if (!assetState.sufficient_balance) {
      return res.status(409).json({
        error: "Execution wallet does not have enough authorized token balance for the requested amount",
        asset_state: assetState,
      });
    }
    if (!assetState.sufficient_allowance) {
      return res.status(409).json({
        error: "Execution router allowance is below the requested execution amount",
        asset_state: assetState,
        approval_required: true,
        approval_transaction: buildScopedApproval(requestedTokenIn, executionWallet, router, requestedAmountIn),
      });
    }

    const gridInput: GridPreflightInput = {
      router,
      tokenIn: requestedTokenIn,
      tokenOut: requestedTokenOut,
      recipient,
      fee: Number(requestedFee),
      amountIn: requestedAmountIn.toString(),
      amountOutMinimum: requestedMinimumOut.toString(),
    };
    const response = await runGridPreflight({ ...request, evidence: { ...evidence, execution_capability: capability } } as Record<string, unknown>, gridInput, protocol);
    const result = object(response.result);
    if (result.broadcast !== false) return res.status(502).json({ error: "Testnet execution adapter did not prove that no transaction was broadcast" });

    const returnedSelector = typeof result.selector === "string" && isHex(result.selector) ? selectorOf(result.selector) : "";
    if (!returnedSelector || !allowedSelectors.includes(returnedSelector)) {
      return res.status(409).json({
        error: "Testnet execution adapter produced a function selector outside the verified provider capability scope",
        returned_selector: returnedSelector || null,
        allowed_selectors: allowedSelectors,
      });
    }

    return res.status(200).json({
      ok: true,
      request_id: requestId,
      chain_id: TESTNET_CHAIN_ID,
      authenticated_wallet: authenticatedWallet,
      execution_wallet: executionWallet,
      capability_scope: {
        protocol,
        allowed_targets: allowedTargets,
        allowed_selectors: allowedSelectors,
        authorized_token_in: expectedTokenIn,
        authorized_capital_raw: expectedCapital.toString(),
        ...(isPancakeSwapProtocol ? { controlled_token_out: TESTNET_WBNB_TOKEN, controlled_fee: CONTROLLED_FEE } : {}),
      },
      asset_state: assetState,
      preflight: result,
      note: "Read-only preflight completed through the Testnet execution adapter. No transaction was broadcast.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected Testnet preflight error";
    const status = /required|must|invalid|outside|authorized|configured|scope|capital|token|recipient|fee|wallet|adapter|allowance|balance/i.test(message) ? 409 : 500;
    return res.status(status).json({ error: message });
  }
}
