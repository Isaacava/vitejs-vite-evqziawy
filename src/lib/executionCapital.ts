export type ExecutionCapitalStatus =
  | "requested"
  | "authorized"
  | "active"
  | "exit_pending"
  | "settled"
  | "revoked"
  | "expired";

export const TESTNET_U_TOKEN_ADDRESS = "0xc70B8741B8B07A6d61E54fd4B20f22Fa648E5565" as const;

export type ExecutionMarketDescriptor = {
  token_in: `0x${string}`;
  token_out: `0x${string}` | null;
  token_in_symbol: string;
  token_out_symbol: string | null;
  fee: number | null;
};

export type ExecutionCapabilityDescriptor = {
  network: "bsc-testnet";
  chainId: 97;
  execution: "altana-scoped-session";
  wallet_provider: "altana";
  authorization_model: "scoped_session";
  session_key_address: `0x${string}`;
  session_key_public_key: `0x${string}`;
  allowed_targets: readonly `0x${string}`[];
  allowed_selectors: readonly `0x${string}`[];
  selectors_required: true;
  private_key_exposed: false;
  execution_market?: ExecutionMarketDescriptor;
  source_url: string;
  endpoint_id: string;
  endpoint_status: string | null;
  fetched_at: string;
  independently_authorized: boolean;
};

export type ExecutionCapitalRequest = {
  id: string;
  job_id: string;
  agent_id?: string | null;
  requester_wallet: string;
  user_execution_wallet: string | null;
  agent_session_key: string | null;
  session_key_id: string | null;
  capital_requested: string | null;
  capital_token: string;
  purpose: string;
  requested_duration_seconds: number | null;
  duration_seconds: number | null;
  wallet_provider: "altana";
  authorization_model: "scoped_session";
  capital_authorized: string | null;
  spend_cap?: string | null;
  call_allowlist?: unknown;
  session_expires_at?: string | null;
  capital_deployed: string | null;
  capital_returned: string | null;
  ending_assets: Record<string, unknown> | null;
  realized_pnl: string | null;
  unrealized_pnl: string | null;
  status: ExecutionCapitalStatus;
  authorization_verified_at: string | null;
  session_grant_tx_hash: string | null;
  session_revoke_tx_hash: string | null;
  evidence: Record<string, unknown>;
  requested_at: string;
  authorized_at: string | null;
  activated_at: string | null;
  exit_pending_at: string | null;
  settled_at: string | null;
  revoked_at: string | null;
  expired_at: string | null;
  created_at: string;
  updated_at: string;
};

export function displayObservedNumber(value: string | number | null | undefined, suffix = "") {
  if (value === null || value === undefined || value === "") return "Not yet observed";
  return `${value}${suffix}`;
}

function isAddress(value: unknown): value is `0x${string}` {
  return typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value);
}

function isHex(value: unknown): value is `0x${string}` {
  return typeof value === "string" && /^0x[a-fA-F0-9]*$/.test(value);
}

function isSelector(value: unknown): value is `0x${string}` {
  return typeof value === "string" && /^0x[a-fA-F0-9]{8}$/.test(value);
}

function parseExecutionMarket(value: unknown): ExecutionMarketDescriptor | undefined {
  if (!value || typeof value !== "object") return undefined;
  const market = value as Record<string, unknown>;
  if (!isAddress(market.token_in)) return undefined;
  const tokenOut = market.token_out === null || market.token_out === undefined ? null : isAddress(market.token_out) ? market.token_out : null;
  const tokenInSymbol = typeof market.token_in_symbol === "string" && market.token_in_symbol.trim() ? market.token_in_symbol.trim() : "TOKEN";
  const tokenOutSymbol = typeof market.token_out_symbol === "string" && market.token_out_symbol.trim() ? market.token_out_symbol.trim() : null;
  const fee = market.fee === null || market.fee === undefined ? null : Number(market.fee);
  return { token_in: market.token_in, token_out: tokenOut, token_in_symbol: tokenInSymbol, token_out_symbol: tokenOutSymbol, fee: Number.isInteger(fee) ? fee : null };
}

export function getExecutionCapability(request: ExecutionCapitalRequest | null | undefined): ExecutionCapabilityDescriptor | null {
  const raw = request?.evidence?.execution_capability;
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  if (
    value.network !== "bsc-testnet" ||
    Number(value.chainId) !== 97 ||
    value.execution !== "altana-scoped-session" ||
    value.wallet_provider !== "altana" ||
    value.authorization_model !== "scoped_session" ||
    value.selectors_required !== true ||
    value.private_key_exposed !== false ||
    typeof value.source_url !== "string" ||
    typeof value.endpoint_id !== "string" ||
    typeof value.fetched_at !== "string" ||
    typeof value.independently_authorized !== "boolean" ||
    !isAddress(value.session_key_address) ||
    !isHex(value.session_key_public_key) ||
    !Array.isArray(value.allowed_targets) ||
    !value.allowed_targets.every(isAddress) ||
    value.allowed_targets.length === 0 ||
    !Array.isArray(value.allowed_selectors) ||
    !value.allowed_selectors.every(isSelector) ||
    value.allowed_selectors.length === 0
  ) return null;

  return {
    network: "bsc-testnet",
    chainId: 97,
    execution: "altana-scoped-session",
    wallet_provider: "altana",
    authorization_model: "scoped_session",
    session_key_address: value.session_key_address,
    session_key_public_key: value.session_key_public_key,
    allowed_targets: value.allowed_targets,
    allowed_selectors: value.allowed_selectors,
    selectors_required: true,
    private_key_exposed: false,
    execution_market: parseExecutionMarket(value.execution_market),
    source_url: value.source_url,
    endpoint_id: value.endpoint_id,
    endpoint_status: typeof value.endpoint_status === "string" ? value.endpoint_status : null,
    fetched_at: value.fetched_at,
    independently_authorized: value.independently_authorized,
  };
}

export function isVerifiedAuthorization(request: Pick<ExecutionCapitalRequest, "wallet_provider" | "authorization_model" | "authorization_verified_at" | "session_key_id">) {
  return Boolean(
    request.wallet_provider === "altana" &&
    request.authorization_model === "scoped_session" &&
    request.authorization_verified_at &&
    request.session_key_id,
  );
}
