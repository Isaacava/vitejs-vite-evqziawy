import { bscTestnet } from "viem/chains";
import type { Address, Chain } from "viem";

export type BscNetworkName = "testnet";
export type AppEnvironment = "testnet";

export const APP_ENV: AppEnvironment = "testnet";
export const BSC_NETWORK: BscNetworkName = "testnet";
export const BSC_CHAIN: Chain = bscTestnet;
export const BSC_CHAIN_ID = 97;

// Dedicated Testnet build: do not inherit the stale public BNB seed RPC.
export const BSC_RPC_URL = "https://bsc-testnet-rpc.publicnode.com";

export const BSC_EXPLORER_URL = "https://testnet.bscscan.com";

const runtimeEnv = (import.meta as unknown as {
  env?: {
    VITE_ERC8183_COMMERCE_ADDRESS?: string;
    VITE_ERC8183_ROUTER_ADDRESS?: string;
    VITE_ERC8183_POLICY_ADDRESS?: string;
  };
}).env;

const TESTNET_CONTRACTS = {
  commerce: runtimeEnv?.VITE_ERC8183_COMMERCE_ADDRESS || "0xa206c0517b6371c6638cd9e4a42cc9f02a33b0de",
  router: runtimeEnv?.VITE_ERC8183_ROUTER_ADDRESS || "0x6d948b47614dbfbbf97a5e3fd9b410deeab44f17",
  policy: runtimeEnv?.VITE_ERC8183_POLICY_ADDRESS || "0xc4f85d602235e14a45fd1d9794c4092af762b1a6",
  registry: "0x8004A818BFB912233c491871b3d84c89A494BD9e",
} as const;

function asAddress(value: string, name: string): Address {
  if (!/^0x[a-fA-F0-9]{40}$/.test(value)) {
    throw new Error(`${name} is not a valid Testnet contract address.`);
  }
  return value as Address;
}

export const NETWORK_CONTRACTS = {
  commerce: asAddress(TESTNET_CONTRACTS.commerce, "VITE_ERC8183_COMMERCE_ADDRESS"),
  router: asAddress(TESTNET_CONTRACTS.router, "VITE_ERC8183_ROUTER_ADDRESS"),
  policy: asAddress(TESTNET_CONTRACTS.policy, "VITE_ERC8183_POLICY_ADDRESS"),
  registry: asAddress(TESTNET_CONTRACTS.registry, "ERC-8004 registry"),
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
