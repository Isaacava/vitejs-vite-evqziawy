import { EthereumProvider } from "@walletconnect/ethereum-provider";
import { BSC_RPC_URL } from "./network";

type Eip1193Provider = {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  on?: (event: string, handler: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, handler: (...args: unknown[]) => void) => void;
  disconnect?: () => Promise<void>;
  connect?: (args?: { chains?: number[] }) => Promise<void>;
  connected?: boolean;
  session?: { namespaces?: { eip155?: { accounts?: string[] } } };
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
const STORAGE = "agentmarket-testnet-wc-v6";
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

function hasTestnetSession(provider: Eip1193Provider) {
  const accounts = provider.session?.namespaces?.eip155?.accounts || [];
  return accounts.some((account) => {
    const match = /^eip155:(\d+):0x[a-fA-F0-9]{40}$/.exec(account);
    return !!match && Number(match[1]) === AUTH_CHAIN_ID;
  });
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
  }).then(async (provider) => {
    const eip = provider as unknown as Eip1193Provider;

    // This explicit chain request is the same handshake used by the
    // previously working Testnet login flow.
    await eip.connect?.({ chains: [AUTH_CHAIN_ID] });

    if (!hasTestnetSession(eip)) {
      await dropProvider(eip);
      throw new Error("The connected wallet did not approve BSC Testnet (chain 97). Reconnect WalletConnect and approve the Testnet network in the wallet.");
    }

    const chainId = await chainIdOf(eip);
    if (chainId !== AUTH_CHAIN_ID) {
      await dropProvider(eip);
      throw new Error(`WalletConnect established a session, but the active chain is ${chainId || "unknown"}. AgentMarket Testnet requires chain 97.`);
    }

    providerRef = eip;
    return eip;
  });

  try { return await initPromise; }
  catch (error) { initPromise = null; throw error; }
}

async function ensureExpectedChain(provider: Eip1193Provider) {
  const chainId = await chainIdOf(provider);
  if (chainId === AUTH_CHAIN_ID) return;

  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: AUTH_CHAIN_ID_HEX }] });
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? Number((error as { code?: unknown }).code) : 0;
    if (code !== 4902) throw new Error("Your wallet is not on BSC Testnet (chain 97). Approve the Testnet network switch and try again.");
    await provider.request({ method: "wallet_addEthereumChain", params: [TESTNET_CHAIN_CONFIG] });
  }

  if (await chainIdOf(provider) !== AUTH_CHAIN_ID) {
    throw new Error("WalletConnect is connected, but the active wallet network is not BSC Testnet (chain 97). Switch to BSC Testnet and try again.");
  }
}

export async function connectWallet() {
  let provider = providerRef;
  if (!provider) provider = await makeProvider();

  try {
    if (!hasTestnetSession(provider)) {
      await dropProvider(provider);
      provider = await makeProvider(true);
    }

    if (await chainIdOf(provider) !== AUTH_CHAIN_ID) {
      await dropProvider(provider);
      provider = await makeProvider(true);
    }
  } catch {
    await dropProvider(provider);
    provider = await makeProvider(true);
  }

  let accounts = (await provider.request({ method: "eth_accounts" })) as string[];

  if (!accounts?.[0]) {
    try {
      if (provider.connect) await provider.connect({ chains: [AUTH_CHAIN_ID] });
      else await provider.request({ method: "eth_requestAccounts" });
    } catch {
      await dropProvider(provider);
      provider = await makeProvider(true);
    }
    accounts = (await provider.request({ method: "eth_accounts" })) as string[];
  }

  await ensureExpectedChain(provider);

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
