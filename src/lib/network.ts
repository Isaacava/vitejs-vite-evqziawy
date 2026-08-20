import { bscTestnet } from "viem/chains";
import type { Address, Chain } from "viem";

export type BscNetworkName = "testnet";
export type AppEnvironment = "testnet";

export const APP_ENV: AppEnvironment = "testnet";
export const BSC_NETWORK: BscNetworkName = "testnet";
export const BSC_CHAIN: Chain = bscTestnet;
export const BSC_CHAIN_ID = 97;

// Dedicated Testnet build: ignore stale Vercel VITE_BSC_RPC_URL overrides.
export const BSC_RPC_URL = "https://bsc-testnet-rpc.publicnode.com";

export const BSC_EXPLORER_URL = "https://testnet.bscscan.com";

const TESTNET_CONTRACTS = {
  commerce: "0xa206c0517b6371c6638cd9e4a42cc9f02a33b0de",
  router: "0xd7d36d66d2f1b608a0f943f722d27e3744f66f25",
  policy: "0x4f4678d4439fec812ac7674bb3efb4c8f5fb78a6",
  registry: "0x8004A818BFB912233c491871b3d84c89A494BD9e",
} as const;

export const NETWORK_CONTRACTS = {
  commerce: TESTNET_CONTRACTS.commerce as Address,
  router: TESTNET_CONTRACTS.router as Address,
  policy: TESTNET_CONTRACTS.policy as Address,
  registry: TESTNET_CONTRACTS.registry as Address,
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
