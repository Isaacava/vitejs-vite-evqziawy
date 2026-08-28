import { useEffect, useMemo, useState } from "react";
import { EthereumProvider } from "@walletconnect/ethereum-provider";
import { createPublicClient, createWalletClient, custom, formatUnits, http, type Address, type EIP1193Provider } from "viem";
import { bscTestnet } from "viem/chains";
import { BSC_RPC_URL } from "./lib/network";

const WALLETCONNECT_PROJECT_ID = "1dbe8fd5e4974ae7c80d074c4082b5a0";
const U_TOKEN = "0xc70B8741B8B07A6d61E54fd4B20f22Fa648E5565" as Address;
const WBNB_TOKEN = "0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd" as Address;
const V3_FACTORY = "0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865" as Address;
const POSITION_MANAGER = "0x46A15B0b27311cedF172AB29E4f4766fbE7F4364" as Address;
const FEE = 500;
const PRICE_U_PER_WBNB = 650n;
const ZERO = "0x0000000000000000000000000000000000000000" as Address;
const MIN_TICK = -887272;
const MAX_TICK = 887272;

const FACTORY_ABI = [{ type: "function", name: "getPool", stateMutability: "view", inputs: [{ name: "tokenA", type: "address" }, { name: "tokenB", type: "address" }, { name: "fee", type: "uint24" }], outputs: [{ name: "pool", type: "address" }] }] as const;
const ERC20_ABI = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ name: "balance", type: "uint256" }] },
  { type: "function", name: "allowance", stateMutability: "view", inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }], outputs: [{ name: "remaining", type: "uint256" }] },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint8" }] },
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ name: "", type: "bool" }] },
] as const;
const WBNB_ABI = [{ type: "function", name: "deposit", stateMutability: "payable", inputs: [], outputs: [] }] as const;
const POOL_ABI = [
  { type: "function", name: "tickSpacing", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "int24" }] },
  { type: "function", name: "slot0", stateMutability: "view", inputs: [], outputs: [{ name: "sqrtPriceX96", type: "uint160" }, { name: "tick", type: "int24" }, { name: "observationIndex", type: "uint16" }, { name: "observationCardinality", type: "uint16" }, { name: "observationCardinalityNext", type: "uint16" }, { name: "feeProtocol", type: "uint8" }, { name: "unlocked", type: "bool" }] },
  { type: "function", name: "liquidity", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint128" }] },
] as const;
const POSITION_MANAGER_ABI = [
  { type: "function", name: "createAndInitializePoolIfNecessary", stateMutability: "payable", inputs: [{ name: "token0", type: "address" }, { name: "token1", type: "address" }, { name: "fee", type: "uint24" }, { name: "sqrtPriceX96", type: "uint160" }], outputs: [{ name: "pool", type: "address" }] },
  { type: "function", name: "mint", stateMutability: "payable", inputs: [{ name: "params", type: "tuple", components: [{ name: "token0", type: "address" }, { name: "token1", type: "address" }, { name: "fee", type: "uint24" }, { name: "tickLower", type: "int24" }, { name: "tickUpper", type: "int24" }, { name: "amount0Desired", type: "uint256" }, { name: "amount1Desired", type: "uint256" }, { name: "amount0Min", type: "uint256" }, { name: "amount1Min", type: "uint256" }, { name: "recipient", type: "address" }, { name: "deadline", type: "uint256" }] }], outputs: [{ name: "tokenId", type: "uint256" }, { name: "liquidity", type: "uint128" }, { name: "amount0", type: "uint256" }, { name: "amount1", type: "uint256" }] },
] as const;

const publicClient = createPublicClient({ chain: bscTestnet, transport: http(BSC_RPC_URL) });
const TOKEN0 = WBNB_TOKEN.toLowerCase() < U_TOKEN.toLowerCase() ? WBNB_TOKEN : U_TOKEN;
const TOKEN1 = WBNB_TOKEN.toLowerCase() < U_TOKEN.toLowerCase() ? U_TOKEN : WBNB_TOKEN;

function pow10(decimals: number) { return 10n ** BigInt(decimals); }
function integerSqrt(value: bigint): bigint {
  if (value < 2n) return value;
  let x = 1n << BigInt(Math.ceil(value.toString(2).length / 2));
  let y = (x + value / x) >> 1n;
  while (y < x) { x = y; y = (x + value / x) >> 1n; }
  return x;
}
function sqrtPriceX96ForRawRatio(numerator: bigint, denominator: bigint) { return integerSqrt((numerator << 192n) / denominator); }
function rawWbnbForOneU(uDecimals: number, wbnbDecimals: number) {
  const oneURaw = pow10(uDecimals);
  return (oneURaw * pow10(wbnbDecimals)) / (PRICE_U_PER_WBNB * pow10(uDecimals));
}
function short(value: string) { return `${value.slice(0, 8)}…${value.slice(-6)}`; }
function alignTicks(spacing: number) {
  return { lower: Math.ceil(MIN_TICK / spacing) * spacing, upper: Math.floor(MAX_TICK / spacing) * spacing };
}

export default function TestnetLiquidityLab() {
  const [provider, setProvider] = useState<EIP1193Provider | null>(null);
  const [account, setAccount] = useState<Address | null>(null);
  const [walletClient, setWalletClient] = useState<ReturnType<typeof createWalletClient> | null>(null);
  const [pool, setPool] = useState<Address | null>(null);
  const [uDecimals, setUDecimals] = useState<number | null>(null);
  const [wbnbDecimals, setWbnbDecimals] = useState<number | null>(null);
  const [uBalance, setUBalance] = useState<bigint | null>(null);
  const [wBnbBalance, setWBnbBalance] = useState<bigint | null>(null);
  const [tBnbBalance, setTBnbBalance] = useState<bigint | null>(null);
  const [tickSpacing, setTickSpacing] = useState<number | null>(null);
  const [currentTick, setCurrentTick] = useState<number | null>(null);
  const [poolLiquidity, setPoolLiquidity] = useState<bigint | null>(null);
  const [computedWbnb, setComputedWbnb] = useState<bigint | null>(null);
  const [simulatedLiquidity, setSimulatedLiquidity] = useState<bigint | null>(null);
  const [status, setStatus] = useState("Connect your BSC Testnet wallet to inspect the live U/WBNB pool.");
  const [busy, setBusy] = useState(false);
  const [txs, setTxs] = useState<string[]>([]);

  const readState = useMemo(() => async (address: Address) => {
    const [candidate, uDec, wDec, u, w, b] = await Promise.all([
      publicClient.readContract({ address: V3_FACTORY, abi: FACTORY_ABI, functionName: "getPool", args: [TOKEN0, TOKEN1, FEE] }),
      publicClient.readContract({ address: U_TOKEN, abi: ERC20_ABI, functionName: "decimals" }),
      publicClient.readContract({ address: WBNB_TOKEN, abi: ERC20_ABI, functionName: "decimals" }),
      publicClient.readContract({ address: U_TOKEN, abi: ERC20_ABI, functionName: "balanceOf", args: [address] }),
      publicClient.readContract({ address: WBNB_TOKEN, abi: ERC20_ABI, functionName: "balanceOf", args: [address] }),
      publicClient.getBalance({ address }),
    ]);
    setUDecimals(uDec); setWbnbDecimals(wDec); setUBalance(u); setWBnbBalance(w); setTBnbBalance(b);
    const targetWbnb = rawWbnbForOneU(uDec, wDec); setComputedWbnb(targetWbnb); setSimulatedLiquidity(null);
    if (candidate === ZERO) {
      setPool(null); setTickSpacing(null); setCurrentTick(null); setPoolLiquidity(null);
      setStatus("No U/WBNB V3 pool exists at fee 0.05% yet.");
      return { candidate: null, uDec, wDec, u, w, b, targetWbnb };
    }
    const [spacing, slot0, liquidity] = await Promise.all([
      publicClient.readContract({ address: candidate, abi: POOL_ABI, functionName: "tickSpacing" }),
      publicClient.readContract({ address: candidate, abi: POOL_ABI, functionName: "slot0" }),
      publicClient.readContract({ address: candidate, abi: POOL_ABI, functionName: "liquidity" }),
    ]);
    setPool(candidate); setTickSpacing(spacing); setCurrentTick(slot0[1]); setPoolLiquidity(liquidity);
    if (slot0[0] === 0n) setStatus("The U/WBNB pool exists but is not initialized.");
    else setStatus(`Initialized U/WBNB V3 pool found at fee 0.05%: ${short(candidate)}.`);
    return { candidate, uDec, wDec, u, w, b, targetWbnb, spacing, slot0, liquidity };
  }, []);

  useEffect(() => {
    if (provider && account) setWalletClient(createWalletClient({ account, chain: bscTestnet, transport: custom(provider) }));
  }, [provider, account]);
  useEffect(() => { if (account) void readState(account); }, [account, readState]);

  async function connect() {
    setBusy(true);
    try {
      const wc = await EthereumProvider.init({ projectId: WALLETCONNECT_PROJECT_ID, chains: [97], showQrModal: true, metadata: { name: "AgentMarket Testnet Liquidity Lab", description: "Testnet-only U/WBNB V3 liquidity", url: window.location.origin, icons: [] } });
      await wc.connect();
      const next = (wc.accounts as string[])[0] as Address | undefined;
      if (!next) throw new Error("No wallet account returned.");
      setProvider(wc as unknown as EIP1193Provider); setAccount(next);
    } catch (error) { setStatus(error instanceof Error ? error.message : "Wallet connection failed."); }
    finally { setBusy(false); }
  }

  async function waitFor(hash: `0x${string}`) {
    setTxs((items) => [...items, hash]);
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`Transaction ${short(hash)} reverted on-chain.`);
  }

  async function approve(token: Address, amount: bigint, label: string) {
    if (!walletClient || !account) throw new Error("Connect your wallet first.");
    const allowance = await publicClient.readContract({ address: token, abi: ERC20_ABI, functionName: "allowance", args: [account, POSITION_MANAGER] });
    if (allowance >= amount) return;
    setStatus(`Simulating ${label} approval before signature.`);
    const sim = await publicClient.simulateContract({ address: token, abi: ERC20_ABI, functionName: "approve", args: [POSITION_MANAGER, amount], account });
    const hash = await walletClient.writeContract(sim.request); await waitFor(hash);
  }

  async function addLiquidity() {
    if (!walletClient || !account) { setStatus("Connect your BSC Testnet wallet first."); return; }
    setBusy(true); setTxs([]); setSimulatedLiquidity(null);
    try {
      const state = await readState(account);
      if (state.u < state.uDec) throw new Error("Unable to read the U token balance correctly.");
      if (state.u < pow10(state.uDec)) throw new Error(`At least 1 U is required. Current balance: ${formatUnits(state.u, state.uDec)} U.`);
      if (state.targetWbnb === 0n) throw new Error("Computed WBNB amount is zero; token decimals/price cannot be resolved safely.");

      if (state.w < state.targetWbnb) {
        const native = await publicClient.getBalance({ address: account });
        const need = state.targetWbnb - state.w;
        if (native < need) throw new Error(`Need ${formatUnits(need, state.wDec)} tBNB to wrap into WBNB, plus gas.`);
        setStatus(`Simulating a ${formatUnits(need, state.wDec)} tBNB → WBNB wrap.`);
        const sim = await publicClient.simulateContract({ address: WBNB_TOKEN, abi: WBNB_ABI, functionName: "deposit", value: need, account });
        const hash = await walletClient.writeContract(sim.request); await waitFor(hash); await readState(account);
      }

      await approve(U_TOKEN, pow10(state.uDec), "U");
      await approve(WBNB_TOKEN, state.targetWbnb, "WBNB");

      let candidate = await publicClient.readContract({ address: V3_FACTORY, abi: FACTORY_ABI, functionName: "getPool", args: [TOKEN0, TOKEN1, FEE] });
      if (candidate === ZERO) {
        const rawPriceNumerator = PRICE_U_PER_WBNB * pow10(state.uDec);
        const rawPriceDenominator = pow10(state.wDec);
        const sqrtPrice = sqrtPriceX96ForRatio(rawPriceNumerator, rawPriceDenominator);
        setStatus("Simulating U/WBNB V3 pool initialization.");
        const sim = await publicClient.simulateContract({ address: POSITION_MANAGER, abi: POSITION_MANAGER_ABI, functionName: "createAndInitializePoolIfNecessary", args: [TOKEN0, TOKEN1, FEE, sqrtPrice], account });
        const hash = await walletClient.writeContract(sim.request); await waitFor(hash);
        candidate = await publicClient.readContract({ address: V3_FACTORY, abi: FACTORY_ABI, functionName: "getPool", args: [TOKEN0, TOKEN1, FEE] });
      }
      if (candidate === ZERO) throw new Error("Pool creation confirmed but the factory still reports no pool.");

      const [spacing, slot0] = await Promise.all([
        publicClient.readContract({ address: candidate, abi: POOL_ABI, functionName: "tickSpacing" }),
        publicClient.readContract({ address: candidate, abi: POOL_ABI, functionName: "slot0" }),
      ]);
      if (slot0[0] === 0n) throw new Error("The V3 pool is not initialized; minting is blocked.");
      const ticks = alignTicks(spacing);
      const amount0Desired = TOKEN0.toLowerCase() === WBNB_TOKEN.toLowerCase() ? state.targetWbnb : pow10(state.uDec);
      const amount1Desired = TOKEN1.toLowerCase() === WBNB_TOKEN.toLowerCase() ? state.targetWbnb : pow10(state.uDec);
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 15 * 60);

      setStatus(`Simulating V3 mint with ${formatUnits(pow10(state.uDec), state.uDec)} U and ${formatUnits(state.targetWbnb, state.wDec)} WBNB.`);
      const mintSim = await publicClient.simulateContract({
        address: POSITION_MANAGER, abi: POSITION_MANAGER_ABI, functionName: "mint",
        args: [{ token0: TOKEN0, token1: TOKEN1, fee: FEE, tickLower: ticks.lower, tickUpper: ticks.upper, amount0Desired, amount1Desired, amount0Min: 0n, amount1Min: 0n, recipient: account, deadline }],
        account,
      });
      const result = mintSim.result;
      if (!result || result[1] === 0n) throw new Error("V3 mint simulation returned zero liquidity. No signature was requested.");
      setSimulatedLiquidity(result[1]);
      const hash = await walletClient.writeContract(mintSim.request); await waitFor(hash); await readState(account);
      setStatus(`Liquidity position created successfully in ${short(candidate)}. The V3 LP NFT is owned by your wallet.`);
    } catch (error) { setStatus(error instanceof Error ? error.message : "Liquidity transaction failed."); }
    finally { setBusy(false); }
  }

  const ready = Boolean(account && pool && computedWbnb !== null && computedWbnb > 0n && tickSpacing !== null && currentTick !== null);

  return (
    <main style={{ minHeight: "100vh", padding: "32px 18px", background: "#0c0c0c", color: "#f5f1e8" }}>
      <div style={{ maxWidth: 900, margin: "0 auto" }}>
        <a href="/testnet" style={{ color: "inherit", opacity: .75, textDecoration: "none" }}>← Testnet</a>
        <section style={{ marginTop: 24, padding: 24, border: "1px solid rgba(255,255,255,.12)", borderRadius: 18, background: "rgba(255,255,255,.03)" }}>
          <div style={{ fontSize: 12, letterSpacing: ".12em", opacity: .65 }}>TESTNET LIQUIDITY LAB</div>
          <h1 style={{ margin: "10px 0 8px", fontSize: 36 }}>U / WBNB V3</h1>
          <p style={{ opacity: .8, lineHeight: 1.6 }}>Optional BSC Testnet-only tooling. The lab reads token decimals and live V3 pool state, computes the test amounts without integer-rounding to zero, and simulates the exact mint before signature.</p>
        </section>
        <section style={{ marginTop: 18, display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))" }}>
          <div style={{ padding: 18, borderRadius: 16, background: "rgba(255,255,255,.04)" }}><div style={{ opacity:.6,fontSize:12 }}>U BALANCE</div><strong>{uBalance===null||uDecimals===null?"—":formatUnits(uBalance,uDecimals)}</strong></div>
          <div style={{ padding: 18, borderRadius: 16, background: "rgba(255,255,255,.04)" }}><div style={{ opacity:.6,fontSize:12 }}>WBNB BALANCE</div><strong>{wBnbBalance===null||wbnbDecimals===null?"—":formatUnits(wBnbBalance,wbnbDecimals)}</strong></div>
          <div style={{ padding: 18, borderRadius: 16, background: "rgba(255,255,255,.04)" }}><div style={{ opacity:.6,fontSize:12 }}>tBNB BALANCE</div><strong>{tBnbBalance===null?"—":formatUnits(tBnbBalance,18)}</strong></div>
          <div style={{ padding: 18, borderRadius: 16, background: "rgba(255,255,255,.04)" }}><div style={{ opacity:.6,fontSize:12 }}>POOL</div><strong>{pool?short(pool):"Not created"}</strong></div>
        </section>
        <section style={{ marginTop:18,padding:24,borderRadius:18,background:"rgba(255,255,255,.03)",border:"1px solid rgba(255,255,255,.12)" }}>
          <h2 style={{ marginTop:0 }}>Live pool state</h2>
          <div style={{ display:"grid",gap:8,lineHeight:1.7 }}>
            <div>Fee: <strong>500 / 0.05%</strong></div>
            <div>Tick spacing: <strong>{tickSpacing??"—"}</strong></div>
            <div>Current tick: <strong>{currentTick??"—"}</strong></div>
            <div>Pool liquidity: <strong>{poolLiquidity===null?"—":poolLiquidity.toString()}</strong></div>
          </div>
        </section>
        <section style={{ marginTop:18,padding:24,borderRadius:18,background:"rgba(255,255,255,.03)",border:"1px solid rgba(255,255,255,.12)" }}>
          <h2 style={{ marginTop:0 }}>Test position</h2>
          <div style={{ display:"grid",gap:8,lineHeight:1.7 }}>
            <div>U target: <strong>1 U</strong></div>
            <div>Target reference price: <strong>650 U / WBNB</strong></div>
            <div>Computed WBNB: <strong>{computedWbnb===null||wbnbDecimals===null?"—":formatUnits(computedWbnb,wbnbDecimals)}</strong></div>
            <div>Simulated V3 liquidity: <strong>{simulatedLiquidity===null?"Not simulated yet":simulatedLiquidity.toString()}</strong></div>
          </div>
          <p style={{ marginBottom:0,opacity:.68,lineHeight:1.6 }}>A pool liquidity value of zero is valid before the first LP position. V3 calculates the actual liquidity during the mint simulation.</p>
        </section>
        <section style={{ marginTop:18,padding:24,borderRadius:18,background:"rgba(255,255,255,.03)",border:"1px solid rgba(255,255,255,.12)" }}>
          <div style={{ fontSize:13,opacity:.78,lineHeight:1.6 }}>{status}</div>
          <div style={{ marginTop:16,display:"flex",gap:10,flexWrap:"wrap" }}>
            {!account ? <button disabled={busy} onClick={() => void connect()} style={{padding:"12px 16px",borderRadius:12,border:0}}>Connect wallet</button> : <>
              <button disabled={busy || !ready} onClick={() => void addLiquidity()} style={{padding:"12px 16px",borderRadius:12,border:0}}>{busy?"Working…":"Simulate + add 1 U liquidity"}</button>
              <button disabled={busy} onClick={() => void readState(account)} style={{padding:"12px 16px",borderRadius:12,border:"1px solid rgba(255,255,255,.2)",background:"transparent",color:"inherit"}}>Refresh live state</button>
            </>}
          </div>
          {txs.length>0 && <div style={{marginTop:18,fontSize:12,opacity:.7}}>Transactions: {txs.map(short).join(" · ")}</div>}
        </section>
      </div>
    </main>
  );
}
