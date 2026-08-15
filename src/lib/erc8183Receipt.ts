import { keccak256, toBytes } from "viem";
import type { ReceiptLog } from "./onchainExecutor";

const COMMERCE = "0xa206c0517b6371c6638cd9e4a42cc9f02a33b0de".toLowerCase();
const JOB_CREATED_TOPIC = keccak256(toBytes("JobCreated(uint256,address,address,address,uint256,address)"));

export function extractCreatedJobId(logs: ReceiptLog[]) {
  for (const log of logs) {
    if (log.address.toLowerCase() !== COMMERCE) continue;
    if (log.topics[0]?.toLowerCase() !== JOB_CREATED_TOPIC.toLowerCase()) continue;
    const indexedJobId = log.topics[1];
    if (!indexedJobId) continue;
    return BigInt(indexedJobId).toString();
  }
  return null;
}
