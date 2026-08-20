import { EthereumProvider } from "@walletconnect/ethereum-provider";

type Eip1193Provider = {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  on?: (event: string, handler: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, handler: (...args: unknown[]) => void) => void;
  disconnect?: () => Promise<void>;
  connect?: (args?: { chains?: number[] }) => Promise<void>;
  connected?: boolean;
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

export const WALLETCONNECT_PROJECT_ID = "1dbe8fd5e4974ae7c80d074c4082b5a0";
export const AUTH_CHAIN_ID = 97;
const AUTH_CHAIN_ID_HEX = `0x${AUTH_CHAIN_ID.toString(16)}`;
const TESTNET_WALLETCONNECT_STORAGE = "agentmarket-testnet-wc-v3";
const TESTNET_CHAIN_CONFIG = {
  chainId: AUTH_CHAIN_ID_HEX,
  chainName: "BNB Smart Chain Testnet",
  nativeCurrency: { name: "BNB", symbol: "tBNB", decimals: 18 },
  rpcUrls: ["https://data-seed-prebsc-1-s1.bnbchain.org:8545"],
  blockExplorerUrls: ["https://testnet.bscscan.com"],
};

let walletProvider: Eip1193Provider | null = null;
let walletConnectInitPromise: Promise<Eip1193Provider> | null = null;

async function getChainId(provider: Eip1193Provider) {
  const value = await provider.request({ method: "eth_chainId" });
  return String(value).toLowerCase();
}

async function disconnectWalletConnectSession(provider: Eip1193Provider | null) {
  try {
    await provider?.disconnect?.();
  } catch {
    // Stale sessions can reject disconnect. We still discard our local reference.
  }
  walletProvider = null;
  walletConnectInitPromise = null;
}

async function createTestnetProvider(forceFresh = false): Promise<Eip1193Provider> {
  if (!forceFresh && walletConnectInitPromise) return walletConnectInitPromise;

  walletConnectInitPromise = EthereumProvider.init({
    projectId: WALLETCONNECT_PROJECT_ID,
    chains: [AUTH_CHAIN_ID],
    showQrModal: true,
    customStoragePrefix: TESTNET_WALLETCONNECT_STORAGE,
    metadata: {
      name: "AgentMarket Testnet",
      description: "AgentMarket BSC Testnet marketplace",
      url: window.location.origin,
      icons: [],
    },
  }).then(async (provider) => {
    const eip1193 = provider as unknown as Eip1193Provider;

    if (!provider.connected) {
      await provider.connect({ chains: [AUTH_CHAIN_ID] });
    }

    let chainId: string;
    try {
      chainId = await getChainId(eip1193);
    } catch (cause) {
      await disconnectWalletConnectSession(eip1193);
      throw new Error(
        cause instanceof Error
          ? `WalletConnect Testnet session is unavailable: ${cause.message}`
          : "WalletConnect Testnet session is unavailable. Please reconnect.",
      );
    }

    if (chainId !== AUTH_CHAIN_ID_HEX) {
      await disconnectWalletConnectSession(eip1193);
      throw new Error(
        "WalletConnect did not establish BSC Testnet (chain 97). Reconnect the wallet and approve the Testnet network.",
      );
    }

    walletProvider = eip1193;
    return eip1193;
  });

  try {
    return await walletConnectInitPromise;
  } catch (error) {
    walletConnectInitPromise = null;
    throw error;
  }
}

async function getWalletProvider(): Promise<Eip1193Provider> {
  if (walletProvider) {
    try {
      if ((await getChainId(walletProvider)) === AUTH_CHAIN_ID_HEX) return walletProvider;
    } catch {
      // The provider is stale/disconnected. Recreate it below.
    }
    await disconnectWalletConnectSession(walletProvider);
  }

  return createTestnetProvider();
}

async function ensureExpectedChain(provider: Eip1193Provider) {
  let chainId = await getChainId(provider);
  if (chainId === AUTH_CHAIN_ID_HEX) return;

  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: AUTH_CHAIN_ID_HEX }],
    });
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error
      ? Number((error as { code?: unknown }).code)
      : 0;
    if (code !== 4902) throw error;

    await provider.request({
      method: "wallet_addEthereumChain",
      params: [TESTNET_CHAIN_CONFIG],
    });
  }

  chainId = await getChainId(provider);
  if (chainId !== AUTH_CHAIN_ID_HEX) {
    throw new Error("WalletConnect is not on BSC Testnet (chain 97). Mainnet is disabled on this page.");
  }
}

export async function connectWallet() {
  let provider = await getWalletProvider();

  try {
    if (provider === walletProvider && provider.connect) {
      await provider.connect({ chains: [AUTH_CHAIN_ID] });
    } else {
      await provider.request({ method: "eth_requestAccounts" });
    }
    await ensureExpectedChain(provider);
  } catch (error) {
    await disconnectWalletConnectSession(provider);
    provider = await createTestnetProvider(true);
    await ensureExpectedChain(provider);
  }

  const accounts = (await provider.request({ method: "eth_accounts" })) as string[];
  const wallet = accounts?.[0];
  if (!wallet) throw new Error("No Testnet wallet account was selected.");

  walletProvider = provider;
  return { provider, address: wallet };
}

export async function ensureWalletConnectedProvider() {
  return connectWallet();
}

export function getConnectedWalletProvider() {
  if (!walletProvider) throw new Error("WalletConnect is not connected. Connect your Testnet wallet first.");
  return walletProvider;
}

export async function connectWalletAndSignIn() {
  const { provider, address: wallet } = await connectWallet();

  const challengeResponse = await fetch("/api/auth/nonce", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ wallet }),
  });
  const challenge = await challengeResponse.json();
  if (!challengeResponse.ok) throw new Error(challenge?.error || "Unable to start Testnet wallet sign-in");

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
  if (!verifyResponse.ok) throw new Error(verified?.error || "Testnet wallet signature verification failed");

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
  await disconnectWalletConnectSession(walletProvider);
}

export async function resetWalletConnectSession() {
  await disconnectWalletConnectSession(walletProvider);
  return createTestnetProvider(true);
}
