import { useEffect, useState } from "react";
import { createPublicClient, http, type Address } from "viem";
import { bsc } from "viem/chains";

type Agent = {
  agentId: string;
  uri: string;
  owner: string;
  name?: string;
  description?: string;
  image?: string;
  metadataError?: boolean;
};

type Status = "connecting" | "loading" | "ready" | "error";

const IDENTITY_REGISTRY_ADDRESS = "0xfA09B3397fAC75424422C4D28b1729E3D4f659D7";

const IDENTITY_REGISTRY_ABI = [
  { inputs: [], name: "totalSupply", outputs: [{ internalType: "uint256", name: "", type: "uint256" }], stateMutability: "view", type: "function" },
  { inputs: [{ internalType: "uint256", name: "agentId", type: "uint256" }], name: "exists", outputs: [{ internalType: "bool", name: "", type: "bool" }], stateMutability: "view", type: "function" },
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

function resolveUri(uri: string): string {
  if (uri.startsWith("ipfs://")) {
    return `https://ipfs.io/ipfs/${uri.slice("ipfs://".length)}`;
  }
  return uri;
}

async function fetchAgentMetadata(uri: string): Promise<{ name?: string; description?: string; image?: string }> {
  if (uri.startsWith("data:application/json")) {
    const commaIndex = uri.indexOf(",");
    const payload = uri.slice(commaIndex + 1);
    const isBase64 = uri.slice(0, commaIndex).includes("base64");
    const jsonText = isBase64 ? atob(payload) : decodeURIComponent(payload);
    const parsed = JSON.parse(jsonText);
    return { name: parsed.name, description: parsed.description, image: parsed.image };
  }

  const resolved = resolveUri(uri);
  const res = await withTimeout(fetch(resolved), 6000, `fetch ${resolved}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const parsed = await res.json();
  return {
    name: parsed.name,
    description: parsed.description,
    image: parsed.image ? resolveUri(parsed.image) : undefined,
  };
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
          client.readContract({ address: IDENTITY_REGISTRY_ADDRESS, abi: IDENTITY_REGISTRY_ABI, functionName: "totalSupply" }) as Promise<bigint>,
          8000,
          "totalSupply"
        );
        if (cancelled) return;
        log(`Step 1 done: totalSupply = ${total.toString()}`);
        setTotalAgents(Number(total));
        setStatus("loading");

        const count = Number(total);
        const probeSize = Math.min(count + 5, 40);
        const candidateIds = Array.from({ length: probeSize }, (_, i) => i + 1);
        log(`Step 2: probing ${probeSize} candidate agent IDs for existence…`);

        const existsResults = await Promise.all(
          candidateIds.map((id) =>
            withTimeout(
              client.readContract({ address: IDENTITY_REGISTRY_ADDRESS, abi: IDENTITY_REGISTRY_ABI, functionName: "exists", args: [BigInt(id)] }) as Promise<boolean>,
              8000,
              `exists(${id})`
            ).catch((e) => {
              log(`exists(${id}) failed: ${e.message}`);
              return false;
            })
          )
        );

        const validTokenIds = candidateIds
          .filter((_, i) => existsResults[i])
          .map((id) => BigInt(id));
        log(`Step 2 done: found ${validTokenIds.length} existing agent IDs`);

        log("Step 3: fetching tokenURI + owner for each…");
        const details = await Promise.all(
          validTokenIds.map(async (tokenId) => {
            try {
              const [uri, owner] = await Promise.all([
                withTimeout(client.readContract({ address: IDENTITY_REGISTRY_ADDRESS, abi: IDENTITY_REGISTRY_ABI, functionName: "tokenURI", args: [tokenId] }) as Promise<string>, 8000, `tokenURI(${tokenId})`),
                withTimeout(client.readContract({ address: IDENTITY_REGISTRY_ADDRESS, abi: IDENTITY_REGISTRY_ABI, functionName: "ownerOf", args: [tokenId] }) as Promise<Address>, 8000, `ownerOf(${tokenId})`),
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

        log("Step 4: fetching agent metadata (name/image)…");
        results.forEach(async (agent) => {
          try {
            const meta = await fetchAgentMetadata(agent.uri);
            if (cancelled) return;
            setAgents((prev) =>
              prev.map((a) =>
                a.agentId === agent.agentId
                  ? { ...a, name: meta.name, description: meta.description, image: meta.image }
                  : a
              )
            );
          } catch (e) {
            log(`Metadata fetch failed for agent ${agent.agentId}: ${e instanceof Error ? e.message : String(e)}`);
            if (cancelled) return;
            setAgents((prev) =>
              prev.map((a) => (a.agentId === agent.agentId ? { ...a, metadataError: true } : a))
            );
          }
        });
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
            <div style={styles.cardBody}>
              {agent.image && (
                <img
                  src={agent.image}
                  alt={agent.name || `Agent ${agent.agentId}`}
                  style={styles.agentImage}
                  onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                />
              )}
              <div style={styles.cardText}>
                <div style={styles.cardTop}>
                  <span style={styles.agentId}>{agent.name || `Agent #${agent.agentId}`}</span>
                  <a style={styles.ownerLink} href={`https://bscscan.com/address/${agent.owner}`} target="_blank" rel="noreferrer">Owner: {shortAddr(agent.owner)} ↗</a>
                </div>
                {agent.description && <div style={styles.agentDescription}>{agent.description}</div>}
                <div style={styles.uriRow}>
                  <span style={styles.uriLabel}>{agent.metadataError ? "Registration file (could not load preview):" : "Registration file:"}</span>
                  <span style={styles.uriValue}>{agent.uri || "(empty)"}</span>
                </div>
              </div>
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
  cardBody: { display: "flex", gap: 14, alignItems: "flex-start" as const },
  agentImage: { width: 56, height: 56, borderRadius: 10, objectFit: "cover" as const, flexShrink: 0, background: "#0d0f10", border: "1px solid #26282a" },
  cardText: { flex: 1, minWidth: 0 },
  agentDescription: { fontSize: 13, color: "#a3a09a", lineHeight: 1.5, marginBottom: 8 },
  cardTop: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, flexWrap: "wrap" as const, gap: 8 },
  agentId: { fontWeight: 700, fontSize: 15 },
  ownerLink: { fontSize: 13, color: "#8a8880", textDecoration: "none" },
  uriRow: { display: "flex", gap: 8, fontSize: 13, color: "#a3a09a", wordBreak: "break-all" as const },
  uriLabel: { color: "#5f5d57", flexShrink: 0 },
  uriValue: { color: "#c9c6bf" },
};
