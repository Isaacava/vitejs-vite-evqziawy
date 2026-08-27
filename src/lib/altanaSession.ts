import { BNB_TESTNET, createClient } from "@altananetwork/sdk";
import { createPublicClient, http, keccak256, type Address, type Hex, formatEther } from "viem";
import { publicKeyToAddress } from "viem/accounts";
import { ensureAltanaWallet } from "./altanaWallet";

export const TESTNET_U_TOKEN: Address = "0xc70B8741B8B07A6d61E54fd4B20f22Fa648E5565";
const TESTNET_TOKEN_DECIMALS = 18n;
const ALTANA_KEYSTORE_CONTROLLER: Address = "0xb530D1971f5453F3359518343F05D0AedFfF7e12";
const KEYSTORE_CONTROLLER_ABI = [{
  type: "function",
  name: "getRegistrationFeeInWei",
  stateMutability: "view",
  inputs: [],
  outputs: [{ type: "uint256" }],
}] as const;

const publicClient = createPublicClient({
  chain: BNB_TESTNET.chain,
  transport: http(BNB_TESTNET.publicRpcUrl),
});

type GrantFeeReadiness = {
  walletAddress: Address;
  nativeBalance: bigint;
  registrationFee: bigint;
  minimumRegistrationValue: bigint;
  sufficientForRegistration: boolean;
  nativeBalanceFormatted: string;
  registrationFeeFormatted: string;
  minimumRegistrationValueFormatted: string;
};

export type AltanaSessionGrantInput = {
  agentSessionAddress: Address;
  agentSessionPublicKey: Hex;
  allowedCalls: readonly Address[];
  capitalToken?: Address;
  /** Human-readable U amount. The controlled proof is exactly 1 U. */
  capitalAmount: bigint;
  purpose: string;
  expiry: number;
};

export type AltanaSessionGrantResult = {
  walletAddress: Address;
  signerAddress: Address;
  agentSessionAddress: Address;
  sessionKeyId: Hex;
  expiry: number;
  permissions: {
    calls: readonly { to: Address }[];
    spend: readonly { limit: bigint; period: "day"; token: Address }[];
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
 * Read the native BNB requirement for the first Altana session grant.
 *
 * A first grant can need two KeyStore payments: the wallet's initial admin
 * registration and the additional session-key registration. Trading capital
 * itself remains the ERC-20 U token and is not transferred by this check.
 */
export async function getAltanaGrantFeeReadiness(): Promise<GrantFeeReadiness> {
  const resolved = ensureAltanaWallet();
  const [nativeBalance, registrationFee] = await Promise.all([
    publicClient.getBalance({ address: resolved.walletAddress }),
    publicClient.readContract({
      address: ALTANA_KEYSTORE_CONTROLLER,
      abi: KEYSTORE_CONTROLLER_ABI,
      functionName: "getRegistrationFeeInWei",
    }),
  ]);

  const minimumRegistrationValue = registrationFee * 2n;

  return {
    walletAddress: resolved.walletAddress,
    nativeBalance,
    registrationFee,
    minimumRegistrationValue,
    sufficientForRegistration: nativeBalance >= minimumRegistrationValue,
    nativeBalanceFormatted: formatEther(nativeBalance),
    registrationFeeFormatted: formatEther(registrationFee),
    minimumRegistrationValueFormatted: formatEther(minimumRegistrationValue),
  };
}

/**
 * Grant a real Altana session to an agent's already-existing session key.
 *
 * The Altana SDK's supported browser authority is the Passkey-backed smart
 * wallet returned by ensureAltanaWallet(). AgentMarket WalletConnect remains
 * the separate commerce/login wallet. The agent private key is never exposed.
 */
export async function grantAltanaExecutionSession(
  input: AltanaSessionGrantInput,
): Promise<AltanaSessionGrantResult> {
  if (!isAddress(input.agentSessionAddress)) throw new Error("Agent session address is invalid.");
  if (!isHex(input.agentSessionPublicKey) || input.agentSessionPublicKey.length < 100) {
    throw new Error("Agent session public key is invalid.");
  }
  if (input.allowedCalls.length === 0) {
    throw new Error("At least one allowed contract call target is required; an omitted allowlist would broaden the session scope.");
  }
  if (input.capitalAmount !== 1n) {
    throw new Error("Controlled BSC Testnet execution capital is fixed at exactly 1 U.");
  }
  if (!Number.isInteger(input.expiry) || input.expiry <= Math.floor(Date.now() / 1000)) {
    throw new Error("Execution session expiry must be in the future.");
  }

  const derivedAddress = publicKeyToAddress(input.agentSessionPublicKey);
  if (derivedAddress.toLowerCase() !== input.agentSessionAddress.toLowerCase()) {
    throw new Error("Agent session address does not match its public key.");
  }

  const allowedCalls = input.allowedCalls.filter(isAddress);
  if (allowedCalls.length !== input.allowedCalls.length) {
    throw new Error("One or more allowed contract addresses are invalid.");
  }

  const feeReadiness = await getAltanaGrantFeeReadiness();
  if (!feeReadiness.sufficientForRegistration) {
    throw new Error(
      `Altana wallet ${feeReadiness.walletAddress} has ${feeReadiness.nativeBalanceFormatted} tBNB, but the first session grant needs at least ${feeReadiness.minimumRegistrationValueFormatted} tBNB for two KeyStore registrations. Fund the Altana Testnet wallet with native tBNB first; the requested trading capital remains exactly 1 U.`,
    );
  }

  const resolved = ensureAltanaWallet();
  const client = createClient({ chains: [BNB_TESTNET] });
  const token = input.capitalToken || TESTNET_U_TOKEN;
  const rawCapitalAmount = input.capitalAmount * 10n ** TESTNET_TOKEN_DECIMALS;

  const sessionSigner = {
    type: "privateKey" as const,
    address: input.agentSessionAddress,
    publicKey: input.agentSessionPublicKey,
    async signDigest(): Promise<Hex> {
      throw new Error("Agent session signer is intentionally public-only in the browser.");
    },
  };

  const spendPermission = {
    limit: rawCapitalAmount,
    period: "day" as const,
    token,
  };
  const calls = allowedCalls.map((to) => ({ to }));

  const result = await client.grantSession({
    wallet: resolved.wallet,
    signer: resolved.signer,
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
    walletAddress: resolved.walletAddress,
    signerAddress: resolved.signerAddress,
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
