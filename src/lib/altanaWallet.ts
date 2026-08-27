import { BNB_TESTNET, createClient } from "@altananetwork/sdk";
import type { PasskeySigner, Wallet } from "@altananetwork/sdk";
import type { Address } from "viem";

export type AltanaWalletResolution = {
  walletAddress: Address;
  signerAddress: Address;
  chainId: 97;
  wallet: Wallet;
  signer: PasskeySigner;
};

export type AltanaPasskeyReadiness = {
  secureContext: boolean;
  webAuthnAvailable: boolean;
  platformAuthenticatorAvailable: boolean | null;
  topLevelContext: boolean;
  rpId: string;
};

const RP_NAME = "AgentMarket Testnet";
const chainId = 97 as const;

let cachedResolution: AltanaWalletResolution | null = null;

function rpId() {
  return window.location.hostname;
}

export async function getAltanaPasskeyReadiness(): Promise<AltanaPasskeyReadiness> {
  const secureContext = window.isSecureContext;
  const credentialsAvailable = typeof navigator.credentials?.create === "function";
  const webAuthnAvailable = secureContext && credentialsAvailable && typeof window.PublicKeyCredential !== "undefined";
  let platformAuthenticatorAvailable: boolean | null = null;

  if (
    webAuthnAvailable &&
    typeof window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable === "function"
  ) {
    try {
      platformAuthenticatorAvailable = await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    } catch {
      platformAuthenticatorAvailable = null;
    }
  }

  return {
    secureContext,
    webAuthnAvailable,
    platformAuthenticatorAvailable,
    topLevelContext: window.top === window.self,
    rpId: rpId(),
  };
}

function assertPasskeyReady(readiness: AltanaPasskeyReadiness) {
  if (!readiness.secureContext) {
    throw new Error("Altana Passkeys require a secure HTTPS page. Open AgentMarket from its HTTPS address.");
  }
  if (!readiness.webAuthnAvailable) {
    throw new Error("This browser context does not expose WebAuthn. Use a current browser with Passkey/WebAuthn support.");
  }
  if (!readiness.topLevelContext) {
    throw new Error("Passkey creation is running inside an embedded frame. Open AgentMarket as a top-level page before creating the Altana wallet.");
  }
  if (readiness.platformAuthenticatorAvailable === false) {
    throw new Error("This device/browser does not report a platform authenticator for Passkeys. Use a browser/device with Passkey support or recover an existing Altana wallet.");
  }
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
  const readiness = await getAltanaPasskeyReadiness();
  assertPasskeyReady(readiness);

  const client = createClient({ chains: [BNB_TESTNET] });
  const result = await client.createPasskeyWallet({
    name: RP_NAME,
    rpId: readiness.rpId,
  });

  const resolved = normalizeResolution({
    address: result.address,
    signer: result.signer,
  });

  cachedResolution = resolved;
  return resolved;
}

export async function recoverAltanaWallet(): Promise<AltanaWalletResolution> {
  const readiness = await getAltanaPasskeyReadiness();
  assertPasskeyReady(readiness);

  const client = createClient({ chains: [BNB_TESTNET] });
  const result = await client.recoverFromPasskey({
    rpId: readiness.rpId,
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
 * session. The supported browser execution flow is a Passkey-backed smart
 * wallet; AgentMarket's WalletConnect EOA remains the separate authentication/
 * commerce wallet.
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
