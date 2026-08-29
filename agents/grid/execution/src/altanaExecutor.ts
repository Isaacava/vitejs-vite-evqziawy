import { BNB_TESTNET, createClient, signerFromPrivateKey } from "@altananetwork/sdk";
import type { Address, Hex } from "viem";
import { privateKeyToAccount, publicKeyToAddress } from "viem/accounts";
import type { GridCall, GridExecutionResult, GridSessionDescriptor } from "./types.js";
import { approveGridExecution } from "./riskGuardian.js";

function isAddress(value: string): value is Address {
  return /^0x[a-fA-F0-9]{40}$/.test(value);
}

function isHex(value: string): value is Hex {
  return /^0x[a-fA-F0-9]*$/.test(value);
}

function normalizePrivateKey(value: string): `0x${string}` {
  const raw = value.startsWith("0x") ? value.slice(2) : value;
  if (!/^[0-9a-fA-F]{64}$/.test(raw)) throw new Error("ALTANA_SESSION_PRIVATE_KEY must be a 32-byte hex private key");
  return `0x${raw}`;
}

function configuredList(name: string): Address[] {
  return (process.env[name] || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => {
      if (!isAddress(value)) throw new Error(`${name} contains an invalid address: ${value}`);
      return value as Address;
    });
}

export function reconstructSession(
  descriptor: GridSessionDescriptor,
  sessionPrivateKey: string,
) {
  if (!isAddress(descriptor.walletAddress)) throw new Error("Invalid Altana wallet address");
  if (!isAddress(descriptor.agentSessionAddress)) throw new Error("Invalid agent session address");
  if (!isHex(descriptor.agentSessionPublicKey)) throw new Error("Invalid agent session public key");
  if (descriptor.agentSessionPublicKey.length < 100) throw new Error("Agent session public key is too short");
  if (!Number.isInteger(descriptor.expiry) || descriptor.expiry <= Math.floor(Date.now() / 1000)) throw new Error("Altana session is expired");
  if (descriptor.spendLimit <= 0n) throw new Error("Altana session spend cap must be positive");
  if (descriptor.nativeSpendLimit <= 0n) throw new Error("Altana session descriptor has no native BNB gas-recovery spend permission");

  const privateKey = normalizePrivateKey(sessionPrivateKey);
  const account = privateKeyToAccount(privateKey);
  const derivedAddress = publicKeyToAddress(descriptor.agentSessionPublicKey);
  if (derivedAddress.toLowerCase() !== descriptor.agentSessionAddress.toLowerCase()) {
    throw new Error("Session public key does not derive the declared session address");
  }
  if (account.address.toLowerCase() !== descriptor.agentSessionAddress.toLowerCase()) {
    throw new Error("ALTANA_SESSION_PRIVATE_KEY does not belong to the granted session key");
  }
  if (descriptor.allowedCalls.length === 0) throw new Error("Altana session descriptor has no call allowlist");
  if (descriptor.allowedCalls.some((target) => !isAddress(target))) throw new Error("Altana session contains an invalid call target");

  const spendPermissions = descriptor.spendToken
    ? [
        { limit: descriptor.spendLimit, period: "day" as const, token: descriptor.spendToken },
        { limit: descriptor.nativeSpendLimit, period: "day" as const },
      ]
    : [{ limit: descriptor.spendLimit, period: "day" as const }];

  return {
    walletAddress: descriptor.walletAddress,
    signer: signerFromPrivateKey(privateKey),
    publicKey: descriptor.agentSessionPublicKey,
    permissions: {
      calls: descriptor.allowedCalls.map((to) => ({ to })),
      spend: spendPermissions,
    },
    expiry: descriptor.expiry,
  };
}

export function configuredSessionDescriptor(env: NodeJS.ProcessEnv = process.env): GridSessionDescriptor {
  const privateKey = normalizePrivateKey(env.ALTANA_SESSION_PRIVATE_KEY || "");
  const account = privateKeyToAccount(privateKey);
  const publicKey = account.publicKey as Hex;
  const walletAddress = env.ALTANA_WALLET_ADDRESS?.trim() || "";
  if (!isAddress(walletAddress)) throw new Error("ALTANA_WALLET_ADDRESS must be the user Altana wallet address that granted this session");

  const allowedCalls = configuredList("GRID_ALLOWED_TARGETS");
  if (allowedCalls.length === 0) throw new Error("GRID_ALLOWED_TARGETS must contain at least one contract target");

  const spendTokenRaw = (env.ALTANA_SESSION_SPEND_TOKEN || env.GRID_DEFAULT_TOKEN_IN || "").trim();
  if (!isAddress(spendTokenRaw)) throw new Error("ALTANA_SESSION_SPEND_TOKEN must be a valid token address");

  const spendLimitRaw = (env.ALTANA_SESSION_SPEND_LIMIT || "1000000000000000000").trim();
  if (!/^\d+$/.test(spendLimitRaw) || BigInt(spendLimitRaw) <= 0n) throw new Error("ALTANA_SESSION_SPEND_LIMIT must be a positive raw token amount");

  const nativeSpendLimitRaw = (env.ALTANA_SESSION_NATIVE_SPEND_LIMIT || "20000000000000000").trim();
  if (!/^\d+$/.test(nativeSpendLimitRaw) || BigInt(nativeSpendLimitRaw) <= 0n) throw new Error("ALTANA_SESSION_NATIVE_SPEND_LIMIT must be a positive raw wei amount");

  const expiryRaw = (env.ALTANA_SESSION_EXPIRY || "").trim();
  if (!/^\d+$/.test(expiryRaw)) throw new Error("ALTANA_SESSION_EXPIRY must match the expiry of the already-granted Altana session");

  return {
    walletAddress: walletAddress as Address,
    agentSessionAddress: account.address,
    agentSessionPublicKey: publicKey,
    allowedCalls,
    allowedSelectors: configuredList("GRID_ALLOWED_SELECTORS").map(String),
    spendLimit: BigInt(spendLimitRaw),
    spendToken: spendTokenRaw as Address,
    nativeSpendLimit: BigInt(nativeSpendLimitRaw),
    expiry: Number(expiryRaw),
  };
}

export async function executeGridAction(
  descriptor: GridSessionDescriptor,
  calls: readonly GridCall[],
  sessionPrivateKey: string,
): Promise<GridExecutionResult> {
  const decision = approveGridExecution(descriptor, calls);
  if (!decision.approved) throw new Error(`Risk Guardian rejected execution: ${decision.reasons.join("; ")}`);

  const session = reconstructSession(descriptor, sessionPrivateKey);
  const client = createClient({ chains: [BNB_TESTNET] });
  const result = await client.execute({
    session,
    calls,
    chainId: 97,
  });

  if (result.status === "FAILED") {
    throw new Error(`Altana execute() returned FAILED for calls ${result.callsId}`);
  }

  return {
    callsId: result.callsId,
    transactionHash: result.transactionHash ?? null,
    status: result.status,
  };
}

export async function executeConfiguredGridAction(
  calls: readonly GridCall[],
): Promise<GridExecutionResult> {
  const sessionPrivateKey = normalizePrivateKey(process.env.ALTANA_SESSION_PRIVATE_KEY || "");
  const descriptor = configuredSessionDescriptor();
  return executeGridAction(descriptor, calls, sessionPrivateKey);
}
