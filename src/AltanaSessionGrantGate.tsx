import { useState } from "react";
import type { Address, Hex } from "viem";
import {
  getAltanaGrantFeeReadiness,
  grantAltanaExecutionSession,
  TESTNET_U_TOKEN,
} from "./lib/altanaSession";
import { ensureAltanaWallet, fundAltanaTradingCapital } from "./lib/altanaWallet";
import { ensureAltanaTokenAllowance } from "./lib/altanaAllowance";

export type AltanaSessionGrantGateProps = {
  requestId: string;
  agentSessionAddress: Address;
  agentSessionPublicKey: Hex;
  allowedCalls: readonly Address[];
  allowedSelectors: readonly Hex[];
  capitalAmount: bigint;
  capitalToken?: Address;
  capitalSymbol?: string;
  capitalDecimals?: number;
  approvalSpender?: Address;
  purpose: string;
  durationSeconds: number;
  capabilitySource?: string;
  onAuthorized?: (value: { requestId: string; sessionKeyId: Hex; walletAddress: Address; transactionHash?: Hex }) => void;
};

function compact(address: string) { return `${address.slice(0, 6)}…${address.slice(-4)}`; }
function compactHex(value: string) { return value.length > 14 ? `${value.slice(0, 10)}…${value.slice(-4)}` : value; }

export default function AltanaSessionGrantGate(props: AltanaSessionGrantGateProps) {
  const [status, setStatus] = useState<"idle" | "checking" | "funding_capital" | "approving_allowance" | "signing" | "verifying" | "authorized" | "error">("idle");
  const [error, setError] = useState("");
  const [sessionKeyId, setSessionKeyId] = useState("");
  const [walletAddress, setWalletAddress] = useState("");
  const [capitalTxHash, setCapitalTxHash] = useState("");
  const [allowanceTxHash, setAllowanceTxHash] = useState("");
  const [feeReadiness, setFeeReadiness] = useState<Awaited<ReturnType<typeof getAltanaGrantFeeReadiness>> | null>(null);

  async function grant() {
    setStatus("checking");
    setError("");
    setCapitalTxHash("");
    setAllowanceTxHash("");
    try {
      const executionWallet = ensureAltanaWallet();
      const capitalToken = props.capitalToken || TESTNET_U_TOKEN;
      const decimals = props.capitalDecimals ?? 18;
      if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) throw new Error("Execution token decimals are invalid.");
      const rawCapitalAmount = props.capitalAmount * 10n ** BigInt(decimals);
      const symbol = props.capitalSymbol || "execution token";
      const approvalSpender = props.approvalSpender || (props.allowedCalls.length === 1 ? props.allowedCalls[0] : null);
      if (!approvalSpender) throw new Error("A single execution spender must be identified before requesting an ERC-20 allowance.");

      const readiness = await getAltanaGrantFeeReadiness();
      setFeeReadiness(readiness);
      if (!readiness.sufficientForRegistration) {
        throw new Error(`Altana wallet ${readiness.walletAddress} has ${readiness.nativeBalanceFormatted} tBNB. This first-time session grant needs at least ${readiness.minimumRegistrationValueFormatted} tBNB for KeyStore registration fees, plus any relay/gas costs.`);
      }

      setStatus("funding_capital");
      const capitalFunding = await fundAltanaTradingCapital(executionWallet.walletAddress, capitalToken, rawCapitalAmount);
      if (capitalFunding.transactionHash) setCapitalTxHash(capitalFunding.transactionHash);

      setStatus("approving_allowance");
      const allowance = await ensureAltanaTokenAllowance(capitalToken, approvalSpender, rawCapitalAmount);
      if (allowance.transactionHash) setAllowanceTxHash(allowance.transactionHash);

      setStatus("signing");
      const expiry = Math.floor(Date.now() / 1000) + props.durationSeconds;
      const granted = await grantAltanaExecutionSession({
        agentSessionAddress: props.agentSessionAddress,
        agentSessionPublicKey: props.agentSessionPublicKey,
        allowedCalls: props.allowedCalls,
        capitalToken,
        capitalAmount: props.capitalAmount,
        purpose: props.purpose,
        expiry,
      });

      setStatus("verifying");
      const response = await fetch("/api/testnet?route=execution-capital-verify-passkey", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ request_id: props.requestId, user_execution_wallet: granted.walletAddress, signer_address: granted.signerAddress, session_key_id: granted.sessionKeyId, session_expiry: granted.expiry, session_grant_tx_hash: granted.transactionHash }),
      });
      const body = await response.json() as { ok?: boolean; authorized?: boolean; request?: unknown; error?: string };
      if (!response.ok || !body.authorized) throw new Error(body.error || "AgentMarket could not independently verify the Altana session.");

      setWalletAddress(granted.walletAddress);
      setSessionKeyId(granted.sessionKeyId);
      setStatus("authorized");
      props.onAuthorized?.({ requestId: props.requestId, sessionKeyId: granted.sessionKeyId, walletAddress: granted.walletAddress, transactionHash: granted.transactionHash });
      void symbol;
    } catch (cause) {
      setStatus("error");
      setError(cause instanceof Error ? cause.message : "Altana session authorization failed");
    }
  }

  const symbol = props.capitalSymbol || "execution token";
  const statusText = status === "checking"
    ? "Checking Testnet fee and execution wallet…"
    : status === "funding_capital"
      ? `Fund ${props.capitalAmount.toString()} ${symbol} to your Altana execution wallet…`
      : status === "approving_allowance"
        ? `Approve ${props.capitalAmount.toString()} ${symbol} router allowance in your Altana wallet…`
        : status === "signing"
          ? "Waiting for Passkey approval…"
          : status === "verifying"
            ? "Verifying onchain authority…"
            : status === "authorized"
              ? "Authorized and independently verified ✓"
              : `Approve the agent's ${symbol} trading authority`;

  return (
    <section className="border border-line rounded-[16px_8px_18px_9px] bg-paper p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <small className="block font-mono text-[8.5px] uppercase tracking-widest text-brass mb-1.5">Execution Capital · Altana Session</small>
          <h3 className="font-display text-[18px] font-bold m-0">Approve the agent's trading authority</h3>
          <p className="text-[11px] text-inksoft mt-1.5 max-w-[600px]">Your Altana Passkey wallet is the execution wallet you control. AgentMarket reads the token declared by the selected agent, tops up only the missing amount from your connected wallet, approves the declared spender, and then grants the scoped session.</p>
        </div>
        <span className={`font-mono text-[9px] px-2.5 py-1 rounded-lg ${status === "authorized" ? "status-green" : "status-brass"}`}>BSC TESTNET</span>
      </div>

      <div className="grid sm:grid-cols-2 gap-3 mt-5">
        <div className="border border-line rounded-[12px_7px_13px_8px] bg-paperhi p-3.5"><small className="block font-mono text-[8px] uppercase text-[#8a8477] mb-1">Execution capital required</small><strong className="font-mono text-[11px]">{props.capitalAmount.toString()} {symbol}</strong></div>
        <div className="border border-line rounded-[12px_7px_13px_8px] bg-paperhi p-3.5"><small className="block font-mono text-[8px] uppercase text-[#8a8477] mb-1">Token</small><strong className="font-mono text-[10px] break-all">{props.capitalToken || TESTNET_U_TOKEN}</strong></div>
        <div className="border border-line rounded-[12px_7px_13px_8px] bg-paperhi p-3.5"><small className="block font-mono text-[8px] uppercase text-[#8a8477] mb-1">Duration</small><strong className="font-mono text-[11px]">{Math.round(props.durationSeconds / 3600)}h</strong></div>
        <div className="border border-line rounded-[12px_7px_13px_8px] bg-paperhi p-3.5"><small className="block font-mono text-[8px] uppercase text-[#8a8477] mb-1">Session key</small><strong className="font-mono text-[11px]">{compact(props.agentSessionAddress)}</strong></div>
      </div>

      {feeReadiness && (
        <div className={`mt-4 border rounded-[12px_7px_13px_8px] px-4 py-3 text-[10.5px] ${feeReadiness.sufficientForRegistration ? "border-green/30 bg-green/5" : "border-[#cfad9f] bg-rustsoft text-rust"}`}>
          <strong className="block mb-1">Testnet registration fee check</strong>
          <div>Altana wallet: <span className="font-mono">{compact(feeReadiness.walletAddress)}</span></div>
          <div>Native tBNB balance: <span className="font-mono">{feeReadiness.nativeBalanceFormatted}</span></div>
          <div>KeyStore fee per registration: <span className="font-mono">{feeReadiness.registrationFeeFormatted} tBNB</span></div>
          <div>Minimum for first admin + session registration: <span className="font-mono">{feeReadiness.minimumRegistrationValueFormatted} tBNB</span></div>
        </div>
      )}

      <div className="mt-4 border border-line rounded-[12px_7px_13px_8px] bg-paperhi p-4">
        <small className="block font-mono text-[8px] uppercase text-[#8a8477] mb-2">Execution funding</small>
        <div className="text-[10.5px] text-inksoft leading-5">AgentMarket checks the execution-wallet balance and your connected-wallet balance for the declared token. When the Altana wallet is short, the exact missing amount is prepared as a wallet-signed ERC-20 transfer. If it already has enough, no transfer is sent.</div>
        {capitalTxHash && <a className="inline-block mt-2 text-[9px] font-mono text-brass break-all" href={`https://testnet.bscscan.com/tx/${capitalTxHash}`} target="_blank" rel="noreferrer">Execution-capital transfer ↗</a>}
      </div>

      <div className="mt-4 border border-line rounded-[12px_7px_13px_8px] bg-paperhi p-4">
        <small className="block font-mono text-[8px] uppercase text-[#8a8477] mb-2">Router allowance</small>
        <div className="text-[10.5px] text-inksoft leading-5">After funding, the Altana wallet approves the declared execution spender for exactly the requested capital. This remains an Altana-wallet authorization.</div>
        {props.approvalSpender && <div className="mt-2 font-mono text-[9px] break-all">Spender: {props.approvalSpender}</div>}
        {allowanceTxHash && <a className="inline-block mt-2 text-[9px] font-mono text-brass break-all" href={`https://testnet.bscscan.com/tx/${allowanceTxHash}`} target="_blank" rel="noreferrer">Router allowance approval ↗</a>}
      </div>

      <div className="mt-4 border border-line rounded-[12px_7px_13px_8px] bg-paperhi p-4">
        <small className="block font-mono text-[8px] uppercase text-[#8a8477] mb-2">Contract allowlist</small>
        <div className="flex flex-wrap gap-2">{props.allowedCalls.map((address) => <span key={address} className="font-mono text-[9px] px-2 py-1 rounded-md border border-line">{compact(address)}</span>)}</div>
        <small className="block font-mono text-[8px] uppercase text-[#8a8477] mb-2 mt-4">Function selector allowlist</small>
        <div className="flex flex-wrap gap-2">{props.allowedSelectors.map((value) => <span key={value} className="font-mono text-[9px] px-2 py-1 rounded-md border border-line">{compactHex(value)}</span>)}</div>
      </div>

      {props.capabilitySource && <div className="mt-4 text-[9px] font-mono text-inksoft break-all">Capability source: {props.capabilitySource}</div>}
      {walletAddress && sessionKeyId && <div className="mt-4 border border-green/30 bg-green/5 rounded-[12px_7px_13px_8px] px-4 py-3 text-[11px]"><strong className="text-green">{statusText}</strong><div className="mt-1 font-mono text-[9px]">Altana wallet {compact(walletAddress)} · Agent key {compact(sessionKeyId)}</div></div>}
      {error && <div className="mt-4 border border-[#cfad9f] bg-rustsoft text-rust rounded-[12px_7px_13px_8px] px-4 py-3 text-[11px]">{error}</div>}

      <button type="button" onClick={() => void grant()} disabled={status === "checking" || status === "funding_capital" || status === "approving_allowance" || status === "signing" || status === "verifying" || status === "authorized"} className="mt-5 font-display font-bold text-[12px] px-5 py-3 bg-ink text-paperhi btn-asym">{statusText} →</button>
      <p className="mt-3 text-[10px] text-inksoft">AgentMarket never receives a private key or custody of execution capital. Token transfers and Altana approvals require explicit user-controlled wallet/Passkey signatures.</p>
    </section>
  );
}
