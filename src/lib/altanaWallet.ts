import { BNB_TESTNET, createClient } from "@altananetwork/sdk";
import type { PasskeySigner, Wallet } from "@altananetwork/sdk";
import { bscTestnet } from "viem/chains";
import { createPublicClient, http, type Address, formatEther } from "viem";
import { ensureWalletConnectedProvider } from "./walletAuth";

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

export type AltanaFundingResult = {
  walletAddress: Address;
  senderAddress: Address;
  fundingAmount: bigint;
  fundingAmountFormatted: string;
  registrationFee: bigint;
  registrationFeeFormatted: string;
  transactionHash: `0x${string}`;
};

const RP_NAME = "AgentMarket Testnet";
const chainId = 97 as const;
const ALTANA_KEYSTORE_CONTROLLER: Address = "0xb530D1971f5453F3359518343F05D0AedFfF7e12";
const KEYSTORE_CONTROLLER_ABI = [{
  type: "function",
  name: "getRegistrationFeeInWei",
  stateMutability: "view",
  inputs: [],
  outputs: [{ type: "uint256" }],
}] as const;

// Keep a conservative native Testnet balance reserve for the first Altana grant.
// The grant can include two KeyStore registrations plus relay/gas recovery.
const EXTRA_NATIVE_BUFFER = 2_000_000_000_000_000n; // 0.002 tBNB

const publicClient = createPublicClient({
  chain: bscTestnet,
  transport: http(BNB_TESTNET.publicRpcUrl),
});

let cachedResolution: AltanaWalletResolution | null = null;

function rpId() {
  return window.location.hostname;
}

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function waitForTransactionReceipt(hash: `0x${string}`) {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const receipt = await publicClient.getTransactionReceipt({ hash }).catch(() => null);
    if (receipt) {
      if (receipt.status !== "success") {
        throw new Error(`Altana wallet funding transaction reverted: ${hash}`);
      }
      return receipt;
    }
    await sleep(2_000);
  }
  throw new Error(`Altana wallet funding transaction did not confirm within 120 seconds: ${hash}`);
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

/**
 * Fund an Altana wallet from the user's already-connected AgentMarket wallet.
 *
 * The transfer is native tBNB only. It is explicitly confirmed through the
 * user's WalletConnect wallet and is separate from the 1 U trading permission.
 */
export async function fundAltanaWalletFromAgentMarketWallet(
  walletAddress: Address,
): Promise<AltanaFundingResult> {
  const [providerState, registrationFee] = await Promise.all([
    ensureWalletConnectedProvider(),
    publicClient.readContract({
      address: ALTANA_KEYSTORE_CONTROLLER,
      abi: KEYSTORE_CONTROLLER_ABI,
      functionName: "getRegistrationFeeInWei",
    }),
  ]);

  const fundingAmount = registrationFee * 2n + EXTRA_NATIVE_BUFFER;

  if (fundingAmount <= 0n) {
    throw new Error("Altana Testnet funding amount could not be calculated.");
  }

  const senderAddress = providerState.address as Address;
  const senderBalance = await publicClient.getBalance({ address: senderAddress });
  if (senderBalance < fundingAmount) {
    throw new Error(
      `AgentMarket wallet ${senderAddress} has ${formatEther(senderBalance)} tBNB, but ${formatEther(fundingAmount)} tBNB is needed to fund the Altana wallet setup.`,
    );
  }

  const value = `0x${fundingAmount.toString(16)}`;
  const hash = await providerState.provider.request({
    method: "eth_sendTransaction",
    params: [{
      from: senderAddress,
      to: walletAddress,
      value,
    }],
  }) as `0x${string}`;

  await waitForTransactionReceipt(hash);

  return {
    walletAddress,
    senderAddress,
    fundingAmount,
    fundingAmountFormatted: formatEther(fundingAmount),
    registrationFee,
    registrationFeeFormatted: formatEther(registrationFee),
    transactionHash: hash,
  };
}

export async function createAltanaWallet(): Promise<AltanaWalletResolution & { funding: AltanaFundingResult }> {
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

  const funding = await fundAltanaWalletFromAgentMarketWallet(resolved.walletAddress);
  cachedResolution = resolved;
  return { ...resolved, funding };
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
