import { useState } from "react";
import type { Address, Hex } from "viem";
import { grantAltanaExecutionSession } from "./lib/altanaSession";

export type AltanaSessionGrantGateProps = {
  requestId: string;
  agentSessionAddress: Address;
  agentSessionPublicKey: Hex;
  allowedCalls: readonly Address[];
  allowedSelectors: readonly Hex[];
  capitalAmount: bigint;
  capitalToken?: Address;
  purpose: string;
  durationSeconds: number;
  capabilitySource?: string;
  onAuthorized?: (value: { requestId: string; sessionKeyId: Hex; walletAddress: Address; transactionHash?: Hex }) => void;
};

function compact(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function compactHex(value: string) {
  return value.length > 14 ? `${value.slice(0, 10)}…${value.slice(-4)}` : value;
}

export default function AltanaSessionGrantGate(props: AltanaSessionGrantGateProps) {
  const [status, setStatus] = useState<"idle" | "signing" | "verifying" | "authorized" | "error">("idle");
  const [error, setError] = useState("");
  const [sessionKeyId, setSessionKeyId] = useState("");
  const [walletAddress, setWalletAddress] = useState("");

  async function grant() {
    setStatus("signing");
    setError("");
    try {
      const expiry = Math.floor(Date.now() / 1000) + props.durationSeconds;
      const granted = await grantAltanaExecutionSession({
        agentSessionAddress: props.agentSessionAddress,
        agentSessionPublicKey: props.agentSessionPublicKey,
        allowedCalls: props.allowedCalls,
        capitalToken: props.capitalToken,
        capitalAmount: props.capitalAmount,
        purpose: props.purpose,
        expiry,
      });

      setStatus("verifying");
      const response = await fetch("/api/testnet/execution-capital-verify", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          request_id: props.requestId,
          user_execution_wallet: granted.walletAddress,
          signer_address: granted.signerAddress,
          session_key_id: granted.sessionKeyId,
          session_expiry: granted.expiry,
          session_grant_tx_hash: granted.transactionHash,
        }),
      });
      const body = await response.json() as { ok?: boolean; authorized?: boolean; request?: unknown; error?: string };
      if (!response.ok || !body.authorized) throw new Error(body.error || "AgentMarket could not independently verify the Altana session.");

      setWalletAddress(granted.walletAddress);
      setSessionKeyId(granted.sessionKeyId);
      setStatus("authorized");
      props.onAuthorized?.({
        requestId: props.requestId,
        sessionKeyId: granted.sessionKeyId,
        walletAddress: granted.walletAddress,
        transactionHash: granted.transactionHash,
      });
    } catch (cause) {
      setStatus("error");
      setError(cause instanceof Error ? cause.message : "Altana session authorization failed");
    }
  }

  const statusText = status === "signing"
    ? "Waiting for wallet signature…"
    : status === "verifying"
      ? "Verifying onchain authority…"
      : status === "authorized"
        ? "Authorized and independently verified ✓"
        : "Approve execution authority";

  return (
    <section className="border border-line rounded-[16px_8px_18px_9px] bg-paper p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <small className="block font-mono text-[8.5px] uppercase tracking-widest text-brass mb-1.5">Execution Capital · Altana Session</small>
          <h3 className="font-display text-[18px] font-bold m-0">Approve the agent's trading authority</h3>
          <p className="text-[11px] text-inksoft mt-1.5 max-w-[600px]">
            This scope comes from the provider's live public execution-capability endpoint. Your wallet stays the owner; the agent receives only the displayed targets, selector policy, spend cap, and expiry.
          </p>
        </div>
        <span className={`font-mono text-[9px] px-2.5 py-1 rounded-lg ${status === "authorized" ? "status-green" : "status-brass"}`}>BSC TESTNET</span>
      </div>

      <div className="grid sm:grid-cols-2 gap-3 mt-5">
        <div className="border border-line rounded-[12px_7px_13px_8px] bg-paperhi p-3.5"><small className="block font-mono text-[8px] uppercase text-[#8a8477] mb-1">Trading capital</small><strong className="font-mono text-[11px]">{props.capitalAmount.toString()} {props.capitalToken ? compact(props.capitalToken) : "BNB"}</strong></div>
        <div className="border border-line rounded-[12px_7px_13px_8px] bg-paperhi p-3.5"><small className="block font-mono text-[8px] uppercase text-[#8a8477] mb-1">Duration</small><strong className="font-mono text-[11px]">{Math.round(props.durationSeconds / 3600)}h</strong></div>
        <div className="border border-line rounded-[12px_7px_13px_8px] bg-paperhi p-3.5"><small className="block font-mono text-[8px] uppercase text-[#8a8477] mb-1">Allowed contracts</small><strong className="font-mono text-[11px]">{props.allowedCalls.length}</strong></div>
        <div className="border border-line rounded-[12px_7px_13px_8px] bg-paperhi p-3.5"><small className="block font-mono text-[8px] uppercase text-[#8a8477] mb-1">Session key</small><strong className="font-mono text-[11px]">{compact(props.agentSessionAddress)}</strong></div>
      </div>

      <div className="mt-4 border border-line rounded-[12px_7px_13px_8px] bg-paperhi p-4">
        <small className="block font-mono text-[8px] uppercase text-[#8a8477] mb-2">Contract allowlist</small>
        <div className="flex flex-wrap gap-2">{props.allowedCalls.map((address) => <span key={address} className="font-mono text-[9px] px-2 py-1 rounded-md border border-line">{compact(address)}</span>)}</div>
        <small className="block font-mono text-[8px] uppercase text-[#8a8477] mb-2 mt-4">Function selector allowlist</small>
        <div className="flex flex-wrap gap-2">{props.allowedSelectors.map((value) => <span key={value} className="font-mono text-[9px] px-2 py-1 rounded-md border border-line">{compactHex(value)}</span>)}</div>
        <p className="mt-3 text-[10px] text-inksoft">Selectors are an execution-service Risk Guardian restriction. The Altana permission grants the displayed contract targets; the Grid executor refuses calls outside these selectors.</p>
      </div>

      {props.capabilitySource && <div className="mt-4 text-[9px] font-mono text-inksoft break-all">Capability source: {props.capabilitySource}</div>}
      {walletAddress && sessionKeyId && <div className="mt-4 border border-green/30 bg-green/5 rounded-[12px_7px_13px_8px] px-4 py-3 text-[11px]"><strong className="text-green">{statusText}</strong><div className="mt-1 font-mono text-[9px]">Wallet {compact(walletAddress)} · Key {compact(sessionKeyId)}</div></div>}
      {error && <div className="mt-4 border border-[#cfad9f] bg-rustsoft text-rust rounded-[12px_7px_13px_8px] px-4 py-3 text-[11px]">{error}</div>}

      <button type="button" onClick={() => void grant()} disabled={status === "signing" || status === "verifying" || status === "authorized"} className="mt-5 font-display font-bold text-[12px] px-5 py-3 bg-ink text-paperhi btn-asym">
        {statusText} →
      </button>
      <p className="mt-3 text-[10px] text-inksoft">AgentMarket does not receive the agent private key. The provider's public capability is treated as a requested scope; authorization only becomes verified after the server checks the Altana KeyStore.</p>
    </section>
  );
}
