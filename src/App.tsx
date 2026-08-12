import { useEffect, useMemo, useState } from "react";
import { createClient } from "@supabase/supabase-js";

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
            <div key={agent.agent_id} style={styles.card}>
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
                <a
                  style={styles.ownerLink}
                  href={`https://bscscan.com/address/${agent.owner}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {shortAddr(agent.owner)}
                </a>
                <span style={styles.idLabel}>#{agent.agent_id}</span>
              </div>
            </div>
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

function CategoryBadge({ category }: { category: string }) {
  const labels: Record<string, string> = {
    rebalancing: "Rebalancing",
    grid_trading: "Grid Trading",
    yield: "Yield",
    health_factor: "Health Factor",
    other: "Other",
  };
  const colors: Record<string, string> = {
    rebalancing: "#c9a3f0",
    grid_trading: "#8adede",
    yield: "#7ee2a8",
    health_factor: "#e88a8a",
    other: "#7a776f",
  };
  const color = colors[category] || colors.other;
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
      }}
    >
      {labels[category] || category}
    </span>
  );
}

const styles = {
  page: { minHeight: "100vh", background: "#0b0d0e", color: "#e8e6e1", fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" },
  container: { maxWidth: 1040, margin: "0 auto", padding: "32px 20px 80px" },
  header: { marginBottom: 20 },
  title: { fontSize: 30, fontWeight: 800, margin: "0 0 6px", letterSpacing: "-0.02em", background: "linear-gradient(90deg, #ffffff, #f0b90b)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" },
  subtitle: { fontSize: 14, color: "#8a8880", margin: 0 },
  tabRow: { display: "flex", flexWrap: "wrap" as const, gap: 8, marginBottom: 16 },
  tab: { display: "flex", alignItems: "center", gap: 6, background: "#151718", border: "1px solid #26282a", borderRadius: 999, color: "#a3a09a", fontSize: 13, fontWeight: 600, padding: "8px 14px", cursor: "pointer" },
  tabActive: { background: "rgba(240,185,11,0.12)", border: "1px solid #f0b90b", color: "#f0b90b" },
  tabCount: { fontSize: 11, opacity: 0.7 },
  toolbar: { display: "flex", flexWrap: "wrap" as const, gap: 10, marginBottom: 16, justifyContent: "space-between", alignItems: "center" },
  searchWrap: { position: "relative" as const, flex: "1 1 260px" },
  searchIcon: { position: "absolute" as const, left: 14, top: "50%", transform: "translateY(-50%)", color: "#5f5d57", fontSize: 16 },
  searchInput: { width: "100%", boxSizing: "border-box" as const, background: "#151718", border: "1px solid #26282a", borderRadius: 10, padding: "11px 14px 11px 38px", color: "#e8e6e1", fontSize: 14, outline: "none" },
  countBadge: { fontSize: 12, color: "#f0b90b", background: "rgba(240,185,11,0.1)", border: "1px solid rgba(240,185,11,0.25)", borderRadius: 999, padding: "6px 12px", fontWeight: 600 },
  errorBox: { marginBottom: 16, background: "#2a1616", border: "1px solid #4a2323", color: "#f0a3a3", padding: "14px 18px", borderRadius: 10, fontSize: 14 },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 12 },
  loadingRow: { gridColumn: "1 / -1", display: "flex", alignItems: "center", gap: 10, color: "#7a776f", fontSize: 14, padding: "32px 16px", justifyContent: "center" },
  spinner: { width: 14, height: 14, borderRadius: "50%", border: "2px solid #26282a", borderTopColor: "#f0b90b", display: "inline-block" },
  card: { background: "#111314", border: "1px solid #26282a", borderRadius: 14, padding: "16px", display: "flex", flexDirection: "column" as const, gap: 8 },
  cardTop: { display: "flex", alignItems: "center", justifyContent: "space-between" },
  avatar: { width: 40, height: 40, borderRadius: 10, objectFit: "cover" as const, background: "#0b0d0e", border: "1px solid #26282a" },
  avatarFallback: { width: 40, height: 40, borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 16, color: "#0b0d0e" },
  cardName: { fontSize: 15, fontWeight: 700, color: "#f2f0eb", whiteSpace: "nowrap" as const, overflow: "hidden", textOverflow: "ellipsis" },
  cardDesc: { fontSize: 12.5, color: "#8a8880", lineHeight: 1.5, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" as const, overflow: "hidden" },
  cardFooter: { display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "auto", paddingTop: 8, borderTop: "1px solid #1c1e1f" },
  ownerLink: { fontSize: 12, color: "#7a776f", textDecoration: "none", fontFamily: "monospace" },
  idLabel: { fontSize: 12, color: "#5f5d57" },
  pagination: { display: "flex", alignItems: "center", justifyContent: "center", gap: 16, marginTop: 24 },
  pageBtn: { background: "#151718", border: "1px solid #26282a", borderRadius: 8, color: "#e8e6e1", fontSize: 13, padding: "8px 16px", cursor: "pointer" },
  pageLabel: { fontSize: 13, color: "#7a776f" },
};
