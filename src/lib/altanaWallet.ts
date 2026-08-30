import { BNB_TESTNET, createClient } from "@altananetwork/sdk";
import type { PasskeySigner, Wallet } from "@altananetwork/sdk";
import { bscTestnet } from "viem/chains";
import { createPublicClient, encodeFunctionData, http, type Address, formatEther } from "viem";
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

export type AltanaTradingCapitalResult = {
  walletAddress: Address;
  senderAddress: Address;
  token: Address;
  amount: bigint;
  amountFormatted: string;
  transactionHash?: `0x${string}`;
  alreadyFunded: boolean;
};

export type PersistentAltanaWalletRecord = {
  user_id: string;
  wallet_address: Address;
  signer_address: Address | null;
  chain_id: 97;
  wallet_provider: "altana";
  authorization_model: "passkey";
  rp_id: string | null;
  status: "active" | "recovery_required" | "disabled";
  created_at: string;
  updated_at: string;
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

const ERC20_BALANCE_TRANSFER_ABI = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "owner", type: "address" }], outputs: [{ name: "balance", type: "uint256" }] },
  { type: "function", name: "transfer", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }, { name: "value", type: "uint256" }], outputs: [{ name: "success", type: "bool" }] },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint8" }] },
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "string" }] },
] as const;

const EXTRA_NATIVE_BUFFER = 2_000_000_000_000_000n;

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
      if (receipt.status !== "success") throw new Error(`Altana wallet transaction reverted: ${hash}`);
      return receipt;
    }
    await sleep(2_000);
  }
  throw new Error(`Altana wallet transaction did not confirm within 120 seconds: ${hash}`);
}

export async function getPersistentAltanaWallet(): Promise<PersistentAltanaWalletRecord | null> {
  const response = await fetch("/api/testnet?route=execution-wallet", { credentials: "include", cache: "no-store" });
  const body = await response.json().catch(() => null) as { wallet?: PersistentAltanaWalletRecord | null; error?: string } | null;
  if (!response.ok) throw new Error(body?.error || "Unable to load the persistent Altana execution wallet");
  return body?.wallet || null;
}

export async function persistAltanaWalletResolution(resolution: AltanaWalletResolution): Promise<PersistentAltanaWalletRecord> {
  const response = await fetch("/api/testnet?route=execution-wallet", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      wallet_address: resolution.walletAddress,
      signer_address: resolution.signerAddress,
      rp_id: rpId(),
    }),
  });
  const body = await response.json().catch(() => null) as { wallet?: PersistentAltanaWalletRecord; error?: string } | null;
  if (!response.ok || !body?.wallet) throw new Error(body?.error || "Unable to persist the Altana execution wallet");
  return body.wallet;
}

export async function getAltanaPasskeyReadiness(): Promise<AltanaPasskeyReadiness> {
  const secureContext = window.isSecureContext;
  const credentialsAvailable = typeof navigator.credentials?.create === "function";
  const webAuthnAvailable = secureContext && credentialsAvailable && typeof window.PublicKeyCredential !== "undefined";
  let platformAuthenticatorAvailable: boolean | null = null;

  if (webAuthnAvailable && typeof window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable === "function") {
    try { platformAuthenticatorAvailable = await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable(); }
    catch { platformAuthenticatorAvailable = null; }
  }

  return { secureContext, webAuthnAvailable, platformAuthenticatorAvailable, topLevelContext: window.top === window.self, rpId: rpId() };
}

function assertPasskeyReady(readiness: AltanaPasskeyReadiness) {
  if (!readiness.secureContext) throw new Error("Altana Passkeys require a secure HTTPS page. Open AgentMarket from its HTTPS address.");
  if (!readiness.webAuthnAvailable) throw new Error("This browser context does not expose WebAuthn. Use a current browser with Passkey/WebAuthn support.");
  if (!readiness.topLevelContext) throw new Error("Passkey creation is running inside an embedded frame. Open AgentMarket as a top-level page before creating the Altana wallet.");
  if (readiness.platformAuthenticatorAvailable === false) throw new Error("This device/browser does not report a platform authenticator for Passkeys. Use a browser/device with Passkey support or recover an existing Altana wallet.");
}

function normalizeResolution(value: { address: Address; signer: PasskeySigner }): AltanaWalletResolution {
  if (!/^0x[a-fA-F0-9]{40}$/.test(value.address)) throw new Error("Altana did not return a valid execution wallet address.");
  if (!value.signer || typeof value.signer.signDigest !== "function") throw new Error("Altana did not return a usable Passkey signer.");
  return { walletAddress: value.address, signerAddress: value.signer.address, chainId, wallet: { address: value.address }, signer: value.signer };
}

export async function fundAltanaWalletFromAgentMarketWallet(walletAddress: Address): Promise<AltanaFundingResult> {
  const [providerState, registrationFee] = await Promise.all([
    ensureWalletConnectedProvider(),
    publicClient.readContract({ address: ALTANA_KEYSTORE_CONTROLLER, abi: KEYSTORE_CONTROLLER_ABI, functionName: "getRegistrationFeeInWei" }),
  ]);

  const fundingAmount = registrationFee * 2n + EXTRA_NATIVE_BUFFER;
  if (fundingAmount <= 0n) throw new Error("Altana Testnet funding amount could not be calculated.");

  const senderAddress = providerState.address as Address;
  const senderBalance = await publicClient.getBalance({ address: senderAddress });
  if (senderBalance < fundingAmount) {
    throw new Error(`AgentMarket wallet ${senderAddress} has ${formatEther(senderBalance)} tBNB, but ${formatEther(fundingAmount)} tBNB is needed to fund the Altana wallet setup.`);
  }

  const value = `0x${fundingAmount.toString(16)}`;
  const hash = await providerState.provider.request({ method: "eth_sendTransaction", params: [{ from: senderAddress, to: walletAddress, value }] }) as `0x${string}`;
  await waitForTransactionReceipt(hash);

  return { walletAddress, senderAddress, fundingAmount, fundingAmountFormatted: formatEther(fundingAmount), registrationFee, registrationFeeFormatted: formatEther(registrationFee), transactionHash: hash };
}

/** Transfer only the missing amount of an arbitrary ERC-20 token into the user's own Altana wallet. */
export async function fundAltanaTradingCapital(walletAddress: Address, tokenAddress: Address, rawAmount: bigint): Promise<AltanaTradingCapitalResult> {
  if (!/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) throw new Error("Altana execution wallet address is invalid.");
  if (!/^0x[a-fA-F0-9]{40}$/.test(tokenAddress)) throw new Error("Trading-capital token address is invalid.");
  if (rawAmount <= 0n) throw new Error("Trading-capital amount must be greater than zero.");

  const providerState = await ensureWalletConnectedProvider();
  const senderAddress = providerState.address as Address;
  const [senderBalance, existingTargetBalance, decimals, symbol] = await Promise.all([
    publicClient.readContract({ address: tokenAddress, abi: ERC20_BALANCE_TRANSFER_ABI, functionName: "balanceOf", args: [senderAddress] }),
    publicClient.readContract({ address: tokenAddress, abi: ERC20_BALANCE_TRANSFER_ABI, functionName: "balanceOf", args: [walletAddress] }),
    publicClient.readContract({ address: tokenAddress, abi: ERC20_BALANCE_TRANSFER_ABI, functionName: "decimals" }),
    publicClient.readContract({ address: tokenAddress, abi: ERC20_BALANCE_TRANSFER_ABI, functionName: "symbol" }).catch(() => "TOKEN"),
  ]);
  const tokenDecimals = Number(decimals);
  const tokenSymbol = String(symbol);

  if (existingTargetBalance >= rawAmount) {
    return { walletAddress, senderAddress, token: tokenAddress, amount: rawAmount, amountFormatted: formatTokenAmount(rawAmount, tokenDecimals), alreadyFunded: true };
  }

  const topUpAmount = rawAmount - existingTargetBalance;
  if (senderBalance < topUpAmount) {
    throw new Error(`Connected wallet ${senderAddress} has ${formatTokenAmount(senderBalance, tokenDecimals)} ${tokenSymbol}, but ${formatTokenAmount(topUpAmount, tokenDecimals)} ${tokenSymbol} is needed to bring the Altana execution wallet up to ${formatTokenAmount(rawAmount, tokenDecimals)} ${tokenSymbol}.`);
  }

  const data = encodeFunctionData({ abi: ERC20_BALANCE_TRANSFER_ABI, functionName: "transfer", args: [walletAddress, topUpAmount] });
  const hash = await providerState.provider.request({ method: "eth_sendTransaction", params: [{ from: senderAddress, to: tokenAddress, data }] }) as `0x${string}`;
  await waitForTransactionReceipt(hash);

  const finalBalance = await publicClient.readContract({ address: tokenAddress, abi: ERC20_BALANCE_TRANSFER_ABI, functionName: "balanceOf", args: [walletAddress] });
  if (finalBalance < rawAmount) throw new Error(`Trading-capital transfer confirmed, but the Altana execution wallet still has only ${formatTokenAmount(finalBalance, tokenDecimals)} ${tokenSymbol}.`);

  return { walletAddress, senderAddress, token: tokenAddress, amount: rawAmount, amountFormatted: formatTokenAmount(rawAmount, tokenDecimals), transactionHash: hash, alreadyFunded: false };
}

function formatTokenAmount(value: bigint, decimals: number) {
  const base = 10n ** BigInt(decimals);
  const whole = value / base;
  const fraction = (value % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

export async function createAltanaWallet(): Promise<AltanaWalletResolution & { funding: AltanaFundingResult }> {
  const existing = await getPersistentAltanaWallet();
  if (existing) {
    throw new Error(`A persistent Altana execution wallet already exists for this account at ${existing.wallet_address}. Use Recover existing Altana wallet instead of creating another wallet.`);
  }

  const readiness = await getAltanaPasskeyReadiness();
  assertPasskeyReady(readiness);
  const client = createClient({ chains: [BNB_TESTNET] });
  const result = await client.createPasskeyWallet({ name: RP_NAME, rpId: readiness.rpId });
  const resolved = normalizeResolution({ address: result.address, signer: result.signer });
  const funding = await fundAltanaWalletFromAgentMarketWallet(resolved.walletAddress);
  await persistAltanaWalletResolution(resolved);
  cachedResolution = resolved;
  return { ...resolved, funding };
}

export async function recoverAltanaWallet(): Promise<AltanaWalletResolution> {
  const readiness = await getAltanaPasskeyReadiness();
  assertPasskeyReady(readiness);
  const client = createClient({ chains: [BNB_TESTNET] });
  const result = await client.recoverFromPasskey({ rpId: readiness.rpId, chainId });
  const resolved = normalizeResolution({ address: result.address, signer: result.signer });
  const existing = await getPersistentAltanaWallet();
  if (existing && existing.wallet_address.toLowerCase() !== resolved.walletAddress.toLowerCase()) {
    throw new Error(`The recovered Passkey resolves to ${resolved.walletAddress}, but this account is registered to ${existing.wallet_address}. Recover the Passkey that owns the registered execution wallet.`);
  }
  await persistAltanaWalletResolution(resolved);
  cachedResolution = resolved;
  return resolved;
}

export function ensureAltanaWallet(): AltanaWalletResolution {
  if (!cachedResolution) throw new Error("Altana execution wallet is not resolved yet. Create or recover the Altana Passkey wallet first.");
  return cachedResolution;
}

export function getAltanaWalletResolution() { return cachedResolution; }
export function clearAltanaWalletResolution() { cachedResolution = null; }
