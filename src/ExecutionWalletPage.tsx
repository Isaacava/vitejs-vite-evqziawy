import { useEffect, useMemo, useState } from "react";
import { createPublicClient, formatEther, formatUnits, http, parseUnits, type Address } from "viem";
import { bscTestnet } from "viem/chains";
import AltanaWalletGate from "./AltanaWalletGate";
import {
  ensureAltanaTradingCapital,
} from "./lib/executionCapitalFunding";
import { getAltanaWalletResolution, type AltanaWalletResolution } from "./lib/altanaWallet";
import { TESTNET_U_TOKEN } from "./lib/altanaSession";

const publicClient = createPublicClient({
  chain: bscTestnet,
  transport: http("https://bsc-testnet-rpc.publicnode.com"),
});

const CAKE2: Address = "0x8d008B313C1d6C7fE2982F62d32Da7507cF43551";
const WBNB: Address = "0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd";
const U_TOKEN = TESTNET_U_TOKEN;

const ERC20_ABI = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ name: "balance", type: "uint256" }] },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ name: "decimals", type: "uint8" }] },
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ name: "symbol", type: "string" }] },
] as const;

type WalletRecord = {
  user_id: string;
  wallet_address: Address;
  signer_address: Address | null;
  chain_id: 97;
  wallet_provider: "altana";
  authorization_model: "passkey";
  rp_id: string | null;
  status: "active" | "recovery_required" | "disabled";
  created_at: string;
  updated_at: string;
};

type Session = {
  id: string;
  job_id: string;
  agent_id: string | null;
  purpose: string;
  capital_requested: string | null;
  capital_authorized: string | null;
  capital_token: string;
  status: string;
  agent_session_key: string | null;
  session_key_id: string | null;
  session_expires_at: string | null;
  session_grant_tx_hash: string | null;
  session_revoke_tx_hash: string | null;
  authorized_at: string | null;
  activated_at: string | null;
  revoked_at: string | null;
  expired_at: string | null;
  updated_at: string;
};

type Asset = {
  symbol: string;
  address?: Address;
  balance: bigint;
  decimals: number;
};

function compact(value?: string | null) {
  return value ? `${value.slice(0, 8)}…${value.slice(-6)}` : "—";
}

function isAddress(value: string | null | undefined): value is Address {
  return Boolean(value && /^0x[a-fA-F0-9]{40}$/.test(value));
}

function formatAsset(asset: Asset) {
  return formatUnits(asset.balance, asset.decimals);
}

function statusLabel(status: string) {
  return status.replace(/_/g, " ").replace(/\b\w/g, (value) => value.toUpperCase());
}

export default function ExecutionWalletPage() {
  const [storedWallet, setStoredWallet] = useState<WalletRecord | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [resolution, setResolution] = useState<AltanaWalletResolution | null>(() => getAltanaWalletResolution());
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [balanceError, setBalanceError] = useState("");
  const [fundSymbol, setFundSymbol] = useState("CAKE2");
  const [fundAmount, setFundAmount] = useState("1");
  const [fundBusy, setFundBusy] = useState(false);
  const [fundMessage, setFundMessage] = useState("");

  async function loadWalletRecord() {
    const response = await fetch("/api/testnet?route=execution-wallet", { credentials: "include", cache: "no-store" });
    const body = await response.json().catch(() => null) as { wallet?: WalletRecord | null; sessions?: Session[]; error?: string } | null;
    if (!response.ok) throw new Error(body?.error || "Unable to load the execution wallet");
    setStoredWallet(body?.wallet || null);
    setSessions(body?.sessions || []);
    return body?.wallet || null;
  }

  useEffect(() => {
    let active = true;
    void loadWalletRecord()
      .catch(() => undefined)
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const walletAddress = resolution?.walletAddress || storedWallet?.wallet_address;
    if (!isAddress(walletAddress)) {
      setAssets([]);
      return;
    }
    let active = true;
    const refresh = async () => {
      try {
        setBalanceError("");
        const nativeBalance = await publicClient.getBalance({ address: walletAddress });
        const tokenRows = await Promise.all(
          [
            [CAKE2, "CAKE2"],
            [WBNB, "WBNB"],
            [U_TOKEN, "U"],
          ] as const,
        ).then(async (rows) => Promise.all(rows.map(async ([address, fallbackSymbol]) => {
          const [balance, decimals, symbol] = await Promise.all([
            publicClient.readContract({ address, abi: ERC20_ABI, functionName: "balanceOf", args: [walletAddress] }),
            publicClient.readContract({ address, abi: ERC20_ABI, functionName: "decimals" }),
            publicClient.readContract({ address, abi: ERC20_ABI, functionName: "symbol" }).catch(() => fallbackSymbol),
          ]);
          return { symbol: String(symbol), address, balance, decimals: Number(decimals) } satisfies Asset;
        })));
        if (!active) return;
        setAssets([
          { symbol: "tBNB", balance: nativeBalance, decimals: 18 },
          ...tokenRows,
        ]);
      } catch (error) {
        if (active) setBalanceError(error instanceof Error ? error.message : "Unable to read execution-wallet balances");
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 30_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [resolution?.walletAddress, storedWallet?.wallet_address]);

  const activeSessions = useMemo(() => sessions.filter((session) => ["requested", "authorized", "active", "exit_pending"].includes(session.status)), [sessions]);

  async function handleResolved(value: AltanaWalletResolution) {
    setResolution(value);
    try {
      await loadWalletRecord();
    } catch {}
  }

  async function fundWallet() {
    const walletAddress = resolution?.walletAddress || storedWallet?.wallet_address;
    if (!isAddress(walletAddress)) return;
    const map: Record<string, Address> = { CAKE2, WBNB, U: U_TOKEN };
    const token = map[fundSymbol];
    if (!token) return;
    setFundBusy(true);
    setFundMessage("");
    try {
      const decimals = Number(await publicClient.readContract({ address: token, abi: ERC20_ABI, functionName: "decimals" }));
      const rawAmount = parseUnits(fundAmount || "0", decimals);
      if (rawAmount <= 0n) throw new Error("Funding amount must be greater than zero.");
      const result = await ensureAltanaTradingCapital(walletAddress, token, rawAmount, token, rawAmount);
      setFundMessage(result.alreadyFunded ? `Wallet already has at least ${fundAmount} ${fundSymbol}.` : `Funded ${fundAmount} ${fundSymbol}. Tx ${compact(result.transactionHash || "")}`);
      await new Promise((resolve) => window.setTimeout(resolve, 1000));
      window.location.reload();
    } catch (error) {
      setFundMessage(error instanceof Error ? error.message : "Funding failed");
    } finally {
      setFundBusy(false);
    }
  }

  const walletAddress = resolution?.walletAddress || storedWallet?.wallet_address || null;

  return (
    <div className="mx-auto max-w-[1100px] px-6 py-10 md:px-8">
      <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
        <div>
          <small className="block font-mono text-[8.5px] uppercase tracking-[0.18em] text-brass">Workspace / Execution Wallet</small>
          <h1 className="mt-1 font-display text-[30px] font-bold tracking-tight">Execution Wallet</h1>
          <p className="mt-2 max-w-[720px] text-[12px] leading-5 text-inksoft">One persistent Altana Passkey wallet for your AgentMarket execution activity. Tasks receive scoped sessions; the wallet itself is not recreated for every task.</p>
        </div>
        <span className="rounded-lg border border-line bg-paperhi px-3 py-2 font-mono text-[9px] uppercase tracking-widest">BSC Testnet · 97</span>
      </div>

      {loading ? (
        <section className="rounded-[16px_8px_18px_9px] border border-line bg-paper p-5 text-[11px] text-inksoft">Loading execution wallet…</section>
      ) : !storedWallet && !resolution ? (
        <AltanaWalletGate onResolved={(value) => void handleResolved(value)} />
      ) : (
        <div className="space-y-5">
          <section className="rounded-[16px_8px_18px_9px] border border-line bg-paper p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <small className="block font-mono text-[8px] uppercase tracking-widest text-brass">Wallet identity</small>
                <div className="mt-2 font-mono text-[15px] font-semibold">{walletAddress ? compact(walletAddress) : "—"}</div>
                <div className="mt-1 text-[10px] text-inksoft">Persistent user-owned Altana Passkey wallet · no private key stored by AgentMarket.</div>
              </div>
              <span className="rounded-lg px-2.5 py-1 font-mono text-[9px] status-green">{storedWallet?.status === "active" ? "ACTIVE" : statusLabel(storedWallet?.status || "active")}</span>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl border border-line bg-paperhi p-3"><small className="block font-mono text-[8px] uppercase text-[#8a8477]">Wallet</small><strong className="mt-1 block font-mono text-[10px] break-all">{walletAddress || "Not resolved"}</strong></div>
              <div className="rounded-xl border border-line bg-paperhi p-3"><small className="block font-mono text-[8px] uppercase text-[#8a8477]">Signer</small><strong className="mt-1 block font-mono text-[10px] break-all">{resolution?.signerAddress || storedWallet?.signer_address || "Recover with Passkey"}</strong></div>
              <div className="rounded-xl border border-line bg-paperhi p-3"><small className="block font-mono text-[8px] uppercase text-[#8a8477]">Relying-party ID</small><strong className="mt-1 block font-mono text-[10px]">{storedWallet?.rp_id || window.location.hostname}</strong></div>
            </div>
          </section>

          {!resolution && (
            <AltanaWalletGate existingWalletAddress={storedWallet?.wallet_address || null} onResolved={(value) => void handleResolved(value)} />
          )}

          {resolution && (
            <>
              <section className="rounded-[16px_8px_18px_9px] border border-line bg-paper p-5">
                <div className="flex items-center justify-between gap-4">
                  <div><small className="block font-mono text-[8px] uppercase tracking-widest text-brass">Balances</small><h2 className="mt-1 font-display text-[18px] font-bold">Execution capital</h2></div>
                  <button type="button" onClick={() => window.location.reload()} className="rounded-lg border border-line bg-paperhi px-3 py-2 font-mono text-[9px] uppercase">Refresh</button>
                </div>
                {balanceError && <p className="mt-3 text-[10px] text-rust">{balanceError}</p>}
                <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {assets.map((asset) => <div key={asset.symbol} className="rounded-xl border border-line bg-paperhi p-4"><small className="block font-mono text-[8px] uppercase text-[#8a8477]">{asset.symbol}</small><strong className="mt-2 block font-mono text-[15px]">{formatAsset(asset)}</strong><span className="mt-1 block text-[9px] text-inksoft">{asset.address ? compact(asset.address) : "Native BNB balance"}</span></div>)}
                </div>
              </section>

              <section className="rounded-[16px_8px_18px_9px] border border-line bg-paper p-5">
                <small className="block font-mono text-[8px] uppercase tracking-widest text-brass">Deposit</small>
                <h2 className="mt-1 font-display text-[18px] font-bold">Fund this execution wallet</h2>
                <p className="mt-1 text-[10px] text-inksoft">Funding is initiated from your connected AgentMarket wallet and sent directly to the persistent Altana wallet.</p>
                <div className="mt-4 grid gap-3 sm:grid-cols-[140px_1fr_auto]">
                  <select value={fundSymbol} onChange={(event) => setFundSymbol(event.target.value)} className="rounded-lg border border-line bg-paperhi px-3 py-2 text-[11px]"><option>CAKE2</option><option>WBNB</option><option>U</option></select>
                  <input value={fundAmount} onChange={(event) => setFundAmount(event.target.value)} inputMode="decimal" className="rounded-lg border border-line bg-paperhi px-3 py-2 font-mono text-[11px]" placeholder="Amount" />
                  <button type="button" onClick={() => void fundWallet()} disabled={fundBusy} className="rounded-lg bg-ink px-4 py-2 font-mono text-[10px] font-semibold text-paperhi disabled:opacity-50">{fundBusy ? "Funding…" : "Fund wallet"}</button>
                </div>
                {fundMessage && <p className="mt-3 text-[10px] text-inksoft break-words">{fundMessage}</p>}
              </section>

              <section className="rounded-[16px_8px_18px_9px] border border-line bg-paper p-5">
                <div className="flex items-center justify-between gap-4"><div><small className="block font-mono text-[8px] uppercase tracking-widest text-brass">Agent access</small><h2 className="mt-1 font-display text-[18px] font-bold">Active scoped sessions</h2></div><span className="rounded-full border border-line bg-paperhi px-2.5 py-1 font-mono text-[9px]">{activeSessions.length} active</span></div>
                <div className="mt-4 space-y-3">
                  {activeSessions.length === 0 && <div className="rounded-xl border border-dashed border-line bg-paperhi p-4 text-[10px] text-inksoft">No active agent sessions. Each new task will request a separate scoped permission against this same wallet.</div>}
                  {activeSessions.map((session) => <div key={session.id} className="rounded-xl border border-line bg-paperhi p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><strong className="text-[12px]">{session.purpose}</strong><div className="mt-1 font-mono text-[9px] text-inksoft">Job {session.job_id} · {statusLabel(session.status)}</div></div><span className="rounded-lg px-2 py-1 font-mono text-[8px] status-green">{statusLabel(session.status)}</span></div><div className="mt-3 grid gap-2 text-[9.5px] sm:grid-cols-3"><div><span className="text-inksoft">Capital:</span> {session.capital_authorized || session.capital_requested || "—"} {session.capital_token}</div><div><span className="text-inksoft">Expires:</span> {session.session_expires_at ? new Date(session.session_expires_at).toLocaleString() : "—"}</div><div><span className="text-inksoft">Session key:</span> <span className="font-mono">{compact(session.agent_session_key)}</span></div></div></div>)}
                </div>
              </section>
            </>
          )}
        </div>
      )}
    </div>
  );
}
