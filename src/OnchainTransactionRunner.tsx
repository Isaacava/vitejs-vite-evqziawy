import { useState } from "react";
import { sendAndConfirm, type PreparedTransaction } from "./lib/onchainExecutor";

export type TransactionStep = {
  id: string;
  label: string;
  description: string;
  tx?: PreparedTransaction;
  disabled?: boolean;
};

export default function OnchainTransactionRunner({ steps }: { steps: TransactionStep[] }) {
  const [running, setRunning] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, { hash: string; blockNumber: string }>>({});
  const [error, setError] = useState("");

  async function run(step: TransactionStep) {
    if (!step.tx || step.disabled) return;
    setRunning(step.id);
    setError("");
    try {
      const receipt = await sendAndConfirm(step.tx);
      setResults((current) => ({ ...current, [step.id]: receipt }));
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
              <strong>{result ? "CONFIRMED" : step.tx ? "READY" : "WAITING"}</strong>
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
