import type { ExecutionCapitalRequest } from "./lib/executionCapital";
import ExecutionCapitalCard from "./ExecutionCapitalCard";
import AltanaWalletGate from "./AltanaWalletGate";

type Props = {
  request: ExecutionCapitalRequest | null;
  jobBudget: string | number | null;
  jobCurrency: string;
};

export default function ExecutionCapitalPanel({ request, jobBudget, jobCurrency }: Props) {
  return (
    <div className="mb-6 space-y-4">
      <ExecutionCapitalCard request={request} jobBudget={jobBudget} jobCurrency={jobCurrency} />
      {request && request.status === "requested" && (
        <AltanaWalletGate />
      )}
    </div>
  );
}
