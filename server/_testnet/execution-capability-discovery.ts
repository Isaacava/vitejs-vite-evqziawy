import type { Address } from "viem";

const DISCOVERY_TIMEOUT_MS = 6_000;
const MAX_BYTES = 128 * 1024;

export type UniversalExecutionProfile = {
  detected: boolean;
  requires_client_capital: boolean;
  capital_requirement_confidence: "explicit" | "declared" | "unknown";
  protocol: string | null;
  authorization_model: string | null;
  wallet_provider: string | null;
  capability_url: string | null;
  preflight_url: string | null;
  source_url: string | null;
  source_kind: "execution_capability" | "erc8004_service" | "a2a_agent_card" | "registered_endpoint" | "agent_metadata" | "none";
  session_key_address: Address | null;
  session_key_public_key: string | null;
  allowed_targets: Address[];
  allowed_selectors: string[];
  selectors_required: boolean | null;
  private_key_exposed: boolean | null;
  execution_market: Record<string, unknown> | null;
  reasons: string[];
};

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function address(value: unknown): value is Address {
  return typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value);
}

function unique(values: Array<string | null | undefined>) {
  return [...new Set(values.filter((value): value is string => typeof value === "string" && value.trim().length > 0).map((value) => value.trim()))];
}

function httpUrl(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const parsed = new URL(value.trim());
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

async function fetchJson(url: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DISCOVERY_TIMEOUT_MS);
  try {
    const response = await fetch(url, { headers: { Accept: "application/json" }, signal: controller.signal });
    if (!response.ok) return null;
    const length = Number(response.headers.get("content-length") || 0);
    if (Number.isFinite(length) && length > MAX_BYTES) return null;
    const raw = await response.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_BYTES) return null;
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function serviceEntries(registration: Record<string, unknown>) {
  return Array.isArray(registration.services)
    ? registration.services.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    : [];
}

function looksExecutionRelated(value: unknown) {
  const text = typeof value === "string" ? value.toLowerCase() : "";
  return /execution|commerce|transaction|trading|trade|swap|wallet|payment|financial|defi|rebalance|yield|portfolio/.test(text);
}

function declaredCapitalRequirement(value: Record<string, unknown>) {
  for (const key of ["requires_client_capital", "requiresClientCapital", "capital_required", "capitalRequired", "requires_capital", "requiresCapital"]) {
    if (typeof value[key] === "boolean") return { value: value[key], confidence: "explicit" as const };
  }
  return { value: false, confidence: "unknown" as const };
}

function profileFromCapability(raw: Record<string, unknown>, sourceUrl: string, sourceKind: UniversalExecutionProfile["source_kind"]): UniversalExecutionProfile | null {
  const execution = object(raw.execution);
  const auth = object(raw.authorization);
  const walletProvider = typeof raw.wallet_provider === "string" ? raw.wallet_provider : typeof execution.wallet_provider === "string" ? execution.wallet_provider : null;
  const authorizationModel = typeof raw.authorization_model === "string" ? raw.authorization_model : typeof execution.authorization_model === "string" ? execution.authorization_model : typeof auth.model === "string" ? auth.model : null;
  const protocol = typeof raw.protocol === "string" ? raw.protocol : typeof execution.protocol === "string" ? execution.protocol : null;
  const requirement = declaredCapitalRequirement(raw);
  const nestedRequirement = declaredCapitalRequirement(execution);
  const explicitRequirement = requirement.confidence === "explicit" ? requirement : nestedRequirement;
  const targets = Array.isArray(raw.allowed_targets) ? raw.allowed_targets.filter(address) : [];
  const selectors = Array.isArray(raw.allowed_selectors) ? raw.allowed_selectors.filter((value): value is string => typeof value === "string" && /^0x[a-fA-F0-9]{8}$/.test(value)) : [];
  const sessionKeyAddress = address(raw.session_key_address) ? raw.session_key_address : address(execution.session_key_address) ? execution.session_key_address : null;
  const sessionKeyPublicKey = typeof raw.session_key_public_key === "string" ? raw.session_key_public_key : typeof execution.session_key_public_key === "string" ? execution.session_key_public_key : null;
  const detected = Boolean(protocol || walletProvider || authorizationModel || targets.length || selectors.length || looksExecutionRelated(raw.name));
  if (!detected) return null;
  return {
    detected: true,
    requires_client_capital: explicitRequirement.value,
    capital_requirement_confidence: explicitRequirement.confidence,
    protocol: protocol ? protocol.trim().toLowerCase() : null,
    authorization_model: authorizationModel ? authorizationModel.trim().toLowerCase() : null,
    wallet_provider: walletProvider ? walletProvider.trim().toLowerCase() : null,
    capability_url: sourceUrl,
    preflight_url: typeof raw.preflight_url === "string" ? raw.preflight_url : typeof execution.preflight_url === "string" ? execution.preflight_url : null,
    source_url: sourceUrl,
    source_kind: sourceKind,
    session_key_address: sessionKeyAddress,
    session_key_public_key: sessionKeyPublicKey,
    allowed_targets: targets,
    allowed_selectors: selectors,
    selectors_required: typeof raw.selectors_required === "boolean" ? raw.selectors_required : null,
    private_key_exposed: typeof raw.private_key_exposed === "boolean" ? raw.private_key_exposed : null,
    execution_market: raw.execution_market && typeof raw.execution_market === "object" ? raw.execution_market as Record<string, unknown> : null,
    reasons: ["Execution information was declared by the provider", sourceKind.replaceAll("_", " ") + " was used as discovery evidence"],
  };
}

function profileFromRegistration(registration: Record<string, unknown>, sourceUrl: string): UniversalExecutionProfile | null {
  const executionServices = serviceEntries(registration).filter((service) => looksExecutionRelated(service.name) || looksExecutionRelated(service.type) || looksExecutionRelated(service.description));
  if (executionServices.length === 0) return null;
  const primary = executionServices[0];
  const endpoint = httpUrl(primary.endpoint);
  const nested = object(primary.execution);
  const requirement = declaredCapitalRequirement(primary);
  const nestedRequirement = declaredCapitalRequirement(nested);
  const explicit = requirement.confidence === "explicit" ? requirement : nestedRequirement;
  return {
    detected: true,
    requires_client_capital: explicit.value,
    capital_requirement_confidence: explicit.confidence,
    protocol: typeof primary.protocol === "string" ? primary.protocol.toLowerCase() : typeof primary.name === "string" ? primary.name.toLowerCase() : null,
    authorization_model: typeof primary.authorization_model === "string" ? primary.authorization_model.toLowerCase() : null,
    wallet_provider: typeof primary.wallet_provider === "string" ? primary.wallet_provider.toLowerCase() : null,
    capability_url: endpoint,
    preflight_url: httpUrl(primary.preflight_url),
    source_url: sourceUrl,
    source_kind: "erc8004_service",
    session_key_address: address(primary.session_key_address) ? primary.session_key_address : null,
    session_key_public_key: typeof primary.session_key_public_key === "string" ? primary.session_key_public_key : null,
    allowed_targets: Array.isArray(primary.allowed_targets) ? primary.allowed_targets.filter(address) : [],
    allowed_selectors: Array.isArray(primary.allowed_selectors) ? primary.allowed_selectors.filter((value): value is string => typeof value === "string") : [],
    selectors_required: typeof primary.selectors_required === "boolean" ? primary.selectors_required : null,
    private_key_exposed: typeof primary.private_key_exposed === "boolean" ? primary.private_key_exposed : null,
    execution_market: nested.execution_market && typeof nested.execution_market === "object" ? nested.execution_market as Record<string, unknown> : null,
    reasons: ["An ERC-8004 registration service advertises execution-related behavior", "A service declaration is evidence, not proof of spend authorization"],
  };
}

function profileFromA2A(card: Record<string, unknown>, sourceUrl: string): UniversalExecutionProfile | null {
  const skills = Array.isArray(card.skills) ? card.skills.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object") : [];
  const executionSkill = skills.find((skill) => looksExecutionRelated(skill.name) || looksExecutionRelated(skill.id) || looksExecutionRelated(skill.description));
  const extensions = Array.isArray(card.capabilities) ? card.capabilities : [];
  if (!executionSkill && !skills.some((skill) => looksExecutionRelated(skill))) return null;
  return {
    detected: true,
    requires_client_capital: false,
    capital_requirement_confidence: "unknown",
    protocol: "a2a",
    authorization_model: null,
    wallet_provider: null,
    capability_url: typeof card.url === "string" ? card.url : sourceUrl,
    preflight_url: null,
    source_url: sourceUrl,
    source_kind: "a2a_agent_card",
    session_key_address: null,
    session_key_public_key: null,
    allowed_targets: [],
    allowed_selectors: [],
    selectors_required: null,
    private_key_exposed: null,
    execution_market: null,
    reasons: ["A2A Agent Card exposes an execution-related skill", extensions.length ? "A2A capabilities were also present" : "No A2A extension declaration was required"],
  };
}

function metadataCandidates(agent: Record<string, unknown>) {
  const metadata = object(agent.metadata);
  const execution = object(metadata.execution);
  return unique([
    metadata.execution_capabilities_url as string,
    metadata.execution_capability_url as string,
    execution.execution_capabilities_url as string,
    execution.execution_capability_url as string,
    execution.capabilities_url as string,
    execution.capability_url as string,
  ]);
}

function registrationUri(agent: Record<string, unknown>) {
  const value = typeof agent.uri === "string" ? agent.uri.trim() : "";
  return httpUrl(value);
}

export async function discoverUniversalExecutionProfile(
  agent: Record<string, unknown>,
  registeredEndpoints: Array<Record<string, unknown>> = [],
): Promise<UniversalExecutionProfile> {
  const reasons: string[] = [];
  const metadata = object(agent.metadata);
  const metadataExecution = object(metadata.execution);
  const metadataRequirement = declaredCapitalRequirement(metadataExecution);
  const metadataProtocol = typeof metadataExecution.protocol === "string" ? metadataExecution.protocol.toLowerCase() : null;
  const metadataWallet = typeof metadataExecution.wallet_provider === "string" ? metadataExecution.wallet_provider.toLowerCase() : null;
  const metadataAuth = typeof metadataExecution.authorization_model === "string" ? metadataExecution.authorization_model.toLowerCase() : null;

  for (const url of metadataCandidates(agent)) {
    const document = await fetchJson(url);
    if (document && typeof document === "object") {
      const profile = profileFromCapability(object(document), url, "execution_capability");
      if (profile) return profile;
      reasons.push(`Capability document ${url} did not declare a recognized execution profile`);
    } else {
      reasons.push(`Execution capability URL ${url} was not reachable or returned a non-JSON response`);
    }
  }

  const regUrl = registrationUri(agent);
  if (regUrl) {
    const registration = await fetchJson(regUrl);
    if (registration && typeof registration === "object") {
      const registrationProfile = profileFromRegistration(object(registration), regUrl);
      if (registrationProfile) {
        const executionServices = serviceEntries(object(registration)).filter((service) => looksExecutionRelated(service.name) || looksExecutionRelated(service.type) || looksExecutionRelated(service.description));
        for (const service of executionServices) {
          const serviceEndpoint = httpUrl(service.endpoint);
          if (!serviceEndpoint) continue;
          if (/agent-card\.json|\.well-known\/agent-card/i.test(serviceEndpoint)) {
            const card = await fetchJson(serviceEndpoint);
            const a2aProfile = card && typeof card === "object" ? profileFromA2A(object(card), serviceEndpoint) : null;
            if (a2aProfile) return { ...registrationProfile, ...a2aProfile, source_kind: "a2a_agent_card", source_url: serviceEndpoint, capability_url: serviceEndpoint };
          }
        }
        return registrationProfile;
      }
    }
  }

  const endpointCandidates = unique(registeredEndpoints.flatMap((endpoint) => [
    typeof endpoint.endpoint_url === "string" ? endpoint.endpoint_url : null,
    typeof object(endpoint.metadata).execution_capabilities_url === "string" ? object(endpoint.metadata).execution_capabilities_url as string : null,
    typeof object(endpoint.metadata).execution_capability_url === "string" ? object(endpoint.metadata).execution_capability_url as string : null,
  ]));

  for (const base of endpointCandidates) {
    const direct = httpUrl(base);
    if (!direct) continue;
    const candidates = [
      direct,
      `${direct.replace(/\/+$/, "")}/execution-capabilities`,
      `${direct.replace(/\/+$/, "")}/.well-known/agent-card.json`,
    ];
    for (const candidate of unique(candidates)) {
      const document = await fetchJson(candidate);
      if (!document || typeof document !== "object") continue;
      const raw = object(document);
      const legacy = profileFromCapability(raw, candidate, "registered_endpoint");
      if (legacy) return legacy;
      const a2a = profileFromA2A(raw, candidate);
      if (a2a) return a2a;
    }
  }

  if (metadataProtocol || metadataWallet || metadataAuth || metadataRequirement.confidence === "explicit") {
    reasons.push("Agent metadata contains execution declarations, but no independently reachable capability document was required to classify the agent");
    return {
      detected: true,
      requires_client_capital: metadataRequirement.value,
      capital_requirement_confidence: metadataRequirement.confidence,
      protocol: metadataProtocol,
      authorization_model: metadataAuth,
      wallet_provider: metadataWallet,
      capability_url: null,
      preflight_url: null,
      source_url: null,
      source_kind: "agent_metadata",
      session_key_address: null,
      session_key_public_key: null,
      allowed_targets: [],
      allowed_selectors: [],
      selectors_required: null,
      private_key_exposed: null,
      execution_market: null,
      reasons,
    };
  }

  return {
    detected: false,
    requires_client_capital: false,
    capital_requirement_confidence: "unknown",
    protocol: null,
    authorization_model: null,
    wallet_provider: null,
    capability_url: null,
    preflight_url: null,
    source_url: null,
    source_kind: "none",
    session_key_address: null,
    session_key_public_key: null,
    allowed_targets: [],
    allowed_selectors: [],
    selectors_required: null,
    private_key_exposed: null,
    execution_market: null,
    reasons: reasons.length ? reasons : ["No execution-specific declaration was discovered", "This is non-fatal: ERC-8183 hiring does not require a provider-specific execution-token endpoint"],
  };
}
