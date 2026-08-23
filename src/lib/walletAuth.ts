import EthereumProvider from "@walletconnect/ethereum-provider";
import { BSC_RPC_URL } from "./network";

type Eip1193Provider = {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  on?: (event: string, handler: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, handler: (...args: unknown[]) => void) => void;
  disconnect?: () => Promise<void>;
  connect?: (args?: { chains?: number[] }) => Promise<void>;
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
const STORAGE = "agentmarket-testnet-wc-v8";
const TESTNET_CHAIN_CONFIG = {
  chainId: AUTH_CHAIN_ID_HEX,
  chainName: "BNB Smart Chain Testnet",
  nativeCurrency: { name: "BNB", symbol: "tBNB", decimals: 18 },
  rpcUrls: [BSC_RPC_URL],
  blockExplorerUrls: ["https://testnet.bscscan.com"],
};
const AUTH_API = "/api/auth";

let walletConnectProvider: Eip1193Provider | null = null;
let walletConnectInitPromise: Promise<Eip1193Provider> | null = null;

function normalizeChainId(value: unknown): number {
  const text = String(value ?? "").trim().toLowerCase();
  if (!text) return 0;
  const parsed = text.startsWith("0x") ? Number.parseInt(text.slice(2), 16) : Number.parseInt(text, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function chainIdOf(provider: Eip1193Provider) {
  return normalizeChainId(await provider.request({ method: "eth_chainId" }));
}

function getInjectedProvider() {
  return window.ethereum ?? null;
}

async function getWalletConnectProvider() {
  if (walletConnectProvider) return walletConnectProvider;
  if (!walletConnectInitPromise) {
    walletConnectInitPromise = EthereumProvider.init({
      projectId: WALLETCONNECT_PROJECT_ID,
      chains: [AUTH_CHAIN_ID],
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
  }
  walletConnectProvider = await walletConnectInitPromise;
  return walletConnectProvider;
}

export async function getWalletProvider() {
  const injected = getInjectedProvider();
  if (injected) return injected;
  return getWalletConnectProvider();
}

export async function ensureExpectedChain(provider: Eip1193Provider) {
  const current = await chainIdOf(provider);
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
  }

  if (await chainIdOf(provider) !== AUTH_CHAIN_ID) {
    throw new Error("Wallet did not switch to BSC Testnet (chain 97). Please approve the Testnet network and try again.");
  }
}

export async function connectWallet() {
  const injected = getInjectedProvider();

  // Preserve the previously working flow: use the wallet's injected
  // provider first (MetaMask, Trust Wallet, Binance Wallet, etc.).
  if (injected) {
    let accounts = (await injected.request({ method: "eth_accounts" })) as string[];
    if (!accounts?.[0]) {
      accounts = (await injected.request({ method: "eth_requestAccounts" })) as string[];
    }
    await ensureExpectedChain(injected);
    const wallet = accounts?.[0];
    if (!wallet) throw new Error("No wallet account was selected.");
    return { provider: injected, address: wallet };
  }

  // No injected wallet: fall back to WalletConnect.
  let provider = await getWalletConnectProvider();
  try {
    if (provider.connect) {
      await provider.connect({ chains: [AUTH_CHAIN_ID] });
    }
    await ensureExpectedChain(provider);
  } catch (error) {
    try { await provider.disconnect?.(); } catch { /* stale session */ }
    walletConnectProvider = null;
    walletConnectInitPromise = null;
    provider = await getWalletConnectProvider();
    if (provider.connect) await provider.connect({ chains: [AUTH_CHAIN_ID] });
    await ensureExpectedChain(provider);
  }

  const accounts = (await provider.request({ method: "eth_accounts" })) as string[];
  const wallet = accounts?.[0];
  if (!wallet) throw new Error("No wallet account was selected.");

  walletConnectProvider = provider;
  return { provider, address: wallet };
}

export async function ensureWalletConnectedProvider() { return connectWallet(); }
export function getConnectedWalletProvider() {
  if (getInjectedProvider()) return getInjectedProvider()!;
  if (!walletConnectProvider) throw new Error("Wallet is not connected. Connect your Testnet wallet first.");
  return walletConnectProvider;
}
export function getWalletProviderOrThrow() { return getConnectedWalletProvider(); }

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
  finally {
    try { await walletConnectProvider?.disconnect?.(); } catch { /* stale session */ }
    walletConnectProvider = null;
    walletConnectInitPromise = null;
  }
}

export async function resetWalletConnectSession() {
  try { await walletConnectProvider?.disconnect?.(); } catch { /* stale session */ }
  walletConnectProvider = null;
  walletConnectInitPromise = null;
  return getWalletConnectProvider();
}
