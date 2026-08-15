import { decodeEventLog, type Hex } from "viem";

const JOB_CREATED_ABI = [{
  type: "event",
  name: "JobCreated",
  inputs: [
    { name: "jobId", type: "uint256", indexed: true },
    { name: "client", type: "address", indexed: true },
    { name: "provider", type: "address", indexed: true },
    { name: "evaluator", type: "address", indexed: false },
    { name: "expiredAt", type: "uint256", indexed: false },
    { name: "hook", type: "address", indexed: false },
  ],
  anonymous: false,
}] as const;

export function extractCreatedJobId(logs: Array<{ topics: readonly Hex[]; data: Hex }>, commerceAddress: string) {
  const match = logs.find((log) => {
    try {
      const decoded = decodeEventLog({ abi: JOB_CREATED_ABI, data: log.data, topics: log.topics });
      return decoded.eventName === "JobCreated";
    } catch {
      return false;
    }
  });

  if (!match) throw new Error("The createJob receipt did not contain a JobCreated event.");
  const decoded = decodeEventLog({ abi: JOB_CREATED_ABI, data: match.data, topics: match.topics });
  if (decoded.eventName !== "JobCreated") throw new Error("Unexpected ERC-8183 event in receipt.");
  if (commerceAddress && commerceAddress.toLowerCase() !== "") {
    // Caller is responsible for checking the receipt's `to` address before calling this helper.
  }
  return {
    jobId: decoded.args.jobId.toString(),
    client: decoded.args.client,
    provider: decoded.args.provider,
    evaluator: decoded.args.evaluator,
    hook: decoded.args.hook,
    expiredAt: decoded.args.expiredAt.toString(),
  };
}
