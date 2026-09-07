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
  execution: string;
  wallet_provider: string;
  authorization_model: string;
  session_key_address?: `0x${string}`;
  session_key_public_key?: `0x${string}`;
  allowed_targets: readonly `0x${string}`[];
  allowed_selectors: readonly `0x${string}`[];
  selectors_required: boolean;
  private_key_exposed: false;
  protocol?: string;
  preflight_path?: string;
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
  wallet_provider: string;
  authorization_model: string;
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

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringValue(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function addressList(...values: unknown[]) {
  for (const value of values) {
    if (!Array.isArray(value)) continue;
    const list = value.filter(isAddress);
    if (list.length) return list;
  }
  return [] as `0x${string}`[];
}

function selectorList(...values: unknown[]) {
  for (const value of values) {
    if (!Array.isArray(value)) continue;
    const list = value.filter(isSelector);
    if (list.length) return list;
  }
  return [] as `0x${string}`[];
}

function parseExecutionMarket(value: unknown): ExecutionMarketDescriptor | undefined {
  const market = record(value);
  if (!isAddress(market.token_in)) return undefined;
  const tokenOut = market.token_out === null || market.token_out === undefined ? null : isAddress(market.token_out) ? market.token_out : null;
  const tokenInSymbol = typeof market.token_in_symbol === "string" && market.token_in_symbol.trim() ? market.token_in_symbol.trim() : "TOKEN";
  const tokenOutSymbol = typeof market.token_out_symbol === "string" && market.token_out_symbol.trim() ? market.token_out_symbol.trim() : null;
  const fee = market.fee === null || market.fee === undefined ? null : Number(market.fee);
  return { token_in: market.token_in, token_out: tokenOut, token_in_symbol: tokenInSymbol, token_out_symbol: tokenOutSymbol, fee: Number.isInteger(fee) ? fee : null };
}

export function getExecutionCapability(request: ExecutionCapitalRequest | null | undefined): ExecutionCapabilityDescriptor | null {
  if (!request) return null;

  const evidence = record(request.evidence);
  const raw = record(evidence.execution_capability);
  const authorization = record(evidence.authorization);
  const executionAuthorization = record(evidence.execution_authorization);
  const callAllowlist = record(request.call_allowlist);

  const network = stringValue(raw.network, evidence.network) || "";
  const chainId = Number(raw.chainId ?? raw.chain_id ?? evidence.chain_id);
  const execution = stringValue(raw.execution, raw.execution_mode, evidence.execution);
  const walletProvider = stringValue(raw.wallet_provider, request.wallet_provider);
  const authorizationModel = stringValue(raw.authorization_model, request.authorization_model);

  const allowedTargets = addressList(
    raw.allowed_targets,
    authorization.allowed_targets,
    executionAuthorization.allowed_targets,
    callAllowlist.allowed_targets,
    callAllowlist.targets,
  );
  const allowedSelectors = selectorList(
    raw.allowed_selectors,
    authorization.allowed_selectors,
    executionAuthorization.allowed_selectors,
    callAllowlist.allowed_selectors,
    callAllowlist.selectors,
  );

  const sessionKeyAddress = stringValue(
    raw.session_key_address,
    authorization.session_key_address,
    executionAuthorization.session_key_address,
    request.agent_session_key,
  );
  const sessionKeyPublicKey = stringValue(
    raw.session_key_public_key,
    authorization.session_key_public_key,
    executionAuthorization.session_key_public_key,
    evidence.session_key_public_key,
  );

  // A persisted provider capability is authoritative for display only after the
  // server-side verification has already accepted it. This normalization tolerates
  // equivalent persisted field locations without changing authorization semantics.
  if (
    network !== "bsc-testnet" ||
    chainId !== 97 ||
    !execution ||
    !walletProvider ||
    !authorizationModel ||
    !allowedTargets.length ||
    !allowedSelectors.length ||
    !isAddress(sessionKeyAddress) ||
    !isHex(sessionKeyPublicKey)
  ) return null;

  const selectorsRequired = raw.selectors_required !== false;
  const market = parseExecutionMarket(raw.execution_market) || parseExecutionMarket(evidence.execution_market);
  const sourceUrl = stringValue(raw.source_url, evidence.source_url) || "persisted-provider-capability";
  const endpointId = stringValue(raw.endpoint_id, evidence.endpoint_id) || "provider_execution_capability";
  const fetchedAt = stringValue(raw.fetched_at, evidence.fetched_at) || request.updated_at || new Date(0).toISOString();
  const endpointStatus = stringValue(raw.endpoint_status, evidence.endpoint_status);
  const protocol = stringValue(raw.protocol, evidence.protocol);
  const preflightPath = stringValue(raw.preflight_path, evidence.preflight_path);

  return {
    network: "bsc-testnet",
    chainId: 97,
    execution,
    wallet_provider: walletProvider,
    authorization_model: authorizationModel,
    session_key_address: sessionKeyAddress as `0x${string}`,
    session_key_public_key: sessionKeyPublicKey as `0x${string}`,
    allowed_targets: allowedTargets,
    allowed_selectors: allowedSelectors,
    selectors_required: selectorsRequired,
    private_key_exposed: false,
    ...(protocol ? { protocol: protocol.toLowerCase() } : {}),
    ...(preflightPath && preflightPath.startsWith("/") ? { preflight_path: preflightPath } : {}),
    ...(market ? { execution_market: market } : {}),
    source_url: sourceUrl,
    endpoint_id: endpointId,
    endpoint_status: endpointStatus,
    fetched_at: fetchedAt,
    independently_authorized: raw.independently_authorized === true,
  };
}

export function isVerifiedAuthorization(request: Pick<ExecutionCapitalRequest, "wallet_provider" | "authorization_model" | "authorization_verified_at" | "session_key_id">) {
  return Boolean(request.authorization_verified_at && (request.session_key_id || request.wallet_provider === "none" || request.authorization_model === "none"));
}
