import { EthereumProvider } from "@walletconnect/ethereum-provider";

type Eip1193Provider = {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
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

let walletProvider: Eip1193Provider | null = null;

async function getWalletProvider(): Promise<Eip1193Provider> {
  if (walletProvider) return walletProvider;

  const provider = await EthereumProvider.init({
    projectId: WALLETCONNECT_PROJECT_ID,
    chains: [AUTH_CHAIN_ID],
    showQrModal: true,
    metadata: {
      name: "AgentMarket",
      description: "Agent-to-agent marketplace on BNB Smart Chain",
      url: window.location.origin,
      icons: [],
    },
  });

  if (!provider.connected) {
    await provider.connect();
  }

  walletProvider = provider as unknown as Eip1193Provider;
  return walletProvider;
}

export async function connectWalletAndSignIn() {
  const provider = await getWalletProvider();
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
  walletProvider = null;
}
