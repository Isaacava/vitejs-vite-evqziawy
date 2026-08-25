import { BNB_TESTNET, createClient } from "@altananetwork/sdk";
import { getConnectedWalletProvider } from "./walletAuth";

export type AltanaWalletResolution = {
  walletAddress: `0x${string}`;
  signerAddress: `0x${string}`;
  chainId: 97;
};

type AltanaSigner = {
  address: `0x${string}`;
  type: string;
  publicKey?: string;
  signDigest?: (digest: `0x${string}`) => Promise<`0x${string}`>;
};

type AltanaSdkWithInjected = typeof import("@altananetwork/sdk") & {
  signerFromInjected?: (provider: unknown) => AltanaSigner;
};

/**
 * Resolve an Altana wallet from the user's existing AgentMarket WalletConnect signer.
 *
 * This does not generate or persist a private key. The connected wallet remains the
 * signer/admin authority. The helper intentionally does not grant a session or execute
 * a transaction; those are separate authorization steps.
 */
export async function ensureAltanaWallet(): Promise<AltanaWalletResolution> {
  const provider = getConnectedWalletProvider();
  const sdk = (await import("@altananetwork/sdk")) as AltanaSdkWithInjected;
  const signerFromInjected = sdk.signerFromInjected;

  if (typeof signerFromInjected !== "function") {
    throw new Error(
      "The installed @altananetwork/sdk build does not expose signerFromInjected. " +
      "AgentMarket will not substitute a private key or create a separate signer.",
    );
  }

  const signer = signerFromInjected(provider);
  if (!/^0x[a-fA-F0-9]{40}$/.test(signer.address)) {
    throw new Error("Altana injected signer did not expose the connected wallet address.");
  }

  const client = createClient({ chains: [BNB_TESTNET] });
  const wallet = await client.createWallet({ signer });

  if (!/^0x[a-fA-F0-9]{40}$/.test(wallet.address)) {
    throw new Error("Altana did not return a valid wallet address.");
  }

  return {
    walletAddress: wallet.address,
    signerAddress: signer.address,
    chainId: 97,
  };
}
