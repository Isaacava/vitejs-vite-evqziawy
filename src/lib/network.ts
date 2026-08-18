import { bsc, bscTestnet } from "viem/chains";
import type { Address, Chain } from "viem";

export type BscNetworkName = "mainnet" | "testnet";
export type AppEnvironment = "production" | "testnet";

type ViteRuntimeEnv = Record<string, string | undefined>;
const runtimeEnv = (import.meta as unknown as { env?: ViteRuntimeEnv }).env ?? {};

const configuredEnvironment = (runtimeEnv.VITE_APP_ENV || "production").toLowerCase();
export const APP_ENV: AppEnvironment = configuredEnvironment === "testnet" ? "testnet" : "production";

const configuredNetwork = (runtimeEnv.VITE_BSC_NETWORK || "mainnet").toLowerCase();

if (APP_ENV === "production" && configuredNetwork === "testnet") {
  throw new Error("Production AgentMarket cannot run against BSC Testnet. Use a dedicated VITE_APP_ENV=testnet build.");
}

export const BSC_NETWORK: BscNetworkName = APP_ENV === "testnet" ? "testnet" : "mainnet";
export const BSC_CHAIN: Chain = BSC_NETWORK === "testnet" ? bscTestnet : bsc;
export const BSC_CHAIN_ID = BSC_CHAIN.id;

const DEFAULT_MAINNET_RPC = "https://bsc-dataseed.bnbchain.org";
const DEFAULT_TESTNET_RPC = "https://data-seed-prebsc-1-s1.bnbchain.org:8545";

export const BSC_RPC_URL =
  runtimeEnv.VITE_BSC_RPC_URL ||
  (BSC_NETWORK === "testnet" ? DEFAULT_TESTNET_RPC : DEFAULT_MAINNET_RPC);

export const BSC_EXPLORER_URL =
  BSC_NETWORK === "testnet" ? "https://testnet.bscscan.com" : "https://bscscan.com";

function requireAddress(name: string, value: string | undefined): Address {
  if (!value || !/^0x[a-fA-F0-9]{40}$/.test(value)) {
    throw new Error(
      `${name} is required for BSC ${BSC_NETWORK}. Set the corresponding VITE_* environment variable.`
    );
  }
  return value as Address;
}

const MAINNET_ADDRESSES = {
  commerce: "0xea4daa3100a767e86fded867729ae7446476eba6",
  router: "0x51895229e12f9876011789b04f8698af06ccd6da",
  policy: "0x9c01845705b3078aa2e8cff7520a6376fd766de5",
  registry: "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432",
} as const;

export const NETWORK_CONTRACTS = BSC_NETWORK === "mainnet"
  ? MAINNET_ADDRESSES
  : {
      commerce: requireAddress("VITE_ERC8183_COMMERCE_ADDRESS", runtimeEnv.VITE_ERC8183_COMMERCE_ADDRESS),
      router: requireAddress("VITE_ERC8183_ROUTER_ADDRESS", runtimeEnv.VITE_ERC8183_ROUTER_ADDRESS),
      policy: requireAddress("VITE_ERC8183_POLICY_ADDRESS", runtimeEnv.VITE_ERC8183_POLICY_ADDRESS),
      registry: requireAddress("VITE_ERC8004_REGISTRY_ADDRESS", runtimeEnv.VITE_ERC8004_REGISTRY_ADDRESS),
    };

export function assertExpectedChain(actualChainId: number) {
  if (actualChainId !== BSC_CHAIN_ID) {
    throw new Error(
      `Wrong BSC network: expected chain ${BSC_CHAIN_ID}, received ${actualChainId}.`
    );
  }
}

export function explorerTxUrl(hash: string) {
  return `${BSC_EXPLORER_URL}/tx/${hash}`;
}

export function explorerAddressUrl(address: string) {
  return `${BSC_EXPLORER_URL}/address/${address}`;
}
