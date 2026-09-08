import { useEffect, useMemo, useState } from "react";
import { createPublicClient, formatEther, formatUnits, http, parseUnits, type Address } from "viem";
import { bscTestnet } from "viem/chains";
import AltanaWalletGate from "./AltanaWalletGate";
import { getCurrentUser } from "./lib/walletAuth";
import { fundAltanaTradingCapital, fundAltanaWalletFromAgentMarketWallet, getAltanaWalletResolution, type AltanaWalletResolution } from "./lib/altanaWallet";

const CAKE2: Address = "0x8d008B313C1d6C7fE2982F62d32Da7507cF43551";
const REQUIRED_ALTANA_TBNB = parseUnits("0.002", 18);
const REQUIRED_CAKE2 = parseUnits("5", 18);
const publicClient = createPublicClient({ chain: bscTestnet, transport: http("https://bsc-testnet-rpc.publicnode.com") });
const ERC20_ABI = [{ type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ name: "balance", type: "uint256" }] }] as const;

type User = { id: string; wallet_address: string; created_at: string };
type FaucetStatus = {
  user: { tBNB: string; U: string; CAKE2: string };
  required: { tBNB: string; U: string; CAKE2: string };
  missing: { tBNB: string; U: string; CAKE2: string };
  ready: boolean;
  faucet: { available: boolean; tBNB: string; U: string; CAKE2: string };
};
type AltanaBalances = { tBNB: bigint; CAKE2: bigint };

function compact(address: string) { return `${address.slice(0, 7)}…${address.slice(-5)}`; }
function markComplete(wallet: string) { localStorage.setItem(`agentmarket-onboarding-v1:${wallet.toLowerCase()}`, "complete"); }

export default function OnboardingPage() {
  const [step, setStep] = useState(1);
  const [user, setUser] = useState<User | null>(null);
  const [faucet, setFaucet] = useState<FaucetStatus | null>(null);
  const [faucetBusy, setFaucetBusy] = useState(false);
  const [faucetMessage, setFaucetMessage] = useState("");
  const [altana, setAltana] = useState<AltanaWalletResolution | null>(() => getAltanaWalletResolution());
  const [altanaBalances, setAltanaBalances] = useState<AltanaBalances | null>(null);
  const [fundBusy, setFundBusy] = useState(false);
  const [fundMessage, setFundMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    void getCurrentUser().then((current) => {
      if (!current) { window.location.assign("/"); return; }
      setUser(current as User);
      void loadFaucet();
    });
  }, []);

  async function loadFaucet() {
    try {
      const response = await fetch("/api/testnet?route=faucet", { credentials: "include", cache: "no-store" });
      const body = await response.json() as FaucetStatus & { error?: string };
      if (response.ok) setFaucet(body);
      else setFaucetMessage(body.error || "Unable to check testnet funds.");
    } catch { setFaucetMessage("Unable to check testnet funds right now."); }
  }

  async function claimFaucet() {
    setFaucetBusy(true); setFaucetMessage(""); setError("");
    try {
      const response = await fetch("/api/testnet?route=faucet", { method: "POST", credentials: "include" });
      const body = await response.json().catch(() => ({})) as FaucetStatus & { error?: string };
      if (!response.ok) throw new Error(body.error || "Testnet faucet claim failed.");
      setFaucet(body);
      setFaucetMessage(body.ready ? "Test funds are now in your AgentMarket wallet." : "Claim completed; checking balances again…");
      if (body.ready) setStep(4);
      else await loadFaucet();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Testnet faucet claim failed."); }
    finally { setFaucetBusy(false); }
  }

  async function refreshAltanaBalances(wallet = altana?.walletAddress): Promise<AltanaBalances | null> {
    if (!wallet) return null;
    const [tBNB, CAKE2Balance] = await Promise.all([
      publicClient.getBalance({ address: wallet }),
      publicClient.readContract({ address: CAKE2, abi: ERC20_ABI, functionName: "balanceOf", args: [wallet] }),
    ]);
    const next = { tBNB, CAKE2: CAKE2Balance };
    setAltanaBalances(next);
    return next;
  }

  async function handleAltanaResolved(value: AltanaWalletResolution) {
    setAltana(value);
    setFundMessage("");
    await refreshAltanaBalances(value.walletAddress);
  }

  const altanaReady = Boolean(altanaBalances && altanaBalances.tBNB >= REQUIRED_ALTANA_TBNB && altanaBalances.CAKE2 >= REQUIRED_CAKE2);
  const userFundsReady = Boolean(faucet?.ready);
  const progress = ((step - 1) / 4) * 100;
  const stepLabel = ["Welcome", "How it works", "Testnet funds", "Altana wallet", "Ready"][step - 1];

  async function fundAltana() {
    if (!altana || !user) return;
    setFundBusy(true); setFundMessage(""); setError("");
    try {
      const current = altanaBalances ?? await refreshAltanaBalances(altana.walletAddress);
      if (!current || current.tBNB < REQUIRED_ALTANA_TBNB) {
        await fundAltanaWalletFromAgentMarketWallet(altana.walletAddress);
      }
      const latestCake = await publicClient.readContract({ address: CAKE2, abi: ERC20_ABI, functionName: "balanceOf", args: [altana.walletAddress] });
      if (latestCake < REQUIRED_CAKE2) {
        await fundAltanaTradingCapital(altana.walletAddress, CAKE2, REQUIRED_CAKE2);
      }
      await refreshAltanaBalances(altana.walletAddress);
      setFundMessage("Altana wallet funded with the required testnet execution assets.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to fund the Altana wallet."); }
    finally { setFundBusy(false); }
  }

  function finish() {
    if (user) markComplete(user.wallet_address);
    window.location.assign("/dashboard");
  }

  const canContinue = useMemo(() => {
    if (step === 3) return userFundsReady;
    if (step === 4) return Boolean(altana) && altanaReady;
    return true;
  }, [step, userFundsReady, altana, altanaReady]);

  return (
    <main className="min-h-screen bg-paper text-ink px-5 py-7 md:px-8 md:py-10">
      <div className="mx-auto max-w-[1120px]">
        <header className="flex items-center justify-between gap-5">
          <div className="flex items-center gap-3"><div className="flex h-9 w-9 items-center justify-center rounded-[12px_7px_13px_8px] bg-ink font-display text-sm font-bold text-paperhi">A</div><div><div className="font-display text-[15px] font-bold">AgentMarket</div><div className="font-mono text-[8px] uppercase tracking-[0.16em] text-inksoft">Testnet onboarding</div></div></div>
          <button type="button" onClick={() => { if (user) markComplete(user.wallet_address); window.location.assign("/dashboard"); }} className="font-mono text-[9px] uppercase tracking-widest text-inksoft hover:text-ink">Skip setup</button>
        </header>

        <section className="mt-9 grid gap-7 lg:grid-cols-[1fr_310px] lg:items-start">
          <div className="min-w-0">
            <div className="mb-5 flex items-center justify-between gap-4"><span className="font-mono text-[9px] uppercase tracking-[0.18em] text-brass">Step {step} of 5 · {stepLabel}</span><span className="font-mono text-[9px] text-inksoft">{Math.round(progress)}%</span></div>
            <div className="h-[2px] w-full bg-line"><div className="h-full bg-brass transition-all duration-300" style={{ width: `${Math.max(progress, 7)}%` }} /></div>

            {step === 1 && <div className="pt-12 pb-8"><div className="max-w-[760px]"><div className="font-mono text-[9px] uppercase tracking-[0.2em] text-brass">A short orientation</div><h1 className="mt-3 font-display text-[42px] font-bold leading-[1.02] tracking-[-0.04em] md:text-[60px]">Tell us the job.<br /><span className="text-inksoft">Agents do the work.</span></h1><p className="mt-6 max-w-[650px] text-[14px] leading-6 text-inksoft">AgentMarket connects your goal to capable agents, lets you review the proposed work, and keeps each execution scoped to the mission you approve.</p><button type="button" onClick={() => setStep(2)} className="btn-asym mt-8 bg-ink px-6 py-3.5 font-display text-[12px] font-bold text-paperhi">See how it works →</button></div></div>}

            {step === 2 && <div className="pt-10"><div className="font-mono text-[9px] uppercase tracking-[0.2em] text-brass">The marketplace loop</div><h1 className="mt-3 font-display text-[34px] font-bold tracking-[-0.03em] md:text-[46px]">A mission has a clear paper trail.</h1><div className="mt-8 grid gap-3 md:grid-cols-2"><div className="card-asym border border-line bg-paperhi p-5"><span className="font-mono text-[9px] text-brass">01 · DESCRIBE</span><h2 className="mt-2 font-display text-[20px] font-bold">State the outcome</h2><p className="mt-2 text-[11px] leading-5 text-inksoft">Describe what you want done in plain language. You do not need to know which agent or endpoint can do it.</p></div><div className="card-asym border border-line bg-paperhi p-5"><span className="font-mono text-[9px] text-brass">02 · MATCH</span><h2 className="mt-2 font-display text-[20px] font-bold">Review the fit</h2><p className="mt-2 text-[11px] leading-5 text-inksoft">AgentMarket ranks providers using their declared capabilities, verification, health, and job evidence.</p></div><div className="card-asym border border-line bg-paperhi p-5"><span className="font-mono text-[9px] text-brass">03 · APPROVE</span><h2 className="mt-2 font-display text-[20px] font-bold">Approve the mission</h2><p className="mt-2 text-[11px] leading-5 text-inksoft">You review the quote, parameters, and execution permissions before anything is authorized.</p></div><div className="card-asym border border-line bg-paperhi p-5"><span className="font-mono text-[9px] text-brass">04 · EXECUTE</span><h2 className="mt-2 font-display text-[20px] font-bold">Agent works in scope</h2><p className="mt-2 text-[11px] leading-5 text-inksoft">The agent receives only the scoped execution authority needed for that job, with limits and expiry.</p></div></div><button type="button" onClick={() => setStep(3)} className="btn-asym mt-8 bg-ink px-6 py-3.5 font-display text-[12px] font-bold text-paperhi">Get my testnet ready →</button></div>}

            {step === 3 && <div className="pt-10"><div className="font-mono text-[9px] uppercase tracking-[0.2em] text-brass">BSC Testnet · free test funds</div><h1 className="mt-3 font-display text-[34px] font-bold tracking-[-0.03em] md:text-[46px]">Nothing here uses real funds.</h1><p className="mt-3 max-w-[690px] text-[12px] leading-5 text-inksoft">AgentMarket is currently using BNB Smart Chain Testnet. The faucet tops up your connected AgentMarket wallet with the assets needed to try the marketplace.</p><div className="mt-7 grid gap-3 md:grid-cols-3">{[["U","2","Mission funding stays in your wallet"],["tBNB","0.02","Network and Altana setup fees"],["CAKE2","5","Test asset for supported trading flows"]].map(([symbol, amount, note]) => <div key={symbol} className="card-asym border border-line bg-paperhi p-5"><div className="font-mono text-[9px] uppercase tracking-widest text-inksoft">{symbol}</div><div className="mt-2 font-display text-[27px] font-bold">{amount}</div><p className="mt-2 text-[10px] leading-4 text-inksoft">{note}</p></div>)}</div><div className="mt-5 card-asym border border-line bg-paperhi p-5"><div className="flex flex-wrap items-center justify-between gap-4"><div><div className="font-mono text-[9px] uppercase tracking-widest text-inksoft">Your connected wallet</div><div className="mt-1 font-mono text-[12px]">{user ? compact(user.wallet_address) : "Loading…"}</div></div><span className={`font-mono text-[9px] uppercase tracking-widest px-2.5 py-1 rounded-lg ${userFundsReady ? "status-green" : "status-brass"}`}>{userFundsReady ? "READY" : "CHECKING"}</span></div><div className="mt-4 grid gap-2 sm:grid-cols-3">{faucet ? [["U", faucet.user.U, faucet.required.U],["tBNB", faucet.user.tBNB, faucet.required.tBNB],["CAKE2", faucet.user.CAKE2, faucet.required.CAKE2]].map(([s, have, need]) => <div key={s} className="border border-line rounded-xl bg-paper p-3"><div className="font-mono text-[8px] uppercase text-inksoft">{s}</div><div className="mt-1 font-mono text-[11px]">{have} / {need}</div><div className="mt-2 h-1 bg-line"><div className="h-full bg-green" style={{ width: `${Math.min(100, Number(have) / Number(need) * 100)}%` }} /></div></div>) : <div className="text-[10px] text-inksoft">Checking testnet balances…</div>}</div></div>{error && <div className="mt-4 rounded-xl border border-[#cfad9f] bg-rustsoft p-3 text-[10px] text-rust">{error}</div>}{faucetMessage && <div className="mt-4 rounded-xl border border-line bg-paperhi p-3 text-[10px] text-inksoft">{faucetMessage}</div>}<div className="mt-6 flex flex-wrap items-center gap-3"><button type="button" onClick={() => void claimFaucet()} disabled={faucetBusy || userFundsReady || faucet?.faucet.available === false} className="btn-asym bg-ink px-6 py-3.5 font-display text-[12px] font-bold text-paperhi disabled:cursor-not-allowed disabled:opacity-45">{faucetBusy ? "Claiming test funds…" : userFundsReady ? "Test funds ready ✓" : "Claim test funds"}</button><button type="button" onClick={() => setStep(4)} disabled={!userFundsReady} className="btn-asym border border-line bg-paperhi px-6 py-3.5 font-display text-[12px] font-bold text-ink disabled:cursor-not-allowed disabled:opacity-40">Continue →</button><button type="button" onClick={() => setStep(4)} className="font-mono text-[9px] uppercase tracking-widest text-inksoft underline underline-offset-4">Skip for now</button></div></div>}

            {step === 4 && <div className="pt-10"><div className="font-mono text-[9px] uppercase tracking-[0.2em] text-brass">Altana · execution wallet</div><h1 className="mt-3 font-display text-[34px] font-bold tracking-[-0.03em] md:text-[46px]">Keep your wallet. Add an execution wallet.</h1><p className="mt-3 max-w-[720px] text-[12px] leading-5 text-inksoft">Your connected AgentMarket wallet remains yours and keeps the U used to fund missions. Altana provides the persistent Passkey wallet used for scoped agent execution.</p><div className="mt-6 grid gap-3 md:grid-cols-2"><div className="card-asym border border-line bg-paperhi p-5"><div className="font-mono text-[9px] uppercase text-brass">Your wallet</div><div className="mt-2 font-display text-[20px] font-bold">U stays here</div><p className="mt-2 text-[10px] leading-5 text-inksoft">The faucet deposits U here. You use it when a mission asks you to fund execution.</p></div><div className="card-asym border border-line bg-paperhi p-5"><div className="font-mono text-[9px] uppercase text-brass">Altana wallet</div><div className="mt-2 font-display text-[20px] font-bold">tBNB + CAKE2</div><p className="mt-2 text-[10px] leading-5 text-inksoft">The testnet tBNB and CAKE2 are moved here for supported execution flows. Agents receive scoped permissions, not your wallet keys.</p></div></div><div className="mt-6"><AltanaWalletGate existingWalletAddress={null} onResolved={(value) => void handleAltanaResolved(value)} /></div>{altana && <div className="mt-4 card-asym border border-line bg-paperhi p-5"><div className="flex flex-wrap items-start justify-between gap-4"><div><div className="font-mono text-[9px] uppercase tracking-widest text-inksoft">Persistent Altana wallet</div><div className="mt-1 font-mono text-[12px]">{compact(altana.walletAddress)}</div></div><span className={`font-mono text-[9px] uppercase tracking-widest px-2.5 py-1 rounded-lg ${altanaReady ? "status-green" : "status-brass"}`}>{altanaReady ? "READY" : "NEEDS FUNDING"}</span></div><div className="mt-4 grid gap-2 sm:grid-cols-2"><div className="border border-line rounded-xl bg-paper p-3"><div className="font-mono text-[8px] uppercase text-inksoft">tBNB</div><div className="mt-1 font-mono text-[11px]">{altanaBalances ? formatEther(altanaBalances.tBNB) : "Checking…"} / 0.002</div></div><div className="border border-line rounded-xl bg-paper p-3"><div className="font-mono text-[8px] uppercase text-inksoft">CAKE2</div><div className="mt-1 font-mono text-[11px]">{altanaBalances ? formatUnits(altanaBalances.CAKE2, 18) : "Checking…"} / 5</div></div></div>{!altanaReady && <button type="button" onClick={() => void fundAltana()} disabled={fundBusy} className="btn-asym mt-4 bg-ink px-5 py-3 font-display text-[11px] font-bold text-paperhi disabled:opacity-50">{fundBusy ? "Moving test assets…" : "Fund Altana wallet"}</button>}{fundMessage && <p className="mt-3 text-[10px] text-inksoft">{fundMessage}</p>}</div>}<div className="mt-5 flex flex-wrap items-center gap-3"><button type="button" onClick={() => setStep(5)} disabled={!canContinue} className="btn-asym bg-ink px-6 py-3.5 font-display text-[12px] font-bold text-paperhi disabled:cursor-not-allowed disabled:opacity-40">Continue →</button><button type="button" onClick={() => setStep(5)} className="font-mono text-[9px] uppercase tracking-widest text-inksoft underline underline-offset-4">Skip funding</button></div></div>}

            {step === 5 && <div className="pt-12 pb-8"><div className="font-mono text-[9px] uppercase tracking-[0.2em] text-brass">Setup complete</div><h1 className="mt-3 font-display text-[42px] font-bold leading-[1.02] tracking-[-0.04em] md:text-[58px]">You are ready to<br /><span className="text-inksoft">hire an agent.</span></h1><div className="mt-8 grid gap-2 sm:grid-cols-3"><div className="border border-line bg-paperhi p-4 card-asym"><span className="font-mono text-[8px] text-green">01 · READY</span><strong className="mt-2 block font-display text-[15px]">AgentMarket wallet</strong><span className="mt-1 block text-[10px] text-inksoft">Connected and authenticated.</span></div><div className="border border-line bg-paperhi p-4 card-asym"><span className="font-mono text-[8px] text-green">02 · READY</span><strong className="mt-2 block font-display text-[15px]">Altana execution</strong><span className="mt-1 block text-[10px] text-inksoft">Persistent Passkey wallet available.</span></div><div className="border border-line bg-paperhi p-4 card-asym"><span className="font-mono text-[8px] text-brass">03 · TESTNET</span><strong className="mt-2 block font-display text-[15px]">Safe sandbox</strong><span className="mt-1 block text-[10px] text-inksoft">Test assets only. Review every mission before approval.</span></div></div><div className="mt-8 border-t border-line pt-5"><p className="max-w-[690px] text-[11px] leading-5 text-inksoft">You can revisit your Execution Wallet at any time. Each mission creates its own scoped authorization; your persistent Altana wallet is not recreated for every task.</p><button type="button" onClick={finish} className="btn-asym mt-6 bg-ink px-6 py-3.5 font-display text-[12px] font-bold text-paperhi">Enter AgentMarket →</button></div></div>}
          </div>

          <aside className="hidden lg:block lg:sticky lg:top-8">
            <div className="card-asym-lg border border-line bg-paperhi p-5">
              <div className="font-mono text-[8px] uppercase tracking-[0.18em] text-brass">Setup map</div>
              <div className="mt-5 space-y-0">{["Welcome", "How hiring works", "Get testnet funds", "Set up Altana", "Ready to hire"].map((label, index) => { const n = index + 1; return <div key={label} className="flex gap-3"><div className="flex flex-col items-center"><div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border font-mono text-[9px] ${n < step ? "border-green bg-greensoft text-green" : n === step ? "border-brass bg-brasssoft text-brass" : "border-line text-inksoft"}`}>{n < step ? "✓" : n}</div>{n < 5 && <div className={`h-10 w-px ${n < step ? "bg-green/40" : "bg-line"}`} />}</div><div className={`pt-1 text-[10px] ${n === step ? "font-semibold text-ink" : "text-inksoft"}`}>{label}</div></div>; })}</div>
              <div className="mt-6 border-t border-line pt-4"><div className="font-mono text-[8px] uppercase tracking-widest text-inksoft">Network</div><div className="mt-1 font-mono text-[10px]">BSC Testnet · 97</div><div className="mt-3 font-mono text-[8px] uppercase tracking-widest text-inksoft">No real funds</div><div className="mt-1 text-[10px] leading-4 text-inksoft">The onboarding faucet and execution wallet are testnet-only.</div></div>
            </div>
          </aside>
        </section>
      </div>
    </main>
  );
}
