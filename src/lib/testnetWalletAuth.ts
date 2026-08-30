import {
  AUTH_CHAIN_ID,
  connectWallet,
  connectWalletAndSignIn,
  getConnectedWalletProvider,
  getCurrentUser,
  resetWalletConnectSession,
  signOut,
} from "./walletAuth";

type Eip1193Provider = {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
};

export type AuthUser = {
  id: string;
  wallet_address: string;
  display_name: string | null;
  avatar_url: string | null;
  created_at: string;
  updated_at: string;
};

export { AUTH_CHAIN_ID };

function normalizeChainId(value: unknown): number {
  const text = String(value ?? "").trim().toLowerCase();
  if (!text) return 0;
  const parsed = text.startsWith("0x")
    ? Number.parseInt(text.slice(2), 16)
    : Number.parseInt(text, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function connectTestnetWallet() {
  const connected = await connectWallet();
  const provider = connected.provider as unknown as Eip1193Provider;
  const chainId = normalizeChainId(await provider.request({ method: "eth_chainId" }));

  if (chainId !== AUTH_CHAIN_ID) {
    throw new Error(
      `WalletConnect is on chain ${chainId || "unknown"}. AgentMarket Testnet requires BSC Testnet (chain ${AUTH_CHAIN_ID}).`,
    );
  }

  const accounts = await provider.request({ method: "eth_accounts" }) as string[];
  const address = accounts?.[0] || connected.address;
  if (!address) throw new Error("WalletConnect is connected but no account was selected.");

  return { provider, address };
}

export async function connectTestnetWalletAndSignIn() {
  return connectWalletAndSignIn();
}

export async function getTestnetCurrentUser(): Promise<AuthUser | null> {
  return getCurrentUser();
}

export function getTestnetConnectedProvider() {
  return getConnectedWalletProvider();
}

export async function resetTestnetWalletConnect() {
  return resetWalletConnectSession();
}

export async function disconnectTestnetWallet() {
  await signOut();
}
