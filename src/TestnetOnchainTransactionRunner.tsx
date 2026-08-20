import { useState } from "react";
import { getTestnetConnectedProvider } from "./lib/testnetWalletAuth";

export type TestnetPreparedTransaction = { to: string; data?: string; value?: string };
export type TestnetConfirmedReceipt = { hash: string; blockNumber: string; logs: Array<{ address: string; topics: readonly `0x${string}`[]; data: `0x${string}` }> };
export type TestnetTransactionStep = { id: string; label: string; description: string; tx?: TestnetPreparedTransaction; disabled?: boolean };

type Props = { steps: TestnetTransactionStep[]; onConfirmed?: (step: TestnetTransactionStep, receipt: TestnetConfirmedReceipt) => Promise<void> | void };
const TX_HASH = /^0x[a-fA-F0-9]{64}$/;
const WALLET_REQUEST_TIMEOUT_MS = 60000;

function readableWalletError(cause: unknown, fallback: string) {
  if (cause instanceof Error && cause.message) return cause.message;
  if (typeof cause === "string" && cause) return cause;
  if (cause && typeof cause === "object") {
    const candidate = cause as { message?: unknown; code?: unknown; data?: unknown };
    if (typeof candidate.message === "string" && candidate.message) return candidate.message;
    if (typeof candidate.data === "string" && candidate.data) return `Wallet/RPC error: ${candidate.data}`;
    if (candidate.code != null) return `Wallet/RPC error ${String(candidate.code)}`;
  }
  return fallback;
}

async function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: number | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = window.setTimeout(() => reject(new Error(message)), ms);
      }),
    ]);
  } finally {
    if (timer !== undefined) window.clearTimeout(timer);
  }
}

async function sendAndConfirm(tx: TestnetPreparedTransaction): Promise<TestnetConfirmedReceipt> {
  if (!/^0x[a-fA-F0-9]{40}$/.test(tx.to)) throw new Error("Testnet transaction target is not a valid address.");
  if (tx.data && !/^0x[0-9a-fA-F]*$/.test(tx.data)) throw new Error("Testnet transaction calldata is invalid.");

  const provider = getTestnetConnectedProvider();
  const chainRaw = String(await withTimeout(provider.request({ method: "eth_chainId" }), 15000, "WalletConnect did not respond with the Testnet chain. Reconnect the wallet and try again." )).toLowerCase();
  const chain = chainRaw.startsWith("0x") ? Number.parseInt(chainRaw.slice(2), 16) : Number(chainRaw);
  if (chain !== 97) throw new Error("Wallet must remain on BSC Testnet (chain 97) before signing.");

  const accounts = await withTimeout(provider.request({ method: "eth_accounts" }), 15000, "WalletConnect did not return an account. Reconnect the Testnet wallet and try again.") as string[];
  const from = accounts?.[0];
  if (!/^0x[a-fA-F0-9]{40}$/.test(from || "")) throw new Error("No valid Testnet wallet account is available for this transaction.");

  const request = {
    from,
    to: tx.to,
    ...(tx.data ? { data: tx.data } : {}),
    ...(tx.value ? { value: tx.value } : {}),
  };

  try {
    await withTimeout(
      provider.request({ method: "eth_estimateGas", params: [request] }),
      20000,
      "Testnet transaction preflight timed out. Reconnect the Testnet wallet and try again.",
    );
  } catch (cause) {
    throw new Error(`Testnet transaction preflight failed: ${readableWalletError(cause, "contract rejected the transaction")}`);
  }

  let hash: string;
  try {
    hash = String(
      await withTimeout(
        provider.request({ method: "eth_sendTransaction", params: [request] }),
        WALLET_REQUEST_TIMEOUT_MS,
        "WalletConnect did not return a transaction hash within 60 seconds. Check the Testnet wallet app, approve the request if it is waiting there, then reconnect and retry.",
      ),
    );
  } catch (cause) {
    throw new Error(`Wallet rejected or timed out on the Testnet transaction: ${readableWalletError(cause, "unknown wallet/RPC error")}`);
  }

  if (!TX_HASH.test(hash)) throw new Error("The wallet returned an invalid Testnet transaction hash.");
  const started = Date.now();
  while (Date.now() - started < 180000) {
    const receipt = await withTimeout(
      provider.request({ method: "eth_getTransactionReceipt", params: [hash] }),
      15000,
      "Testnet wallet/RPC did not return the transaction receipt. Reconnect and check the transaction on BscScan.",
    ) as null | { status?: string; blockNumber?: string; logs?: Array<{ address?: string; topics?: string[]; data?: string }> };
    if (receipt) {
      if (String(receipt.status || "").toLowerCase() !== "0x1") throw new Error(`Testnet transaction ${hash.slice(0, 10)}… reverted.`);
      if (!receipt.blockNumber) throw new Error("Confirmed Testnet transaction has no block number.");
      return { hash, blockNumber: BigInt(receipt.blockNumber).toString(), logs: (receipt.logs || []).map((log) => ({ address: log.address || "", topics: (log.topics || []) as readonly `0x${string}`[], data: (log.data || "0x") as `0x${string}` })) };
    }
    await new Promise((resolve) => window.setTimeout(resolve, 2500));
  }
  throw new Error("Testnet transaction confirmation timed out. Check the transaction on BscScan before retrying.");
}

export default function TestnetOnchainTransactionRunner({ steps, onConfirmed }: Props) {
  const [running, setRunning] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, TestnetConfirmedReceipt>>({});
  const [error, setError] = useState("");
  async function run(step: TestnetTransactionStep) {
    if (!step.tx || step.disabled) return;
    setRunning(step.id); setError("");
    try {
      const receipt = await sendAndConfirm(step.tx);
      setResults((current) => ({ ...current, [step.id]: receipt }));
      await onConfirmed?.(step, receipt);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Testnet transaction failed");
    } finally {
      setRunning(null);
    }
  }
  return <div className="console-plan-list">
    {error && <div className="console-alert console-alert-error">{error}</div>}
    {steps.map((step, index) => { const result = results[step.id]; const active = running === step.id; return <article className="console-plan-row" key={step.id}>
      <div><small>{String(index + 1).padStart(2, "0")} / {step.label}</small><strong>{result ? "CONFIRMED" : step.tx && !step.disabled ? "READY" : "WAITING"}</strong></div>
      <p>{step.description}</p>
      {step.tx && !result && <button className="console-dark-button" type="button" disabled={Boolean(running) || Boolean(step.disabled)} onClick={() => void run(step)}>{active ? "Waiting for wallet / receipt…" : `Confirm ${step.label} →`}</button>}
      {result && <p className="console-evidence"><small>TESTNET RECEIPT</small> {result.hash.slice(0, 12)}… confirmed in block {result.blockNumber}.</p>}
    </article>; })}
  </div>;
}
