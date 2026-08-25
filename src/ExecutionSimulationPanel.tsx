import { useMemo, useState } from "react";

type Props = {
  title?: string;
  compact?: boolean;
};

function simulate(capital: number, pnlPct: number) {
  const starting = Number.isFinite(capital) && capital > 0 ? capital : 0;
  const pnl = starting * (pnlPct / 100);
  return { starting, pnl, ending: starting + pnl };
}

export default function ExecutionSimulationPanel({ title = "Execution-capital simulation", compact = false }: Props) {
  const [capital, setCapital] = useState("100");
  const [pnlPct, setPnlPct] = useState("0");
  const result = useMemo(() => simulate(Number(capital), Number(pnlPct)), [capital, pnlPct]);

  return (
    <section className={`border border-line rounded-[16px_8px_18px_9px] bg-paper p-4 ${compact ? "text-[11px]" : "text-[12px]"}`}>
      <div className="flex items-center justify-between gap-3 mb-2">
        <strong className="font-display text-[15px]">{title}</strong>
        <span className="font-mono text-[8px] uppercase tracking-widest text-brass">SIMULATION ONLY</span>
      </div>
      <p className="text-inksoft mb-4">Hypothetical values only. No wallet signing, token transfer, DEX call, or ERC-8183 state change occurs.</p>
      <div className="grid sm:grid-cols-2 gap-3 mb-4">
        <label className="block"><span className="block font-mono text-[8.5px] uppercase text-[#8a8477] mb-1">Hypothetical capital</span><input value={capital} onChange={(event) => setCapital(event.target.value)} inputMode="decimal" className="w-full bg-transparent border border-line rounded-lg px-3 py-2 font-mono" /></label>
        <label className="block"><span className="block font-mono text-[8.5px] uppercase text-[#8a8477] mb-1">Hypothetical P&amp;L %</span><input value={pnlPct} onChange={(event) => setPnlPct(event.target.value)} inputMode="decimal" className="w-full bg-transparent border border-line rounded-lg px-3 py-2 font-mono" /></label>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div><small className="block font-mono text-[8px] uppercase text-[#8a8477]">Start</small><strong>{result.starting.toFixed(2)} USDT</strong></div>
        <div><small className="block font-mono text-[8px] uppercase text-[#8a8477]">Simulated P&amp;L</small><strong>{result.pnl.toFixed(2)} USDT</strong></div>
        <div><small className="block font-mono text-[8px] uppercase text-[#8a8477]">End</small><strong>{result.ending.toFixed(2)} USDT</strong></div>
      </div>
    </section>
  );
}
