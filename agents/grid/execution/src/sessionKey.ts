import { encodePacked, keccak256, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

function normalizeRootSecret(value: string): `0x${string}` {
  const raw = value.startsWith("0x") ? value.slice(2) : value;
  if (!/^[0-9a-fA-F]{64}$/.test(raw)) {
    throw new Error("ALTANA_SESSION_PRIVATE_KEY must be a 32-byte hex private key");
  }
  return `0x${raw}`;
}

/**
 * Derives a deterministic, provider-only session signing key for one
 * AgentMarket execution-capital request. The root secret never leaves Grid.
 * The request id is non-secret and makes each request use a different key.
 */
export function deriveRequestSessionPrivateKey(rootSecret: string, requestId: string): `0x${string}` {
  const root = normalizeRootSecret(rootSecret);
  const id = String(requestId || "").trim();
  if (!id) throw new Error("AgentMarket request id is required for a job-scoped Grid session");

  const derived = keccak256(encodePacked(["bytes32", "string"], [root as Hex, id]));
  if (/^0x0+$/.test(derived)) {
    throw new Error("Unable to derive a valid Grid request-scoped session key");
  }

  // Validate the derived secret eagerly so the service never advertises a key
  // that its signer cannot reconstruct.
  privateKeyToAccount(derived);
  return derived;
}

export function requestSessionAccount(rootSecret: string, requestId: string) {
  return privateKeyToAccount(deriveRequestSessionPrivateKey(rootSecret, requestId));
}
