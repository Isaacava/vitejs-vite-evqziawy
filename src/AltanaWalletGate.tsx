import { useState } from "react";
import { ensureAltanaWallet, type AltanaWalletResolution } from "./lib/altanaWallet";

function compact(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export default function AltanaWalletGate({ onResolved }: { onResolved?: (value: AltanaWalletResolution) => void }) {
  const [state, setState] = useState<"idle" | "resolving" | "ready" | "error">("idle");
  const [wallet, setWallet] = useState<AltanaWalletResolution | null>(null);
  const [error, setError] = useState("");

  async function resolve() {
    setState("resolving");
    setError("");
    try {
      const result = await ensureAltanaWallet();
      setWallet(result);
      setState("ready");
      onResolved?.(result);
    } catch (cause) {
      setState("error");
      setError(cause instanceof Error ? cause.message : "Unable to resolve the Altana wallet");
    }
  }

  return (
    <section className="border border-line rounded-[16px_8px_18px_9px] bg-paper p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <small className="block font-mono text-[8.5px] uppercase tracking-widest text-brass mb-1.5">Execution Capital · Wallet</small>
          <h3 className="font-display text-[18px] font-bold m-0">Your Altana execution wallet</h3>
          <p className="text-[11px] text-inksoft mt-1.5 max-w-[560px]">
            Uses the wallet you already connected to AgentMarket. This step does not grant the agent a session and does not transfer funds.
          </p>
        </div>
        <span className="font-mono text-[9px] px-2.5 py-1 rounded-lg status-brass">BSC TESTNET</span>
      </div>

      <div className="grid sm:grid-cols-2 gap-3 mt-5">
        <div className="border border-line rounded-[12px_7px_13px_8px] bg-paperhi p-3.5">
          <small className="block font-mono text-[8px] uppercase text-[#8a8477] mb-1">Wallet owner</small>
          <strong className="font-mono text-[11px]">Connected AgentMarket wallet</strong>
        </div>
        <div className="border border-line rounded-[12px_7px_13px_8px] bg-paperhi p-3.5">
          <small className="block font-mono text-[8px] uppercase text-[#8a8477] mb-1">Session</small>
          <strong className="font-mono text-[11px]">Not granted</strong>
        </div>
      </div>

      {wallet && <div className="mt-4 border border-green/30 bg-green/5 rounded-[12px_7px_13px_8px] px-4 py-3 text-[11px]">
        <strong className="text-green">Wallet resolved ✓</strong>
        <span className="ml-2 font-mono">{compact(wallet.walletAddress)}</span>
        <span className="ml-2 text-inksoft">Signer {compact(wallet.signerAddress)}</span>
      </div>}

      {error && <div className="mt-4 border border-[#cfad9f] bg-rustsoft text-rust rounded-[12px_7px_13px_8px] px-4 py-3 text-[11px]">{error}</div>}

      <div className="mt-5 flex gap-3 flex-wrap">
        <button
          type="button"
          onClick={() => void resolve()}
          disabled={state === "resolving" || state === "ready"}
          className="font-display font-bold text-[12px] px-5 py-3 bg-ink text-paperhi btn-asym"
        >
          {state === "resolving" ? "Resolving wallet…" : state === "ready" ? "Wallet ready ✓" : "Resolve Altana wallet →"}
        </button>
        <span className="self-center text-[10px] text-inksoft">Next step: independently verify the session before any execution authority is shown.</span>
      </div>
    </section>
  );
}
