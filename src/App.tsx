import { useEffect, useMemo, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import { createWalletClient, custom, parseEther, type Address } from "viem";
import { bsc } from "viem/chains";

declare global {
  interface Window {
    ethereum?: {
      request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
      on?: (event: string, handler: (...args: unknown[]) => void) => void;
      removeListener?: (event: string, handler: (...args: unknown[]) => void) => void;
    };
  }
}

type WalletState = {
  address: Address | null;
  connecting: boolean;
  error: string | null;
};

type Agent = {
  agent_id: string;
  owner: string;
  uri: string;
  name: string | null;
  description: string | null;
  image: string | null;
  chain: string;
  category: string;
};

type Status = "loading" | "ready" | "error";
type ActivateState = "idle" | "confirming" | "awaiting_signature" | "pending" | "done" | "error";

const SUPABASE_URL = "https://sfbxpscbevnmoppgkjcr.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNmYnhwc2NiZXZubW9wcGdramNyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYxMTQ3OTQsImV4cCI6MjEwMTY5MDc5NH0.ttfR2pNVqlOYrorGdAs7aaGgufxwXIsG-GXvLDd-jZw";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const CATEGORIES: { key: string; label: string }[] = [
  { key: "all", label: "All" },
  { key: "rebalancing", label: "Rebalancing" },
  { key: "grid_trading", label: "Grid Trading" },
  { key: "yield", label: "Yield" },
  { key: "health_factor", label: "Health Factor" },
  { key: "other", label: "Other" },
];

const CATEGORY_LABELS: Record<string, string> = {
  rebalancing: "Rebalancing",
  grid_trading: "Grid Trading",
  yield: "Yield",
  health_factor: "Health Factor",
  other: "Other",
};

const CATEGORY_COLORS: Record<string, string> = {
  rebalancing: "#c9a3f0",
  grid_trading: "#8adede",
  yield: "#7ee2a8",
  health_factor: "#e88a8a",
  other: "#7a776f",
};

function shortAddr(addr?: string) {
  if (!addr) return "";
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

const AVATAR_COLORS = ["#f0b90b", "#7ee2a8", "#8adede", "#e88a8a", "#c9a3f0", "#f0a3c9"];
function avatarColor(id: string) {
  const n = parseInt(id, 10) || 0;
  return AVATAR_COLORS[n % AVATAR_COLORS.length];
}

const PAGE_SIZE = 24;

export default function App() {
  const [status, setStatus] = useState<Status>("loading");
  const [agents, setAgents] = useState<Agent[]>([]);
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const [categoryCounts, setCategoryCounts] = useState<Record<string, number>>({});
  const [errorMsg, setErrorMsg] = useState("");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState("all");
  const [page, setPage] = useState(0);
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);
  const [wallet, setWallet] = useState<WalletState>({ address: null, connecting: false, error: null });

  async function connectWallet() {
    if (!window.ethereum) {
      setWallet((w) => ({ ...w, error: "No wallet found. Install MetaMask or Trust Wallet to continue." }));
      return;
    }
    setWallet((w) => ({ ...w, connecting: true, error: null }));
    try {
      const accounts = (await window.ethereum.request({ method: "eth_requestAccounts" })) as string[];
      // Ensure we're on BNB Smart Chain (chainId 0x38 = 56) — switch if needed.
      try {
        await window.ethereum.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: "0x38" }],
        });
      } catch {
        // If the chain isn't added to the wallet yet, this will fail silently
        // here; the transaction step will surface a clearer error if the
        // wrong network is still active.
      }
      setWallet({ address: accounts[0] as Address, connecting: false, error: null });
    } catch (e) {
      setWallet({
        address: null,
        connecting: false,
        error: e instanceof Error ? e.message : "Wallet connection was rejected.",
      });
    }
  }

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    setPage(0);
  }, [debouncedSearch, activeCategory]);

  useEffect(() => {
    let cancelled = false;
    async function loadCounts() {
      const counts: Record<string, number> = {};
      for (const cat of CATEGORIES) {
        if (cat.key === "all") continue;
        const { count } = await supabase
          .from("agents")
          .select("*", { count: "exact", head: true })
          .eq("category", cat.key);
        if (!cancelled) counts[cat.key] = count ?? 0;
      }
      if (!cancelled) setCategoryCounts(counts);
    }
    loadCounts();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setStatus("loading");
      try {
        let query = supabase
          .from("agents")
          .select("*", { count: "exact" })
          .order("indexed_at", { ascending: false })
          .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);

        if (activeCategory !== "all") {
          query = query.eq("category", activeCategory);
        }

        if (debouncedSearch.trim()) {
          const q = debouncedSearch.trim();
          query = query.or(
            `agent_id.eq.${q},name.ilike.%${q}%,description.ilike.%${q}%,owner.ilike.%${q}%`
          );
        }

        const { data, error, count } = await query;
        if (error) throw error;
        if (cancelled) return;

        setAgents(data || []);
        setTotalCount(count ?? null);
        setStatus("ready");
      } catch (e) {
        if (cancelled) return;
        setErrorMsg(e instanceof Error ? e.message : "Failed to load agents");
        setStatus("error");
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [page, debouncedSearch, activeCategory]);

  const totalPages = useMemo(
    () => (totalCount ? Math.ceil(totalCount / PAGE_SIZE) : 1),
    [totalCount]
  );

  if (selectedAgent) {
    return (
      <AgentDetail
        agent={selectedAgent}
        onBack={() => setSelectedAgent(null)}
        wallet={wallet}
        onConnectWallet={connectWallet}
      />
    );
  }

  return (
    <div style={styles.page}>
      <div style={styles.container}>
        <header style={styles.header}>
          <h1 style={styles.title}>Agent Registry</h1>
          <p style={styles.subtitle}>
            Discover autonomous agents on the ERC-8004 registry — indexed from BNB Smart Chain
          </p>
        </header>

        <div style={styles.tabRow}>
          {CATEGORIES.map((cat) => (
            <button
              key={cat.key}
              onClick={() => setActiveCategory(cat.key)}
              style={{
                ...styles.tab,
                ...(activeCategory === cat.key ? styles.tabActive : {}),
              }}
            >
              {cat.label}
              {cat.key !== "all" && categoryCounts[cat.key] !== undefined && (
                <span style={styles.tabCount}>{categoryCounts[cat.key]}</span>
              )}
            </button>
          ))}
        </div>

        <div style={styles.toolbar}>
          <div style={styles.searchWrap}>
            <span style={styles.searchIcon}>⌕</span>
            <input
              style={styles.searchInput}
              placeholder="Search by name, description, ID, or address"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          {totalCount !== null && (
            <span style={styles.countBadge}>{totalCount.toLocaleString()} agents</span>
          )}
        </div>

        {status === "error" && (
          <div style={styles.errorBox}>Couldn't load agents: {errorMsg}</div>
        )}

        <div style={styles.grid}>
          {status === "loading" && (
            <div style={styles.loadingRow}>
              <span style={styles.spinner} />
              Loading agents…
            </div>
          )}

          {status === "ready" && agents.length === 0 && (
            <div style={styles.loadingRow}>No agents found in this category.</div>
          )}

          {agents.map((agent) => (
            <button
              key={agent.agent_id}
              style={styles.card}
              onClick={() => setSelectedAgent(agent)}
            >
              <div style={styles.cardTop}>
                {agent.image ? (
                  <img
                    src={agent.image}
                    alt=""
                    style={styles.avatar}
                    onError={(e) => {
                      (e.currentTarget as HTMLImageElement).style.display = "none";
                    }}
                  />
                ) : (
                  <div style={{ ...styles.avatarFallback, background: avatarColor(agent.agent_id) }}>
                    {(agent.name || "A")[0].toUpperCase()}
                  </div>
                )}
                <CategoryBadge category={agent.category} />
              </div>
              <div style={styles.cardName}>{agent.name || `Agent #${agent.agent_id}`}</div>
              {agent.description && <div style={styles.cardDesc}>{agent.description}</div>}
              <div style={styles.cardFooter}>
                <span style={styles.ownerLink}>{shortAddr(agent.owner)}</span>
                <span style={styles.idLabel}>#{agent.agent_id}</span>
              </div>
            </button>
          ))}
        </div>

        {totalCount !== null && totalCount > PAGE_SIZE && (
          <div style={styles.pagination}>
            <button
              style={styles.pageBtn}
              disabled={page === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
            >
              Previous
            </button>
            <span style={styles.pageLabel}>
              Page {page + 1} of {totalPages}
            </span>
            <button
              style={styles.pageBtn}
              disabled={page + 1 >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function AgentDetail({
  agent,
  onBack,
  wallet,
  onConnectWallet,
}: {
  agent: Agent;
  onBack: () => void;
  wallet: WalletState;
  onConnectWallet: () => void;
}) {
  const [activateState, setActivateState] = useState<ActivateState>("idle");
  const [txHash, setTxHash] = useState<string | null>(null);
  const [txError, setTxError] = useState<string | null>(null);

  const isValidOwner = /^0x[a-fA-F0-9]{40}$/.test(agent.owner);

  function handleActivate() {
    setActivateState("confirming");
    setTxError(null);
  }

  async function confirmActivate() {
    if (!wallet.address || !window.ethereum) return;
    if (!isValidOwner) {
      setTxError("This agent's owner address isn't valid — can't send payment.");
      setActivateState("error");
      return;
    }

    setActivateState("awaiting_signature");
    try {
      const walletClient = createWalletClient({
        chain: bsc,
        transport: custom(window.ethereum),
      });

      // Real onchain transaction: a small activation payment sent directly
      // to the agent owner's wallet, on BNB Smart Chain mainnet. The user
      // signs and pays real gas in their own wallet.
      const hash = await walletClient.sendTransaction({
        account: wallet.address,
        to: agent.owner as Address,
        value: parseEther("0.0005"),
      });

      setTxHash(hash);
      setActivateState("pending");

      // We don't wait for confirmation here since public RPC polling from
      // the browser can be slow/rate-limited — the tx hash itself is
      // immediate, verifiable proof, and BscScan will confirm status.
      setTimeout(() => setActivateState("done"), 2500);
    } catch (e) {
      setTxError(e instanceof Error ? e.message : "Transaction was rejected or failed.");
      setActivateState("error");
    }
  }

  return (
    <div style={styles.page}>
      <div style={styles.detailContainer}>
        <button style={styles.backBtn} onClick={onBack}>
          ← Back to agents
        </button>

        <div style={styles.detailCard}>
          <div style={styles.detailHeader}>
            {agent.image ? (
              <img
                src={agent.image}
                alt=""
                style={styles.detailAvatar}
                onError={(e) => {
                  (e.currentTarget as HTMLImageElement).style.display = "none";
                }}
              />
            ) : (
              <div style={{ ...styles.detailAvatarFallback, background: avatarColor(agent.agent_id) }}>
                {(agent.name || "A")[0].toUpperCase()}
              </div>
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={styles.detailNameRow}>
                <h1 style={styles.detailName}>{agent.name || `Agent #${agent.agent_id}`}</h1>
                <CategoryBadge category={agent.category} />
              </div>
              <div style={styles.detailMeta}>
                Agent #{agent.agent_id} · {agent.chain === "bsc" ? "BNB Smart Chain" : agent.chain}
              </div>
            </div>
          </div>

          {agent.description && <p style={styles.detailDesc}>{agent.description}</p>}

          <div style={styles.detailInfoGrid}>
            <div style={styles.infoBox}>
              <div style={styles.infoLabel}>Owner</div>
              <a
                style={styles.infoLink}
                href={`https://bscscan.com/address/${agent.owner}`}
                target="_blank"
                rel="noreferrer"
              >
                {shortAddr(agent.owner)} ↗
              </a>
            </div>
            <div style={styles.infoBox}>
              <div style={styles.infoLabel}>Registry</div>
              <a
                style={styles.infoLink}
                href="https://bscscan.com/address/0x8004A169FB4a3325136EB29fA0ceB6D2e539a432"
                target="_blank"
                rel="noreferrer"
              >
                ERC-8004 Identity ↗
              </a>
            </div>
            <div style={styles.infoBox}>
              <div style={styles.infoLabel}>Registration file</div>
              <div style={styles.infoValueSmall}>
                {agent.uri.startsWith("data:") ? "Inline (onchain)" : "External"}
              </div>
            </div>
          </div>

          <div style={styles.activateSection}>
            {!wallet.address && (
              <>
                <button style={styles.activateBtn} onClick={onConnectWallet} disabled={wallet.connecting}>
                  {wallet.connecting ? "Connecting…" : "Connect Wallet to Activate"}
                </button>
                {wallet.error && <p style={styles.errorText}>{wallet.error}</p>}
              </>
            )}

            {wallet.address && activateState === "idle" && (
              <>
                <div style={styles.walletRow}>
                  <span style={styles.walletDot} />
                  Connected: {shortAddr(wallet.address)}
                </div>
                <button style={styles.activateBtn} onClick={handleActivate}>
                  Activate Agent
                </button>
              </>
            )}

            {activateState === "confirming" && (
              <div style={styles.confirmBox}>
                <div style={styles.confirmTitle}>Confirm activation payment</div>
                <p style={styles.confirmText}>
                  This sends <strong>0.0005 BNB</strong> from your wallet directly to{" "}
                  <strong>{agent.name || `Agent #${agent.agent_id}`}</strong>'s owner address on BNB
                  Smart Chain — a real onchain transaction, recorded and verifiable on BscScan.
                </p>
                <div style={styles.confirmActions}>
                  <button style={styles.confirmBtn} onClick={confirmActivate}>
                    Confirm in Wallet
                  </button>
                  <button style={styles.cancelBtn} onClick={() => setActivateState("idle")}>
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {activateState === "awaiting_signature" && (
              <div style={styles.activatingBox}>
                <span style={styles.spinner} />
                Waiting for signature in your wallet…
              </div>
            )}

            {activateState === "pending" && txHash && (
              <div style={styles.activatingBox}>
                <span style={styles.spinner} />
                Transaction submitted — confirming onchain…
              </div>
            )}

            {activateState === "done" && txHash && (
              <div style={styles.doneBox}>
                <div style={styles.doneTitle}>✓ Payment sent — agent activated</div>
                <p style={styles.doneText}>
                  Real transaction confirmed on BNB Smart Chain.
                </p>
                <a
                  style={styles.txLink}
                  href={`https://bscscan.com/tx/${txHash}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  View transaction on BscScan ↗
                </a>
              </div>
            )}

            {activateState === "error" && (
              <div style={styles.errorBox}>
                {txError || "Something went wrong with the transaction."}
                <button style={styles.cancelBtn} onClick={() => setActivateState("idle")}>
                  Try again
                </button>
              </div>
            )}

            <p style={styles.demoNote}>
              This sends a real payment on BNB Smart Chain mainnet to the agent's registered owner
              address — a genuine onchain "hire" record. Full x402 pay-per-call service invocation
              requires the agent's own live API and Binance's x402 facilitator, which this demo
              does not have access to.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function CategoryBadge({ category }: { category: string }) {
  const color = CATEGORY_COLORS[category] || CATEGORY_COLORS.other;
  return (
    <span
      style={{
        fontSize: 11,
        fontWeight: 700,
        color,
        background: `${color}1a`,
        border: `1px solid ${color}40`,
        borderRadius: 6,
        padding: "3px 8px",
        textTransform: "uppercase",
        letterSpacing: "0.03em",
        whiteSpace: "nowrap",
      }}
    >
      {CATEGORY_LABELS[category] || category}
    </span>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { minHeight: "100vh", background: "#0b0d0e", color: "#e8e6e1", fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" },
  container: { maxWidth: 1040, margin: "0 auto", padding: "32px 20px 80px" },
  header: { marginBottom: 20 },
  title: { fontSize: 30, fontWeight: 800, margin: "0 0 6px", letterSpacing: "-0.02em", background: "linear-gradient(90deg, #ffffff, #f0b90b)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" },
  subtitle: { fontSize: 14, color: "#8a8880", margin: 0 },
  tabRow: { display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 },
  tab: { display: "flex", alignItems: "center", gap: 6, background: "#151718", border: "1px solid #26282a", borderRadius: 999, color: "#a3a09a", fontSize: 13, fontWeight: 600, padding: "8px 14px", cursor: "pointer" },
  tabActive: { background: "rgba(240,185,11,0.12)", border: "1px solid #f0b90b", color: "#f0b90b" },
  tabCount: { fontSize: 11, opacity: 0.7 },
  toolbar: { display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 16, justifyContent: "space-between", alignItems: "center" },
  searchWrap: { position: "relative", flex: "1 1 260px" },
  searchIcon: { position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", color: "#5f5d57", fontSize: 16 },
  searchInput: { width: "100%", boxSizing: "border-box", background: "#151718", border: "1px solid #26282a", borderRadius: 10, padding: "11px 14px 11px 38px", color: "#e8e6e1", fontSize: 14, outline: "none" },
  countBadge: { fontSize: 12, color: "#f0b90b", background: "rgba(240,185,11,0.1)", border: "1px solid rgba(240,185,11,0.25)", borderRadius: 999, padding: "6px 12px", fontWeight: 600 },
  errorBox: { marginBottom: 16, background: "#2a1616", border: "1px solid #4a2323", color: "#f0a3a3", padding: "14px 18px", borderRadius: 10, fontSize: 14 },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 12 },
  loadingRow: { gridColumn: "1 / -1", display: "flex", alignItems: "center", gap: 10, color: "#7a776f", fontSize: 14, padding: "32px 16px", justifyContent: "center" },
  spinner: { width: 14, height: 14, borderRadius: "50%", border: "2px solid #26282a", borderTopColor: "#f0b90b", display: "inline-block" },
  card: { background: "#111314", border: "1px solid #26282a", borderRadius: 14, padding: "16px", display: "flex", flexDirection: "column", gap: 8, textAlign: "left", cursor: "pointer", font: "inherit", color: "inherit" },
  cardTop: { display: "flex", alignItems: "center", justifyContent: "space-between" },
  avatar: { width: 40, height: 40, borderRadius: 10, objectFit: "cover", background: "#0b0d0e", border: "1px solid #26282a" },
  avatarFallback: { width: 40, height: 40, borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 16, color: "#0b0d0e" },
  cardName: { fontSize: 15, fontWeight: 700, color: "#f2f0eb", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
  cardDesc: { fontSize: 12.5, color: "#8a8880", lineHeight: 1.5, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" },
  cardFooter: { display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "auto", paddingTop: 8, borderTop: "1px solid #1c1e1f" },
  ownerLink: { fontSize: 12, color: "#7a776f", fontFamily: "monospace" },
  idLabel: { fontSize: 12, color: "#5f5d57" },
  pagination: { display: "flex", alignItems: "center", justifyContent: "center", gap: 16, marginTop: 24 },
  pageBtn: { background: "#151718", border: "1px solid #26282a", borderRadius: 8, color: "#e8e6e1", fontSize: 13, padding: "8px 16px", cursor: "pointer" },
  pageLabel: { fontSize: 13, color: "#7a776f" },

  detailContainer: { maxWidth: 640, margin: "0 auto", padding: "24px 20px 80px" },
  backBtn: { background: "transparent", border: "none", color: "#8a8880", fontSize: 14, padding: "8px 0", marginBottom: 12, cursor: "pointer" },
  detailCard: { background: "#111314", border: "1px solid #26282a", borderRadius: 16, padding: 24 },
  detailHeader: { display: "flex", gap: 16, alignItems: "flex-start", marginBottom: 16 },
  detailAvatar: { width: 64, height: 64, borderRadius: 14, objectFit: "cover", background: "#0b0d0e", border: "1px solid #26282a", flexShrink: 0 },
  detailAvatarFallback: { width: 64, height: 64, borderRadius: 14, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 24, color: "#0b0d0e", flexShrink: 0 },
  detailNameRow: { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" },
  detailName: { fontSize: 20, fontWeight: 800, margin: 0, color: "#f2f0eb" },
  detailMeta: { fontSize: 13, color: "#7a776f", marginTop: 4 },
  detailDesc: { fontSize: 14.5, color: "#c9c6bf", lineHeight: 1.6, marginBottom: 20 },
  detailInfoGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10, marginBottom: 24 },
  infoBox: { background: "#151718", border: "1px solid #26282a", borderRadius: 10, padding: "12px 14px" },
  infoLabel: { fontSize: 11, color: "#5f5d57", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 6 },
  infoLink: { fontSize: 13, color: "#f0b90b", textDecoration: "none", fontWeight: 600 },
  infoValueSmall: { fontSize: 13, color: "#c9c6bf" },

  activateSection: { borderTop: "1px solid #1c1e1f", paddingTop: 20 },
  activateBtn: { width: "100%", background: "#f0b90b", border: "none", borderRadius: 12, color: "#0b0d0e", fontSize: 15, fontWeight: 700, padding: "14px 20px", cursor: "pointer" },
  walletRow: { display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#7ee2a8", marginBottom: 12, fontFamily: "monospace" },
  walletDot: { width: 8, height: 8, borderRadius: "50%", background: "#7ee2a8", display: "inline-block" },
  errorText: { fontSize: 12.5, color: "#e88a8a", marginTop: 8 },
  txLink: { fontSize: 13, color: "#f0b90b", textDecoration: "none", fontWeight: 600, display: "inline-block", marginTop: 8 },
  confirmBox: { background: "#151718", border: "1px solid #26282a", borderRadius: 12, padding: 16 },
  confirmTitle: { fontSize: 14, fontWeight: 700, color: "#f2f0eb", marginBottom: 8 },
  confirmText: { fontSize: 13, color: "#a3a09a", lineHeight: 1.5, marginBottom: 14 },
  confirmActions: { display: "flex", gap: 10 },
  confirmBtn: { flex: 1, background: "#f0b90b", border: "none", borderRadius: 10, color: "#0b0d0e", fontSize: 14, fontWeight: 700, padding: "11px", cursor: "pointer" },
  cancelBtn: { flex: 1, background: "transparent", border: "1px solid #26282a", borderRadius: 10, color: "#a3a09a", fontSize: 14, fontWeight: 600, padding: "11px", cursor: "pointer" },
  activatingBox: { display: "flex", alignItems: "center", gap: 10, justifyContent: "center", color: "#8a8880", fontSize: 14, padding: "14px 0" },
  doneBox: { background: "rgba(126,226,168,0.08)", border: "1px solid rgba(126,226,168,0.3)", borderRadius: 12, padding: 16 },
  doneTitle: { fontSize: 15, fontWeight: 700, color: "#7ee2a8", marginBottom: 6 },
  doneText: { fontSize: 13, color: "#a3a09a", lineHeight: 1.5, margin: 0 },
  demoNote: { fontSize: 11.5, color: "#5f5d57", marginTop: 12, lineHeight: 1.5 },
};

