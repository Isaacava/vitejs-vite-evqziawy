import { BNB_TESTNET, createClient } from "@altananetwork/sdk";
import { keccak256, type Address, type Hex } from "viem";
import { publicKeyToAddress } from "viem/accounts";
import { getConnectedWalletProvider } from "./walletAuth";
import { ensureAltanaWallet } from "./altanaWallet";

export type AltanaSessionGrantInput = {
  agentSessionAddress: Address;
  agentSessionPublicKey: Hex;
  capitalToken?: Address;
  capitalAmount: bigint;
  purpose: string;
  expiry: number;
};

export type AltanaSessionGrantResult = {
  walletAddress: Address;
  agentSessionAddress: Address;
  sessionKeyId: Hex;
  expiry: number;
  permissions: {
    calls: readonly { to: Address }[];
    spend: readonly { limit: bigint; period: "day"; token?: Address }[];
  };
  transactionHash?: Hex;
};

function isAddress(value: string): value is Address {
  return /^0x[a-fA-F0-9]{40}$/.test(value);
}

function isHex(value: string): value is Hex {
  return /^0x[a-fA-F0-9]*$/.test(value);
}

/**
 * Grant a real Altana session to an agent's already-existing session key.
 * The browser only sees the agent public key/address; it never receives the
 * agent private key. The connected user wallet remains the admin signer.
 */
export async function grantAltanaExecutionSession(
  input: AltanaSessionGrantInput,
): Promise<AltanaSessionGrantResult> {
  const provider = getConnectedWalletProvider();
  const sdk = (await import("@altananetwork/sdk")) as typeof import("@altananetwork/sdk") & {
    signerFromInjected?: (provider: unknown) => {
      type: "injected";
      address: Address;
      publicKey: Hex;
      signDigest(digest: Hex): Promise<Hex>;
    };
  };

  if (typeof sdk.signerFromInjected !== "function") {
    throw new Error("This installed Altana SDK build does not expose an injected-wallet signer.");
  }
  if (!isAddress(input.agentSessionAddress)) throw new Error("Agent session address is invalid.");
  if (!isHex(input.agentSessionPublicKey) || input.agentSessionPublicKey.length < 100) {
    throw new Error("Agent session public key is invalid.");
  }
  if (input.capitalAmount <= 0n) throw new Error("Execution capital must be greater than zero.");
  if (!Number.isInteger(input.expiry) || input.expiry <= Math.floor(Date.now() / 1000)) {
    throw new Error("Execution session expiry must be in the future.");
  }

  const derivedAddress = publicKeyToAddress(input.agentSessionPublicKey);
  if (derivedAddress.toLowerCase() !== input.agentSessionAddress.toLowerCase()) {
    throw new Error("Agent session address does not match its public key.");
  }

  const { walletAddress } = await ensureAltanaWallet();
  const signer = sdk.signerFromInjected(provider);
  const client = createClient({ chains: [BNB_TESTNET] });

  // Grant needs the public descriptor only. The actual private key stays in
  // the agent process and is never passed to AgentMarket.
  const sessionSigner = {
    type: "privateKey" as const,
    address: input.agentSessionAddress,
    publicKey: input.agentSessionPublicKey,
    async signDigest(): Promise<Hex> {
      throw new Error("Agent session signer is intentionally public-only in the browser.");
    },
  };

  const spendPermission = input.capitalToken
    ? { limit: input.capitalAmount, period: "day" as const, token: input.capitalToken }
    : { limit: input.capitalAmount, period: "day" as const };

  // Contract targets are supplied by the agent's declared execution profile;
  // this helper does not hard-code a PancakeSwap contract address.
  const calls: readonly { to: Address }[] = [];
  const result = await client.grantSession({
    wallet: { address: walletAddress },
    signer,
    sessionSigner,
    permissions: {
      calls,
      spend: [spendPermission],
    },
    expiry: input.expiry,
    chainId: 97,
    register: true,
  });

  return {
    walletAddress,
    agentSessionAddress: input.agentSessionAddress,
    sessionKeyId: keccak256(input.agentSessionPublicKey),
    expiry: input.expiry,
    permissions: {
      calls,
      spend: [spendPermission],
    },
    transactionHash: result.transactionHash,
  };
}
