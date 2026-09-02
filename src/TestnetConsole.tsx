const tools = [
  { title: "CAKE2 swap helper", detail: "Read-only testnet preflight before a signed swap.", href: "/testnet/swap", action: "Open" },
  { title: "Provider readiness", detail: "Current endpoint and hireability status.", href: "/testnet/providers", action: "View" },
  { title: "Job history", detail: "Recent BSC Testnet commerce jobs.", href: "/testnet/jobs", action: "Open" },
  { title: "Policy review", detail: "Current evaluator and settlement status.", href: "/testnet/review", action: "View" },
] as const;

export default function TestnetConsole() {
  return (
    <main className="mx-auto max-w-[1240px] px-6 py-8 md:px-8 font-body text-ink">
      <div className="mb-6">
        <span className="block font-mono text-[9.5px] uppercase tracking-wide text-[#8a8477] mb-2">Manage / Testnet</span>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="font-display text-[28px] font-bold tracking-tight md:text-[34px]">Testnet console</h1>
            <p className="mt-1.5 text-[12px] text-inksoft">BSC Testnet only.</p>
          </div>
          <span className="env-badge shrink-0"><span className="am-dot-brass" /> TESTNET · CHAIN 97</span>
        </div>
      </div>

      <section className="am-wide-card mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <strong className="block font-display text-[15px] font-bold">BSC Testnet · Chain 97</strong>
          <span className="text-[10.5px] text-inksoft">Faucet funds only · ERC-8004 · ERC-8183</span>
        </div>
        <span className="font-mono text-[9.5px] uppercase text-[#8a8477]">Sandbox</span>
      </section>

      <section className="grid gap-3 sm:grid-cols-2">
        {tools.map((tool, index) => (
          <a key={tool.title} href={tool.href} className="group card-asym border border-line bg-paperhi p-[18px] no-underline transition-transform hover:-translate-y-0.5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <span className="font-mono text-[8.5px] uppercase tracking-wide text-brass">0{index + 1}</span>
                <h2 className="mt-2 font-display text-[15px] font-bold">{tool.title}</h2>
                <p className="mt-1.5 text-[10.5px] leading-5 text-inksoft">{tool.detail}</p>
              </div>
              <span className="shrink-0 text-[11px] font-extrabold text-brass opacity-80 group-hover:opacity-100">{tool.action} →</span>
            </div>
          </a>
        ))}
      </section>
    </main>
  );
}
