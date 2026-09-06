import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getAuthenticatedUser, serverClient } from "../_auth.js";
import { invokeProviderOperation, resolveProviderOperation } from "./provider-operation.js";

type EndpointRecord = { endpoint_url: string; protocol: string; status: string; metadata?: unknown; version?: string | null };

type JsonRecord = Record<string, unknown>;

function object(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function hasExecutionCapability(value: JsonRecord): boolean {
  const nested = [value, object(value.execution_capability), object(value.executionCapability), object(value.capability), object(value.authorization), object(value.execution_capital)];
  return nested.some((candidate) =>
    candidate.network === "bsc-testnet" &&
    Number(candidate.chain_id ?? candidate.chainId) === 97 &&
    typeof candidate.execution === "string" &&
    typeof candidate.wallet_provider === "string" &&
    typeof candidate.authorization_model === "string" &&
    Array.isArray(candidate.allowed_targets) &&
    candidate.allowed_targets.length > 0 &&
    Array.isArray(candidate.allowed_selectors) &&
    candidate.allowed_selectors.length > 0,
  );
}

function declaredStateChanging(endpoint: EndpointRecord): boolean {
  const metadata = object(endpoint.metadata);
  const manifest = object(metadata.provider_manifest ?? metadata.providerManifest);
  const execution = object(manifest.execution ?? metadata.execution);
  return execution.state_changing === true || execution.stateChanging === true;
}

function actionLabel(endpoint: EndpointRecord): string {
  const metadata = object(endpoint.metadata);
  const manifest = object(metadata.provider_manifest ?? metadata.providerManifest);
  const capabilities = Array.isArray(manifest.capabilities) ? manifest.capabilities : [];
  const first = capabilities.find((item) => item && typeof item === "object") as JsonRecord | undefined;
  return text(first?.name) || text(metadata.agent_kind) || "state-changing action";
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const auth = await getAuthenticatedUser(req);
    if (!auth) return res.status(401).json({ ok: false, error: "Authenticated AgentMarket session required" });

    const chainJobIdRaw = typeof req.query?.job === "string" ? req.query.job.trim() : "";
    if (!/^\d+$/.test(chainJobIdRaw)) return res.status(400).json({ ok: false, error: "job must be a numeric ERC-8183 job id" });
    const chainJobId = Number(chainJobIdRaw);
    const supabase = serverClient();

    const { data: job, error: jobError } = await supabase.from("jobs")
      .select("id,mission_task_id,client_wallet,chain_job_id")
      .eq("chain_job_id", chainJobId)
      .maybeSingle();
    if (jobError) throw new Error(jobError.message);
    if (!job || !job.mission_task_id) return res.status(404).json({ ok: false, error: "Marketplace job not found" });
    if (!auth.user.wallet_address || String(job.client_wallet || "").toLowerCase() !== auth.user.wallet_address.toLowerCase()) {
      return res.status(403).json({ ok: false, error: "The authenticated wallet does not own this job" });
    }

    const { data: task, error: taskError } = await supabase.from("mission_tasks")
      .select("id,agent_id")
      .eq("id", job.mission_task_id)
      .maybeSingle();
    if (taskError) throw new Error(taskError.message);
    if (!task?.agent_id) return res.status(409).json({ ok: false, error: "Job does not identify a provider agent" });

    const { data: agent, error: agentError } = await supabase.from("agents")
      .select("id,agent_id,name,metadata")
      .eq("id", task.agent_id)
      .maybeSingle();
    if (agentError) throw new Error(agentError.message);
    if (!agent) return res.status(404).json({ ok: false, error: "Provider agent not found" });

    const provider = {
      agent_id: agent.agent_id,
      name: typeof agent.name === "string" && agent.name.trim() ? agent.name.trim() : null,
    };

    const { data: endpoints, error: endpointError } = await supabase.from("agent_endpoints")
      .select("endpoint_url,protocol,status,metadata")
      .eq("agent_id", String(agent.id))
      .order("last_checked_at", { ascending: false })
      .limit(20);
    if (endpointError) throw new Error(endpointError.message);

    let lastError = "Provider has not published an execution decision.";
    let lastAttempt: JsonRecord | null = null;

    for (const endpoint of (endpoints || []) as EndpointRecord[]) {
      let operation = await resolveProviderOperation(endpoint, "decision");
      let operationSource: "decision" | "authorization" = "decision";

      // Some providers intentionally expose no separate decision endpoint. In that
      // case the provider-declared authorization operation is the decision boundary:
      // its response tells AgentMarket whether execution authorization/capital is needed.
      if (!operation) {
        operation = await resolveProviderOperation(endpoint, "authorization");
        operationSource = "authorization";
      }
      if (!operation) continue;

      try {
        const result = await invokeProviderOperation(operation, {
          chain_job_id: chainJobId,
          job_id: job.id,
          agent_id: agent.agent_id,
          client_wallet: auth.user.wallet_address,
          network: "bsc-testnet",
          environment: "testnet",
        });
        const body = object(result.body);
        lastAttempt = {
          endpoint: result.endpoint,
          method: result.method,
          transport: result.transport,
          status: result.status,
          source_operation: operationSource,
          body,
        };

        if (result.status >= 200 && result.status < 300) {
          const explicitExecutionRequired = body.execution_required ?? body.executionRequired;
          const explicitAuthorizationRequired = body.authorization_required ?? body.authorizationRequired;
          const explicitDecision = body.decision;

          if (explicitExecutionRequired !== undefined || explicitDecision !== undefined || explicitAuthorizationRequired !== undefined) {
            const executionRequired = explicitExecutionRequired === undefined
              ? Boolean(explicitAuthorizationRequired)
              : Boolean(explicitExecutionRequired);
            return res.status(200).json({
              ok: true,
              source_url: result.endpoint,
              provider,
              operation: { action: operationSource, endpoint: result.endpoint, method: operation.method, transport: operation.transport, name: operation.name },
              execution_required: executionRequired,
              authorization_required: explicitAuthorizationRequired === undefined ? executionRequired : Boolean(explicitAuthorizationRequired),
              decision: explicitDecision && typeof explicitDecision === "object"
                ? explicitDecision
                : { action: actionLabel(endpoint), source: operationSource },
              observation: {
                source: "supabase.agent_endpoints.metadata.operations",
                operation: operation.name,
                metadata_state_changing: declaredStateChanging(endpoint),
              },
              ...body,
            });
          }

          if (operationSource === "authorization" && (hasExecutionCapability(body) || declaredStateChanging(endpoint))) {
            return res.status(200).json({
              ok: true,
              source_url: result.endpoint,
              provider,
              operation: { action: "authorization", endpoint: result.endpoint, method: operation.method, transport: operation.transport, name: operation.name },
              execution_required: true,
              authorization_required: true,
              decision: { action: actionLabel(endpoint), source: "provider-declared-authorization" },
              observation: {
                source: "supabase.agent_endpoints.metadata.operations.authorization",
                capability_detected: hasExecutionCapability(body),
                metadata_state_changing: declaredStateChanging(endpoint),
              },
              provider_response: body,
            });
          }

          lastError = `Provider operation returned HTTP ${result.status} without an execution decision.`;
        } else {
          lastError = `Provider ${operationSource} operation returned HTTP ${result.status}.`;
        }
      } catch (error) {
        lastError = error instanceof Error ? error.message : `Provider ${operationSource} operation failed`;
        lastAttempt = { endpoint: operation.endpoint, method: operation.method, transport: operation.transport, source_operation: operationSource, error: lastError };
      }
    }

    return res.status(202).json({ ok: false, pending: true, error: lastError, provider, attempt: lastAttempt });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Unable to resolve provider execution decision" });
  }
}
