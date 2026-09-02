import { BNB_TESTNET, createClient } from "@altananetwork/sdk";
import { bscTestnet } from "viem/chains";
import { createPublicClient, http, keccak256, type Address, type Hex, formatEther } from "viem";
import { publicKeyToAddress } from "viem/accounts";
import { ensureAltanaWallet, fundAltanaWalletFromAgentMarketWallet } from "./altanaWallet";

export const TESTNET_U_TOKEN: Address = "0xc70B8741B8B07A6d61E54fd4B20f22Fa648E5565";
const TESTNET_TOKEN_DECIMALS = 18n;
const DEFAULT_NATIVE_GAS_ALLOWANCE_WEI = 20_000_000_000_000_000n;
const ALTANA_KEYSTORE_CONTROLLER: Address = "0xb530D1971f5453F3359518343F05D0AedFfF7e12";
const KEYSTORE_CONTROLLER_ABI = [{ type: "function", name: "getRegistrationFeeInWei", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] }] as const;

const publicClient = createPublicClient({ chain: bscTestnet, transport: http(BNB_TESTNET.publicRpcUrl) });

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
  capitalToken: Address;
  capitalAmount: bigint;
  purpose: string;
  expiry: number;
};

type AltanaSpendPermission = { limit: bigint; period: "day"; token?: Address };

export type AltanaSessionGrantResult = {
  walletAddress: Address;
  signerAddress: Address;
  agentSessionAddress: Address;
  sessionKeyId: Hex;
  expiry: number;
  permissions: { calls: readonly { to: Address }[]; spend: readonly AltanaSpendPermission[] };
  transactionHash?: Hex;
};

function isAddress(value: string): value is Address { return /^0x[a-fA-F0-9]{40}$/.test(value); }
function isHex(value: string): value is Hex { return /^0x[a-fA-F0-9]*$/.test(value); }

export async function getAltanaGrantFeeReadiness(): Promise<GrantFeeReadiness> {
  const resolved = ensureAltanaWallet();
  const [nativeBalance, registrationFee] = await Promise.all([
    publicClient.getBalance({ address: resolved.walletAddress }),
    publicClient.readContract({ address: ALTANA_KEYSTORE_CONTROLLER, abi: KEYSTORE_CONTROLLER_ABI, functionName: "getRegistrationFeeInWei" }),
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

/** Grant a real Altana session for the exact execution token declared by the selected agent. */
export async function grantAltanaExecutionSession(input: AltanaSessionGrantInput): Promise<AltanaSessionGrantResult> {
  if (!isAddress(input.agentSessionAddress)) throw new Error("Agent session address is invalid.");
  if (!isHex(input.agentSessionPublicKey) || input.agentSessionPublicKey.length < 100) throw new Error("Agent session public key is invalid.");
  if (input.allowedCalls.length === 0) throw new Error("At least one allowed contract call target is required; an omitted allowlist would broaden the session scope.");
  if (!isAddress(input.capitalToken)) throw new Error("Execution-capital token address is required and must be a valid EVM address.");
  if (input.capitalAmount !== 1n) throw new Error("Controlled BSC Testnet execution capital is fixed at exactly 1 token unit.");
  if (!Number.isInteger(input.expiry) || input.expiry <= Math.floor(Date.now() / 1000)) throw new Error("Execution session expiry must be in the future.");

  const derivedAddress = publicKeyToAddress(input.agentSessionPublicKey);
  if (derivedAddress.toLowerCase() !== input.agentSessionAddress.toLowerCase()) throw new Error("Agent session address does not match its public key.");

  const allowedCalls = input.allowedCalls.filter(isAddress);
  if (allowedCalls.length !== input.allowedCalls.length) throw new Error("One or more allowed contract addresses are invalid.");

  let feeReadiness = await getAltanaGrantFeeReadiness();
  if (!feeReadiness.sufficientForRegistration) {
    await fundAltanaWalletFromAgentMarketWallet(feeReadiness.walletAddress);
    feeReadiness = await getAltanaGrantFeeReadiness();
    if (!feeReadiness.sufficientForRegistration) {
      throw new Error(`Altana wallet ${feeReadiness.walletAddress} still has ${feeReadiness.nativeBalanceFormatted} tBNB after the automatic setup funding step; at least ${feeReadiness.minimumRegistrationValueFormatted} tBNB is required for KeyStore registration fees.`);
    }
  }

  const resolved = ensureAltanaWallet();
  const client = createClient({ chains: [BNB_TESTNET] });
  const token = input.capitalToken;
  const rawCapitalAmount = input.capitalAmount * 10n ** TESTNET_TOKEN_DECIMALS;

  const sessionSigner = {
    type: "privateKey" as const,
    address: input.agentSessionAddress,
    publicKey: input.agentSessionPublicKey,
    async signDigest(): Promise<Hex> { throw new Error("Agent session signer is intentionally public-only in the browser."); },
  };

  const tokenSpendPermission: AltanaSpendPermission = { limit: rawCapitalAmount, period: "day", token };
  const nativeSpendPermission: AltanaSpendPermission = { limit: DEFAULT_NATIVE_GAS_ALLOWANCE_WEI, period: "day" };
  const spendPermissions = [tokenSpendPermission, nativeSpendPermission] as const;
  const calls = allowedCalls.map((to) => ({ to }));

  const result = await client.grantSession({
    wallet: resolved.wallet,
    signer: resolved.signer,
    sessionSigner,
    permissions: { calls, spend: spendPermissions },
    expiry: input.expiry,
    chainId: 97,
    register: false,
  });

  const registration = await client.registerSessionKey({ wallet: resolved.wallet, signer: resolved.signer, session: result, chainId: 97 });
  const transactionHash = registration.alreadyRegistered ? result.transactionHash : registration.transactionHash ?? result.transactionHash;

  return {
    walletAddress: resolved.walletAddress,
    signerAddress: resolved.signerAddress,
    agentSessionAddress: input.agentSessionAddress,
    sessionKeyId: keccak256(input.agentSessionPublicKey),
    expiry: input.expiry,
    permissions: { calls, spend: spendPermissions },
    ...(transactionHash ? { transactionHash } : {}),
  };
}

/** Revoke the on-chain Altana session key owned by the connected user wallet. */
export async function revokeAltanaExecutionSession(sessionKeyId: string): Promise<Hex> {
  if (!isHex(sessionKeyId) || sessionKeyId.length !== 66) throw new Error("Active Altana session identifier is invalid.");

  const resolved = ensureAltanaWallet();
  const client = createClient({ chains: [BNB_TESTNET] });
  const revokeSession = (client as typeof client & {
    revokeSession?: (input: { wallet: typeof resolved.wallet; signer: typeof resolved.signer; sessionKeyId: Hex; chainId: number }) => Promise<{ transactionHash?: Hex; hash?: Hex }>;
  }).revokeSession;

  if (!revokeSession) throw new Error("The installed Altana SDK does not expose session revocation.");

  const result = await revokeSession.call(client, {
    wallet: resolved.wallet,
    signer: resolved.signer,
    sessionKeyId: sessionKeyId as Hex,
    chainId: 97,
  });
  const transactionHash = result.transactionHash || result.hash;
  if (!transactionHash) throw new Error("Altana did not return a revoke transaction hash.");
  return transactionHash;
}
