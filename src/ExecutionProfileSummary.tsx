type ExecutionProfile = {
  wallet_provider?: "altana" | "twak" | "evm" | "unknown";
  wallet_model?: "agent_owned" | "external" | "unknown";
  transaction_authority?: "scoped_session" | "agent_wallet" | "restricted_commands" | "unknown";
  supports_spend_cap?: boolean;
  supports_call_allowlist?: boolean;
  supports_expiry?: boolean;
  supports_revocation?: boolean;
  evidence?: string[];
};

type CommerceProfile = { erc8183?: boolean; x402?: boolean; b402?: boolean };
type CommunicationProfile = { a2a?: boolean; mcp?: boolean; http?: boolean };

export type AgentProtocolProfile = {
  execution?: ExecutionProfile;
  commerce?: CommerceProfile;
  communication?: CommunicationProfile;
};

function labelWallet(provider: ExecutionProfile["wallet_provider"]) {
  if (provider === "altana") return "Altana Smart Agentic Wallet";
  if (provider === "twak") return "Trust Wallet Agent Kit";
  if (provider === "evm") return "EVM agent wallet";
  return "Wallet model not declared";
}

function pill(label: string, active: boolean) {
  return active ? <span key={label} className="inline-flex items-center rounded-full border border-[#c9b77a] bg-[#fbf4db] px-2 py-1 font-mono text-[9px] text-[#765f19]">{label}</span> : null;
}

export default function ExecutionProfileSummary({ profile }: { profile?: AgentProtocolProfile | null }) {
  const execution = profile?.execution;
  const commerce = profile?.commerce;
  const communication = profile?.communication;

  return (
    <section className="border border-line rounded-[16px_8px_18px_9px] bg-paper p-4">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div>
          <small className="block font-mono text-[8.5px] uppercase tracking-wide text-[#8a8477]">Execution profile</small>
          <strong className="block font-display text-[14px] font-bold mt-1">How this agent can actually operate</strong>
        </div>
        <span className="font-mono text-[9px] text-[#8a8477]">evidence-based</span>
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        <div className="border border-line rounded-[12px_7px_13px_8px] p-3 bg-paperhi">
          <small className="block font-mono text-[8px] uppercase text-[#8a8477] mb-1">Wallet / execution</small>
          <strong className="block text-[12px]">{labelWallet(execution?.wallet_provider || "unknown")}</strong>
          <span className="block text-[10px] text-inksoft mt-1">
            {execution?.transaction_authority === "scoped_session" && "Scoped onchain session authority declared."}
            {execution?.transaction_authority === "agent_wallet" && "Agent wallet signing model declared."}
            {execution?.transaction_authority === "restricted_commands" && "Restricted command-based wallet operations declared."}
            {(!execution || execution.transaction_authority === "unknown") && "AgentMarket has no verified execution authority declaration."}
          </span>
        </div>

        <div className="border border-line rounded-[12px_7px_13px_8px] p-3 bg-paperhi">
          <small className="block font-mono text-[8px] uppercase text-[#8a8477] mb-1">Guardrails</small>
          <div className="flex flex-wrap gap-1.5 mt-2">
            {pill("Spend cap", execution?.supports_spend_cap === true)}
            {pill("Call allowlist", execution?.supports_call_allowlist === true)}
            {pill("Expiry", execution?.supports_expiry === true)}
            {pill("Revocation", execution?.supports_revocation === true)}
            {!execution || !Object.values(execution).some((value) => value === true) ? <span className="font-mono text-[9px] text-[#8a8477]">No guardrails declared</span> : null}
          </div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {pill("ERC-8183", commerce?.erc8183 === true)}
        {pill("A2A", communication?.a2a === true)}
        {pill("MCP", communication?.mcp === true)}
        {pill("HTTP", communication?.http === true)}
        {pill("x402", commerce?.x402 === true)}
        {pill("B402", commerce?.b402 === true)}
      </div>

      <p className="mt-3 text-[10px] leading-4 text-[#8a8477]">
        These labels describe capabilities exposed or verified by AgentMarket. They do not grant permission, custody assets, or guarantee trading outcomes.
      </p>
    </section>
  );
}
