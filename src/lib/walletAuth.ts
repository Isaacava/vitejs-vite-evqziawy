import { EthereumProvider } from "@walletconnect/ethereum-provider";

type Eip1193Provider = {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  on?: (event: string, handler: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, handler: (...args: unknown[]) => void) => void;
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
const TESTNET_RPC_URL = "https://data-seed-prebsc-1-s1.bnbchain.org:8545";
const TESTNET_EXPLORER_URL = "https://testnet.bscscan.com";

let walletProvider: Eip1193Provider | null = null;

async function ensureTestnetChain(provider: Eip1193Provider) {
  const current = String(await provider.request({ method: "eth_chainId" })).toLowerCase();
  if (current === AUTH_CHAIN_ID_HEX) return;

  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: AUTH_CHAIN_ID_HEX }],
    });
  } catch (switchError: unknown) {
    const code = typeof switchError === "object" && switchError !== null && "code" in switchError
      ? Number((switchError as { code?: unknown }).code)
      : 0;
    if (code !== 4902) throw new Error("WalletConnect is connected to the wrong network. Switch to BSC Testnet (chain 97) in your wallet.");

    await provider.request({
      method: "wallet_addEthereumChain",
      params: [{
        chainId: AUTH_CHAIN_ID_HEX,
        chainName: "BNB Smart Chain Testnet",
        nativeCurrency: { name: "tBNB", symbol: "tBNB", decimals: 18 },
        rpcUrls: [TESTNET_RPC_URL],
        blockExplorerUrls: [TESTNET_EXPLORER_URL],
      }],
    });
  }

  const verified = String(await provider.request({ method: "eth_chainId" })).toLowerCase();
  if (verified !== AUTH_CHAIN_ID_HEX) {
    throw new Error("WalletConnect could not switch to BSC Testnet (chain 97). Mainnet transactions are disabled in this preview.");
  }
}

async function getWalletProvider(): Promise<Eip1193Provider> {
  if (walletProvider) {
    await ensureTestnetChain(walletProvider);
    return walletProvider;
  }

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
  await ensureTestnetChain(eip1193);

  walletProvider = eip1193;
  window.ethereum = eip1193;
  return eip1193;
}

export async function ensureWalletConnectedProvider() {
  const provider = await getWalletProvider();
  await ensureTestnetChain(provider);

  const accounts = (await provider.request({ method: "eth_accounts" })) as string[];
  if (!accounts?.[0]) throw new Error("No wallet account is connected. Connect with WalletConnect to continue.");

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
  walletProvider = null;
  delete window.ethereum;
}
