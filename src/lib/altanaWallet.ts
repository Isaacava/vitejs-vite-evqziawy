import { BNB_TESTNET, createClient } from "@altananetwork/sdk";
import type { Address, PasskeySigner, Wallet } from "@altananetwork/sdk";

export type AltanaWalletResolution = {
  walletAddress: Address;
  signerAddress: Address;
  chainId: 97;
  wallet: Wallet;
  signer: PasskeySigner;
};

const RP_NAME = "AgentMarket Testnet";
const chainId = 97 as const;

let cachedResolution: AltanaWalletResolution | null = null;

function rpId() {
  return window.location.hostname;
}

function normalizeResolution(value: {
  address: Address;
  signer: PasskeySigner;
}): AltanaWalletResolution {
  if (!/^0x[a-fA-F0-9]{40}$/.test(value.address)) {
    throw new Error("Altana did not return a valid execution wallet address.");
  }

  if (!value.signer || typeof value.signer.signDigest !== "function") {
    throw new Error("Altana did not return a usable Passkey signer.");
  }

  return {
    walletAddress: value.address,
    signerAddress: value.signer.address,
    chainId,
    wallet: { address: value.address },
    signer: value.signer,
  };
}

export async function createAltanaWallet(): Promise<AltanaWalletResolution> {
  const client = createClient({ chains: [BNB_TESTNET] });
  const result = await client.createPasskeyWallet({
    name: RP_NAME,
    rpId: rpId(),
  });

  const resolved = normalizeResolution({
    address: result.address,
    signer: result.signer,
  });

  cachedResolution = resolved;
  return resolved;
}

export async function recoverAltanaWallet(): Promise<AltanaWalletResolution> {
  const client = createClient({ chains: [BNB_TESTNET] });
  const result = await client.recoverFromPasskey({
    rpId: rpId(),
    chainId,
  });

  const resolved = normalizeResolution({
    address: result.address,
    signer: result.signer,
  });

  cachedResolution = resolved;
  return resolved;
}

/**
 * Return the Altana execution wallet selected or created in this browser
 * session. This intentionally does not fall back to a WalletConnect EOA:
 * the installed Altana SDK's supported browser authorization flow is a
 * Passkey-backed smart wallet, while WalletConnect remains the AgentMarket
 * authentication/commerce wallet.
 */
export function ensureAltanaWallet(): AltanaWalletResolution {
  if (!cachedResolution) {
    throw new Error(
      "Altana execution wallet is not resolved yet. Create or recover the Altana Passkey wallet first.",
    );
  }
  return cachedResolution;
}

export function getAltanaWalletResolution() {
  return cachedResolution;
}

export function clearAltanaWalletResolution() {
  cachedResolution = null;
}
