import { EthereumProvider } from "@walletconnect/ethereum-provider";

type Eip1193Provider = {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  on?: (event: string, handler: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, handler: (...args: unknown[]) => void) => void;
  disconnect?: () => Promise<void>;
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

let walletProvider: Eip1193Provider | null = null;

function currentProviderChain(provider: Eip1193Provider): Promise<string> {
  return provider.request({ method: "eth_chainId" }).then((value) => String(value).toLowerCase());
}

async function disconnectWalletConnectSession(provider: Eip1193Provider) {
  try {
    await provider.disconnect?.();
  } catch {
    // A stale WalletConnect session can fail during disconnect. We can still clear our
    // provider reference and let the next call create a fresh Testnet-only session.
  }
  walletProvider = null;
  // Do not delete window.ethereum here. Wallet browsers can expose it as a non-configurable
  // property, and deleting it can throw "Cannot delete property 'ethereum' of #<Window>".
  // The next successful connection simply replaces the reference with the fresh WC provider.
}

async function createTestnetProvider(): Promise<Eip1193Provider> {
  const provider = await EthereumProvider.init({
    projectId: WALLETCONNECT_PROJECT_ID,
    chains: [AUTH_CHAIN_ID],
    showQrModal: true,
    metadata: {
      name: "AgentMarket Testnet",
      description: "AgentMarket BSC Testnet marketplace",
      url: window.location.origin,
      icons: [],
    },
  });

  if (!provider.connected) {
    await provider.connect();
  }

  const eip1193 = provider as unknown as Eip1193Provider;
  const chainId = await currentProviderChain(eip1193);
  if (chainId !== AUTH_CHAIN_ID_HEX) {
    await disconnectWalletConnectSession(eip1193);
    throw new Error(
      "WalletConnect did not establish a BSC Testnet session. Reconnect and select BSC Testnet (chain 97)."
    );
  }

  walletProvider = eip1193;
  window.ethereum = eip1193;
  return eip1193;
}

async function getWalletProvider(): Promise<Eip1193Provider> {
  if (walletProvider) {
    const current = await currentProviderChain(walletProvider);
    if (current === AUTH_CHAIN_ID_HEX) return walletProvider;
    await disconnectWalletConnectSession(walletProvider);
  }

  return createTestnetProvider();
}

export async function ensureWalletConnectedProvider() {
  let provider = await getWalletProvider();
  let chainId = await currentProviderChain(provider);

  if (chainId !== AUTH_CHAIN_ID_HEX) {
    await disconnectWalletConnectSession(provider);
    provider = await createTestnetProvider();
    chainId = await currentProviderChain(provider);
  }

  if (chainId !== AUTH_CHAIN_ID_HEX) {
    throw new Error("WalletConnect is not on BSC Testnet (chain 97). Mainnet transactions are disabled in this preview.");
  }

  const accounts = (await provider.request({ method: "eth_accounts" })) as string[];
  if (!accounts?.[0]) throw new Error("No Testnet wallet is connected. Connect with WalletConnect to continue.");

  window.ethereum = provider;
  return { provider, address: accounts[0] };
}

export function getConnectedWalletProvider() {
  if (!walletProvider) throw new Error("WalletConnect is not connected. Connect your Testnet wallet first.");
  return walletProvider;
}

export async function connectWalletAndSignIn() {
  const { provider, address: wallet } = await ensureWalletConnectedProvider();

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

  window.ethereum = provider;
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
  if (walletProvider) await disconnectWalletConnectSession(walletProvider);
  walletProvider = null;
  // Do not delete window.ethereum; see disconnectWalletConnectSession above.
}
