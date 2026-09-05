import { keccak256, type Hex } from "viem";
import type { Address } from "viem";
import { invokeProviderOperation, resolveProviderOperation } from "./provider-operation.js";

const ZERO_HASH = `0x${"0".repeat(64)}` as Hex;

type SubmittedChainJob = {
  id: bigint;
  provider: Address;
  evaluator: Address;
  deliverable: Hex;
  status: number;
  submittedAt?: bigint;
};

type EvaluationResult = {
  verdict: "approve" | "reject" | "pending";
  evidence: Record<string, unknown>;
  content?: unknown;
  endpoint?: string | null;
  error?: string;
};

function isHash(value: unknown): value is Hex {
  return typeof value === "string" && /^0x[a-fA-F0-9]{64}$/.test(value);
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function resultLooksUsable(value: unknown) {
  if (!value || typeof value !== "object") return false;
  const body = object(value);
  return body.result !== undefined
    || body.output !== undefined
    || body.content !== undefined
    || body.deliverable !== undefined
    || body.status !== undefined
    || body.transaction_hash !== undefined
    || body.transactionHash !== undefined;
}

function parseResponse(rawText: string): unknown {
  try { return rawText ? JSON.parse(rawText) : {}; } catch { return rawText; }
}

/**
 * Deterministically evaluates a submitted ERC-8183 deliverable.
 * The evaluator never invents a provider result URL. It resolves the provider's
 * declared `result` operation and hashes the exact response bytes returned by it.
 */
export async function evaluateSubmittedJob(
  supabase: any,
  chainJob: SubmittedChainJob,
): Promise<EvaluationResult> {
  const chainJobId = Number(chainJob.id);
  const onchainDeliverable = String(chainJob.deliverable || ZERO_HASH).toLowerCase();

  if (!isHash(chainJob.deliverable) || /^0x0+$/i.test(chainJob.deliverable)) {
    return {
      verdict: "pending",
      evidence: {
        evaluator: "agentmarket_deterministic_evaluator",
        chain_job_id: chainJobId,
        check: "nonzero_deliverable",
        passed: false,
      },
      error: "Submitted job has no non-zero deliverable commitment.",
    };
  }

  const { data: agent, error: agentError } = await supabase
    .from("agents")
    .select("id,agent_id,owner,name,uri,metadata")
    .ilike("owner", String(chainJob.provider))
    .limit(1)
    .maybeSingle();

  if (agentError) throw new Error(agentError.message);

  if (!agent) {
    return {
      verdict: "pending",
      evidence: {
        evaluator: "agentmarket_deterministic_evaluator",
        chain_job_id: chainJobId,
        provider: chainJob.provider,
        check: "provider_identity",
        passed: false,
        registered_agent: false,
      },
      error: "No AgentMarket provider identity is registered for this ERC-8183 provider wallet.",
    };
  }

  const { data: endpoints, error: endpointError } = await supabase
    .from("agent_endpoints")
    .select("endpoint_url,protocol,status,metadata")
    .eq("agent_id", String(agent.id))
    .order("last_checked_at", { ascending: false })
    .limit(20);

  if (endpointError) throw new Error(endpointError.message);

  let lastError = "Provider has not published a result yet.";
  for (const endpoint of endpoints || []) {
    const operation = await resolveProviderOperation(endpoint, "result");
    if (!operation) continue;

    try {
      const result = await invokeProviderOperation(operation, {
        chain_job_id: chainJobId,
        job_id: chainJobId,
        agent_id: agent.agent_id,
        client_wallet: null,
        network: "bsc-testnet",
        environment: "testnet",
      });

      if (!resultLooksUsable(result.body) && !result.rawText) {
        lastError = `Provider result operation ${operation.name || "result"} returned an empty payload.`;
        continue;
      }

      const bytes = new TextEncoder().encode(result.rawText);
      const computedHash = keccak256(bytes).toLowerCase();
      const hashMatches = computedHash === onchainDeliverable;
      const content = parseResponse(result.rawText);

      const evidence = {
        evaluator: "agentmarket_deterministic_evaluator",
        chain_job_id: chainJobId,
        provider: chainJob.provider,
        evaluator_address: chainJob.evaluator,
        endpoint: result.endpoint,
        operation: {
          action: operation.action,
          endpoint: operation.endpoint,
          method: operation.method,
          transport: operation.transport,
          name: operation.name,
        },
        response_bytes: bytes.length,
        computed_deliverable_hash: computedHash,
        onchain_deliverable_hash: chainJob.deliverable,
        checks: {
          endpoint_declared: true,
          endpoint_reachable: result.status >= 200 && result.status < 300,
          http_ok: true,
          nonempty_response: bytes.length > 0,
          deliverable_hash_matches: hashMatches,
        },
        evaluated_at: new Date().toISOString(),
      };

      if (hashMatches && bytes.length > 0) {
        return { verdict: "approve", evidence, content, endpoint: result.endpoint };
      }

      return {
        verdict: "reject",
        evidence,
        content,
        endpoint: result.endpoint,
        error: "Submitted deliverable does not match the immutable ERC-8183 commitment.",
      };
    } catch (error) {
      lastError = error instanceof Error ? error.message : "Provider result operation failed";
    }
  }

  return {
    verdict: "pending",
    evidence: {
      evaluator: "agentmarket_deterministic_evaluator",
      chain_job_id: chainJobId,
      provider: chainJob.provider,
      check: "provider_result_operation",
      passed: false,
      attempted_endpoints: (endpoints || []).length,
    },
    error: lastError,
  };
}

export async function persistEvaluation(
  supabase: any,
  jobId: string,
  result: EvaluationResult,
  evaluatorAddress: Address,
) {
  const now = new Date().toISOString();
  const { data: existing, error: existingError } = await supabase
    .from("evaluations")
    .select("id")
    .eq("job_id", jobId)
    .maybeSingle();
  if (existingError) throw new Error(existingError.message);

  const payload = {
    verdict: result.verdict,
    evaluator_address: evaluatorAddress,
    evidence: result.evidence,
    notes: result.error || "Deterministic deliverable evidence verified by AgentMarket.",
    updated_at: now,
  };

  if (existing?.id) {
    const { error } = await supabase.from("evaluations").update(payload).eq("id", existing.id);
    if (error) throw new Error(error.message);
    return existing.id;
  }

  const { data: created, error } = await supabase.from("evaluations").insert({
    job_id: jobId,
    ...payload,
  }).select("id").maybeSingle();
  if (error) throw new Error(error.message);
  return created?.id ?? null;
}
