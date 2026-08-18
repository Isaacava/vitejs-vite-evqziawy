import EthereumProvider from "@walletconnect/ethereum-provider";
import { APP_ENV, BSC_CHAIN_ID, BSC_CHAIN } from "./network";

type Eip1193Provider = {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
  disconnect?: () => Promise<void>;
  connect?: () => Promise<void>;
};

declare global {
  interface Window {
    ethereum?: Eip1193Provider;
  }
}

export type AuthUser = {
  id: string;
  wallet_address: string;
  display_name: string | null;
  avatar_url: string | null;
  created_at: string;
  updated_at: string;
};

const runtimeEnv = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};
const WALLETCONNECT_PROJECT_ID = runtimeEnv.VITE_WALLETCONNECT_PROJECT_ID || "1dbe8fd5e4974ae7c80d074c4082b5a0";

let walletConnectProvider: Eip1193Provider | null = null;
let walletConnectInitPromise: Promise<Eip1193Provider> | null = null;

function chainConfig() {
  return {
    chainId: `0x${BSC_CHAIN_ID.toString(16)}`,
    chainName: BSC_CHAIN.name,
    nativeCurrency: BSC_CHAIN.nativeCurrency,
    rpcUrls: [BSC_CHAIN.rpcUrls.default.http[0]],
    blockExplorerUrls: [BSC_CHAIN.blockExplorers?.default.url || "https://bscscan.com"],
  };
}

async function getWalletConnectProvider() {
  if (walletConnectProvider) return walletConnectProvider;
  if (!walletConnectInitPromise) {
    walletConnectInitPromise = EthereumProvider.init({
      projectId: WALLETCONNECT_PROJECT_ID,
      chains: [BSC_CHAIN_ID],
      optionalChains: APP_ENV === "testnet" ? [56] : [97],
      showQrModal: true,
      metadata: {
        name: "AgentMarket",
        description: "AgentMarket on-chain agent marketplace",
        url: window.location.origin,
        icons: [`${window.location.origin}/favicon.svg`],
      },
    }).then((provider) => {
      const eip1193 = provider as unknown as Eip1193Provider;
      walletConnectProvider = eip1193;
      return eip1193;
    });
  }
  return walletConnectInitPromise;
}

export async function getWalletProvider() {
  if (window.ethereum) return window.ethereum;
  return getWalletConnectProvider();
}

export async function connectWallet() {
  const provider = await getWalletProvider();
  if (provider === walletConnectProvider && provider.connect) {
    await provider.connect();
  } else {
    await provider.request({ method: "eth_requestAccounts" });
  }
  await ensureExpectedChain(provider);
  return provider;
}

export async function ensureExpectedChain(provider: Eip1193Provider) {
  const chainIdHex = String(await provider.request({ method: "eth_chainId" }));
  const expectedHex = `0x${BSC_CHAIN_ID.toString(16)}`;
  if (chainIdHex.toLowerCase() === expectedHex.toLowerCase()) return;

  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: expectedHex }] });
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error
      ? Number((error as { code?: unknown }).code)
      : 0;
    if (code !== 4902) throw error;
    await provider.request({ method: "wallet_addEthereumChain", params: [chainConfig()] });
  }
}

export async function connectWalletAndSignIn() {
  const provider = await connectWallet();
  const accounts = (await provider.request({ method: "eth_accounts" })) as string[];
  const wallet = accounts?.[0];
  if (!wallet) throw new Error("No wallet account was selected.");

  const challengeResponse = await fetch("/api/auth/nonce", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ wallet }),
  });
  const challenge = await challengeResponse.json();
  if (!challengeResponse.ok) throw new Error(challenge?.error || "Unable to start wallet sign-in");

  const signature = await provider.request({
    method: "personal_sign",
    params: [challenge.message, wallet],
  });

  const verifyResponse = await fetch("/api/auth/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session_id: challenge.session_id, wallet, signature }),
  });
  const verified = await verifyResponse.json();
  if (!verifyResponse.ok) throw new Error(verified?.error || "Wallet signature verification failed");

  return verified.user as AuthUser;
}

export async function getCurrentUser() {
  const response = await fetch("/api/auth/me", { credentials: "include" });
  if (!response.ok) return null;
  const data = (await response.json()) as { authenticated: boolean; user?: AuthUser };
  return data.authenticated ? data.user || null : null;
}

export async function signOut() {
  await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
}

export async function disconnectWallet() {
  if (walletConnectProvider?.disconnect) await walletConnectProvider.disconnect();
  walletConnectProvider = null;
  walletConnectInitPromise = null;
}
