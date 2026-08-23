import { EthereumProvider } from "@walletconnect/ethereum-provider";

type Eip1193Provider = {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  on?: (event: string, handler: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, handler: (...args: unknown[]) => void) => void;
  disconnect?: () => Promise<void>;
  connect?: (args?: { chains?: number[] }) => Promise<void>;
  connected?: boolean;
  session?: {
    namespaces?: {
      eip155?: {
        accounts?: string[];
      };
    };
  };
};

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
const STORAGE = "agentmarket-testnet-wc-v6";
const TESTNET_RPC = "https://bsc-testnet-rpc.publicnode.com";

let providerRef: Eip1193Provider | null = null;
let initPromise: Promise<Eip1193Provider> | null = null;

function normalizeChainId(value: unknown): number {
  const text = String(value ?? "").trim().toLowerCase();
  if (!text) return 0;
  if (text.startsWith("0x")) {
    const parsed = Number.parseInt(text.slice(2), 16);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  const parsed = Number.parseInt(text, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function chainIdOf(provider: Eip1193Provider): Promise<number> {
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
  try {
    await provider?.disconnect?.();
  } catch {
    // Ignore stale WalletConnect disconnect failures.
  }
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
    rpcMap: {
      [AUTH_CHAIN_ID]: TESTNET_RPC,
    },
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

    // EthereumProvider restores an existing WalletConnect session from its
    // persistent storage during init. Do not call connect() again when that
    // session is already a valid BSC Testnet session; doing so can reopen the
    // wallet connection UI and makes users think AgentMarket lost their login.
    if (!hasTestnetSession(eip)) {
      await eip.connect?.({ chains: [AUTH_CHAIN_ID] });
    }

    if (!hasTestnetSession(eip)) {
      await dropProvider(eip);
      throw new Error(
        "The connected wallet did not approve BSC Testnet (chain 97). Reconnect WalletConnect and approve the Testnet network in the wallet.",
      );
    }

    const chainId = await chainIdOf(eip);
    if (chainId !== AUTH_CHAIN_ID) {
      await dropProvider(eip);
      throw new Error(
        `WalletConnect established a session, but the active chain is ${chainId || "unknown"}. AgentMarket Testnet requires chain 97.`,
      );
    }

    providerRef = eip;
    return eip;
  });

  try {
    return await initPromise;
  } catch (error) {
    initPromise = null;
    throw error;
  }
}

export async function connectTestnetWallet() {
  let provider = providerRef;

  if (!provider) provider = await makeProvider();

  try {
    if (!hasTestnetSession(provider)) {
      await dropProvider(provider);
      provider = await makeProvider(true);
    }

    const chainId = await chainIdOf(provider);
    if (chainId !== AUTH_CHAIN_ID) {
      await dropProvider(provider);
      provider = await makeProvider(true);
    }
  } catch {
    await dropProvider(provider);
    provider = await makeProvider(true);
  }

  const accounts = (await provider.request({ method: "eth_accounts" })) as string[];
  const address = accounts?.[0];
  if (!address) throw new Error("Wallet connected to BSC Testnet but no account was selected.");

  providerRef = provider;
  return { provider, address };
}

export async function connectTestnetWalletAndSignIn() {
  const { provider, address: wallet } = await connectTestnetWallet();

  const challengeResponse = await fetch("/api/auth/nonce", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
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
    credentials: "include",
    body: JSON.stringify({ session_id: challenge.session_id, wallet, signature }),
  });
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
