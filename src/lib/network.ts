import { bscTestnet } from "viem/chains";
import type { Address, Chain } from "viem";

export type BscNetworkName = "testnet";
export type AppEnvironment = "testnet";

// This branch is the marketplace's complete development environment.
// It is intentionally hard-locked to BSC Testnet so production/mainnet
// contracts, balances, and transactions cannot be used accidentally.
export const APP_ENV: AppEnvironment = "testnet";
export const BSC_NETWORK: BscNetworkName = "testnet";
export const BSC_CHAIN: Chain = bscTestnet;
export const BSC_CHAIN_ID = 97;

export const BSC_RPC_URL =
  import.meta.env.VITE_BSC_RPC_URL ||
  "https://data-seed-prebsc-1-s1.bnbchain.org:8545";

export const BSC_EXPLORER_URL = "https://testnet.bscscan.com";

function requireAddress(name: string, value: string | undefined): Address {
  if (!value || !/^0x[a-fA-F0-9]{40}$/.test(value)) {
    throw new Error(
      `${name} is required for the marketplace testnet build. Set the corresponding VITE_* environment variable.`
    );
  }
  return value as Address;
}

// Testnet contract addresses are deliberately environment-provided so the
// test marketplace can follow the current BNB Agent SDK/APEX testnet presets
// without ever sharing production addresses.
export const NETWORK_CONTRACTS = {
  commerce: requireAddress(
    "VITE_ERC8183_COMMERCE_ADDRESS",
    import.meta.env.VITE_ERC8183_COMMERCE_ADDRESS,
  ),
  router: requireAddress(
    "VITE_ERC8183_ROUTER_ADDRESS",
    import.meta.env.VITE_ERC8183_ROUTER_ADDRESS,
  ),
  policy: requireAddress(
    "VITE_ERC8183_POLICY_ADDRESS",
    import.meta.env.VITE_ERC8183_POLICY_ADDRESS,
  ),
  registry: requireAddress(
    "VITE_ERC8004_REGISTRY_ADDRESS",
    import.meta.env.VITE_ERC8004_REGISTRY_ADDRESS,
  ),
} as const;

export function assertExpectedChain(actualChainId: number) {
  if (actualChainId !== BSC_CHAIN_ID) {
    throw new Error(
      `Wrong BSC network: expected BSC Testnet (chain ${BSC_CHAIN_ID}), received ${actualChainId}.`,
    );
  }
}

export function explorerTxUrl(hash: string) {
  return `${BSC_EXPLORER_URL}/tx/${hash}`;
}

export function explorerAddressUrl(address: string) {
  return `${BSC_EXPLORER_URL}/address/${address}`;
}
