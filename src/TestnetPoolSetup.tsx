import { useEffect, useMemo, useState } from "react";
import { EthereumProvider } from "@walletconnect/ethereum-provider";
import {
  createPublicClient,
  createWalletClient,
  custom,
  formatUnits,
  http,
  type Address,
  type EIP1193Provider,
} from "viem";
import { bscTestnet } from "viem/chains";

const WALLETCONNECT_PROJECT_ID = "1dbe8fd5e4974ae7c80d074c4082b5a0";

const U_TOKEN = "0xc70B8741B8B07A6d61E54fd4B20f22Fa648E5565" as Address;
const WBNB_TOKEN = "0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd" as Address;
const V3_FACTORY = "0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865" as Address;
const POSITION_MANAGER = "0x46A15B0b27311cedF172AB29E4f4766fbE7F4364" as Address;
const FEE = 500;
const PRICE_U_PER_WBNB = 1000n;
const U_AMOUNT = 1_000_000_000_000_000_000n;
const WBNB_AMOUNT = 1_000_000_000_000_000n;
const TICK_LOWER = -887270;
const TICK_UPPER = 887270;

const FACTORY_ABI = [
  {
    type: "function",
    name: "getPool",
    stateMutability: "view",
    inputs: [
      { name: "tokenA", type: "address" },
      { name: "tokenB", type: "address" },
      { name: "fee", type: "uint24" },
    ],
    outputs: [{ name: "pool", type: "address" }],
  },
] as const;

const ERC20_ABI = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "balance", type: "uint256" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "remaining", type: "uint256" }],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

const WBNB_DEPOSIT_ABI = [
  {
    type: "function",
    name: "deposit",
    stateMutability: "payable",
    inputs: [],
    outputs: [],
  },
] as const;

const POSITION_MANAGER_ABI = [
  {
    type: "function",
    name: "createAndInitializePoolIfNecessary",
    stateMutability: "payable",
    inputs: [
      { name: "token0", type: "address" },
      { name: "token1", type: "address" },
      { name: "fee", type: "uint24" },
      { name: "sqrtPriceX96", type: "uint160" },
    ],
    outputs: [{ name: "pool", type: "address" }],
  },
  {
    type: "function",
    name: "mint",
    stateMutability: "payable",
    inputs: [
      {
        name: "params",
        type: "tuple",
        components: [
          { name: "token0", type: "address" },
          { name: "token1", type: "address" },
          { name: "fee", type: "uint24" },
          { name: "tickLower", type: "int24" },
          { name: "tickUpper", type: "int24" },
          { name: "amount0Desired", type: "uint256" },
          { name: "amount1Desired", type: "uint256" },
          { name: "amount0Min", type: "uint256" },
          { name: "amount1Min", type: "uint256" },
          { name: "recipient", type: "address" },
          { name: "deadline", type: "uint256" },
        ],
      },
    ],
    outputs: [
      { name: "tokenId", type: "uint256" },
      { name: "liquidity", type: "uint128" },
      { name: "amount0", type: "uint256" },
      { name: "amount1", type: "uint256" },
    ],
  },
] as const;

const POOL_ABI = [
  {
    type: "function",
    name: "slot0",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "sqrtPriceX96", type: "uint160" },
      { name: "tick", type: "int24" },
      { name: "observationIndex", type: "uint16" },
      { name: "observationCardinality", type: "uint16" },
      { name: "observationCardinalityNext", type: "uint16" },
      { name: "feeProtocol", type: "uint32" },
      { name: "unlocked", type: "bool" },
    ],
  },
  {
    type: "function",
    name: "liquidity",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint128" }],
  },
] as const;

const publicClient = createPublicClient({
  chain: bscTestnet,
  transport: http(),
});

function integerSqrt(value: bigint): bigint {
  if (value < 0n) throw new Error("sqrt input cannot be negative");
  if (value < 2n) return value;
  let x0 = 1n << BigInt(Math.ceil(Math.log2(Number(value)) / 2));
  let x1 = (x0 + value / x0) >> 1n;
  while (x1 < x0) {
    x0 = x1;
    x1 = (x0 + value / x0) >> 1n;
  }
  return x0;
}

function sqrtPriceX96ForPrice(price: bigint): bigint {
  return integerSqrt(price * (1n << 192n));
}

const SQRT_PRICE_X96 = sqrtPriceX96ForPrice(PRICE_U_PER_WBNB);

function shortHash(value: string) {
  return `${value.slice(0, 10)}…${value.slice(-8)}`;
}

export default function TestnetPoolSetup() {
  const [provider, setProvider] = useState<EIP1193Provider | null>(null);
  const [account, setAccount] = useState<Address | null>(null);
  const [pool, setPool] = useState<Address | null>(null);
  const [poolLiquidity, setPoolLiquidity] = useState<string | null>(null);
  const [walletU, setWalletU] = useState<bigint | null>(null);
  const [walletWbnb, setWalletWbnb] = useState<bigint | null>(null);
  const [uAllowance, setUAllowance] = useState<bigint | null>(null);
  const [wbnbAllowance, setWbnbAllowance] = useState<bigint | null>(null);
  const [status, setStatus] = useState("Connect the AgentMarket wallet to inspect the U/WBNB testnet market.");
  const [busy, setBusy] = useState(false);
  const [txs, setTxs] = useState<string[]>([]);

  const walletClient = useMemo(() => {
    if (!provider || !account) return null;
    return createWalletClient({
      account,
      chain: bscTestnet,
      transport: custom(provider),
    });
  }, [provider, account]);

  async function refresh(addressToRead = account) {
    if (!addressToRead) return;
    const [candidatePool, uBal, wBal, ua, wa] = await Promise.all([
      publicClient.readContract({
        address: V3_FACTORY,
        abi: FACTORY_ABI,
        functionName: "getPool",
        args: [WBNB_TOKEN, U_TOKEN, FEE],
      }),
      publicClient.readContract({ address: U_TOKEN, abi: ERC20_ABI, functionName: "balanceOf", args: [addressToRead] }),
      publicClient.readContract({ address: WBNB_TOKEN, abi: ERC20_ABI, functionName: "balanceOf", args: [addressToRead] }),
      publicClient.readContract({ address: U_TOKEN, abi: ERC20_ABI, functionName: "allowance", args: [addressToRead, POSITION_MANAGER] }),
      publicClient.readContract({ address: WBNB_TOKEN, abi: ERC20_ABI, functionName: "allowance", args: [addressToRead, POSITION_MANAGER] }),
    ]);

    const zero = "0x0000000000000000000000000000000000000000" as Address;
    const actualPool = candidatePool === zero ? null : candidatePool;
    setPool(actualPool);
    setWalletU(uBal);
    setWalletWbnb(wBal);
    setUAllowance(ua);
    setWbnbAllowance(wa);

    if (actualPool) {
      const [slot, liq] = await Promise.all([
        publicClient.readContract({ address: actualPool, abi: POOL_ABI, functionName: "slot0" }),
        publicClient.readContract({ address: actualPool, abi: POOL_ABI, functionName: "liquidity" }),
      ]);
      setPoolLiquidity(liq.toString());
      setStatus(`Verified pool ${shortHash(actualPool)} exists at V3 fee 500. Current tick: ${slot[1].toString()}.`);
    } else {
      setPoolLiquidity(null);
      setStatus("No U/WBNB V3 pool exists yet at fee 500. The signed bootstrap below will create and initialize it.");
    }
  }

  async function connect() {
    setBusy(true);
    setStatus("Opening WalletConnect…");
    try {
      const wc = await EthereumProvider.init({
        projectId: WALLETCONNECT_PROJECT_ID,
        chains: [97],
        showQrModal: true,
        metadata: {
          name: "AgentMarket Testnet Pool Setup",
          description: "Wallet-signed BSC Testnet U/WBNB V3 pool bootstrap",
          url: window.location.origin,
          icons: [],
        },
      });
      await wc.connect();
      const [nextAccount] = wc.accounts as string[];
      if (!nextAccount) throw new Error("Wallet did not return an account.");
      const next = nextAccount as Address;
      setProvider(wc as unknown as EIP1193Provider);
      setAccount(next);
      setStatus("Wallet connected. Reading BSC Testnet pool and token state…");
      await refresh(next);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Wallet connection failed.");
    } finally {
      setBusy(false);
    }
  }

  async function wait(hash: `0x${string}`) {
    setTxs((items) => [...items, hash]);
    await publicClient.waitForTransactionReceipt({ hash });
  }

  async function approveToken(token: Address, amount: bigint, label: string) {
    if (!walletClient || !account) throw new Error("Connect wallet first.");
    setStatus(`Approve ${label} for the PancakeSwap V3 Position Manager.`);
    const hash = await walletClient.writeContract({
      address: token,
      abi: ERC20_ABI,
      functionName: "approve",
      args: [POSITION_MANAGER, amount],
    });
    await wait(hash);
  }

  async function wrapWbnb() {
    if (!walletClient || !account) throw new Error("Connect wallet first.");
    setStatus(`Wrap ${formatUnits(WBNB_AMOUNT, 18)} tBNB into WBNB.`);
    const hash = await walletClient.writeContract({
      address: WBNB_TOKEN,
      abi: WBNB_DEPOSIT_ABI,
      functionName: "deposit",
      value: WBNB_AMOUNT,
    });
    await wait(hash);
  }

  async function bootstrap() {
    if (!walletClient || !account) throw new Error("Connect the AgentMarket wallet first.");
    if (walletU === null || walletU < U_AMOUNT) throw new Error("The connected wallet needs at least 1 U for the controlled test pool.");

    setBusy(true);
    setTxs([]);
    try {
      if (walletWbnb === null || walletWbnb < WBNB_AMOUNT) {
        await wrapWbnb();
        await refresh();
      }

      const fresh = await Promise.all([
        publicClient.readContract({ address: U_TOKEN, abi: ERC20_ABI, functionName: "allowance", args: [account, POSITION_MANAGER] }),
        publicClient.readContract({ address: WBNB_TOKEN, abi: ERC20_ABI, functionName: "allowance", args: [account, POSITION_MANAGER] }),
        publicClient.readContract({ address: V3_FACTORY, abi: FACTORY_ABI, functionName: "getPool", args: [WBNB_TOKEN, U_TOKEN, FEE] }),
      ]);

      if (fresh[0] < U_AMOUNT) await approveToken(U_TOKEN, U_AMOUNT, "U");
      if (fresh[1] < WBNB_AMOUNT) await approveToken(WBNB_TOKEN, WBNB_AMOUNT, "WBNB");

      const candidatePool = fresh[2] as Address;
      const zero = "0x0000000000000000000000000000000000000000" as Address;

      if (candidatePool === zero) {
        setStatus("Creating and initializing the U/WBNB V3 pool…");
        const createHash = await walletClient.writeContract({
          address: POSITION_MANAGER,
          abi: POSITION_MANAGER_ABI,
          functionName: "createAndInitializePoolIfNecessary",
          args: [WBNB_TOKEN, U_TOKEN, FEE, SQRT_PRICE_X96],
        });
        await wait(createHash);
      }

      const actualPool = (await publicClient.readContract({
        address: V3_FACTORY,
        abi: FACTORY_ABI,
        functionName: "getPool",
        args: [WBNB_TOKEN, U_TOKEN, FEE],
      })) as Address;

      setPool(actualPool);
      setStatus(`Pool ${shortHash(actualPool)} is deployed. Minting a full-range position with 0.001 WBNB + 1 U…`);

      const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
      const mintHash = await walletClient.writeContract({
        address: POSITION_MANAGER,
        abi: POSITION_MANAGER_ABI,
        functionName: "mint",
        args: [{
          token0: WBNB_TOKEN,
          token1: U_TOKEN,
          fee: FEE,
          tickLower: TICK_LOWER,
          tickUpper: TICK_UPPER,
          amount0Desired: WBNB_AMOUNT,
          amount1Desired: U_AMOUNT,
          amount0Min: 0n,
          amount1Min: 0n,
          recipient: account,
          deadline,
        }],
      });
      await wait(mintHash);

      await refresh();
      setStatus(`Bootstrap complete. U/WBNB V3 pool ${shortHash(actualPool)} now has liquidity and is ready for the controlled Grid preflight.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Pool bootstrap failed.");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (account) void refresh();
  }, [account]);

  return (
    <div style={{ minHeight: "100vh", background: "#f5f1e8", color: "#181815", padding: 32, fontFamily: "system-ui, sans-serif" }}>
      <div style={{ maxWidth: 900, margin: "0 auto" }}>
        <a href="/" style={{ color: "inherit" }}>← Back to AgentMarket</a>
        <h1 style={{ fontSize: 34, marginBottom: 8 }}>BSC Testnet Market Setup</h1>
        <p style={{ lineHeight: 1.6 }}>
          This testnet-only setup creates the exact market required by the Grid executor without changing the ERC-8183 U payment token.
          All state-changing transactions are signed by the connected wallet.
        </p>

        <div style={{ border: "1px solid #c8c3b7", borderRadius: 14, padding: 20, background: "#fffdf7", marginTop: 20 }}>
          <h2 style={{ fontSize: 20, marginTop: 0 }}>Declared market</h2>
          <div style={{ display: "grid", gap: 8, fontFamily: "ui-monospace, monospace", fontSize: 13 }}>
            <div>Token in: {U_TOKEN}</div>
            <div>Token out: {WBNB_TOKEN}</div>
            <div>V3 fee: {FEE} (0.05%)</div>
            <div>Initial price: {PRICE_U_PER_WBNB.toString()} U per WBNB</div>
            <div>Bootstrap liquidity: 1 U + 0.001 WBNB</div>
            <div>Position Manager: {POSITION_MANAGER}</div>
          </div>
        </div>

        <div style={{ border: "1px solid #c8c3b7", borderRadius: 14, padding: 20, background: "#fffdf7", marginTop: 16 }}>
          <h2 style={{ fontSize: 20, marginTop: 0 }}>Verification</h2>
          <p>{status}</p>
          {account ? <p style={{ fontFamily: "ui-monospace, monospace" }}>Wallet: {account}</p> : null}
          {pool ? <p style={{ fontFamily: "ui-monospace, monospace" }}>Pool: {pool}</p> : null}
          {poolLiquidity ? <p>Pool liquidity: {poolLiquidity}</p> : null}
          {walletU !== null ? <p>Wallet U: {formatUnits(walletU, 18)}</p> : null}
          {walletWbnb !== null ? <p>Wallet WBNB: {formatUnits(walletWbnb, 18)}</p> : null}
          {uAllowance !== null ? <p>U allowance to Position Manager: {formatUnits(uAllowance, 18)}</p> : null}
          {wbnbAllowance !== null ? <p>WBNB allowance to Position Manager: {formatUnits(wbnbAllowance, 18)}</p> : null}
        </div>

        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 18 }}>
          <button disabled={busy || !!account} onClick={() => void connect()} style={{ padding: "12px 18px", borderRadius: 10, border: 0, background: "#181815", color: "#fffdf7", cursor: "pointer" }}>
            {account ? "Wallet connected" : "Connect Wallet"}
          </button>
          <button disabled={busy || !account || !!pool} onClick={() => void bootstrap()} style={{ padding: "12px 18px", borderRadius: 10, border: 0, background: "#c49a45", color: "#181815", cursor: "pointer" }}>
            {busy ? "Working…" : pool ? "Pool already exists" : "Create + Seed U/WBNB Pool"}
          </button>
          <button disabled={busy || !account} onClick={() => void refresh()} style={{ padding: "12px 18px", borderRadius: 10, border: "1px solid #c8c3b7", background: "#fffdf7", cursor: "pointer" }}>
            Refresh verification
          </button>
        </div>

        {txs.length > 0 ? (
          <div style={{ marginTop: 18 }}>
            <strong>Signed transactions</strong>
            {txs.map((hash) => <div key={hash} style={{ fontFamily: "ui-monospace, monospace", marginTop: 5 }}>{hash}</div>)}
          </div>
        ) : null}

        <div style={{ marginTop: 24, fontSize: 13, lineHeight: 1.6 }}>
          The bootstrap is deliberately isolated from the Altana session scope. The agent remains restricted to the V3 swap router and swap selector after the pool is established.
        </div>
      </div>
    </div>
  );
}
