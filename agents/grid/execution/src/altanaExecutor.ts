import { BNB_TESTNET, createClient } from "@altananetwork/sdk";
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

  return {
    walletAddress: descriptor.walletAddress,
    signer: {
      type: "privateKey" as const,
      address: account.address,
      publicKey: descriptor.agentSessionPublicKey,
      signDigest: account.sign,
    },
    publicKey: descriptor.agentSessionPublicKey,
    permissions: {
      calls: descriptor.allowedCalls.map((to) => ({ to })),
      spend: descriptor.spendToken
        ? [{ limit: descriptor.spendLimit, period: "day" as const, token: descriptor.spendToken }]
        : [{ limit: descriptor.spendLimit, period: "day" as const }],
    },
    expiry: descriptor.expiry,
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
