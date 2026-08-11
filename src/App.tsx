import { useEffect, useState } from "react";
import { createPublicClient, http, type Address } from "viem";
import { bsc } from "viem/chains";

type Agent = { agentId: string; uri: string; owner: string };
type Status = "connecting" | "loading" | "ready" | "error";

const IDENTITY_REGISTRY_ADDRESS = "0xfA09B3397fAC75424422C4D28b1729E3D4f659D7";

const IDENTITY_REGISTRY_ABI = [
  { inputs: [], name: "totalSupply", outputs: [{ internalType: "uint256", name: "", type: "uint256" }], stateMutability: "view", type: "function" },
  { inputs: [{ internalType: "uint256", name: "index", type: "uint256" }], name: "tokenByIndex", outputs: [{ internalType: "uint256", name: "", type: "uint256" }], stateMutability: "view", type: "function" },
  { inputs: [{ internalType: "uint256", name: "tokenId", type: "uint256" }], name: "tokenURI", outputs: [{ internalType: "string", name: "", type: "string" }], stateMutability: "view", type: "function" },
  { inputs: [{ internalType: "uint256", name: "tokenId", type: "uint256" }], name: "ownerOf", outputs: [{ internalType: "address", name: "", type: "address" }], stateMutability: "view", type: "function" },
];

const client = createPublicClient({
  chain: bsc,
  transport: http("https://bsc.publicnode.com"),
  batch: { multicall: true },
});

function shortAddr(addr?: string) {
  if (!addr) return "";
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`Timed out after ${ms}ms: ${label}`)), ms)),
  ]);
}

export default function App() {
  const [status, setStatus] = useState<Status>("connecting");
  const [totalAgents, setTotalAgents] = useState<number | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [errorMsg, setErrorMsg] = useState("");
  const [debugLog, setDebugLog] = useState<string[]>([]);

  function log(msg: string) {
    console.log(msg);
    setDebugLog((prev) => [...prev, msg]);
  }

  useEffect(() => {
    let cancelled = false;

    async function run() {
      try {
        setStatus("connecting");
        log("Step 1: requesting totalSupply…");
        const total = await withTimeout(
          client.readContract({ address: IDENTITY_REGISTRY_ADDRESS, abi: IDENTITY_REGISTRY_ABI, functionName: "totalSupply" }),
          8000,
          "totalSupply"
        );
        if (cancelled) return;
        log(`Step 1 done: totalSupply = ${total.toString()}`);
        setTotalAgents(Number(total));
        setStatus("loading");

        const count = Number(total);
        const sampleSize = Math.min(count, 12);
        const indexes = Array.from({ length: sampleSize }, (_, i) => count - 1 - i);
        log(`Step 2: fetching ${sampleSize} tokenIds…`);

        const tokenIds = await Promise.all(
          indexes.map((index) =>
            withTimeout(
              client.readContract({ address: IDENTITY_REGISTRY_ADDRESS, abi: IDENTITY_REGISTRY_ABI, functionName: "tokenByIndex", args: [BigInt(index)] }),
              8000,
              `tokenByIndex(${index})`
            ).catch((e) => {
              log(`tokenByIndex(${index}) failed: ${e.message}`);
              return null;
            })
          )
        );

        const validTokenIds = tokenIds.filter((t): t is bigint => t !== null);
        log(`Step 2 done: got ${validTokenIds.length} valid tokenIds`);

        log("Step 3: fetching tokenURI + owner for each…");
        const details = await Promise.all(
          validTokenIds.map(async (tokenId) => {
            try {
              const [uri, owner] = await Promise.all([
                withTimeout(client.readContract({ address: IDENTITY_REGISTRY_ADDRESS, abi: IDENTITY_REGISTRY_ABI, functionName: "tokenURI", args: [tokenId] }), 8000, `tokenURI(${tokenId})`),
                withTimeout(client.readContract({ address: IDENTITY_REGISTRY_ADDRESS, abi: IDENTITY_REGISTRY_ABI, functionName: "ownerOf", args: [tokenId] }), 8000, `ownerOf(${tokenId})`),
              ]);
              return { agentId: tokenId.toString(), uri: uri as string, owner: owner as Address } as Agent;
            } catch (e) {
              log(`Details for tokenId ${tokenId} failed: ${e instanceof Error ? e.message : String(e)}`);
              return null;
            }
          })
        );

        const results = details.filter((d): d is Agent => d !== null);
        log(`Step 3 done: ${results.length} agents ready to display`);

        if (!cancelled) {
          setAgents(results);
          setStatus("ready");
        }
      } catch (err) {
        console.error(err);
        log(`FATAL: ${err instanceof Error ? err.message : String(err)}`);
        if (!cancelled) {
          const message = err instanceof Error ? err.message : "Something went wrong reading the chain.";
          setErrorMsg(message);
          setStatus("error");
        }
      }
    }

    run();
    return () => { cancelled = true; };
  }, []);

  return (
    <div style={styles.page}>
      <header style={styles.header}>
        <div style={styles.eyebrow}>BNB Smart Chain · Live Onchain Data</div>
        <h1 style={styles.title}>Agent Registry</h1>
        <p style={styles.subtitle}>Reading directly from the BRC8004 Identity Registry contract on BNB Chain mainnet. No mock data — every row below is a real registered agent.</p>
      </header>

      <section style={styles.statsRow}>
        <div style={styles.statCard}>
          <div style={styles.statLabel}>Total registered agents</div>
          <div style={styles.statValue}>{totalAgents === null ? "—" : totalAgents.toLocaleString()}</div>
        </div>
        <div style={styles.statCard}>
          <div style={styles.statLabel}>Status</div>
          <div style={styles.statValue}><StatusPill status={status} /></div>
        </div>
        <div style={styles.statCard}>
          <div style={styles.statLabel}>Contract</div>
          <a style={styles.contractLink} href={`https://bscscan.com/address/${IDENTITY_REGISTRY_ADDRESS}`} target="_blank" rel="noreferrer">{shortAddr(IDENTITY_REGISTRY_ADDRESS)} ↗</a>
        </div>
      </section>

      {status === "error" && <div style={styles.errorBox}>Couldn't read from the chain: {errorMsg}</div>}

      {debugLog.length > 0 && (
        <div style={styles.debugBox}>
          <div style={styles.debugTitle}>Debug log</div>
          {debugLog.map((line, i) => <div key={i} style={styles.debugLine}>{line}</div>)}
        </div>
      )}

      <section style={styles.list}>
        {agents.length === 0 && status !== "error" && <div style={styles.loadingRow}>Fetching agents from BNB Chain…</div>}
        {agents.map((agent) => (
          <div key={agent.agentId} style={styles.card}>
            <div style={styles.cardTop}>
              <span style={styles.agentId}>Agent #{agent.agentId}</span>
              <a style={styles.ownerLink} href={`https://bscscan.com/address/${agent.owner}`} target="_blank" rel="noreferrer">Owner: {shortAddr(agent.owner)} ↗</a>
            </div>
            <div style={styles.uriRow}>
              <span style={styles.uriLabel}>Registration file:</span>
              <span style={styles.uriValue}>{agent.uri || "(empty)"}</span>
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}

function StatusPill({ status }: { status: Status }) {
  const map: Record<Status, { text: string; bg: string; fg: string }> = {
    connecting: { text: "Connecting…", bg: "#3a3a2e", fg: "#e8d98a" },
    loading: { text: "Loading agents…", bg: "#2e3a3a", fg: "#8adede" },
    ready: { text: "Live", bg: "#1f3a2e", fg: "#7ee2a8" },
    error: { text: "Error", bg: "#3a1f1f", fg: "#e88a8a" },
  };
  const s = map[status] || map.connecting;
  return <span style={{ display: "inline-block", padding: "4px 10px", borderRadius: 999, fontSize: 13, fontWeight: 600, background: s.bg, color: s.fg }}>{s.text}</span>;
}

const styles = {
  page: { minHeight: "100vh", background: "#0d0f10", color: "#e8e6e1", fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", padding: "48px 24px 80px" },
  header: { maxWidth: 780, margin: "0 auto 40px" },
  eyebrow: { fontSize: 12, letterSpacing: "0.08em", textTransform: "uppercase" as const, color: "#f0b90b", fontWeight: 700, marginBottom: 12 },
  title: { fontSize: 40, fontWeight: 800, margin: "0 0 12px", letterSpacing: "-0.02em" },
  subtitle: { fontSize: 16, lineHeight: 1.6, color: "#a3a09a", maxWidth: 560 },
  statsRow: { maxWidth: 780, margin: "0 auto 32px", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 },
  statCard: { background: "#17191a", border: "1px solid #26282a", borderRadius: 12, padding: "16px 18px" },
  statLabel: { fontSize: 12, color: "#7a776f", marginBottom: 6, textTransform: "uppercase" as const, letterSpacing: "0.04em" },
  statValue: { fontSize: 22, fontWeight: 700 },
  contractLink: { fontSize: 15, color: "#f0b90b", textDecoration: "none", fontWeight: 600 },
  errorBox: { maxWidth: 780, margin: "0 auto 24px", background: "#2a1616", border: "1px solid #4a2323", color: "#f0a3a3", padding: "14px 18px", borderRadius: 10, fontSize: 14 },
  debugBox: { maxWidth: 780, margin: "0 auto 24px", background: "#111314", border: "1px solid #26282a", borderRadius: 10, padding: "14px 18px", fontFamily: "monospace" },
  debugTitle: { fontSize: 12, color: "#7a776f", marginBottom: 8, textTransform: "uppercase" as const, letterSpacing: "0.04em" },
  debugLine: { fontSize: 12, color: "#8adede", lineHeight: 1.6, wordBreak: "break-all" as const },
  list: { maxWidth: 780, margin: "0 auto", display: "flex", flexDirection: "column" as const, gap: 10 },
  loadingRow: { color: "#7a776f", fontSize: 14, padding: "20px 0" },
  card: { background: "#17191a", border: "1px solid #26282a", borderRadius: 12, padding: "16px 18px" },
  cardTop: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, flexWrap: "wrap" as const, gap: 8 },
  agentId: { fontWeight: 700, fontSize: 15 },
  ownerLink: { fontSize: 13, color: "#8a8880", textDecoration: "none" },
  uriRow: { display: "flex", gap: 8, fontSize: 13, color: "#a3a09a", wordBreak: "break-all" as const },
  uriLabel: { color: "#5f5d57", flexShrink: 0 },
  uriValue: { color: "#c9c6bf" },
};
