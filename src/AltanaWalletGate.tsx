import { useEffect, useState } from "react";
import {
  createAltanaWallet,
  getAltanaPasskeyReadiness,
  getAltanaWalletResolution,
  recoverAltanaWallet,
  type AltanaPasskeyReadiness,
  type AltanaWalletResolution,
} from "./lib/altanaWallet";

function compact(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function readinessLabel(value: boolean | null) {
  if (value === null) return "Not reported";
  return value ? "Available" : "Unavailable";
}

export default function AltanaWalletGate({ onResolved }: { onResolved?: (value: AltanaWalletResolution) => void }) {
  const [state, setState] = useState<"idle" | "creating" | "recovering" | "ready" | "error">("idle");
  const [wallet, setWallet] = useState<AltanaWalletResolution | null>(() => getAltanaWalletResolution());
  const [readiness, setReadiness] = useState<AltanaPasskeyReadiness | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let mounted = true;
    void getAltanaPasskeyReadiness().then((result) => {
      if (mounted) setReadiness(result);
    });

    const resolved = getAltanaWalletResolution();
    if (resolved) {
      setWallet(resolved);
      setState("ready");
      onResolved?.(resolved);
    }

    return () => {
      mounted = false;
    };
  }, [onResolved]);

  async function resolveWith(mode: "create" | "recover") {
    setState(mode === "create" ? "creating" : "recovering");
    setError("");
    try {
      const currentReadiness = await getAltanaPasskeyReadiness();
      setReadiness(currentReadiness);
      const result = mode === "create" ? await createAltanaWallet() : await recoverAltanaWallet();
      setWallet(result);
      setState("ready");
      onResolved?.(result);
    } catch (cause) {
      setState("error");
      setError(cause instanceof Error ? cause.message : "Unable to resolve the Altana execution wallet");
    }
  }

  return (
    <section className="border border-line rounded-[16px_8px_18px_9px] bg-paper p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <small className="block font-mono text-[8.5px] uppercase tracking-widest text-brass mb-1.5">Execution Capital · Wallet</small>
          <h3 className="font-display text-[18px] font-bold m-0">Your Altana execution wallet</h3>
          <p className="text-[11px] text-inksoft mt-1.5 max-w-[620px]">
            AgentMarket WalletConnect remains your marketplace and ERC-8183 wallet. Altana uses a separate user-controlled Passkey smart wallet for scoped execution authority. This step does not transfer trading capital.
          </p>
        </div>
        <span className="font-mono text-[9px] px-2.5 py-1 rounded-lg status-brass">BSC TESTNET</span>
      </div>

      <div className="grid sm:grid-cols-2 gap-3 mt-5">
        <div className="border border-line rounded-[12px_7px_13px_8px] bg-paperhi p-3.5">
          <small className="block font-mono text-[8px] uppercase text-[#8a8477] mb-1">Marketplace wallet</small>
          <strong className="font-mono text-[11px]">WalletConnect / AgentMarket</strong>
        </div>
        <div className="border border-line rounded-[12px_7px_13px_8px] bg-paperhi p-3.5">
          <small className="block font-mono text-[8px] uppercase text-[#8a8477] mb-1">Altana wallet</small>
          <strong className="font-mono text-[11px]">{wallet ? compact(wallet.walletAddress) : "Not resolved"}</strong>
        </div>
      </div>

      {readiness && !wallet && (
        <div className="mt-4 border border-line rounded-[12px_7px_13px_8px] bg-paperhi p-4">
          <small className="block font-mono text-[8px] uppercase text-[#8a8477] mb-2">Passkey readiness</small>
          <div className="grid sm:grid-cols-2 gap-2 text-[10px]">
            <div>HTTPS / secure context: <strong>{readiness.secureContext ? "OK" : "Missing"}</strong></div>
            <div>WebAuthn: <strong>{readiness.webAuthnAvailable ? "Available" : "Unavailable"}</strong></div>
            <div>Platform authenticator: <strong>{readinessLabel(readiness.platformAuthenticatorAvailable)}</strong></div>
            <div>Top-level page: <strong>{readiness.topLevelContext ? "Yes" : "No"}</strong></div>
          </div>
          <div className="mt-2 font-mono text-[9px] text-inksoft break-all">Relying-party ID: {readiness.rpId}</div>
        </div>
      )}

      {wallet && (
        <div className="mt-4 border border-green/30 bg-green/5 rounded-[12px_7px_13px_8px] px-4 py-3 text-[11px]">
          <strong className="text-green">Altana wallet ready ✓</strong>
          <div className="mt-1 font-mono text-[9px]">Wallet {compact(wallet.walletAddress)} · Passkey signer {compact(wallet.signerAddress)}</div>
        </div>
      )}

      {error && <div className="mt-4 border border-[#cfad9f] bg-rustsoft text-rust rounded-[12px_7px_13px_8px] px-4 py-3 text-[11px] break-words">{error}</div>}

      {!wallet && (
        <div className="mt-5 flex gap-3 flex-wrap">
          <button
            type="button"
            onClick={() => void resolveWith("create")}
            disabled={state === "creating" || state === "recovering"}
            className="font-display font-bold text-[12px] px-5 py-3 bg-ink text-paperhi btn-asym"
          >
            {state === "creating" ? "Creating Passkey wallet…" : "Create Altana Passkey wallet →"}
          </button>
          <button
            type="button"
            onClick={() => void resolveWith("recover")}
            disabled={state === "creating" || state === "recovering"}
            className="font-display font-bold text-[12px] px-5 py-3 border border-line bg-paperhi text-ink btn-asym"
          >
            {state === "recovering" ? "Recovering…" : "Recover existing Altana wallet →"}
          </button>
        </div>
      )}

      {wallet && <p className="mt-4 text-[10px] text-inksoft">Your Passkey is the user authority for the Altana execution wallet. The agent only receives the separate session scope shown below.</p>}
    </section>
  );
}
