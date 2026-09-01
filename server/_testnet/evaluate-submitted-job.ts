import { keccak256, type Hex } from "viem";
import type { Address } from "viem";

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

function extractEndpoint(agent: Record<string, unknown>): string | null {
  const metadata = agent.metadata && typeof agent.metadata === "object"
    ? agent.metadata as Record<string, unknown>
    : null;
  if (metadata && typeof metadata.endpoint === "string" && metadata.endpoint.trim()) return metadata.endpoint.trim();
  if (metadata && typeof metadata.url === "string" && metadata.url.trim()) return metadata.url.trim();
  if (typeof agent.uri === "string" && agent.uri.trim()) return agent.uri.trim();
  return null;
}

async function parseResponse(response: Response): Promise<{ bytes: Uint8Array; content: unknown }> {
  const bytes = new Uint8Array(await response.arrayBuffer());
  const text = new TextDecoder().decode(bytes);
  let content: unknown = text;
  try { content = JSON.parse(text); } catch { /* keep text */ }
  return { bytes, content };
}

/**
 * Deterministically evaluates a submitted ERC-8183 deliverable.
 * The evaluator does not trust the provider's "done" signal: it retrieves
 * the published result, hashes the exact response bytes, and compares the
 * result with the immutable on-chain deliverable commitment.
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
    .select("agent_id,owner,uri,name,metadata")
    .ilike("owner", String(chainJob.provider))
    .limit(1)
    .maybeSingle();

  if (agentError) throw new Error(agentError.message);

  const endpoint = agent ? extractEndpoint(agent) : null;
  if (!endpoint) {
    return {
      verdict: "pending",
      evidence: {
        evaluator: "agentmarket_deterministic_evaluator",
        chain_job_id: chainJobId,
        provider: chainJob.provider,
        check: "provider_endpoint",
        passed: false,
        registered_agent: Boolean(agent),
      },
      error: "No registered provider result endpoint is available for independent evidence verification.",
    };
  }

  const url = `${endpoint.replace(/\/$/, "")}/job/${chainJobId}/response`;
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Accept: "application/json, text/plain;q=0.9, */*" },
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    return {
      verdict: "pending",
      endpoint,
      evidence: {
        evaluator: "agentmarket_deterministic_evaluator",
        chain_job_id: chainJobId,
        provider: chainJob.provider,
        endpoint,
        check: "provider_response_reachable",
        passed: false,
      },
      error: error instanceof Error ? error.message : "Provider result endpoint could not be reached.",
    };
  }

  if (!response.ok) {
    return {
      verdict: "pending",
      endpoint,
      evidence: {
        evaluator: "agentmarket_deterministic_evaluator",
        chain_job_id: chainJobId,
        provider: chainJob.provider,
        endpoint,
        http_status: response.status,
        check: "provider_response_http_ok",
        passed: false,
      },
      error: `Provider result endpoint returned HTTP ${response.status}.`,
    };
  }

  const { bytes, content } = await parseResponse(response);
  const computedHash = keccak256(bytes).toLowerCase();
  const hashMatches = computedHash === onchainDeliverable;

  const evidence = {
    evaluator: "agentmarket_deterministic_evaluator",
    chain_job_id: chainJobId,
    provider: chainJob.provider,
    evaluator_address: chainJob.evaluator,
    endpoint,
    response_bytes: bytes.length,
    computed_deliverable_hash: computedHash,
    onchain_deliverable_hash: chainJob.deliverable,
    checks: {
      endpoint_reachable: true,
      http_ok: true,
      nonempty_response: bytes.length > 0,
      deliverable_hash_matches: hashMatches,
    },
    evaluated_at: new Date().toISOString(),
  };

  const verdict = hashMatches && bytes.length > 0 ? "approve" : "reject";
  return { verdict, evidence, content, endpoint, ...(verdict === "reject" ? { error: "Submitted deliverable does not match the immutable ERC-8183 commitment." } : {}) };
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
