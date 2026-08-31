import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createPublicClient, encodeFunctionData, formatUnits, http, parseEventLogs, parseUnits, type Address, type Hex } from "viem";
import { bscTestnet } from "viem/chains";
import { getAuthenticatedUser, serverClient } from "../../src/server/authHandlers.js";

const COMMERCE = "0xa206c0517b6371c6638cd9e4a42cc9f02a33b0de" as Address;
const ROUTER = "0x6d948b47614dbfbbf97a5e3fd9b410deeab44f17" as Address;
const POLICY = "0xc4f85d602235e14a45fd1d9794c4092af762b1a6" as Address;
const TESTNET_RPC_URL = "https://bsc-testnet-rpc.publicnode.com";
const COMMERCE_ABI = [
  { type: "function", name: "createJob", stateMutability: "nonpayable", inputs: [{ name: "provider", type: "address" }, { name: "evaluator", type: "address" }, { name: "expiredAt", type: "uint256" }, { name: "description", type: "string" }, { name: "hook", type: "address" }], outputs: [{ name: "jobId", type: "uint256" }] },
  { type: "function", name: "setBudget", stateMutability: "nonpayable", inputs: [{ name: "jobId", type: "uint256" }, { name: "amount", type: "uint256" }, { name: "optParams", type: "bytes" }], outputs: [] },
  { type: "function", name: "fund", stateMutability: "nonpayable", inputs: [{ name: "jobId", type: "uint256" }, { name: "expectedBudget", type: "uint256" }, { name: "optParams", type: "bytes" }], outputs: [] },
  { type: "event", name: "JobCreated", inputs: [{ name: "jobId", type: "uint256", indexed: true }, { name: "client", type: "address", indexed: true }, { name: "provider", type: "address", indexed: true }, { name: "evaluator", type: "address", indexed: false }, { name: "expiredAt", type: "uint256", indexed: false }, { name: "hook", type: "address", indexed: false }], anonymous: false },
] as const;
const ROUTER_ABI = [{ type: "function", name: "registerJob", stateMutability: "nonpayable", inputs: [{ name: "jobId", type: "uint256" }, { name: "policy", type: "address" }], outputs: [] }] as const;
const ERC20_ABI = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "allowance", stateMutability: "view", inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
] as const;
const TOKEN_ABI = [{ type: "function", name: "paymentToken", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] }] as const;
const JOB_READ_ABI = [{
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
}] as const;
const publicClient = createPublicClient({ chain: bscTestnet, transport: http(TESTNET_RPC_URL) });

function readContract(args: Record<string, unknown>) {
  return (publicClient.readContract as unknown as (value: Record<string, unknown>) => Promise<any>)(args);
}

function isValidAddress(value: unknown): value is Address {
  return typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value);
}

function isAltanaAgent(agent: Record<string, unknown>) {
  const metadata = agent.metadata && typeof agent.metadata === "object" ? agent.metadata as Record<string, unknown> : {};
  const execution = metadata.execution && typeof metadata.execution === "object" ? metadata.execution as Record<string, unknown> : {};
  const provider = typeof execution.wallet_provider === "string" ? execution.wallet_provider.toLowerCase() : "";
  return String(agent.agent_id || "").toLowerCase() === "grid-strategy" || provider === "altana";
}

function validActiveAltanaWallet(value: Record<string, unknown> | null): value is Record<string, unknown> & { wallet_address: Address } {
  return Boolean(
    value &&
    value.status === "active" &&
    Number(value.chain_id) === 97 &&
    String(value.wallet_provider).toLowerCase() === "altana" &&
    String(value.authorization_model).toLowerCase() === "passkey" &&
    isValidAddress(value.wallet_address),
  );
}

const phaseTarget: Record<string, Address | "payment_token"> = { create: COMMERCE, register: ROUTER, set_budget: COMMERCE, fund: COMMERCE, approve: "payment_token" };

async function syncReceipt(req: VercelRequest, res: VercelResponse, auth: Awaited<ReturnType<typeof getAuthenticatedUser>>) {
  const missionId = typeof req.body?.mission_id === "string" ? req.body.mission_id.trim() : "";
  const jobId = typeof req.body?.job_id === "string" ? req.body.job_id.trim() : "";
  const phase = typeof req.body?.phase === "string" ? req.body.phase.trim().toLowerCase() : "";
  const txHash = typeof req.body?.tx_hash === "string" ? req.body.tx_hash.trim() : "";
  let chainJobId = typeof req.body?.chain_job_id === "string" ? req.body.chain_job_id.trim() : "";
  if (!missionId || !jobId || !txHash || !(txHash.startsWith("0x") && txHash.length === 66) || !phaseTarget[phase]) return res.status(400).json({ error: "mission_id, job_id, phase and tx_hash are required" });
  const supabase = serverClient();
  const { data: mission, error: missionError } = await supabase.from("missions").select("id,user_id,status").eq("id", missionId).eq("user_id", auth.user.id).maybeSingle();
  if (missionError) throw new Error(missionError.message);
  if (!mission) return res.status(404).json({ error: "Mission not found" });
  const receipt = await publicClient.getTransactionReceipt({ hash: txHash as Hex });
  if (receipt.status !== "success") return res.status(409).json({ error: "Blockchain transaction reverted", tx_hash: txHash, status: receipt.status });
  const expectedTarget = phaseTarget[phase];
  const target = expectedTarget === "payment_token" ? await readContract({ address: COMMERCE, abi: TOKEN_ABI, functionName: "paymentToken" }) as Address : expectedTarget;
  if (!receipt.to || receipt.to.toLowerCase() !== target.toLowerCase()) return res.status(409).json({ error: "Transaction target does not match the requested testnet ERC-8183 phase", expected_target: target, actual_target: receipt.to });
  if (phase === "create" && !chainJobId) {
    const parsed = parseEventLogs({ abi: COMMERCE_ABI, eventName: "JobCreated", logs: receipt.logs, strict: false })[0];
    const args = parsed?.args as { jobId?: bigint; client?: Address; provider?: Address } | undefined;
    if (!args?.jobId) return res.status(409).json({ error: "createJob receipt is successful but no JobCreated event with jobId was found", tx_hash: txHash });
    if (args.client && args.client.toLowerCase() !== auth.user.wallet_address.toLowerCase()) return res.status(403).json({ error: "JobCreated client does not match the authenticated wallet" });
    chainJobId = args.jobId.toString();
  }
  const { data: job, error: jobError } = await supabase.from("jobs").select("id,mission_task_id,status,chain_job_id,chain_status").eq("id", jobId).maybeSingle();
  if (jobError) throw new Error(jobError.message);
  if (!job) return res.status(404).json({ error: "Marketplace job not found" });
  if (!chainJobId && job.chain_job_id != null) chainJobId = String(job.chain_job_id);
  if (!chainJobId && phase !== "create") return res.status(409).json({ error: "A confirmed chain job id is required for this Testnet phase" });
  const { data: task, error: taskError } = await supabase.from("mission_tasks").select("id,mission_id").eq("id", job.mission_task_id).eq("mission_id", mission.id).maybeSingle();
  if (taskError) throw new Error(taskError.message);
  if (!task) return res.status(403).json({ error: "Job does not belong to this mission" });
  let confirmedChainStatus = job.chain_status || "not_created";
  let confirmedJob: any = null;
  if (chainJobId) {
    confirmedJob = await readContract({ address: COMMERCE, abi: JOB_READ_ABI, functionName: "getJob", args: [BigInt(chainJobId)] });
    if (!confirmedJob || confirmedJob.id === 0n) return res.status(409).json({ error: "Chain job was not found", chain_job_id: chainJobId });
    if (confirmedJob.client.toLowerCase() !== auth.user.wallet_address.toLowerCase()) return res.status(403).json({ error: "Chain job client does not match the authenticated wallet" });
  }
  if (phase === "create") confirmedChainStatus = "created";
  else if (phase === "register") confirmedChainStatus = "registered";
  else if (phase === "set_budget") confirmedChainStatus = "budget_set";
  else if (phase === "fund") {
    if (!confirmedJob || Number(confirmedJob.status) !== 1) return res.status(409).json({ error: "Fund transaction confirmed, but Commerce job is not FUNDED", chain_job_id: chainJobId, onchain_status: confirmedJob ? Number(confirmedJob.status) : null });
    confirmedChainStatus = "funded";
  }
  const update: Record<string, unknown> = { chain_status: confirmedChainStatus, updated_at: new Date().toISOString() };
  if (chainJobId) update.chain_job_id = Number(chainJobId);
  const { data: updatedJob, error: updateError } = await supabase.from("jobs").update(update).eq("id", job.id).select("id,mission_task_id,status,chain_job_id,chain_status,updated_at").single();
  if (updateError) throw new Error(updateError.message);
  await supabase.from("user_activity").insert({ user_id: auth.user.id, mission_id: mission.id, job_id: job.id, type: "testnet_chain_receipt_confirmed", title: `${phase} testnet transaction confirmed`, description: `Verified on BSC Testnet: ${txHash}`, metadata: { phase, tx_hash: txHash, chain_job_id: chainJobId || null, block_number: receipt.blockNumber.toString(), receipt_status: receipt.status, chain_id: 97, environment: "testnet" } });
  return res.status(200).json({ ok: true, phase, network: "bsc-testnet", chain_id: 97, tx_hash: txHash, block_number: receipt.blockNumber.toString(), receipt_status: receipt.status, job: updatedJob, onchain_job: confirmedJob ? { id: confirmedJob.id.toString(), status: Number(confirmedJob.status), budget: confirmedJob.budget.toString(), provider: confirmedJob.provider, client: confirmedJob.client } : null, note: "Testnet-only endpoint. It never reads or writes against the production Mainnet ERC-8183 deployment." });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const auth = await getAuthenticatedUser(req);
  if (!auth) return res.status(401).json({ error: "Authentication required" });
  try {
    if (req.body?.action === "sync_receipt") return await syncReceipt(req, res, auth);
    const missionId = typeof req.body?.mission_id === "string" ? req.body.mission_id.trim() : "";
    const clientAddress = typeof req.body?.client_address === "string" ? req.body.client_address.trim() : "";
    const budget = typeof req.body?.budget === "string" ? req.body.budget.trim() : String(req.body?.budget ?? "");
    if (!missionId || !/^0x[a-fA-F0-9]{40}$/.test(clientAddress) || !budget) return res.status(400).json({ error: "mission_id, authenticated client_address and budget are required" });
    if (clientAddress.toLowerCase() !== auth.user.wallet_address.toLowerCase()) return res.status(403).json({ error: "client_address must match the authenticated wallet" });
    const supabase = serverClient();
    const { data: mission, error: missionError } = await supabase.from("missions").select("id,goal,status,budget,user_id").eq("id", missionId).eq("user_id", auth.user.id).maybeSingle();
    if (missionError) throw new Error(missionError.message);
    if (!mission) return res.status(404).json({ error: "Mission not found" });
    const { data: task, error: taskError } = await supabase.from("mission_tasks").select("id,agent_id,budget").eq("mission_id", mission.id).limit(1).maybeSingle();
    if (taskError) throw new Error(taskError.message);
    if (!task?.agent_id) return res.status(409).json({ error: "Mission has no assigned provider" });
    const { data: agent, error: agentError } = await supabase.from("agents").select("agent_id,owner,name,verification_status,status,metadata").eq("id", task.agent_id).maybeSingle();
    if (agentError) throw new Error(agentError.message);
    if (!agent?.owner || !/^0x[a-fA-F0-9]{40}$/.test(agent.owner)) return res.status(409).json({ error: "Selected provider has no valid wallet" });

    const executionWallet = (() => { return null as Record<string, unknown> | null; })();
    let activeAltanaWallet: Record<string, unknown> | null = null;
    if (isAltanaAgent(agent as Record<string, unknown>)) {
      const { data: wallet, error: walletError } = await supabase
        .from("altana_execution_wallets")
        .select("wallet_address,status,chain_id,wallet_provider,authorization_model")
        .eq("user_id", auth.user.id)
        .maybeSingle();
      if (walletError) throw new Error(walletError.message);
      if (!validActiveAltanaWallet(wallet as Record<string, unknown> | null)) {
        return res.status(409).json({ error: "An active BSC Testnet Altana execution wallet must be provisioned before creating this Grid job; the wallet is bound into the immutable ERC-8183 description." });
      }
      activeAltanaWallet = wallet;
    }
    void executionWallet;

    const token = await readContract({ address: COMMERCE, abi: TOKEN_ABI, functionName: "paymentToken" });
    const [decimals, symbol, balance, allowance] = await Promise.all([
      readContract({ address: token as Address, abi: ERC20_ABI, functionName: "decimals" }),
      readContract({ address: token as Address, abi: ERC20_ABI, functionName: "symbol" }),
      readContract({ address: token as Address, abi: ERC20_ABI, functionName: "balanceOf", args: [clientAddress as Address] }),
      readContract({ address: token as Address, abi: ERC20_ABI, functionName: "allowance", args: [clientAddress as Address, COMMERCE] }),
    ]);
    const rawBudget = parseUnits(budget, Number(decimals));
    const expiresAt = BigInt(Math.floor(Date.now() / 1000) + 60 * 60);
    const descriptionPayload: Record<string, unknown> = {
      marketplace: "AgentMarket",
      network: "bsc-testnet",
      chain_id: 97,
      mission_id: mission.id,
      goal: mission.goal,
      execution: isAltanaAgent(agent as Record<string, unknown>) && activeAltanaWallet
        ? {
            wallet_provider: "altana",
            authorization_model: "scoped_session",
            wallet_address: activeAltanaWallet.wallet_address,
            chain_id: 97,
          }
        : undefined,
    };
    const description = JSON.stringify(descriptionPayload);
    const createJobData = encodeFunctionData({ abi: COMMERCE_ABI, functionName: "createJob", args: [agent.owner as Address, ROUTER, expiresAt, description, ROUTER] });
    const registerTemplate = encodeFunctionData({ abi: ROUTER_ABI, functionName: "registerJob", args: [0n, POLICY] });
    const setBudgetTemplate = encodeFunctionData({ abi: COMMERCE_ABI, functionName: "setBudget", args: [0n, rawBudget, "0x"] });
    const fundTemplate = encodeFunctionData({ abi: COMMERCE_ABI, functionName: "fund", args: [0n, rawBudget, "0x"] });
    const { data: marketplaceJob, error: marketplaceJobError } = await supabase.from("jobs").select("id,status,chain_job_id").eq("mission_task_id", task.id).maybeSingle();
    if (marketplaceJobError) throw new Error(marketplaceJobError.message);
    return res.status(200).json({
      ok: true,
      network: "bsc-testnet",
      chain_id: 97,
      mission: { id: mission.id, status: mission.status },
      marketplace_job: marketplaceJob ? { id: marketplaceJob.id, status: marketplaceJob.status, chain_job_id: marketplaceJob.chain_job_id } : null,
      agent: { agent_id: agent.agent_id, name: agent.name, provider: agent.owner, status: agent.status, verification_status: agent.verification_status },
      commerce: { address: COMMERCE, evaluator: ROUTER, hook: ROUTER, default_policy: POLICY },
      payment: { token, symbol, decimals, budget_raw: rawBudget.toString(), balance_raw: String(balance), allowance_raw: String(allowance), balance_formatted: formatUnits(BigInt(balance), Number(decimals)), allowance_formatted: formatUnits(BigInt(allowance), Number(decimals)) },
      execution: activeAltanaWallet ? {
        wallet_address: activeAltanaWallet.wallet_address,
        wallet_provider: activeAltanaWallet.wallet_provider,
        authorization_model: activeAltanaWallet.authorization_model,
        bound_into_job_description: true,
      } : { wallet_address: null, bound_into_job_description: false },
      expiry: new Date(Number(expiresAt) * 1000).toISOString(),
      wallet_steps: ["createJob", "registerJob using the returned jobId", "setBudget using the returned jobId", BigInt(allowance) < rawBudget ? "approve payment token to Commerce" : "approval already sufficient", "fund using the returned jobId"],
      transactions: {
        create_job: { to: COMMERCE, data: createJobData },
        register_job: { to: ROUTER, data: registerTemplate, data_builder: "Replace placeholder jobId 0 with the confirmed createJob receipt jobId." },
        set_budget: { to: COMMERCE, data: setBudgetTemplate, data_builder: "Replace placeholder jobId 0 with the confirmed createJob receipt jobId." },
        approve: BigInt(allowance) < rawBudget ? { to: token, data_builder: "Encode ERC-20 approve(Commerce, budgetRaw) in the user wallet." } : { data_builder: "No approval transaction required." },
        fund: { to: COMMERCE, data: fundTemplate, data_builder: "Replace placeholder jobId 0 with the confirmed createJob receipt jobId." },
      },
      note: isAltanaAgent(agent as Record<string, unknown>)
        ? "Testnet-only preparation for isolated Grid Agent validation. The user's active Altana execution wallet is embedded in the immutable ERC-8183 job description before funding."
        : "Testnet-only preparation for isolated Agent validation. This endpoint does not share production Mainnet contracts.",
    });
  } catch (error) { return res.status(400).json({ error: error instanceof Error ? error.message : "Unable to prepare testnet ERC-8183 job" }); }
}
