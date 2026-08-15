type Eip1193Provider = {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
};

declare global {
  interface Window {
    ethereum?: Eip1193Provider;
  }
}

export type PreparedTransaction = {
  to: string;
  data?: string;
  value?: string;
};

export type ConfirmedTransaction = {
  hash: string;
  blockNumber: string;
};

const TX_HASH = /^0x[a-fA-F0-9]{64}$/;

function provider() {
  if (!window.ethereum) throw new Error("No compatible browser wallet was detected.");
  return window.ethereum;
}

function transaction(tx: PreparedTransaction) {
  if (!/^0x[a-fA-F0-9]{40}$/.test(tx.to)) throw new Error("Transaction target is not a valid EVM address.");
  if (tx.data && !/^0x[0-9a-fA-F]*$/.test(tx.data)) throw new Error("Transaction calldata is invalid.");
  return {
    to: tx.to,
    ...(tx.data ? { data: tx.data } : {}),
    ...(tx.value ? { value: tx.value } : {}),
  };
}

export async function sendPreparedTransaction(tx: PreparedTransaction) {
  const hash = String(await provider().request({
    method: "eth_sendTransaction",
    params: [transaction(tx)],
  }));
  if (!TX_HASH.test(hash)) throw new Error("The wallet returned an invalid transaction hash.");
  return hash;
}

export async function waitForTransaction(hash: string, timeoutMs = 180_000, pollMs = 2_500) {
  if (!TX_HASH.test(hash)) throw new Error("Invalid transaction hash.");
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const receipt = await provider().request({
      method: "eth_getTransactionReceipt",
      params: [hash],
    }) as null | {
      status?: string;
      blockNumber?: string;
    };
    if (receipt) {
      const status = receipt.status?.toLowerCase();
      if (status !== "0x1") throw new Error(`Transaction ${hash.slice(0, 10)}… failed or was reverted.`);
      if (!receipt.blockNumber) throw new Error("Confirmed transaction is missing a block number.");
      return {
        hash,
        blockNumber: BigInt(receipt.blockNumber).toString(),
      } satisfies ConfirmedTransaction;
    }
    await new Promise((resolve) => window.setTimeout(resolve, pollMs));
  }
  throw new Error("Transaction confirmation timed out. Check the transaction in your wallet/explorer before retrying.");
}

export async function sendAndConfirm(tx: PreparedTransaction) {
  const hash = await sendPreparedTransaction(tx);
  return waitForTransaction(hash);
}
