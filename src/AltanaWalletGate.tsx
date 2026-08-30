import { useEffect, useState } from "react";
import {
  createAltanaWallet,
  getAltanaPasskeyReadiness,
  getAltanaWalletResolution,
  getPersistentAltanaWallet,
  markAltanaRecoveryFailed,
  recoverAltanaWallet,
  type AltanaPasskeyReadiness,
  type AltanaWalletResolution,
  type AltanaFundingResult,
  type PersistentAltanaWalletRecord,
} from "./lib/altanaWallet";

function compact(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function readinessLabel(value: boolean | null) {
  if (value === null) return "Not reported";
  return value ? "Available" : "Unavailable";
}

export default function AltanaWalletGate({
  onResolved,
  existingWalletAddress = null,
}: {
  onResolved?: (value: AltanaWalletResolution) => void;
  existingWalletAddress?: string | null;
}) {
  const [state, setState] = useState<"idle" | "creating" | "recovering" | "ready" | "error">("idle");
  const [wallet, setWallet] = useState<AltanaWalletResolution | null>(() => getAltanaWalletResolution());
  const [storedWallet, setStoredWallet] = useState<PersistentAltanaWalletRecord | null>(null);
  const [funding, setFunding] = useState<AltanaFundingResult | null>(null);
  const [readiness, setReadiness] = useState<AltanaPasskeyReadiness | null>(null);
  const [error, setError] = useState("");
  const [recoveryFailed, setRecoveryFailed] = useState(false);

  useEffect(() => {
    let mounted = true;
    void getAltanaPasskeyReadiness().then((result) => {
      if (mounted) setReadiness(result);
    });
    void getPersistentAltanaWallet().then((result) => {
      if (mounted) setStoredWallet(result);
    }).catch(() => undefined);

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
    setFunding(null);
    try {
      const currentReadiness = await getAltanaPasskeyReadiness();
      setReadiness(currentReadiness);

      if (mode === "create") {
        const result = await createAltanaWallet({ replaceAfterRecoveryFailure: recoveryFailed });
        setWallet(result);
        setFunding(result.funding);
        setState("ready");
        setStoredWallet(await getPersistentAltanaWallet());
        onResolved?.(result);
        return;
      }

      const result = await recoverAltanaWallet();
      setWallet(result);
      setState("ready");
      setRecoveryFailed(false);
      setStoredWallet(await getPersistentAltanaWallet());
      onResolved?.(result);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Unable to resolve the Altana execution wallet";
      setError(message);
      if (mode === "recover") {
        try {
          await markAltanaRecoveryFailed();
          setStoredWallet(await getPersistentAltanaWallet());
        } catch {}
        setRecoveryFailed(true);
      }
      setState("error");
    }
  }

  const persistentAddress = existingWalletAddress || storedWallet?.wallet_address || null;
  const hasPersistentWallet = Boolean(persistentAddress);
  const createLabel = state === "creating"
    ? "Creating and funding new Altana wallet…"
    : "Create a new Altana Passkey wallet →";

  return (
    <section className="border border-line rounded-[16px_8px_18px_9px] bg-paper p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <small className="block font-mono text-[8.5px] uppercase tracking-widest text-brass mb-1.5">Execution Capital · Wallet</small>
          <h3 className="font-display text-[18px] font-bold m-0">Your Altana execution wallet</h3>
          <p className="text-[11px] text-inksoft mt-1.5 max-w-[620px]">AgentMarket WalletConnect remains your marketplace and ERC-8183 wallet. Altana uses one persistent user-controlled Passkey smart wallet for scoped execution authority. New tasks reuse this wallet and receive new scoped sessions.</p>
        </div>
        <span className="font-mono text-[9px] px-2.5 py-1 rounded-lg status-brass">BSC TESTNET</span>
      </div>

      <div className="grid sm:grid-cols-2 gap-3 mt-5">
        <div className="border border-line rounded-[12px_7px_13px_8px] bg-paperhi p-3.5"><small className="block font-mono text-[8px] uppercase text-[#8a8477] mb-1">Marketplace wallet</small><strong className="font-mono text-[11px]">WalletConnect / AgentMarket</strong></div>
        <div className="border border-line rounded-[12px_7px_13px_8px] bg-paperhi p-3.5"><small className="block font-mono text-[8px] uppercase text-[#8a8477] mb-1">Persistent Altana wallet</small><strong className="font-mono text-[11px]">{persistentAddress ? compact(persistentAddress) : "Not created yet"}</strong></div>
      </div>

      {readiness && !wallet && (
        <div className="mt-4 border border-line rounded-[12px_7px_13px_8px] bg-paperhi p-4">
          <small className="block font-mono text-[8px] uppercase text-[#8a8477] mb-2">Passkey readiness</small>
          <div className="grid sm:grid-cols-2 gap-2 text-[10px]"><div>HTTPS / secure context: <strong>{readiness.secureContext ? "OK" : "Missing"}</strong></div><div>WebAuthn: <strong>{readiness.webAuthnAvailable ? "Available" : "Unavailable"}</strong></div><div>Platform authenticator: <strong>{readinessLabel(readiness.platformAuthenticatorAvailable)}</strong></div><div>Top-level page: <strong>{readiness.topLevelContext ? "Yes" : "No"}</strong></div></div>
          <div className="mt-2 font-mono text-[9px] text-inksoft break-all">Relying-party ID: {readiness.rpId}</div>
        </div>
      )}

      {wallet && (
        <div className="mt-4 border border-green/30 bg-green/5 rounded-[12px_7px_13px_8px] px-4 py-3 text-[11px]"><strong className="text-green">Altana wallet ready ✓</strong><div className="mt-1 font-mono text-[9px]">Wallet {compact(wallet.walletAddress)} · Passkey signer {compact(wallet.signerAddress)}</div>{funding && <div className="mt-2 text-[10px] text-inksoft">Setup funding confirmed: {funding.fundingAmountFormatted} tBNB · Tx {compact(funding.transactionHash)}</div>}</div>
      )}

      {error && <div className="mt-4 border border-[#cfad9f] bg-rustsoft text-rust rounded-[12px_7px_13px_8px] px-4 py-3 text-[11px] break-words">{error}</div>}

      {!wallet && (
        <div className="mt-5 flex gap-3 flex-wrap">
          {!hasPersistentWallet && (
            <button type="button" onClick={() => void resolveWith("create")} disabled={state === "creating" || state === "recovering"} className="font-display font-bold text-[12px] px-5 py-3 bg-ink text-paperhi btn-asym">{createLabel}</button>
          )}
          {hasPersistentWallet && !recoveryFailed && (
            <button type="button" onClick={() => void resolveWith("recover")} disabled={state === "creating" || state === "recovering"} className="font-display font-bold text-[12px] px-5 py-3 border border-line bg-paperhi text-ink btn-asym">{state === "recovering" ? "Recovering…" : "Unlock existing Altana wallet →"}</button>
          )}
          {recoveryFailed && (
            <>
              <div className="w-full border border-[#cfad9f] bg-rustsoft rounded-[12px_7px_13px_8px] px-4 py-3 text-[10px] text-rust">Recovery could not unlock the registered wallet. Creating a new wallet will replace the recovery-required wallet record. Any funds still held by the old wallet remain at its old address until recovered separately.</div>
              <button type="button" onClick={() => void resolveWith("create")} disabled={state === "creating" || state === "recovering"} className="font-display font-bold text-[12px] px-5 py-3 bg-ink text-paperhi btn-asym">{createLabel}</button>
              <button type="button" onClick={() => { setRecoveryFailed(false); setError(""); }} disabled={state === "creating" || state === "recovering"} className="font-display font-bold text-[12px] px-5 py-3 border border-line bg-paperhi text-ink btn-asym">Try recovery again →</button>
            </>
          )}
          {!hasPersistentWallet && !recoveryFailed && (
            <span className="self-center text-[10px] text-inksoft">No persistent Altana wallet is registered for this account yet.</span>
          )}
        </div>
      )}

      {state === "creating" && <p className="mt-4 text-[10px] text-inksoft">After the Passkey wallet is created, WalletConnect will ask you to approve the small native tBNB Testnet setup transfer. Trading capital is not automatically moved during wallet creation.</p>}
      {wallet && <p className="mt-4 text-[10px] text-inksoft">Your Passkey is the owner authority for this persistent Altana execution wallet. Agents receive separate, expiring scoped sessions.</p>}
    </section>
  );
}
