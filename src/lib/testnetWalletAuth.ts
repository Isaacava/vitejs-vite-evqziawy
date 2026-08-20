import { EthereumProvider } from "@walletconnect/ethereum-provider";

type Eip1193Provider = {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  on?: (event: string, handler: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, handler: (...args: unknown[]) => void) => void;
  disconnect?: () => Promise<void>;
  connect?: (args?: { chains?: number[] }) => Promise<void>;
  connected?: boolean;
};

declare global { interface Window { ethereum?: Eip1193Provider; } }

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
const AUTH_CHAIN_ID_HEX = "0x61";
const STORAGE = "agentmarket-testnet-wc-v4";
const TESTNET_CHAIN = {
  chainId: AUTH_CHAIN_ID_HEX,
  chainName: "BNB Smart Chain Testnet",
  nativeCurrency: { name: "BNB", symbol: "tBNB", decimals: 18 },
  rpcUrls: ["https://data-seed-prebsc-1-s1.bnbchain.org:8545"],
  blockExplorerUrls: ["https://testnet.bscscan.com"],
};

let providerRef: Eip1193Provider | null = null;
let initPromise: Promise<Eip1193Provider> | null = null;

async function chainIdOf(provider: Eip1193Provider) {
  return String(await provider.request({ method: "eth_chainId" })).toLowerCase();
}

async function dropProvider(provider: Eip1193Provider | null) {
  try { await provider?.disconnect?.(); } catch { /* ignore stale-session disconnect errors */ }
  providerRef = null;
  initPromise = null;
}

async function makeProvider(forceFresh = false): Promise<Eip1193Provider> {
  if (!forceFresh && initPromise) return initPromise;
  initPromise = EthereumProvider.init({
    projectId: WALLETCONNECT_PROJECT_ID,
    chains: [AUTH_CHAIN_ID],
    showQrModal: true,
    customStoragePrefix: STORAGE,
    metadata: {
      name: "AgentMarket Testnet",
      description: "AgentMarket BSC Testnet marketplace",
      url: window.location.origin,
      icons: [],
    },
  }).then(async (provider) => {
    const eip = provider as unknown as Eip1193Provider;
    if (!provider.connected) await provider.connect({ chains: [AUTH_CHAIN_ID] });
    // Do NOT reject a restored session just because it reports another chain.
    // connectWallet() below gets a chance to switch it to BSC Testnet.
    await chainIdOf(eip);
    providerRef = eip;
    return eip;
  });
  try { return await initPromise; } catch (error) { initPromise = null; throw error; }
}

async function ensureTestnet(provider: Eip1193Provider) {
  if ((await chainIdOf(provider)) === AUTH_CHAIN_ID_HEX) return;
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: AUTH_CHAIN_ID_HEX }] });
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? Number((error as { code?: unknown }).code) : 0;
    if (code !== 4902) throw error;
    await provider.request({ method: "wallet_addEthereumChain", params: [TESTNET_CHAIN] });
  }
  await new Promise((resolve) => setTimeout(resolve, 250));
  if ((await chainIdOf(provider)) !== AUTH_CHAIN_ID_HEX) {
    throw new Error("WalletConnect connected, but the wallet did not apply BSC Testnet (chain 97). Please approve the network switch in the wallet.");
  }
}

export async function connectTestnetWallet() {
  let provider = providerRef || await makeProvider();
  try {
    if (provider.connect) await provider.connect({ chains: [AUTH_CHAIN_ID] });
    else await provider.request({ method: "eth_requestAccounts" });
    await ensureTestnet(provider);
  } catch (firstError) {
    await dropProvider(provider);
    provider = await makeProvider(true);
    try {
      await ensureTestnet(provider);
    } catch (secondError) {
      const message = secondError instanceof Error ? secondError.message : firstError instanceof Error ? firstError.message : "Unable to establish BSC Testnet wallet connection";
      throw new Error(message);
    }
  }
  const accounts = (await provider.request({ method: "eth_accounts" })) as string[];
  const address = accounts?.[0];
  if (!address) throw new Error("No Testnet wallet account was selected.");
  providerRef = provider;
  return { provider, address };
}

export async function connectTestnetWalletAndSignIn() {
  const { provider, address: wallet } = await connectTestnetWallet();
  const challengeResponse = await fetch("/api/auth/nonce", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ wallet }) });
  const challenge = await challengeResponse.json();
  if (!challengeResponse.ok) throw new Error(challenge?.error || "Unable to start Testnet wallet sign-in");
  const signature = await provider.request({ method: "personal_sign", params: [challenge.message, wallet] });
  const verifyResponse = await fetch("/api/auth/verify", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ session_id: challenge.session_id, wallet, signature }) });
  const verified = await verifyResponse.json();
  if (!verifyResponse.ok) throw new Error(verified?.error || "Testnet wallet signature verification failed");
  return verified.user as AuthUser;
}

export async function getTestnetCurrentUser() {
  const response = await fetch("/api/auth/me", { credentials: "include" });
  if (!response.ok) return null;
  const data = (await response.json()) as { authenticated: boolean; user?: AuthUser };
  return data.authenticated ? data.user || null : null;
}

export function getTestnetConnectedProvider() {
  if (!providerRef) throw new Error("WalletConnect is not connected. Connect your Testnet wallet first.");
  return providerRef;
}

export async function resetTestnetWalletConnect() {
  await dropProvider(providerRef);
  return makeProvider(true);
}

export async function disconnectTestnetWallet() {
  await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
  await dropProvider(providerRef);
}
