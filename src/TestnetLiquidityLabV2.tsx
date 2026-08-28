import { useEffect, useMemo, useState } from "react";
import { EthereumProvider } from "@walletconnect/ethereum-provider";
import {
  createPublicClient,
  createWalletClient,
  custom,
  decodeErrorResult,
  encodeFunctionData,
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
const U_AMOUNT_HUMAN = 1n;
const TARGET_PRICE_U_PER_WBNB = 650n;
const ZERO = "0x0000000000000000000000000000000000000000" as Address;
const MAX_TICK = 887272;

type PoolState = {
  token0: Address;
  token1: Address;
  fee: number;
  tickSpacing: number;
  tick: number;
  sqrtPriceX96: bigint;
  liquidity: bigint;
};

const FACTORY_ABI = [
  { type: "function", name: "getPool", stateMutability: "view", inputs: [{ name: "tokenA", type: "address" }, { name: "tokenB", type: "address" }, { name: "fee", type: "uint24" }], outputs: [{ name: "pool", type: "address" }] },
] as const;

const ERC20_ABI = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ name: "balance", type: "uint256" }] },
  { type: "function", name: "allowance", stateMutability: "view", inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }], outputs: [{ name: "remaining", type: "uint256" }] },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint8" }] },
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "string" }] },
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ name: "", type: "bool" }] },
] as const;

const WBNB_ABI = [
  { type: "function", name: "deposit", stateMutability: "payable", inputs: [], outputs: [] },
] as const;

const POOL_ABI = [
  { type: "function", name: "slot0", stateMutability: "view", inputs: [], outputs: [{ name: "sqrtPriceX96", type: "uint160" }, { name: "tick", type: "int24" }, { name: "observationIndex", type: "uint16" }, { name: "observationCardinality", type: "uint16" }, { name: "observationCardinalityNext", type: "uint16" }, { name: "feeProtocol", type: "uint32" }, { name: "unlocked", type: "bool" }] },
  { type: "function", name: "liquidity", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint128" }] },
  { type: "function", name: "tickSpacing", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "int24" }] },
  { type: "function", name: "token0", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
  { type: "function", name: "token1", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
] as const;

const POSITION_MANAGER_ABI = [
  { type: "function", name: "createAndInitializePoolIfNecessary", stateMutability: "payable", inputs: [{ name: "token0", type: "address" }, { name: "token1", type: "address" }, { name: "fee", type: "uint24" }, { name: "sqrtPriceX96", type: "uint160" }], outputs: [{ name: "pool", type: "address" }] },
  {
    type: "function",
    name: "mint",
    stateMutability: "payable",
    inputs: [{ name: "params", type: "tuple", components: [
      { name: "token0", type: "address" }, { name: "token1", type: "address" }, { name: "fee", type: "uint24" },
      { name: "tickLower", type: "int24" }, { name: "tickUpper", type: "int24" },
      { name: "amount0Desired", type: "uint256" }, { name: "amount1Desired", type: "uint256" },
      { name: "amount0Min", type: "uint256" }, { name: "amount1Min", type: "uint256" },
      { name: "recipient", type: "address" }, { name: "deadline", type: "uint256" },
    ] }],
    outputs: [{ name: "tokenId", type: "uint256" }, { name: "liquidity", type: "uint128" }, { name: "amount0", type: "uint256" }, { name: "amount1", type: "uint256" }],
  },
] as const;

const publicClient = createPublicClient({ chain: bscTestnet, transport: http(BSC_RPC_URL) });

function integerSqrt(value: bigint): bigint {
  if (value < 2n) return value;
  let x = 1n << BigInt(Math.ceil(value.toString(2).length / 2));
  let y = (x + value / x) >> 1n;
  while (y < x) { x = y; y = (x + value / x) >> 1n; }
  return x;
}

function sqrtPriceForHumanRatio(token0IsWbnb: boolean, uDecimals: number, wbnbDecimals: number, uPerWbnb: bigint) {
  const scale0 = 10n ** BigInt(token0IsWbnb ? wbnbDecimals : uDecimals);
  const scale1 = 10n ** BigInt(token0IsWbnb ? uDecimals : wbnbDecimals);
  const rawRatioNumerator = (token0IsWbnb ? uPerWbnb * scale1 : scale1);
  const rawRatioDenominator = (token0IsWbnb ? scale0 : uPerWbnb * scale0);
  return integerSqrt((rawRatioNumerator << 192n) / rawRatioDenominator);
}

function humanWbnbForU(uAmount: bigint, uDecimals: number, wbnbDecimals: number, uPerWbnb: bigint) {
  const numerator = uAmount * (10n ** BigInt(wbnbDecimals));
  const denominator = uPerWbnb * (10n ** BigInt(uDecimals));
  return numerator / denominator;
}

function alignFullRangeTicks(spacing: number) {
  const bound = Math.floor(MAX_TICK / spacing) * spacing;
  return { lower: -bound, upper: bound };
}

function errorText(error: unknown): string {
  const root = error as { shortMessage?: string; message?: string; details?: string; cause?: { data?: `0x${string}`; shortMessage?: string; message?: string } } | null;
  const data = root?.cause?.data;
  if (data && data !== "0x") {
    try {
      const decoded = decodeErrorResult({ abi: [], data });
      return `${root?.shortMessage || root?.message || "Contract call failed"}: ${decoded.errorName}`;
    } catch { /* fall through */ }
  }
  return root?.shortMessage || root?.cause?.shortMessage || root?.details || root?.message || "Transaction simulation failed.";
}

function compact(value: string) { return `${value.slice(0, 8)}…${value.slice(-6)}`; }

export default function TestnetLiquidityLabV2() {
  const [provider, setProvider] = useState<EIP1193Provider | null>(null);
  const [account, setAccount] = useState<Address | null>(null);
  const [pool, setPool] = useState<Address | null>(null);
  const [poolState, setPoolState] = useState<PoolState | null>(null);
  const [uDecimals, setUDecimals] = useState<number | null>(null);
  const [wbnbDecimals, setWbnbDecimals] = useState<number | null>(null);
  const [uSymbol, setUSymbol] = useState("U");
  const [wbnbSymbol, setWbnbSymbol] = useState("WBNB");
  const [uBalance, setUBalance] = useState<bigint | null>(null);
  const [wbnbBalance, setWbnbBalance] = useState<bigint | null>(null);
  const [tbnbBalance, setTbnbBalance] = useState<bigint | null>(null);
  const [status, setStatus] = useState("Connect your BSC Testnet wallet to inspect the live U/WBNB V3 state.");
  const [txs, setTxs] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const walletClient = useMemo(() => provider && account ? createWalletClient({ account, chain: bscTestnet, transport: custom(provider) }) : null, [provider, account]);
  const token0 = WBNB_TOKEN.toLowerCase() < U_TOKEN.toLowerCase() ? WBNB_TOKEN : U_TOKEN;
  const token1 = WBNB_TOKEN.toLowerCase() < U_TOKEN.toLowerCase() ? U_TOKEN : WBNB_TOKEN;
  const token0IsWbnb = token0.toLowerCase() === WBNB_TOKEN.toLowerCase();

  async function refresh(address = account) {
    if (!address) return;
    const [poolAddress, ud, wd, us, ws, ub, wb, tb] = await Promise.all([
      publicClient.readContract({ address: V3_FACTORY, abi: FACTORY_ABI, functionName: "getPool", args: [token0, token1, FEE] }),
      publicClient.readContract({ address: U_TOKEN, abi: ERC20_ABI, functionName: "decimals" }),
      publicClient.readContract({ address: WBNB_TOKEN, abi: ERC20_ABI, functionName: "decimals" }),
      publicClient.readContract({ address: U_TOKEN, abi: ERC20_ABI, functionName: "symbol" }),
      publicClient.readContract({ address: WBNB_TOKEN, abi: ERC20_ABI, functionName: "symbol" }),
      publicClient.readContract({ address: U_TOKEN, abi: ERC20_ABI, functionName: "balanceOf", args: [address] }),
      publicClient.readContract({ address: WBNB_TOKEN, abi: ERC20_ABI, functionName: "balanceOf", args: [address] }),
      publicClient.getBalance({ address }),
    ]);
    setUDecimals(Number(ud)); setWbnbDecimals(Number(wd)); setUSymbol(String(us)); setWbnbSymbol(String(ws));
    setUBalance(ub); setWbnbBalance(wb); setTbnbBalance(tb);
    if (poolAddress === ZERO) { setPool(null); setPoolState(null); setStatus("No U/WBNB V3 pool exists yet at fee 0.05%. The lab can create one at 650 U/WBNB."); return; }
    setPool(poolAddress);
    const [slot, liquidity, spacing, p0, p1] = await Promise.all([
      publicClient.readContract({ address: poolAddress, abi: POOL_ABI, functionName: "slot0" }),
      publicClient.readContract({ address: poolAddress, abi: POOL_ABI, functionName: "liquidity" }),
      publicClient.readContract({ address: poolAddress, abi: POOL_ABI, functionName: "tickSpacing" }),
      publicClient.readContract({ address: poolAddress, abi: POOL_ABI, functionName: "token0" }),
      publicClient.readContract({ address: poolAddress, abi: POOL_ABI, functionName: "token1" }),
    ]);
    if (p0.toLowerCase() !== token0.toLowerCase() || p1.toLowerCase() !== token1.toLowerCase()) throw new Error("Factory pool token ordering does not match the requested pair.");
    setPoolState({ token0: p0, token1: p1, fee: FEE, tickSpacing: Number(spacing), tick: Number(slot[1]), sqrtPriceX96: slot[0], liquidity });
    setStatus(liquidity === 0n ? `Pool ${compact(poolAddress)} exists and is initialized, but currently has zero liquidity.` : `Pool ${compact(poolAddress)} is initialized with live liquidity.`);
  }

  async function connect() {
    setBusy(true);
    try {
      const wc = await EthereumProvider.init({ projectId: WALLETCONNECT_PROJECT_ID, chains: [97], showQrModal: true, metadata: { name: "AgentMarket Testnet Liquidity Lab", description: "Testnet U/WBNB V3 liquidity", url: window.location.origin, icons: [] } });
      await wc.connect();
      const next = (wc.accounts as string[])[0] as Address | undefined;
      if (!next) throw new Error("No wallet account returned.");
      setProvider(wc as unknown as EIP1193Provider); setAccount(next); await refresh(next);
    } catch (error) { setStatus(errorText(error)); } finally { setBusy(false); }
  }

  async function waitFor(hash: `0x${string}`) {
    setTxs((items) => [...items, hash]);
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`Transaction ${compact(hash)} reverted on-chain.`);
  }

  async function approve(token: Address, amount: bigint, label: string) {
    if (!walletClient || !account) throw new Error("Connect your wallet first.");
    const allowance = await publicClient.readContract({ address: token, abi: ERC20_ABI, functionName: "allowance", args: [account, POSITION_MANAGER] });
    if (allowance >= amount) return;
    setStatus(`Simulating ${label} approval for the exact required amount.`);
    const sim = await publicClient.simulateContract({ address: token, abi: ERC20_ABI, functionName: "approve", args: [POSITION_MANAGER, amount], account });
    const hash = await walletClient.writeContract(sim.request); await waitFor(hash);
  }

  async function wrap(amount: bigint) {
    if (!walletClient || !account) throw new Error("Connect your wallet first.");
    setStatus(`Simulating ${formatUnits(amount, wbnbDecimals ?? 18)} tBNB → WBNB.`);
    const sim = await publicClient.simulateContract({ address: WBNB_TOKEN, abi: WBNB_ABI, functionName: "deposit", value: amount, account });
    const hash = await walletClient.writeContract(sim.request); await waitFor(hash);
  }

  async function addLiquidity() {
    if (!walletClient || !account) { setStatus("Connect your BSC Testnet wallet first."); return; }
    if (uDecimals === null || wbnbDecimals === null || uBalance === null || tbnbBalance === null) { setStatus("Refresh wallet balances before adding liquidity."); return; }
    setBusy(true); setTxs([]);
    try {
      const uAmount = U_AMOUNT_HUMAN * (10n ** BigInt(uDecimals));
      const wbnbAmount = humanWbnbForU(U_AMOUNT_HUMAN, uDecimals, wbnbDecimals, TARGET_PRICE_U_PER_WBNB);
      if (uBalance < uAmount) throw new Error(`You need at least 1 ${uSymbol}; wallet has ${formatUnits(uBalance, uDecimals)} ${uSymbol}.`);
      if (tbnbBalance < wbnbAmount) throw new Error(`You need at least ${formatUnits(wbnbAmount, wbnbDecimals)} tBNB plus gas.`);

      if (wbnbBalance === null || wbnbBalance < wbnbAmount) { await wrap(wbnbAmount); await refresh(); }
      await approve(U_TOKEN, uAmount, uSymbol);
      await approve(WBNB_TOKEN, wbnbAmount, wbnbSymbol);

      let candidate = await publicClient.readContract({ address: V3_FACTORY, abi: FACTORY_ABI, functionName: "getPool", args: [token0, token1, FEE] });
      if (candidate === ZERO) {
        const sqrt = sqrtPriceForHumanRatio(token0IsWbnb, uDecimals, wbnbDecimals, TARGET_PRICE_U_PER_WBNB);
        setStatus("Simulating creation and initialization of the U/WBNB V3 pool at 650 U/WBNB.");
        const sim = await publicClient.simulateContract({ address: POSITION_MANAGER, abi: POSITION_MANAGER_ABI, functionName: "createAndInitializePoolIfNecessary", args: [token0, token1, FEE, sqrt], account });
        const hash = await walletClient.writeContract(sim.request); await waitFor(hash);
        candidate = await publicClient.readContract({ address: V3_FACTORY, abi: FACTORY_ABI, functionName: "getPool", args: [token0, token1, FEE] });
        if (candidate === ZERO) throw new Error("Pool creation confirmed but the factory still reports no pool.");
      }

      const [spacing, slot, liveLiquidity, live0, live1] = await Promise.all([
        publicClient.readContract({ address: candidate, abi: POOL_ABI, functionName: "tickSpacing" }),
        publicClient.readContract({ address: candidate, abi: POOL_ABI, functionName: "slot0" }),
        publicClient.readContract({ address: candidate, abi: POOL_ABI, functionName: "liquidity" }),
        publicClient.readContract({ address: candidate, abi: POOL_ABI, functionName: "token0" }),
        publicClient.readContract({ address: candidate, abi: POOL_ABI, functionName: "token1" }),
      ]);
      if (live0.toLowerCase() !== token0.toLowerCase() || live1.toLowerCase() !== token1.toLowerCase()) throw new Error("Pool token ordering changed unexpectedly.");
      const ranges = alignFullRangeTicks(Number(spacing));
      const currentTick = Number(slot[1]);
      const amount0Desired = token0IsWbnb ? wbnbAmount : uAmount;
      const amount1Desired = token0IsWbnb ? uAmount : wbnbAmount;
      setPool(candidate);
      setPoolState({ token0: live0, token1: live1, fee: FEE, tickSpacing: Number(spacing), tick: currentTick, sqrtPriceX96: slot[0], liquidity: liveLiquidity });
      setStatus(`Simulating mint against ${compact(candidate)} at tick ${currentTick}, spacing ${Number(spacing)}.`);

      // Ensure the current pool price is inside the requested full range and that the desired amounts are non-zero.
      if (amount0Desired === 0n || amount1Desired === 0n) throw new Error("Calculated liquidity amount is zero; refusing to mint.");
      if (ranges.lower >= currentTick || currentTick >= ranges.upper) throw new Error(`Current pool tick ${currentTick} is outside the usable full-range bounds ${ranges.lower}..${ranges.upper}.`);

      const deadline = BigInt(Math.floor(Date.now() / 1000) + 15 * 60);
      const sim = await publicClient.simulateContract({
        address: POSITION_MANAGER,
        abi: POSITION_MANAGER_ABI,
        functionName: "mint",
        args: [{ token0, token1, fee: FEE, tickLower: ranges.lower, tickUpper: ranges.upper, amount0Desired, amount1Desired, amount0Min: 0n, amount1Min: 0n, recipient: account, deadline }],
        account,
      });
      const hash = await walletClient.writeContract(sim.request); await waitFor(hash);
      await refresh();
      setStatus(`Liquidity position created successfully. Pool ${compact(candidate)} is owned by your wallet.`);
    } catch (error) { setStatus(errorText(error)); }
    finally { setBusy(false); }
  }

  useEffect(() => { if (account) void refresh(); }, [account]);

  return (
    <main className="console-page">
      <div className="console-shell">
        <header className="console-nav"><a href="/testnet" className="console-brand">AgentMarket</a><span>TESTNET / LIQUIDITY</span><a href="/testnet">Sandbox →</a></header>
        <section className="console-hero"><div><span className="console-kicker">BSC TESTNET / CHAIN 97</span><h1>U / WBNB liquidity lab.</h1><p>Optional Testnet tooling. Token decimals, pool state, and tick spacing are read live before the V3 mint.</p></div><div className="console-state"><small>FEE</small><strong>0.05%</strong><span>Position NFT is minted to your connected wallet.</span></div></section>
        <section className="console-grid">
          <div className="console-card"><div className="console-section-head"><span>WALLET</span><b>{account ? "CONNECTED" : "NOT CONNECTED"}</b></div><div className="console-stat"><span>{uSymbol} balance</span><strong>{uBalance == null || uDecimals == null ? "—" : formatUnits(uBalance, uDecimals)}</strong></div><div className="console-stat"><span>{wbnbSymbol} balance</span><strong>{wbnbBalance == null || wbnbDecimals == null ? "—" : formatUnits(wbnbBalance, wbnbDecimals)}</strong></div><div className="console-stat"><span>tBNB balance</span><strong>{tbnbBalance == null ? "—" : formatUnits(tbnbBalance, 18)}</strong></div></div>
          <div className="console-card"><div className="console-section-head"><span>POOL</span><b>{pool ? "FOUND" : "NOT CREATED"}</b></div><div className="console-stat"><span>Address</span><strong>{pool ? compact(pool) : "—"}</strong></div><div className="console-stat"><span>Fee</span><strong>500 / 0.05%</strong></div><div className="console-stat"><span>Tick spacing</span><strong>{poolState ? String(poolState.tickSpacing) : "—"}</strong></div><div className="console-stat"><span>Current tick</span><strong>{poolState ? String(poolState.tick) : "—"}</strong></div><div className="console-stat"><span>Liquidity</span><strong>{poolState ? String(poolState.liquidity) : "—"}</strong></div></div>
        </section>
        <section className="console-card console-plan-card"><div className="console-section-head"><span>TEST POSITION</span><b>1 {uSymbol}</b></div><div className="console-stat"><span>Target reference price</span><strong>650 {uSymbol} / {wbnbSymbol}</strong></div><div className="console-stat"><span>Computed {wbnbSymbol}</span><strong>{uDecimals == null || wbnbDecimals == null ? "—" : formatUnits(humanWbnbForU(U_AMOUNT_HUMAN, uDecimals, wbnbDecimals, TARGET_PRICE_U_PER_WBNB), wbnbDecimals)}</strong></div><p className="console-evidence">The lab dynamically reads token decimals and the actual V3 tick spacing. No Grid Agent permissions or custody are involved.</p></section>
        <section className="console-card console-plan-card"><p className="console-evidence">{status}</p><div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>{!account ? <button className="console-brass-button" type="button" disabled={busy} onClick={() => void connect()}>{busy ? "Connecting…" : "Connect Testnet wallet →"}</button> : <button className="console-brass-button" type="button" disabled={busy} onClick={() => void addLiquidity()}>{busy ? "Simulating / signing…" : pool ? `Add 1 ${uSymbol} liquidity →` : `Create pool + add 1 ${uSymbol} →`}</button>}<button className="console-outline-button" type="button" disabled={busy || !account} onClick={() => void refresh()} >Refresh live state</button></div>{txs.length > 0 && <div className="console-evidence" style={{ marginTop: 14 }}>Transactions: {txs.map(compact).join(" · ")}</div>}</section>
      </div>
    </main>
  );
}
