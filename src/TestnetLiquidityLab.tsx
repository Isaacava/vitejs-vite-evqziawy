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
import { BSC_RPC_URL } from "./lib/network";

const WALLETCONNECT_PROJECT_ID = "1dbe8fd5e4974ae7c80d074c4082b5a0";

const U_TOKEN = "0xc70B8741B8B07A6d61E54fd4B20f22Fa648E5565" as Address;
const WBNB_TOKEN = "0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd" as Address;
const V3_FACTORY = "0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865" as Address;
const POSITION_MANAGER = "0x46A15B0b27311cedF172AB29E4f4766fbE7F4364" as Address;
const FEE = 500;
const U_AMOUNT = 1_000_000_000_000_000_000n;
const PRICE_U_PER_WBNB = 650n;
const WBNB_AMOUNT = 1_538_461_538_461_538n;
const ZERO = "0x0000000000000000000000000000000000000000" as Address;

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

const WBNB_ABI = [
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

const publicClient = createPublicClient({
  chain: bscTestnet,
  transport: http(BSC_RPC_URL),
});

function integerSqrt(value: bigint): bigint {
  if (value < 2n) return value;
  let x = 1n << BigInt(Math.ceil(value.toString(2).length / 2));
  let y = (x + value / x) >> 1n;
  while (y < x) {
    x = y;
    y = (x + value / x) >> 1n;
  }
  return x;
}

function sqrtPriceX96ForRatio(numerator: bigint, denominator: bigint) {
  return integerSqrt((numerator << 192n) / denominator);
}

const TOKEN0 = WBNB_TOKEN.toLowerCase() < U_TOKEN.toLowerCase() ? WBNB_TOKEN : U_TOKEN;
const TOKEN1 = WBNB_TOKEN.toLowerCase() < U_TOKEN.toLowerCase() ? U_TOKEN : WBNB_TOKEN;
const SQRT_PRICE_X96 = sqrtPriceX96ForRatio(
  TOKEN0.toLowerCase() === WBNB_TOKEN.toLowerCase() ? PRICE_U_PER_WBNB : 1n,
  TOKEN0.toLowerCase() === WBNB_TOKEN.toLowerCase() ? 1n : PRICE_U_PER_WBNB,
);

function short(value: string) {
  return `${value.slice(0, 8)}…${value.slice(-6)}`;
}

export default function TestnetLiquidityLab() {
  const [provider, setProvider] = useState<EIP1193Provider | null>(null);
  const [account, setAccount] = useState<Address | null>(null);
  const [pool, setPool] = useState<Address | null>(null);
  const [uBalance, setUBalance] = useState<bigint | null>(null);
  const [wBnbBalance, setWBnbBalance] = useState<bigint | null>(null);
  const [tBnbBalance, setTBnbBalance] = useState<bigint | null>(null);
  const [status, setStatus] = useState("Connect your BSC Testnet wallet to inspect the test pool.");
  const [txs, setTxs] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const walletClient = useMemo(() => {
    if (!provider || !account) return null;
    return createWalletClient({ account, chain: bscTestnet, transport: custom(provider) });
  }, [provider, account]);

  async function refresh(address = account) {
    if (!address) return;
    const [candidate, u, w, b] = await Promise.all([
      publicClient.readContract({ address: V3_FACTORY, abi: FACTORY_ABI, functionName: "getPool", args: [TOKEN0, TOKEN1, FEE] }),
      publicClient.readContract({ address: U_TOKEN, abi: ERC20_ABI, functionName: "balanceOf", args: [address] }),
      publicClient.readContract({ address: WBNB_TOKEN, abi: ERC20_ABI, functionName: "balanceOf", args: [address] }),
      publicClient.getBalance({ address }),
    ]);
    setPool(candidate === ZERO ? null : candidate);
    setUBalance(u);
    setWBnbBalance(w);
    setTBnbBalance(b);
    setStatus(candidate === ZERO
      ? "No U/WBNB V3 pool exists yet at fee 0.05%. The lab can create and initialize it at 650 U/WBNB."
      : `U/WBNB V3 pool found at fee 0.05%: ${short(candidate)}`);
  }

  async function connect() {
    setBusy(true);
    try {
      const wc = await EthereumProvider.init({
        projectId: WALLETCONNECT_PROJECT_ID,
        chains: [97],
        showQrModal: true,
        metadata: {
          name: "AgentMarket Testnet Liquidity Lab",
          description: "Testnet-only U/WBNB V3 liquidity",
          url: window.location.origin,
          icons: [],
        },
      });
      await wc.connect();
      const next = (wc.accounts as string[])[0] as Address | undefined;
      if (!next) throw new Error("No wallet account returned.");
      setProvider(wc as unknown as EIP1193Provider);
      setAccount(next);
      await refresh(next);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Wallet connection failed.");
    } finally {
      setBusy(false);
    }
  }

  async function waitFor(hash: `0x${string}`) {
    setTxs((items) => [...items, hash]);
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`Transaction ${short(hash)} reverted on-chain.`);
  }

  async function ensureApproval(token: Address, amount: bigint, label: string) {
    if (!walletClient || !account) throw new Error("Connect your wallet first.");
    const allowance = await publicClient.readContract({ address: token, abi: ERC20_ABI, functionName: "allowance", args: [account, POSITION_MANAGER] });
    if (allowance >= amount) return;
    setStatus(`Simulating the ${label} approval before requesting a wallet signature.`);
    const simulation = await publicClient.simulateContract({
      address: token,
      abi: ERC20_ABI,
      functionName: "approve",
      args: [POSITION_MANAGER, amount],
      account,
    });
    const hash = await walletClient.writeContract(simulation.request);
    await waitFor(hash);
  }

  async function wrapWbnb() {
    if (!walletClient || !account) throw new Error("Connect your wallet first.");
    if (tBnbBalance === null || tBnbBalance < WBNB_AMOUNT) throw new Error(`You need at least ${formatUnits(WBNB_AMOUNT, 18)} tBNB plus gas.`);
    setStatus(`Simulating a ${formatUnits(WBNB_AMOUNT, 18)} tBNB → WBNB wrap.`);
    const simulation = await publicClient.simulateContract({
      address: WBNB_TOKEN,
      abi: WBNB_ABI,
      functionName: "deposit",
      value: WBNB_AMOUNT,
      account,
    });
    const hash = await walletClient.writeContract(simulation.request);
    await waitFor(hash);
  }

  async function addLiquidity() {
    if (!walletClient || !account) throw new Error("Connect your BSC Testnet wallet first.");
    if (uBalance === null || uBalance < U_AMOUNT) throw new Error("At least 1 U is required for this test position.");
    if (tBnbBalance === null || tBnbBalance < WBNB_AMOUNT) throw new Error(`At least ${formatUnits(WBNB_AMOUNT, 18)} tBNB is required, plus gas.`);

    setBusy(true);
    setTxs([]);
    try {
      if (wBnbBalance === null || wBnbBalance < WBNB_AMOUNT) {
        await wrapWbnb();
        await refresh();
      }

      await ensureApproval(U_TOKEN, U_AMOUNT, "U");
      await ensureApproval(WBNB_TOKEN, WBNB_AMOUNT, "WBNB");

      let candidate = await publicClient.readContract({
        address: V3_FACTORY,
        abi: FACTORY_ABI,
        functionName: "getPool",
        args: [TOKEN0, TOKEN1, FEE],
      });

      if (candidate === ZERO) {
        setStatus("Simulating V3 pool creation and initialization at 650 U/WBNB.");
        const simulation = await publicClient.simulateContract({
          address: POSITION_MANAGER,
          abi: POSITION_MANAGER_ABI,
          functionName: "createAndInitializePoolIfNecessary",
          args: [TOKEN0, TOKEN1, FEE, SQRT_PRICE_X96],
          account,
        });
        const hash = await walletClient.writeContract(simulation.request);
        await waitFor(hash);
        candidate = await publicClient.readContract({ address: V3_FACTORY, abi: FACTORY_ABI, functionName: "getPool", args: [TOKEN0, TOKEN1, FEE] });
        if (candidate === ZERO) throw new Error("The pool creation transaction confirmed, but the factory still reports no pool.");
      }

      const amount0Desired = TOKEN0.toLowerCase() === WBNB_TOKEN.toLowerCase() ? WBNB_AMOUNT : U_AMOUNT;
      const amount1Desired = TOKEN1.toLowerCase() === WBNB_TOKEN.toLowerCase() ? WBNB_AMOUNT : U_AMOUNT;
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 15 * 60);

      setStatus(`Simulating the V3 liquidity position against pool ${short(candidate)}.`);
      const mintSimulation = await publicClient.simulateContract({
        address: POSITION_MANAGER,
        abi: POSITION_MANAGER_ABI,
        functionName: "mint",
        args: [{
          token0: TOKEN0,
          token1: TOKEN1,
          fee: FEE,
          tickLower: -887270,
          tickUpper: 887270,
          amount0Desired,
          amount1Desired,
          amount0Min: 0n,
          amount1Min: 0n,
          recipient: account,
          deadline,
        }],
        account,
      });
      const mintHash = await walletClient.writeContract(mintSimulation.request);
      await waitFor(mintHash);

      await refresh();
      setStatus(`Liquidity position created successfully in ${short(candidate)}. The V3 LP position is owned by your wallet.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Liquidity transaction failed.");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (account) void refresh();
  }, [account]);

  return (
    <main style={{ minHeight: "100vh", padding: "32px 18px", background: "#0c0c0c", color: "#f5f1e8" }}>
      <div style={{ maxWidth: 860, margin: "0 auto" }}>
        <a href="/testnet" style={{ color: "inherit", opacity: 0.75, textDecoration: "none" }}>← Testnet</a>
        <section style={{ marginTop: 24, padding: 24, border: "1px solid rgba(255,255,255,.12)", borderRadius: 18, background: "rgba(255,255,255,.03)" }}>
          <div style={{ fontSize: 12, letterSpacing: ".12em", opacity: 0.65 }}>TESTNET LIQUIDITY LAB</div>
          <h1 style={{ margin: "10px 0 8px", fontSize: 36 }}>U / WBNB V3</h1>
          <p style={{ opacity: 0.8, lineHeight: 1.6 }}>
            Optional BSC Testnet-only tooling for the marketplace test environment. This does not make liquidity a requirement of AgentMarket and does not depend on the Grid Agent.
          </p>
        </section>

        <section style={{ marginTop: 18, display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))" }}>
          <div style={{ padding: 18, borderRadius: 16, background: "rgba(255,255,255,.04)" }}><div style={{ opacity: 0.6, fontSize: 12 }}>U BALANCE</div><strong>{uBalance === null ? "—" : formatUnits(uBalance, 18)}</strong></div>
          <div style={{ padding: 18, borderRadius: 16, background: "rgba(255,255,255,.04)" }}><div style={{ opacity: 0.6, fontSize: 12 }}>WBNB BALANCE</div><strong>{wBnbBalance === null ? "—" : formatUnits(wBnbBalance, 18)}</strong></div>
          <div style={{ padding: 18, borderRadius: 16, background: "rgba(255,255,255,.04)" }}><div style={{ opacity: 0.6, fontSize: 12 }}>tBNB BALANCE</div><strong>{tBnbBalance === null ? "—" : formatUnits(tBnbBalance, 18)}</strong></div>
          <div style={{ padding: 18, borderRadius: 16, background: "rgba(255,255,255,.04)" }}><div style={{ opacity: 0.6, fontSize: 12 }}>POOL</div><strong>{pool ? short(pool) : "Not created"}</strong></div>
        </section>

        <section style={{ marginTop: 18, padding: 24, borderRadius: 18, background: "rgba(255,255,255,.03)", border: "1px solid rgba(255,255,255,.12)" }}>
          <h2 style={{ marginTop: 0 }}>Test position</h2>
          <div style={{ display: "grid", gap: 8, lineHeight: 1.7 }}>
            <div>U: <strong>1.000000 U</strong></div>
            <div>WBNB: <strong>{formatUnits(WBNB_AMOUNT, 18)} WBNB</strong></div>
            <div>Fee tier: <strong>0.05%</strong></div>
            <div>Initialization price: <strong>650 U per WBNB</strong></div>
            <div>Network: <strong>BSC Testnet (97)</strong></div>
          </div>
          <p style={{ marginBottom: 0, opacity: 0.7, lineHeight: 1.6 }}>
            The lab simulates each state-changing call before asking your wallet to sign. Your position remains in your wallet; AgentMarket does not custody the LP NFT or private key.
          </p>
        </section>

        <section style={{ marginTop: 18, padding: 24, borderRadius: 18, background: "rgba(255,255,255,.03)", border: "1px solid rgba(255,255,255,.12)" }}>
          <div style={{ fontSize: 13, opacity: 0.75, lineHeight: 1.6 }}>{status}</div>
          <div style={{ marginTop: 16, display: "flex", gap: 10, flexWrap: "wrap" }}>
            {!account ? (
              <button disabled={busy} onClick={() => void connect()} style={{ padding: "12px 16px", borderRadius: 12, border: 0, cursor: "pointer" }}>Connect wallet</button>
            ) : (
              <button disabled={busy} onClick={() => void addLiquidity()} style={{ padding: "12px 16px", borderRadius: 12, border: 0, cursor: busy ? "default" : "pointer" }}>
                {busy ? "Working…" : pool ? "Add 1 U liquidity" : "Create pool + add 1 U liquidity"}
              </button>
            )}
          </div>
          {txs.length > 0 && <div style={{ marginTop: 18, fontSize: 12, opacity: 0.7 }}>Transactions: {txs.map(short).join(" · ")}</div>}
        </section>
      </div>
    </main>
  );
}
