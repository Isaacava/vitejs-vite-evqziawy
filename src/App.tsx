import { useEffect, useMemo, useState } from "react";
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

const IDENTITY_REGISTRY_ADDRESS = "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432";

const IDENTITY_REGISTRY_ABI = [
  { inputs: [], name: "totalSupply", outputs: [{ internalType: "uint256", name: "", type: "uint256" }], stateMutability: "view", type: "function" },
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

const AVATAR_COLORS = ["#f0b90b", "#7ee2a8", "#8adede", "#e88a8a", "#c9a3f0", "#f0a3c9"];
function avatarColor(id: string) {
  const n = parseInt(id, 10) || 0;
  return AVATAR_COLORS[n % AVATAR_COLORS.length];
}

export default function App() {
  const [status, setStatus] = useState<Status>("connecting");
  const [agents, setAgents] = useState<Agent[]>([]);
  const [errorMsg, setErrorMsg] = useState("");
  const [debugLog, setDebugLog] = useState<string[]>([]);
  const [showDebug, setShowDebug] = useState(false);
  const [search, setSearch] = useState("");

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
        let total: bigint;
        try {
          total = await withTimeout(
            client.readContract({ address: IDENTITY_REGISTRY_ADDRESS, abi: IDENTITY_REGISTRY_ABI, functionName: "totalSupply" }) as Promise<bigint>,
            8000,
            "totalSupply"
          );
          log(`Step 1 done: totalSupply = ${total.toString()}`);
        } catch (e) {
          log(`totalSupply not available (${e instanceof Error ? e.message : String(e)}), using fallback probe window`);
          total = 60n;
        }
        if (cancelled) return;
        setStatus("loading");

        const count = Number(total);
        const probeSize = Math.min(count, 60);
        const candidateIds = Array.from({ length: probeSize }, (_, i) => count - i).filter((id) => id > 0);
        log(`Step 2: probing ${candidateIds.length} most recent agent IDs…`);

        const ownerResults = await Promise.all(
          candidateIds.map((id) =>
            withTimeout(
              client.readContract({ address: IDENTITY_REGISTRY_ADDRESS, abi: IDENTITY_REGISTRY_ABI, functionName: "ownerOf", args: [BigInt(id)] }) as Promise<Address>,
              8000,
              `ownerOf(${id})`
            ).catch(() => null)
          )
        );

        const validAgents = candidateIds
          .map((id, i) => ({ id: BigInt(id), owner: ownerResults[i] }))
          .filter((a): a is { id: bigint; owner: Address } => a.owner !== null);
        log(`Step 2 done: found ${validAgents.length} existing agent IDs`);

        log("Step 3: fetching tokenURI for each…");
        const details = await Promise.all(
          validAgents.map(async ({ id: tokenId, owner }) => {
            try {
              const uri = await withTimeout(
                client.readContract({ address: IDENTITY_REGISTRY_ADDRESS, abi: IDENTITY_REGISTRY_ABI, functionName: "tokenURI", args: [tokenId] }) as Promise<string>,
                8000,
                `tokenURI(${tokenId})`
              );
              return { agentId: tokenId.toString(), uri: uri as string, owner: owner as Address } as Agent;
            } catch (e) {
              log(`tokenURI for tokenId ${tokenId} failed: ${e instanceof Error ? e.message : String(e)}`);
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

  const filteredAgents = useMemo(() => {
    if (!search.trim()) return agents;
    const q = search.toLowerCase();
    return agents.filter(
      (a) =>
        a.agentId.includes(q) ||
        a.name?.toLowerCase().includes(q) ||
        a.description?.toLowerCase().includes(q) ||
        a.owner.toLowerCase().includes(q)
    );
  }, [agents, search]);

  return (
    <div style={styles.page}>
      <div style={styles.container}>
        <header style={styles.header}>
          <h1 style={styles.title}>Agent Registry</h1>
          <p style={styles.subtitle}>Discover autonomous agents on the ERC-8004 registry — live from BNB Smart Chain</p>
        </header>

        <div style={styles.toolbar}>
          <div style={styles.searchWrap}>
            <span style={styles.searchIcon}>⌕</span>
            <input
              style={styles.searchInput}
              placeholder="Search by agent name, description, ID, or address"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div style={styles.toolbarRight}>
            <StatusPill status={status} />
            <button style={styles.debugToggle} onClick={() => setShowDebug((s) => !s)}>
              {showDebug ? "Hide log" : "Debug log"}
            </button>
          </div>
        </div>

        {status === "error" && <div style={styles.errorBox}>Couldn't read from the chain: {errorMsg}</div>}

        {showDebug && debugLog.length > 0 && (
          <div style={styles.debugBox}>
            {debugLog.map((line, i) => <div key={i} style={styles.debugLine}>{line}</div>)}
          </div>
        )}

        <div style={styles.tableWrap}>
          <div style={styles.tableHeaderRow}>
            <div style={{ ...styles.th, flex: "2 1 220px" }}>Name</div>
            <div style={{ ...styles.th, flex: "1 1 120px" }}>Chain</div>
            <div style={{ ...styles.th, flex: "1 1 100px" }}>Owner</div>
            <div style={{ ...styles.th, flex: "0 0 90px" }}>ID</div>
          </div>

          {agents.length === 0 && status !== "error" && (
            <div style={styles.loadingRow}>
              <span style={styles.spinner} />
              Fetching agents from BNB Chain…
            </div>
          )}

          {filteredAgents.length === 0 && agents.length > 0 && (
            <div style={styles.loadingRow}>No agents match "{search}"</div>
          )}

          {filteredAgents.map((agent) => (
            <div key={agent.agentId} style={styles.row}>
              <div style={{ ...styles.td, flex: "2 1 220px", display: "flex", alignItems: "center", gap: 12 }}>
                {agent.image ? (
                  <img
                    src={agent.image}
                    alt=""
                    style={styles.avatar}
                    onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                  />
                ) : (
                  <div style={{ ...styles.avatarFallback, background: avatarColor(agent.agentId) }}>
                    {(agent.name || "A")[0].toUpperCase()}
                  </div>
                )}
                <div style={{ minWidth: 0 }}>
                  <div style={styles.agentName}>{agent.name || `Agent #${agent.agentId}`}</div>
                  {agent.description && <div style={styles.agentDesc}>{agent.description}</div>}
                </div>
              </div>
              <div style={{ ...styles.td, flex: "1 1 120px" }}>
                <span style={styles.chainBadge}>BNB Smart Chain</span>
              </div>
              <div style={{ ...styles.td, flex: "1 1 100px" }}>
                <a style={styles.ownerLink} href={`https://bscscan.com/address/${agent.owner}`} target="_blank" rel="noreferrer">
                  {shortAddr(agent.owner)}
                </a>
              </div>
              <div style={{ ...styles.td, flex: "0 0 90px", color: "#7a776f" }}>#{agent.agentId}</div>
            </div>
          ))}
        </div>

        {agents.length > 0 && (
          <div style={styles.footer}>
            Showing {filteredAgents.length} of {agents.length} agents loaded (probing most recent registrations)
          </div>
        )}
      </div>
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
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 12px", borderRadius: 999, fontSize: 13, fontWeight: 600, background: s.bg, color: s.fg }}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: s.fg }} />
      {s.text}
    </span>
  );
}

const styles = {
  page: { minHeight: "100vh", background: "#0b0d0e", color: "#e8e6e1", fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" },
  container: { maxWidth: 960, margin: "0 auto", padding: "32px 20px 80px" },
  header: { marginBottom: 24 },
  title: { fontSize: 30, fontWeight: 800, margin: "0 0 6px", letterSpacing: "-0.02em", background: "linear-gradient(90deg, #ffffff, #f0b90b)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" },
  subtitle: { fontSize: 14, color: "#8a8880", margin: 0 },
  toolbar: { display: "flex", flexWrap: "wrap" as const, gap: 10, marginBottom: 16, justifyContent: "space-between", alignItems: "center" },
  searchWrap: { position: "relative" as const, flex: "1 1 260px" },
  searchIcon: { position: "absolute" as const, left: 14, top: "50%", transform: "translateY(-50%)", color: "#5f5d57", fontSize: 16 },
  searchInput: { width: "100%", boxSizing: "border-box" as const, background: "#151718", border: "1px solid #26282a", borderRadius: 10, padding: "11px 14px 11px 38px", color: "#e8e6e1", fontSize: 14, outline: "none" },
  toolbarRight: { display: "flex", alignItems: "center", gap: 8 },
  debugToggle: { background: "transparent", border: "1px solid #26282a", borderRadius: 8, color: "#7a776f", fontSize: 12, padding: "6px 10px", cursor: "pointer" },
  errorBox: { marginBottom: 16, background: "#2a1616", border: "1px solid #4a2323", color: "#f0a3a3", padding: "14px 18px", borderRadius: 10, fontSize: 14 },
  debugBox: { marginBottom: 16, background: "#111314", border: "1px solid #26282a", borderRadius: 10, padding: "14px 18px", fontFamily: "monospace", maxHeight: 220, overflowY: "auto" as const },
  debugLine: { fontSize: 12, color: "#8adede", lineHeight: 1.6, wordBreak: "break-all" as const },
  tableWrap: { background: "#111314", border: "1px solid #26282a", borderRadius: 14, overflow: "hidden" },
  tableHeaderRow: { display: "flex", padding: "12px 16px", borderBottom: "1px solid #26282a", background: "#151718" },
  th: { fontSize: 11, fontWeight: 700, color: "#7a776f", textTransform: "uppercase" as const, letterSpacing: "0.04em" },
  row: { display: "flex", alignItems: "center", padding: "14px 16px", borderBottom: "1px solid #1c1e1f" },
  td: { fontSize: 14, color: "#e8e6e1", paddingRight: 12 },
  avatar: { width: 36, height: 36, borderRadius: 9, objectFit: "cover" as const, flexShrink: 0, background: "#0b0d0e", border: "1px solid #26282a" },
  avatarFallback: { width: 36, height: 36, borderRadius: 9, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 15, color: "#0b0d0e" },
  agentName: { fontSize: 14, fontWeight: 600, color: "#f2f0eb", whiteSpace: "nowrap" as const, overflow: "hidden", textOverflow: "ellipsis" },
  agentDesc: { fontSize: 12, color: "#7a776f", whiteSpace: "nowrap" as const, overflow: "hidden", textOverflow: "ellipsis", maxWidth: 320 },
  chainBadge: { display: "inline-block", fontSize: 12, color: "#f0b90b", background: "rgba(240,185,11,0.1)", border: "1px solid rgba(240,185,11,0.25)", borderRadius: 6, padding: "3px 8px" },
  ownerLink: { fontSize: 13, color: "#8a8880", textDecoration: "none", fontFamily: "monospace" },
  loadingRow: { display: "flex", alignItems: "center", gap: 10, color: "#7a776f", fontSize: 14, padding: "32px 16px", justifyContent: "center" },
  spinner: { width: 14, height: 14, borderRadius: "50%", border: "2px solid #26282a", borderTopColor: "#f0b90b", display: "inline-block" },
  footer: { marginTop: 14, fontSize: 12, color: "#5f5d57", textAlign: "center" as const },
};
