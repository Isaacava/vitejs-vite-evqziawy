import { EthereumProvider } from "@walletconnect/ethereum-provider";
import { BSC_RPC_URL } from "./network";

type Eip1193Provider = {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  on?: (event: string, handler: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, handler: (...args: unknown[]) => void) => void;
  disconnect?: () => Promise<void>;
  connect?: (args?: { chains?: number[] }) => Promise<void>;
  connected?: boolean;
};

declare global { interface Window { ethereum?: Eip1193Provider } }

export type AuthUser = {
  id: string;
  wallet_address: string;
  display_name: string | null;
  avatar_url: string | null;
  created_at: string;
  updated_at: string;
};

export const WALLETCONNECT_PROJECT_ID = "1dbe8fd5e4974ae7c80d074c4082b5a0";
export const AUTH_CHAIN_ID = 97;
const AUTH_CHAIN_ID_HEX = `0x${AUTH_CHAIN_ID.toString(16)}`;
const STORAGE = "agentmarket-testnet-wc-v7";
const TESTNET_CHAIN_CONFIG = {
  chainId: AUTH_CHAIN_ID_HEX,
  chainName: "BNB Smart Chain Testnet",
  nativeCurrency: { name: "BNB", symbol: "tBNB", decimals: 18 },
  rpcUrls: [BSC_RPC_URL],
  blockExplorerUrls: ["https://testnet.bscscan.com"],
};
const AUTH_API = "/api/auth";

let providerRef: Eip1193Provider | null = null;
let initPromise: Promise<Eip1193Provider> | null = null;

function normalizeChainId(value: unknown): number {
  const text = String(value ?? "").trim().toLowerCase();
  if (!text) return 0;
  const parsed = text.startsWith("0x") ? Number.parseInt(text.slice(2), 16) : Number.parseInt(text, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function chainIdOf(provider: Eip1193Provider) {
  return normalizeChainId(await provider.request({ method: "eth_chainId" }));
}

async function dropProvider(provider: Eip1193Provider | null) {
  try { await provider?.disconnect?.(); } catch { /* stale session */ }
  providerRef = null;
  initPromise = null;
}

async function makeProvider(forceFresh = false): Promise<Eip1193Provider> {
  if (!forceFresh && initPromise) return initPromise;

  initPromise = EthereumProvider.init({
    projectId: WALLETCONNECT_PROJECT_ID,
    optionalChains: [AUTH_CHAIN_ID],
    optionalMethods: ["eth_sendTransaction", "personal_sign"],
    optionalEvents: ["chainChanged", "accountsChanged"],
    rpcMap: { [AUTH_CHAIN_ID]: BSC_RPC_URL },
    showQrModal: true,
    customStoragePrefix: STORAGE,
    metadata: {
      name: "AgentMarket Testnet",
      description: "AgentMarket BSC Testnet marketplace",
      url: window.location.origin,
      icons: [`${window.location.origin}/favicon.svg`],
    },
  }).then((provider) => provider as unknown as Eip1193Provider);

  try { return await initPromise; }
  catch (error) { initPromise = null; throw error; }
}

async function ensureExpectedChain(provider: Eip1193Provider) {
  const current = await chainIdOf(provider);

  // The wallet is already on BSC Testnet. Do nothing except continue.
  if (current === AUTH_CHAIN_ID) return;

  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: AUTH_CHAIN_ID_HEX }],
    });
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error
      ? Number((error as { code?: unknown }).code)
      : 0;

    if (code !== 4902) {
      throw new Error(
        `Wallet is on chain ${current || "unknown"}. AgentMarket Testnet requires BSC Testnet (chain 97). Approve the network switch in your wallet.`,
      );
    }

    await provider.request({
      method: "wallet_addEthereumChain",
      params: [TESTNET_CHAIN_CONFIG],
    });

    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: AUTH_CHAIN_ID_HEX }],
    });
  }

  const after = await chainIdOf(provider);
  if (after !== AUTH_CHAIN_ID) {
    throw new Error("Wallet did not switch to BSC Testnet (chain 97). Please approve the Testnet network and try again.");
  }
}

async function connectProvider(provider: Eip1193Provider) {
  if (await chainIdOf(provider) === AUTH_CHAIN_ID) return provider;

  if (provider.connect) {
    await provider.connect({ chains: [AUTH_CHAIN_ID] });
  }

  await ensureExpectedChain(provider);
  return provider;
}

export async function connectWallet() {
  let provider = providerRef || await makeProvider();

  try {
    provider = await connectProvider(provider);
  } catch (firstError) {
    // A stale WalletConnect session may not be switchable. Drop only that
    // session, start a fresh Testnet session, then negotiate chain 97 again.
    await dropProvider(provider);
    provider = await makeProvider(true);
    try {
      provider = await connectProvider(provider);
    } catch {
      throw firstError instanceof Error ? firstError : new Error("Unable to establish a BSC Testnet wallet session.");
    }
  }

  let accounts = (await provider.request({ method: "eth_accounts" })) as string[];
  if (!accounts?.[0]) {
    if (provider.connect) await provider.connect({ chains: [AUTH_CHAIN_ID] });
    else await provider.request({ method: "eth_requestAccounts" });
    await ensureExpectedChain(provider);
    accounts = (await provider.request({ method: "eth_accounts" })) as string[];
  }

  const wallet = accounts?.[0];
  if (!wallet) throw new Error("Wallet connected to BSC Testnet but no account was selected.");

  providerRef = provider;
  return { provider, address: wallet };
}

export async function ensureWalletConnectedProvider() { return connectWallet(); }
export function getWalletProvider() {
  if (!providerRef) throw new Error("WalletConnect is not connected. Connect your Testnet wallet first.");
  return providerRef;
}
export function getConnectedWalletProvider() { return getWalletProvider(); }

async function authRequest(action: "nonce" | "verify" | "me" | "logout", init?: RequestInit) {
  return fetch(`${AUTH_API}?action=${action}`, { credentials: "include", ...init });
}

export async function connectWalletAndSignIn() {
  const { provider, address: wallet } = await connectWallet();

  const challengeResponse = await authRequest("nonce", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ wallet }),
  });
  const challenge = await challengeResponse.json();
  if (!challengeResponse.ok) throw new Error(challenge?.error || "Unable to start Testnet wallet sign-in");

  const signature = await provider.request({ method: "personal_sign", params: [challenge.message, wallet] });

  const verifyResponse = await authRequest("verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session_id: challenge.session_id, wallet, signature }),
  });
  const verified = await verifyResponse.json();
  if (!verifyResponse.ok) throw new Error(verified?.error || "Testnet wallet signature verification failed");

  return verified.user as AuthUser;
}

export async function getCurrentUser() {
  const response = await authRequest("me");
  if (!response.ok) return null;
  const data = (await response.json()) as { authenticated: boolean; user?: AuthUser };
  return data.authenticated ? data.user || null : null;
}

export async function signOut() {
  try { await authRequest("logout", { method: "POST" }); }
  finally { await dropProvider(providerRef); }
}

export async function resetWalletConnectSession() {
  await dropProvider(providerRef);
  return makeProvider(true);
}
