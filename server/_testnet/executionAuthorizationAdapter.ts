import { createPublicClient, http, type Address, type Hex } from "viem";
import { bscTestnet } from "viem/chains";

export type ExecutionAuthorizationRequest = {
  wallet_provider: string;
  authorization_model: string;
  wallet: Address;
  session_key_id?: Hex;
  session_expiry?: number;
};

export type ExecutionAuthorizationResult = {
  authorized: boolean;
  method: string;
  details: Record<string, unknown>;
};

export interface ExecutionAuthorizationAdapter {
  supports(input: ExecutionAuthorizationRequest): boolean;
  verify(input: ExecutionAuthorizationRequest): Promise<ExecutionAuthorizationResult>;
}

function isAddress(value: unknown): value is Address {
  return typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value);
}

function isBytes32(value: unknown): value is Hex {
  return typeof value === "string" && /^0x[a-fA-F0-9]{64}$/.test(value);
}

const altanaKeyStoreAbi = [{
  name: "isValidKey",
  type: "function",
  stateMutability: "view",
  inputs: [
    { name: "wallet", type: "address" },
    { name: "keyId", type: "bytes32" },
  ],
  outputs: [{ name: "valid", type: "bool" }],
}] as const;

const altanaKeyStoreByNetwork: Record<string, Address> = {
  "bsc-testnet": (process.env.ALTANA_KEYSTORE_ADDRESS || "") as Address,
};

const publicClient = createPublicClient({
  chain: bscTestnet,
  transport: http(process.env.BSC_TESTNET_RPC_URL || "https://bsc-testnet-rpc.publicnode.com"),
});

const altanaAdapter: ExecutionAuthorizationAdapter = {
  supports(input) {
    return input.wallet_provider.trim().toLowerCase() === "altana"
      && input.authorization_model.trim().toLowerCase() === "scoped_session";
  },

  async verify(input) {
    const keyStore = altanaKeyStoreByNetwork["bsc-testnet"];
    if (!isAddress(keyStore)) {
      throw new Error("The Altana authorization adapter is not configured for BSC Testnet");
    }
    if (!input.session_key_id || !isBytes32(input.session_key_id)) {
      throw new Error("Altana scoped-session authorization requires a bytes32 session key id");
    }
    if (!Number.isInteger(input.session_expiry) || Number(input.session_expiry) <= Math.floor(Date.now() / 1000)) {
      throw new Error("Altana scoped-session authorization requires a future session expiry");
    }

    const valid = await publicClient.readContract({
      address: keyStore,
      abi: altanaKeyStoreAbi,
      functionName: "isValidKey",
      args: [input.wallet, input.session_key_id],
    });

    if (!valid) {
      return {
        authorized: false,
        method: "altana_keystore_isValidKey",
        details: {
          network: "bsc-testnet",
          chain_id: 97,
          wallet: input.wallet,
          key_id: input.session_key_id,
          keystore: keyStore,
        },
      };
    }

    return {
      authorized: true,
      method: "altana_keystore_isValidKey",
      details: {
        network: "bsc-testnet",
        chain_id: 97,
        wallet: input.wallet,
        key_id: input.session_key_id,
        keystore: keyStore,
        session_expiry: input.session_expiry,
      },
    };
  },
};

const adapters: ExecutionAuthorizationAdapter[] = [altanaAdapter];

export function resolveExecutionAuthorizationAdapter(input: ExecutionAuthorizationRequest) {
  return adapters.find((adapter) => adapter.supports(input)) || null;
}
