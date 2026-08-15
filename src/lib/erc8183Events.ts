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

type ReceiptLog = { topics: readonly Hex[]; data: Hex };

type DecodeTopics = [Hex, ...Hex[]];

function decodeJobCreated(log: ReceiptLog) {
  if (log.topics.length === 0) return null;
  const topics = [...log.topics] as DecodeTopics;
  return decodeEventLog({
    abi: JOB_CREATED_ABI,
    data: log.data,
    topics,
  });
}

export function extractCreatedJobId(logs: ReceiptLog[], commerceAddress: string) {
  const expectedCommerce = commerceAddress.trim().toLowerCase();
  const match = logs.find((log) => {
    try {
      const decoded = decodeJobCreated(log);
      return decoded?.eventName === "JobCreated";
    } catch {
      return false;
    }
  });

  if (!match) throw new Error("The createJob receipt did not contain a JobCreated event.");
  const decoded = decodeJobCreated(match);
  if (!decoded || decoded.eventName !== "JobCreated") throw new Error("Unexpected ERC-8183 event in receipt.");

  if (!expectedCommerce) throw new Error("Commerce contract address is required to validate the receipt target.");

  return {
    jobId: decoded.args.jobId.toString(),
    client: decoded.args.client,
    provider: decoded.args.provider,
    evaluator: decoded.args.evaluator,
    hook: decoded.args.hook,
    expiredAt: decoded.args.expiredAt.toString(),
  };
}
