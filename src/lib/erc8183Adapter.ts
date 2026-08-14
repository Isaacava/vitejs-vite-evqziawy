import type { Address, EIP1193Provider, Hex } from "viem";
import { formatUnits, parseUnits } from "viem";

import {
  COMMERCE_ABI,
  ERC20_ABI,
  ERC8183_ADDRESSES,
  ROUTER_ABI,
  getWalletClient,
  publicClient,
} from "./erc8183";

export type ChainJob = {
  id: bigint;
  client: Address;
  provider: Address;
  evaluator: Address;
  description: string;
  budget: bigint;
  expiredAt: bigint;
  status: number;
  hook: Address;
  submittedAt: bigint;
  deliverable: Hex;
};

export function bscExplorerUrl(hash: Hex) {
  return `https://bscscan.com/tx/${hash}`;
}

export async function readPaymentAsset() {
  const token = await publicClient.readContract({
    address: ERC8183_ADDRESSES.commerce,
    abi: COMMERCE_ABI,
    functionName: "paymentToken",
  });

  const [symbol, decimals] = await Promise.all([
    publicClient.readContract({ address: token, abi: ERC20_ABI, functionName: "symbol" }),
    publicClient.readContract({ address: token, abi: ERC20_ABI, functionName: "decimals" }),
  ]);

  return { token, symbol, decimals };
}

export async function readChainJob(jobId: bigint): Promise<ChainJob> {
  return publicClient.readContract({
    address: ERC8183_ADDRESSES.commerce,
    abi: COMMERCE_ABI,
    functionName: "getJob",
    args: [jobId],
  });
}

export async function createChainJob(args: {
  provider: Address;
  evaluator?: Address;
  hook?: Address;
  description: string;
  expiresAt?: bigint;
  providerWallet: EIP1193Provider;
  account: Address;
}) {
  const wallet = getWalletClient(args.providerWallet, args.account);
  const evaluator = args.evaluator ?? ERC8183_ADDRESSES.router;
  const hook = args.hook ?? ERC8183_ADDRESSES.router;
  const expiresAt = args.expiresAt ?? BigInt(Math.floor(Date.now() / 1000) + 60 * 60);

  const hash = await wallet.writeContract({
    address: ERC8183_ADDRESSES.commerce,
    abi: COMMERCE_ABI,
    functionName: "createJob",
    args: [args.provider, evaluator, expiresAt, args.description, hook],
    chain: undefined,
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash });

  return { hash, receipt };
}

export async function registerPolicy(args: {
  jobId: bigint;
  providerWallet: EIP1193Provider;
  account: Address;
}) {
  const wallet = getWalletClient(args.providerWallet, args.account);
  const hash = await wallet.writeContract({
    address: ERC8183_ADDRESSES.router,
    abi: ROUTER_ABI,
    functionName: "registerJob",
    args: [args.jobId, ERC8183_ADDRESSES.policy],
    chain: undefined,
  });
  return { hash, receipt: await publicClient.waitForTransactionReceipt({ hash }) };
}

export async function setBudget(args: {
  jobId: bigint;
  amount: bigint;
  providerWallet: EIP1193Provider;
  account: Address;
}) {
  const wallet = getWalletClient(args.providerWallet, args.account);
  const hash = await wallet.writeContract({
    address: ERC8183_ADDRESSES.commerce,
    abi: COMMERCE_ABI,
    functionName: "setBudget",
    args: [args.jobId, args.amount, "0x"],
    chain: undefined,
  });
  return { hash, receipt: await publicClient.waitForTransactionReceipt({ hash }) };
}

export async function fundJob(args: {
  jobId: bigint;
  amount: bigint;
  providerWallet: EIP1193Provider;
  account: Address;
}) {
  const wallet = getWalletClient(args.providerWallet, args.account);
  const token = await publicClient.readContract({
    address: ERC8183_ADDRESSES.commerce,
    abi: COMMERCE_ABI,
    functionName: "paymentToken",
  });

  const allowance = await publicClient.readContract({
    address: token,
    abi: ERC20_ABI,
    functionName: "allowance",
    args: [args.account, ERC8183_ADDRESSES.commerce],
  });

  if (allowance < args.amount) {
    const approvalHash = await wallet.writeContract({
      address: token,
      abi: ERC20_ABI,
      functionName: "approve",
      args: [ERC8183_ADDRESSES.commerce, args.amount],
      chain: undefined,
    });
    await publicClient.waitForTransactionReceipt({ hash: approvalHash });
  }

  const hash = await wallet.writeContract({
    address: ERC8183_ADDRESSES.commerce,
    abi: COMMERCE_ABI,
    functionName: "fund",
    args: [args.jobId, args.amount, "0x"],
    chain: undefined,
  });

  return { hash, receipt: await publicClient.waitForTransactionReceipt({ hash }) };
}

export async function submitDeliverable(args: {
  jobId: bigint;
  deliverable: Hex;
  providerWallet: EIP1193Provider;
  account: Address;
}) {
  const wallet = getWalletClient(args.providerWallet, args.account);
  const hash = await wallet.writeContract({
    address: ERC8183_ADDRESSES.commerce,
    abi: COMMERCE_ABI,
    functionName: "submit",
    args: [args.jobId, args.deliverable, "0x"],
    chain: undefined,
  });
  return { hash, receipt: await publicClient.waitForTransactionReceipt({ hash }) };
}

export async function settleJob(args: {
  jobId: bigint;
  providerWallet: EIP1193Provider;
  account: Address;
}) {
  const wallet = getWalletClient(args.providerWallet, args.account);
  const hash = await wallet.writeContract({
    address: ERC8183_ADDRESSES.router,
    abi: ROUTER_ABI,
    functionName: "settle",
    args: [args.jobId, "0x"],
    chain: undefined,
  });
  return { hash, receipt: await publicClient.waitForTransactionReceipt({ hash }) };
}

export async function formatPaymentAmount(amount: string) {
  const asset = await readPaymentAsset();
  const raw = parseUnits(amount, asset.decimals);
  return { ...asset, raw, formatted: formatUnits(raw, asset.decimals) };
}
