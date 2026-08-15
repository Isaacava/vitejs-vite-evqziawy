import { useState } from "react";
import { sendAndConfirm, type PreparedTransaction } from "./lib/onchainExecutor";

export type ConfirmedRunnerReceipt = {
  hash: string;
  blockNumber: string;
  logs?: Array<{ topics: readonly `0x${string}`[]; data: `0x${string}` }>;
};

export type TransactionStep = {
  id: string;
  label: string;
  description: string;
  tx?: PreparedTransaction;
  disabled?: boolean;
};

type Props = {
  steps: TransactionStep[];
  onConfirmed?: (step: TransactionStep, receipt: ConfirmedRunnerReceipt) => void;
};

export default function OnchainTransactionRunner({ steps, onConfirmed }: Props) {
  const [running, setRunning] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, ConfirmedRunnerReceipt>>({});
  const [error, setError] = useState("");

  async function run(step: TransactionStep) {
    if (!step.tx || step.disabled) return;
    setRunning(step.id);
    setError("");
    try {
      const receipt = await sendAndConfirm(step.tx);
      const confirmed = receipt as ConfirmedRunnerReceipt;
      setResults((current) => ({ ...current, [step.id]: confirmed }));
      onConfirmed?.(step, confirmed);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Transaction failed");
    } finally {
      setRunning(null);
    }
  }

  return (
    <div className="console-plan-list">
      {error && <div className="console-alert console-alert-error">{error}</div>}
      {steps.map((step, index) => {
        const result = results[step.id];
        const isRunning = running === step.id;
        return (
          <article className="console-plan-row" key={step.id}>
            <div>
              <small>{String(index + 1).padStart(2, "0")} / {step.label}</small>
              <strong>{result ? "CONFIRMED" : step.tx && !step.disabled ? "READY" : "WAITING"}</strong>
            </div>
            <p>{step.description}</p>
            {step.tx && !result && (
              <button className="console-dark-button" disabled={Boolean(running) || step.disabled} onClick={() => void run(step)}>
                {isRunning ? "Waiting for wallet / receipt…" : `Confirm ${step.label} →`}
              </button>
            )}
            {result && <p className="console-evidence"><small>RECEIPT</small> {result.hash.slice(0, 10)}… confirmed in block {result.blockNumber}.</p>}
          </article>
        );
      })}
    </div>
  );
}
