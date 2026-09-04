import { useState } from "react";
import type { Address, Hex } from "viem";
import { getAltanaGrantFeeReadiness, grantAltanaExecutionSession } from "./lib/altanaSession";
import { ensureAltanaWallet, fundAltanaTradingCapital } from "./lib/altanaWallet";
import { getAltanaWalletResolution } from "./lib/altanaWallet";
import AltanaWalletGate from "./AltanaWalletGate";
import { ensureAltanaTokenAllowance } from "./lib/altanaAllowance";

function GrantPill({ label }: { label: string }) {
  return <span className="inline-flex items-center gap-1 rounded-full border border-brasslt bg-[#fbf4db] px-2.5 py-1 font-mono text-[9px] text-[#765f19]"><span aria-hidden="true">✓</span>{label}</span>;
}

export type AltanaSessionGrantGateProps = {
  requestId: string;
  agentSessionAddress: Address;
  agentSessionPublicKey: Hex;
  allowedCalls: readonly Address[];
  allowedSelectors: readonly Hex[];
  capitalAmount: bigint;
  /** Exact execution token declared by the agent capability and stored on the request. */
  capitalToken: Address;
  capitalSymbol?: string;
  capitalDecimals?: number;
  approvalSpender?: Address;
  purpose: string;
  durationSeconds: number;
  capabilitySource?: string;
  renewal?: boolean;
  onAuthorized?: (value: { requestId: string; sessionKeyId: Hex; walletAddress: Address; transactionHash?: Hex }) => void;
};

function compact(address: string) { return `${address.slice(0, 6)}…${address.slice(-4)}`; }
function compactHex(value: string) { return value.length > 14 ? `${value.slice(0, 10)}…${value.slice(-4)}` : value; }

export default function AltanaSessionGrantGate(props: AltanaSessionGrantGateProps) {
  const [reviewed, setReviewed] = useState(false);
  const [walletReady, setWalletReady] = useState(() => Boolean(getAltanaWalletResolution()));
  const [status, setStatus] = useState<"idle" | "checking" | "signing" | "verifying" | "funding_capital" | "approving_allowance" | "authorized" | "error">("idle");
  const [error, setError] = useState("");
  const [sessionKeyId, setSessionKeyId] = useState("");
  const [walletAddress, setWalletAddress] = useState("");
  const [capitalTxHash, setCapitalTxHash] = useState("");
  const [allowanceTxHash, setAllowanceTxHash] = useState("");
  const [feeReadiness, setFeeReadiness] = useState<Awaited<ReturnType<typeof getAltanaGrantFeeReadiness>> | null>(null);

  async function grant() {
    if (!walletReady) {
      setError("Create or recover the Altana Passkey wallet before authorizing the agent.");
      return;
    }
    setStatus("checking");
    setError("");
    setCapitalTxHash("");
    setAllowanceTxHash("");
    try {
      const executionWallet = ensureAltanaWallet();
      if (!/^0x[a-fA-F0-9]{40}$/.test(props.capitalToken)) throw new Error("The agent did not provide a valid execution-capital token address. Authorization cannot continue.");
      const decimals = props.capitalDecimals ?? 18;
      if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) throw new Error("Execution token decimals are invalid.");
      const rawCapitalAmount = props.capitalAmount * 10n ** BigInt(decimals);
      if (rawCapitalAmount <= 0n) throw new Error("Execution-capital amount must be greater than zero.");
      const symbol = props.capitalSymbol || "execution token";
      const approvalSpender = props.approvalSpender || (props.allowedCalls.length === 1 ? props.allowedCalls[0] : null);
      if (!approvalSpender) throw new Error("A single execution spender must be identified before requesting an ERC-20 allowance.");

      const readiness = await getAltanaGrantFeeReadiness();
      setFeeReadiness(readiness);
      if (!readiness.sufficientForRegistration) throw new Error(`Altana wallet ${readiness.walletAddress} has ${readiness.nativeBalanceFormatted} tBNB. This first-time session grant needs at least ${readiness.minimumRegistrationValueFormatted} tBNB for KeyStore registration fees, plus any relay/gas costs.`);

      // The Passkey-controlled Altana wallet is the owner authority. The scoped
      // agent session is granted and verified before any trading capital moves.
      setStatus("signing");
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
      const response = await fetch("/api/testnet?route=execution-capital-verify-passkey", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          request_id: props.requestId,
          renewal: props.renewal === true,
          user_execution_wallet: granted.walletAddress,
          signer_address: granted.signerAddress,
          session_key_id: granted.sessionKeyId,
          session_expiry: granted.expiry,
          session_grant_tx_hash: granted.transactionHash,
          capital_token: props.capitalToken,
          capital_amount_raw: rawCapitalAmount.toString(),
          capital_funding_tx_hash: null,
          allowance_tx_hash: null,
          allowance_spender: approvalSpender,
        }),
      });
      const body = await response.json() as { ok?: boolean; authorized?: boolean; error?: string };
      if (!response.ok || !body.authorized) throw new Error(body.error || "AgentMarket could not independently verify the Altana session.");

      // Trading capital is deliberately funded only after the Passkey grant has
      // been confirmed in the on-chain KeyStore.
      setStatus("funding_capital");
      const capitalFunding = await fundAltanaTradingCapital(executionWallet.walletAddress, props.capitalToken, rawCapitalAmount);
      if (capitalFunding.token.toLowerCase() !== props.capitalToken.toLowerCase()) throw new Error("The funding helper returned a different token address than the execution-capital request.");
      if (capitalFunding.transactionHash) setCapitalTxHash(capitalFunding.transactionHash);

      setStatus("approving_allowance");
      const allowance = await ensureAltanaTokenAllowance(props.capitalToken, approvalSpender, rawCapitalAmount);
      if (allowance.token.toLowerCase() !== props.capitalToken.toLowerCase()) throw new Error("The allowance helper returned a different token address than the execution-capital request.");
      if (allowance.transactionHash) setAllowanceTxHash(allowance.transactionHash);

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
  const statusText = status === "checking" ? "Checking Altana wallet and request scope…" : status === "signing" ? "Waiting for Passkey approval…" : status === "verifying" ? "AgentMarket is verifying the Altana grant on-chain…" : status === "funding_capital" ? `Fund ${props.capitalAmount.toString()} ${symbol} to your Altana execution wallet…` : status === "approving_allowance" ? `Approve ${props.capitalAmount.toString()} ${symbol} router allowance in your Altana wallet…` : status === "authorized" ? "Authorized and independently verified ✓" : props.renewal ? `Authorize a fresh ${symbol} session for this job` : `Approve the agent's ${symbol} trading authority`;

  return (
    <section className="border border-line rounded-[16px_8px_18px_9px] bg-paper p-5">
      <div className="flex items-start justify-between gap-4"><div><small className="block font-mono text-[8.5px] uppercase tracking-widest text-brass mb-1.5">Execution Capital · Altana Session</small><h3 className="font-display text-[18px] font-bold m-0">{props.renewal ? "Renew the job's trading authority" : "Authorize this agent to execute"}</h3><p className="text-[11px] text-inksoft mt-1.5 max-w-[600px]">Your Passkey owns the Altana wallet. This job gets a separate, expiring agent session limited to the exact token, spend cap, contracts, and function selectors shown below.</p></div><span className={`font-mono text-[9px] px-2.5 py-1 rounded-lg ${status === "authorized" ? "status-green" : "status-brass"}`}>BSC TESTNET</span></div>

      {!walletReady && status === "idle" && (
        <div className="mt-5">
          <AltanaWalletGate onResolved={() => setWalletReady(true)} />
        </div>
      )}

      {walletReady && (
        <>
          <div className="mt-5 border border-green/20 bg-green/5 rounded-[12px_7px_13px_8px] px-4 py-3 text-[11px]"><strong className="text-green">Altana Passkey wallet ready ✓</strong><div className="mt-1 text-inksoft">The wallet owner authority is ready. Next, review and sign the job-scoped agent session.</div></div>
          <div className="grid sm:grid-cols-2 gap-3 mt-4">
            <div className="border border-line rounded-[12px_7px_13px_8px] bg-paperhi p-3.5"><small className="block font-mono text-[8px] uppercase text-[#8a8477] mb-1">Execution capital requested</small><strong className="font-mono text-[11px]">{props.capitalAmount.toString()} {symbol}</strong></div>
            <div className="border border-line rounded-[12px_7px_13px_8px] bg-paperhi p-3.5"><small className="block font-mono text-[8px] uppercase text-[#8a8477] mb-1">Exact token</small><strong className="font-mono text-[10px] break-all">{props.capitalToken}</strong></div>
            <div className="border border-line rounded-[12px_7px_13px_8px] bg-paperhi p-3.5"><small className="block font-mono text-[8px] uppercase text-[#8a8477] mb-1">Duration</small><strong className="font-mono text-[11px]">{Math.round(props.durationSeconds / 3600)}h</strong></div>
            <div className="border border-line rounded-[12px_7px_13px_8px] bg-paperhi p-3.5"><small className="block font-mono text-[8px] uppercase text-[#8a8477] mb-1">Agent session</small><strong className="font-mono text-[11px]">{compact(props.agentSessionAddress)}</strong></div>
          </div>
          {feeReadiness && <div className={`mt-4 border rounded-[12px_7px_13px_8px] px-4 py-3 text-[10.5px] ${feeReadiness.sufficientForRegistration ? "border-green/30 bg-green/5" : "border-[#cfad9f] bg-rustsoft text-rust"}`}><strong className="block mb-1">Passkey wallet fee check</strong><div>Altana wallet: <span className="font-mono">{compact(feeReadiness.walletAddress)}</span></div><div>Native tBNB balance: <span className="font-mono">{feeReadiness.nativeBalanceFormatted}</span></div><div>KeyStore fee per registration: <span className="font-mono">{feeReadiness.registrationFeeFormatted} tBNB</span></div><div>Minimum for first admin + session registration: <span className="font-mono">{feeReadiness.minimumRegistrationValueFormatted} tBNB</span></div></div>}
          <div className="mt-4 border border-line rounded-[12px_7px_13px_8px] bg-paperhi p-4"><small className="block font-mono text-[8px] uppercase text-[#8a8477] mb-2">Authorization sequence</small><div className="text-[10.5px] text-inksoft leading-5">1. Passkey wallet ready. 2. Review the exact agent scope. 3. Sign the scoped session with your Passkey. 4. AgentMarket verifies the session in KeyStore. 5. Only then fund execution capital and create the required allowance.</div>{capitalTxHash && <a className="inline-block mt-2 text-[9px] font-mono text-brass break-all" href={`https://testnet.bscscan.com/tx/${capitalTxHash}`} target="_blank" rel="noreferrer">Execution-capital transfer ↗</a>}</div>
          <div className="mt-4 border border-line rounded-[12px_7px_13px_8px] bg-paperhi p-4"><small className="block font-mono text-[8px] uppercase text-[#8a8477] mb-2">Router allowance</small><div className="text-[10.5px] text-inksoft leading-5">After the grant is verified, the Altana wallet approves the declared execution spender for exactly the requested amount of the same token address.</div>{props.approvalSpender && <div className="mt-2 font-mono text-[9px] break-all">Spender: {props.approvalSpender}</div>}{allowanceTxHash && <a className="inline-block mt-2 text-[9px] font-mono text-brass break-all" href={`https://testnet.bscscan.com/tx/${allowanceTxHash}`} target="_blank" rel="noreferrer">Router allowance approval ↗</a>}</div>
          <div className="mt-4 border border-line rounded-[12px_7px_13px_8px] bg-paperhi p-4"><small className="block font-mono text-[8px] uppercase text-[#8a8477] mb-2">Contract allowlist</small><div className="flex flex-wrap gap-2">{props.allowedCalls.map((address) => <span key={address} className="font-mono text-[9px] px-2 py-1 rounded-md border border-line">{compact(address)}</span>)}</div><small className="block font-mono text-[8px] uppercase text-[#8a8477] mb-2 mt-4">Function selector allowlist</small><div className="flex flex-wrap gap-2">{props.allowedSelectors.map((value) => <span key={value} className="font-mono text-[9px] px-2 py-1 rounded-md border border-line">{compactHex(value)}</span>)}</div></div>
          {!reviewed && status === "idle" && <div className="mt-4 border border-brasslt/60 bg-[#fbf4db]/40 rounded-[12px_7px_13px_8px] p-4"><strong className="block font-display text-[13px] mb-2">This is what the agent is asking for — review before signing</strong><div className="flex flex-wrap gap-2 mb-3"><GrantPill label="Spend cap"/><GrantPill label="Call allowlist"/><GrantPill label="Expiry"/><GrantPill label="Revocation"/></div><p className="text-[10.5px] text-inksoft leading-5">Nothing is authorized yet. The exact token, spend amount, contract allowlist, and expiry shown above are the terms your Passkey will authorize.</p><button type="button" onClick={() => setReviewed(true)} className="mt-4 font-display font-bold text-[12px] px-5 py-3 border border-ink bg-paperhi text-ink btn-asym">I've reviewed this scope →</button></div>}
          {props.capabilitySource && <div className="mt-4 text-[9px] font-mono text-inksoft break-all">Capability source: {props.capabilitySource}</div>}
          {walletAddress && sessionKeyId && <div className="mt-4 border border-green/30 bg-green/5 rounded-[12px_7px_13px_8px] px-4 py-3 text-[11px]"><strong className="text-green">{statusText}</strong><div className="mt-1 font-mono text-[9px]">Altana wallet {compact(walletAddress)} · Agent key {compact(sessionKeyId)}</div></div>}
          {error && <div className="mt-4 border border-[#cfad9f] bg-rustsoft text-rust rounded-[12px_7px_13px_8px] px-4 py-3 text-[11px]">{error}</div>}
          {(reviewed || status !== "idle") && <button type="button" onClick={() => void grant()} disabled={status === "checking" || status === "signing" || status === "verifying" || status === "funding_capital" || status === "approving_allowance" || status === "authorized"} className="mt-5 font-display font-bold text-[12px] px-5 py-3 bg-ink text-paperhi btn-asym">{statusText} →</button>}
        </>
      )}
      <p className="mt-3 text-[10px] text-inksoft">AgentMarket never receives a private key or custody of execution capital. Your Passkey controls the Altana wallet; the agent receives only the job-scoped, expiring authority you approve.</p>
    </section>
  );
}
