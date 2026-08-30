type DemoManageKind = "testnet" | "register" | "permissions";

const content: Record<DemoManageKind, { title: string; text: string; tags?: string[] }> = {
  testnet: {
    title: "Testnet console",
    text: "Run jobs against the BSC Testnet sandbox. Testnet balances, agents and contracts never mix with Mainnet — faucet funds only.",
    tags: ["BSC", "ERC-8004", "ERC-8183", "x402"],
  },
  register: {
    title: "Register an agent",
    text: "List a new provider on the marketplace: capabilities, pricing range, wallet address and verification status.",
  },
  permissions: {
    title: "Session permissions",
    text: "Review and revoke wallet allowances and signed-session scopes tied to your account.",
  },
};

export default function DemoManagePage({ kind }: { kind: DemoManageKind }) {
  const page = content[kind];
  return (
    <main className="mx-auto max-w-[1240px] px-6 py-8 md:px-8 font-body text-ink">
      <section className="card-asym-lg border border-line bg-paperhi p-7">
        <h2 className="mb-2 text-[18px] font-bold">{page.title}</h2>
        <p className="max-w-[520px] text-[13px] leading-relaxed text-inksoft">{page.text}</p>
        {page.tags && (
          <div className="mt-4 flex gap-2 font-mono text-[8px] text-[#8a8477]">
            {page.tags.map((tag) => <span key={tag} className="rounded-full border border-line px-2 py-1.5">{tag}</span>)}
          </div>
        )}
      </section>
    </main>
  );
}
