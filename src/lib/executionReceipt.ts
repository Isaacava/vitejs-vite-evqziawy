export type TestnetExecutionReceipt = {
  chainId: number;
  observed: boolean;
  transaction_hash: string;
  block_number?: string;
  block_hash?: string;
  status?: "success" | "reverted" | null;
  gas_used?: string;
  effective_gas_price?: string;
  contract_address?: string | null;
  from?: string;
  to?: string | null;
};

type ReceiptResponse = {
  ok?: boolean;
  network?: string;
  chain_id?: number;
  transaction_hash?: string;
  receipt?: TestnetExecutionReceipt;
  error?: string;
};

function validHash(value: string): boolean {
  return /^0x[a-fA-F0-9]{64}$/.test(value);
}

export async function fetchTestnetExecutionReceipt(transactionHash: string): Promise<TestnetExecutionReceipt> {
  if (!validHash(transactionHash)) throw new Error("Invalid Testnet transaction hash");

  const response = await fetch(
    `/api/testnet/execution-receipt?tx_hash=${encodeURIComponent(transactionHash)}`,
    {
      method: "GET",
      credentials: "include",
      headers: { Accept: "application/json" },
      cache: "no-store",
    },
  );

  const body = await response.json().catch(() => null) as ReceiptResponse | null;
  if (!response.ok) {
    throw new Error(body?.error || `Receipt verification failed with HTTP ${response.status}`);
  }

  if (body?.network !== "bsc-testnet" || Number(body.chain_id) !== 97) {
    throw new Error("Receipt verifier did not report BSC Testnet");
  }

  if (!body.receipt) throw new Error("Receipt verifier returned no receipt result");
  return body.receipt;
}

export async function waitForTestnetExecutionReceipt(
  transactionHash: string,
  options: {
    intervalMs?: number;
    timeoutMs?: number;
    signal?: AbortSignal;
  } = {},
): Promise<TestnetExecutionReceipt> {
  const intervalMs = Math.max(500, options.intervalMs ?? 1_500);
  const timeoutMs = Math.max(intervalMs, options.timeoutMs ?? 60_000);
  const startedAt = Date.now();
  let lastPending: TestnetExecutionReceipt | null = null;

  while (Date.now() - startedAt <= timeoutMs) {
    if (options.signal?.aborted) throw new DOMException("Receipt verification aborted", "AbortError");

    const receipt = await fetchTestnetExecutionReceipt(transactionHash);
    if (receipt.observed) return receipt;
    lastPending = receipt;

    const remaining = timeoutMs - (Date.now() - startedAt);
    if (remaining <= 0) break;
    await new Promise<void>((resolve, reject) => {
      const signal = options.signal;
      const onAbort = () => {
        window.clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        reject(new DOMException("Receipt verification aborted", "AbortError"));
      };
      const timer = window.setTimeout(() => {
        signal?.removeEventListener("abort", onAbort);
        resolve();
      }, Math.min(intervalMs, remaining));
      if (!signal) return;
      signal.addEventListener("abort", onAbort, { once: true });
    });
  }

  if (lastPending) {
    throw new Error(`Transaction ${transactionHash.slice(0, 10)}… is still pending after ${Math.round(timeoutMs / 1000)} seconds`);
  }
  throw new Error("Unable to obtain Testnet execution receipt");
}
