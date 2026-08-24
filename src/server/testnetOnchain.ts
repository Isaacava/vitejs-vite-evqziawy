import { createPublicClient, http, type Address, type Hex } from "viem";
import { bscTestnet } from "viem/chains";

const CHAIN_ID = 97 as const;
const NETWORK = "bsc-testnet" as const;
const RPC_URL = process.env.BSC_TESTNET_RPC_URL || "https://bsc-testnet-rpc.publicnode.com";
const IDENTITY_REGISTRY = "0x8004A818BFB912233c491871b3d84c89A494BD9e" as Address;
const REPUTATION_REGISTRY = "0x8004B663056A597Dffe9eCcC1965A193B7388713" as Address;
const COMMERCE = "0xa206c0517b6371c6638cd9e4a42cc9f02a33b0de" as Address;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as Address;
const CACHE_TTL_MS = 30_000;

const IDENTITY_ABI = [
  { type: "function", name: "ownerOf", stateMutability: "view", inputs: [{ name: "agentId", type: "uint256" }], outputs: [{ name: "", type: "address" }] },
  { type: "function", name: "getAgentWallet", stateMutability: "view", inputs: [{ name: "agentId", type: "uint256" }], outputs: [{ name: "", type: "address" }] },
  { type: "function", name: "tokenURI", stateMutability: "view", inputs: [{ name: "agentId", type: "uint256" }], outputs: [{ name: "", type: "string" }] },
] as const;

const REPUTATION_ABI = [
  { type: "function", name: "getClients", stateMutability: "view", inputs: [{ name: "agentId", type: "uint256" }], outputs: [{ name: "", type: "address[]" }] },
  {
    type: "function",
    name: "getSummary",
    stateMutability: "view",
    inputs: [
      { name: "agentId", type: "uint256" },
      { name: "clientAddresses", type: "address[]" },
      { name: "tag1", type: "string" },
      { name: "tag2", type: "string" },
    ],
    outputs: [
      { name: "count", type: "uint64" },
      { name: "summaryValue", type: "int128" },
      { name: "summaryValueDecimals", type: "uint8" },
    ],
  },
] as const;

const JOB_ABI = [
  { type: "function", name: "jobCounter", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  {
    type: "function",
    name: "getJob",
    stateMutability: "view",
    inputs: [{ name: "jobId", type: "uint256" }],
    outputs: [{
      name: "job",
      type: "tuple",
      components: [
        { name: "id", type: "uint256" },
        { name: "client", type: "address" },
        { name: "provider", type: "address" },
        { name: "evaluator", type: "address" },
        { name: "description", type: "string" },
        { name: "budget", type: "uint256" },
        { name: "expiredAt", type: "uint256" },
        { name: "status", type: "uint8" },
        { name: "hook", type: "address" },
        { name: "submittedAt", type: "uint256" },
        { name: "deliverable", type: "bytes32" },
      ],
    }],
  },
] as const;

const publicClient = createPublicClient({ chain: bscTestnet, transport: http(RPC_URL) });
const looseReadContract = (args: Record<string, unknown>) =>
  (publicClient.readContract as unknown as (value: Record<string, unknown>) => Promise<any>)(args);

type JobStatus = "open" | "funded" | "submitted" | "completed" | "rejected" | "expired" | "unknown";

type RawJob = {
  id: bigint;
  client: Address;
  provider: Address;
  evaluator: Address;
  description: string;
  budget: bigint;
  expiredAt: bigint;
  status: number;
  submittedAt: bigint;
  deliverable: Hex;
};

export type OnchainJob = {
  chain_job_id: string;
  client: Address;
  provider: Address;
  evaluator: Address;
  description: string;
  budget: string;
  expired_at: string;
  submitted_at: string;
  status: number;
  chain_status: JobStatus;
  deliverable: Hex;
  transaction_hash?: Hex;
  block_number?: string;
};

export type OnchainAgentStats = {
  agent_id: string;
  owner: Address;
  agent_wallet: Address;
  agent_uri: string | null;
  job_provider_addresses: Address[];
  total_jobs: number;
  completed_jobs: number;
  submitted_jobs: number;
  funded_jobs: number;
  open_jobs: number;
  rejected_jobs: number;
  expired_jobs: number;
  terminal_jobs: number;
  success_rate: number | null;
  feedback_count: number;
  reputation_value: string | null;
  reputation_decimals: number | null;
  reputation_score: number | null;
  jobs: OnchainJob[];
  source: "erc8004_identity+erc8183_commerce";
  network: typeof NETWORK;
  chain_id: typeof CHAIN_ID;
};

let allJobsCache: { expiresAt: number; jobs: OnchainJob[]; counter: bigint } | null = null;
let allJobsPromise: Promise<OnchainJob[]> | null = null;

function statusName(status: number): JobStatus {
  return ({ 0: "open", 1: "funded", 2: "submitted", 3: "completed", 4: "rejected", 5: "expired" } as Record<number, JobStatus>)[status] || "unknown";
}

function toDateString(seconds: bigint) {
  return seconds > 0n ? new Date(Number(seconds) * 1000).toISOString() : "";
}

function normalizeReputation(value: bigint, decimals: number) {
  const numberValue = Number(value) / 10 ** decimals;
  if (!Number.isFinite(numberValue) || numberValue < 0 || numberValue > 100) return null;
  return Number(numberValue.toFixed(4));
}

async function readIdentity(agentId: bigint) {
  const [owner, wallet, uri] = await publicClient.multicall({
    contracts: [
      { address: IDENTITY_REGISTRY, abi: IDENTITY_ABI, functionName: "ownerOf", args: [agentId] },
      { address: IDENTITY_REGISTRY, abi: IDENTITY_ABI, functionName: "getAgentWallet", args: [agentId] },
      { address: IDENTITY_REGISTRY, abi: IDENTITY_ABI, functionName: "tokenURI", args: [agentId] },
    ],
    allowFailure: true,
  });
  const resolvedOwner = owner.status === "success" ? owner.result as Address : undefined;
  const configuredWallet = wallet.status === "success" ? wallet.result as Address : undefined;
  const resolvedUri = uri.status === "success" ? uri.result : undefined;
  if (!resolvedOwner) throw new Error(`ERC-8004 agent ${agentId.toString()} does not exist on the Testnet Identity Registry`);
  const agentWallet = configuredWallet && configuredWallet.toLowerCase() !== ZERO_ADDRESS ? configuredWallet : resolvedOwner;
  return { owner: resolvedOwner, agentWallet, agentUri: typeof resolvedUri === "string" ? resolvedUri : null };
}

async function readReputation(agentId: bigint) {
  const clients = await looseReadContract({ address: REPUTATION_REGISTRY, abi: REPUTATION_ABI, functionName: "getClients", args: [agentId] }) as Address[];
  if (!clients.length) return { feedbackCount: 0, reputationValue: null, reputationDecimals: null, reputationScore: null };
  const summary = await looseReadContract({ address: REPUTATION_REGISTRY, abi: REPUTATION_ABI, functionName: "getSummary", args: [agentId, clients, "", ""] }) as readonly [bigint, bigint, number];
  const [count, value, decimals] = summary;
  return { feedbackCount: Number(count), reputationValue: value.toString(), reputationDecimals: Number(decimals), reputationScore: normalizeReputation(value, Number(decimals)) };
}

async function loadAllCommerceJobs(): Promise<OnchainJob[]> {
  if (allJobsCache && allJobsCache.expiresAt > Date.now()) return allJobsCache.jobs;
  if (allJobsPromise) return allJobsPromise;

  allJobsPromise = (async () => {
    const counter = BigInt(await looseReadContract({ address: COMMERCE, abi: JOB_ABI, functionName: "jobCounter" }));
    const ids: bigint[] = [];
    for (let id = 0n; id <= counter; id += 1n) ids.push(id);

    const jobs: OnchainJob[] = [];
    for (let start = 0; start < ids.length; start += 100) {
      const chunk = ids.slice(start, start + 100);
      const results = await publicClient.multicall({
        contracts: chunk.map((jobId) => ({ address: COMMERCE, abi: JOB_ABI, functionName: "getJob" as const, args: [jobId] })),
        allowFailure: true,
      });
      results.forEach((result, index) => {
        if (result.status !== "success") return;
        const job = result.result as RawJob;
        if (!job || job.id === 0n) return;
        jobs.push({
          chain_job_id: job.id.toString(),
          client: job.client,
          provider: job.provider,
          evaluator: job.evaluator,
          description: job.description,
          budget: job.budget.toString(),
          expired_at: toDateString(job.expiredAt),
          submitted_at: toDateString(job.submittedAt),
          status: Number(job.status),
          chain_status: statusName(Number(job.status)),
          deliverable: job.deliverable,
        });
      });
    }

    jobs.sort((a, b) => Number(BigInt(b.chain_job_id) - BigInt(a.chain_job_id)));
    allJobsCache = { expiresAt: Date.now() + CACHE_TTL_MS, jobs, counter };
    return jobs;
  })();

  try {
    return await allJobsPromise;
  } finally {
    allJobsPromise = null;
  }
}

export async function readAgentOnchainStats(agentIdValue: string | number) {
  const agentId = BigInt(String(agentIdValue).trim());
  if (agentId < 0n) throw new Error("agentId must be non-negative");

  const [identity, reputation, allJobs] = await Promise.all([
    readIdentity(agentId),
    readReputation(agentId),
    loadAllCommerceJobs(),
  ]);

  const providers = new Set([identity.agentWallet.toLowerCase(), identity.owner.toLowerCase()]);
  const jobs = allJobs.filter((job) => providers.has(job.provider.toLowerCase()));

  const counts = jobs.reduce((acc, job) => {
    acc.total += 1;
    if (job.chain_status === "completed") acc.completed += 1;
    if (job.chain_status === "submitted") acc.submitted += 1;
    if (job.chain_status === "funded") acc.funded += 1;
    if (job.chain_status === "open") acc.open += 1;
    if (job.chain_status === "rejected") acc.rejected += 1;
    if (job.chain_status === "expired") acc.expired += 1;
    if (["completed", "rejected", "expired"].includes(job.chain_status)) acc.terminal += 1;
    return acc;
  }, { total: 0, completed: 0, submitted: 0, funded: 0, open: 0, rejected: 0, expired: 0, terminal: 0 });

  return {
    agent_id: agentId.toString(),
    owner: identity.owner,
    agent_wallet: identity.agentWallet,
    agent_uri: identity.agentUri,
    job_provider_addresses: [...providers].map((address) => address as Address),
    total_jobs: counts.total,
    completed_jobs: counts.completed,
    submitted_jobs: counts.submitted,
    funded_jobs: counts.funded,
    open_jobs: counts.open,
    rejected_jobs: counts.rejected,
    expired_jobs: counts.expired,
    terminal_jobs: counts.terminal,
    success_rate: counts.terminal > 0 ? Number(((counts.completed / counts.terminal) * 100).toFixed(1)) : null,
    feedback_count: reputation.feedbackCount,
    reputation_value: reputation.reputationValue,
    reputation_decimals: reputation.reputationDecimals,
    reputation_score: reputation.reputationScore,
    jobs,
    source: "erc8004_identity+erc8183_commerce" as const,
    network: NETWORK,
    chain_id: CHAIN_ID,
  } satisfies OnchainAgentStats;
}
