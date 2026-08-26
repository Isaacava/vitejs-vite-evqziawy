import { createPublicClient, http, type Hex } from "viem";
import { bscTestnet } from "viem/chains";

const publicClient = createPublicClient({
  chain: bscTestnet,
  transport: http(process.env.BSC_TESTNET_RPC_URL || "https://bsc-testnet-rpc.publicnode.com"),
});

function isHash(value: string): value is Hex {
  return /^0x[a-fA-F0-9]{64}$/.test(value);
}

export async function observeTestnetReceipt(hash: string) {
  if (!isHash(hash)) throw new Error("transaction hash must be a 32-byte transaction hash");

  try {
    const receipt = await publicClient.getTransactionReceipt({ hash });
    return {
      chainId: 97,
      observed: true,
      transaction_hash: receipt.transactionHash,
      block_number: receipt.blockNumber.toString(),
      block_hash: receipt.blockHash,
      status: receipt.status,
      gas_used: receipt.gasUsed.toString(),
      effective_gas_price: receipt.effectiveGasPrice.toString(),
      contract_address: receipt.contractAddress,
      from: receipt.from,
      to: receipt.to,
    };
  } catch {
    return {
      chainId: 97,
      observed: false,
      transaction_hash: hash,
      status: null,
    };
  }
}
