export type ExecutionCapitalStatus =
  | "requested"
  | "authorized"
  | "active"
  | "exit_pending"
  | "settled"
  | "revoked"
  | "expired";

export type ExecutionCapitalRequest = {
  id: string;
  job_id: string;
  requester_wallet: string;
  user_execution_wallet: string | null;
  agent_session_key: string | null;
  session_key_id: string | null;
  wallet_provider: "altana";
  authorization_model: "scoped_session";
  capital_requested: string | null;
  capital_authorized: string | null;
  capital_deployed: string | null;
  capital_returned: string | null;
  ending_assets: Record<string, unknown> | null;
  realized_pnl: string | null;
  unrealized_pnl: string | null;
  purpose: string;
  duration_seconds: number | null;
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

export function isVerifiedAuthorization(request: Pick<ExecutionCapitalRequest, "wallet_provider" | "authorization_model" | "authorization_verified_at" | "session_key_id">) {
  return Boolean(
    request.wallet_provider === "altana" &&
    request.authorization_model === "scoped_session" &&
    request.authorization_verified_at &&
    request.session_key_id,
  );
}
