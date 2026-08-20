import { useEffect, useMemo, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import { type Address, type EIP1193Provider } from "viem";
import { EthereumProvider } from "@walletconnect/ethereum-provider";
import {
  COMMERCE_ABI,
  ERC20_ABI,
  ERC8004_REGISTRY_ADDRESS,
  ERC8183_ADDRESSES,
  ROUTER_ABI,
  getWalletClient,
  publicClient,
} from "./lib/erc8183";

const WALLETCONNECT_PROJECT_ID = "1dbe8fd5e4974ae7c80d074c4082b5a0";

type WalletState = {
  address: Address | null;
  connecting: boolean;
  error: string | null;
  provider: EIP1193Provider | null;
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

const SUPABASE_URL = "https://sfbxpscbevnmoppgkjcr.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzZmJ4cHNharz...REDACTED";

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
  const [wallet, setWallet] = useState<WalletState>({
    address: null,
    connecting: false,
    error: null,
    provider: null,
  });

  async function connectWallet() {
    setWallet((w) => ({ ...w, connecting: true, error: null }));
    try {
      console.log("Initializing WalletConnect Testnet provider…");
      const provider = await Promise.race([
        EthereumProvider.init({
          projectId: WALLETCONNECT_PROJECT_ID,
          chains: [97],
          showQrModal: true,
          metadata: {
            name: "AgentMarket Testnet",
            description: "ERC-8004/8183 agent marketplace on BSC Testnet",
            url: window.location.origin,
            icons: [],
          },
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("WalletConnect init timed out after 15s")), 15000)
        ),
      ]);
      console.log("WalletConnect Testnet provider initialized, opening connect flow…");
      await provider.connect();
      console.log("WalletConnect connect() resolved");

      const accounts = provider.accounts as string[];
      if (!accounts || accounts.length === 0) {
        throw new Error("No account returned from wallet.");
      }

      setWallet({
        address: accounts[0] as Address,
        connecting: false,
        error: null,
        provider: provider as unknown as EIP1193Provider,
      });
    } catch (e) {
      console.error("WalletConnect Testnet connection failed:", e);
      setWallet({
        address: null,
        connecting: false,
        error: e instanceof Error ? e.message : "Wallet connection was rejected or failed.",
        provider: null,
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
            Discover autonomous agents on the ERC-8004 registry — indexed from BNB Smart Chain Testnet
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
  type HireStep =
    | "idle"
    | "confirming"
    | "reading_token"
    | "creating"
    | "registering"
    | "budgeting"
    | "approving"
    | "funding"
    | "done"
    | "error";

  const [hireStep, setHireStep] = useState<HireStep>("idle");
  const [hireError, setHireError] = useState<string | null>(null);
  const [txLinks, setTxLinks] = useState<{ label: string; hash: string }[]>([]);
  const [jobId, setJobId] = useState<bigint | null>(null);
  const [tokenInfo, setTokenInfo] = useState<{ symbol: string; decimals: number } | null>(null);

  const isValidOwner = /^0x[a-fA-F0-9]{40}$/.test(agent.owner);

  function addTx(label: string, hash: string) {
    setTxLinks((prev) => [...prev, { label, hash }]);
  }

  function handleActivate() {
    setHireStep("confirming");
    setHireError(null);
    setTxLinks([]);
    setJobId(null);
  }

  async function confirmActivate() {
    if (!wallet.address || !wallet.provider) return;
    if (!isValidOwner) {
      setHireError("This agent's owner address isn't valid — can't create a job for it.");
      setHireStep("error");
      return;
    }

    try {
      const walletClient = getWalletClient(wallet.provider, wallet.address);

      setHireStep("reading_token");
      const tokenAddress = await publicClient.readContract({
        address: ERC8183_ADDRESSES.commerce,
        abi: COMMERCE_ABI,
        functionName: "paymentToken",
      });
      const [decimals, symbol] = await Promise.all([
        publicClient.readContract({
          address: tokenAddress,
          abi: ERC20_ABI,
          functionName: "decimals",
        }),
        publicClient.readContract({
          address: tokenAddress,
          abi: ERC20_ABI,
          functionName: "symbol",
        }),
      ]);
      setTokenInfo({ symbol, decimals });

      const budget = 10n ** BigInt(decimals);

      setHireStep("creating");
      const expiredAt = BigInt(Math.floor(Date.now() / 1000) + 24 * 60 * 60);
      const createHash = await walletClient.writeContract({
        address: ERC8183_ADDRESSES.commerce,
        abi: COMMERCE_ABI,
        functionName: "createJob",
        args: [
          agent.owner as Address,
          ERC8183_ADDRESSES.router,
          expiredAt,
          `Hire: ${agent.name || `Agent #${agent.agent_id}`}`,
          ERC8183_ADDRESSES.router,
        ],
      });
      addTx("Create job", createHash);
      await publicClient.waitForTransactionReceipt({ hash: createHash });

      const newJobId = await publicClient.readContract({
        address: ERC8183_ADDRESSES.commerce,
        abi: COMMERCE_ABI,
        functionName: "jobCounter",
      });
      setJobId(newJobId);

      setHireStep("registering");
      const registerHash = await walletClient.writeContract({
        address: ERC8183_ADDRESSES.router,
        abi: ROUTER_ABI,
        functionName: "registerJob",
        args: [newJobId, ERC8183_ADDRESSES.policy],
      });
      addTx("Register job", registerHash);
      await publicClient.waitForTransactionReceipt({ hash: registerHash });

      setHireStep("budgeting");
      const budgetHash = await walletClient.writeContract({
        address: ERC8183_ADDRESSES.commerce,
        abi: COMMERCE_ABI,
        functionName: "setBudget",
        args: [newJobId, budget, "0x"],
      });
      addTx("Set budget", budgetHash);
      await publicClient.waitForTransactionReceipt({ hash: budgetHash });

      const allowance = await publicClient.readContract({
        address: tokenAddress,
        abi: ERC20_ABI,
        functionName: "allowance",
        args: [wallet.address, ERC8183_ADDRESSES.commerce],
      });
      if (allowance < budget) {
        setHireStep("approving");
        const approveHash = await walletClient.writeContract({
          address: tokenAddress,
          abi: ERC20_ABI,
          functionName: "approve",
          args: [ERC8183_ADDRESSES.commerce, budget],
        });
        addTx("Approve token", approveHash);
        await publicClient.waitForTransactionReceipt({ hash: approveHash });
      }

      setHireStep("funding");
      const fundHash = await walletClient.writeContract({
        address: ERC8183_ADDRESSES.commerce,
        abi: COMMERCE_ABI,
        functionName: "fund",
        args: [newJobId, budget, "0x"],
      });
      addTx("Fund job", fundHash);
      await publicClient.waitForTransactionReceipt({ hash: fundHash });

      setHireStep("done");
    } catch (e) {
      setHireError(e instanceof Error ? e.message : "Transaction was rejected or failed.");
      setHireStep("error");
    }
  }

  const stepLabel: Record<HireStep, string> = {
    idle: "",
    confirming: "",
    reading_token: "Reading payment token…",
    creating: "Creating job on-chain…",
    registering: "Registering job with evaluator…",
    budgeting: "Setting budget…",
    approving: "Approving token spend…",
    funding: "Funding job (escrow)…",
    done: "",
    error: "",
  };

  const inFlight = !["idle", "confirming", "done", "error"].includes(hireStep);

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
                Agent #{agent.agent_id} · {agent.chain === "bsc" ? "BSC Testnet" : agent.chain}
              </div>
            </div>
          </div>

          {agent.description && <p style={styles.detailDesc}>{agent.description}</p>}

          <div style={styles.detailInfoGrid}>
            <div style={styles.infoBox}>
              <div style={styles.infoLabel}>Owner</div>
              <a
                style={styles.infoLink}
                href={`https://testnet.bscscan.com/address/${agent.owner}`}
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
                href={`https://testnet.bscscan.com/address/${ERC8004_REGISTRY_ADDRESS}`}
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
                  {wallet.connecting ? "Opening Testnet wallet connect…" : "Connect Testnet Wallet to Hire"}
                </button>
                {wallet.error && <p style={styles.errorText}>{wallet.error}</p>}
              </>
            )}

            {wallet.address && hireStep === "idle" && (
              <>
                <div style={styles.walletRow}>
                  <span style={styles.walletDot} />
                  Connected: {shortAddr(wallet.address)}
                </div>
                <button style={styles.activateBtn} onClick={handleActivate}>
                  Hire Agent (ERC-8183 Testnet)
                </button>
              </>
            )}

            {hireStep === "confirming" && (
              <div style={styles.confirmBox}>
                <div style={styles.confirmTitle}>Confirm ERC-8183 Testnet job</div>
                <p style={styles.confirmText}>
                  This creates and funds a real escrowed job on BSC Testnet — Create → Register →
                  Set Budget → Approve → Fund — with <strong>{agent.name || `Agent #${agent.agent_id}`}</strong>'s
                  owner address as the provider. You'll sign multiple transactions in your Testnet wallet.
                  The default budget is 1 unit of the Commerce kernel's payment token.
                </p>
                <div style={styles.confirmActions}>
                  <button style={styles.confirmBtn} onClick={confirmActivate}>
                    Confirm in Testnet Wallet
                  </button>
                  <button style={styles.cancelBtn} onClick={() => setHireStep("idle")}>
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {inFlight && (
              <div style={styles.activatingBox}>
                <span style={styles.spinner} />
                {stepLabel[hireStep]}
              </div>
            )}

            {txLinks.length > 0 && hireStep !== "confirming" && hireStep !== "idle" && (
              <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 6 }}>
                {txLinks.map((tx, i) => (
                  <a
                    key={i}
                    style={styles.txLink}
                    href={`https://testnet.bscscan.com/tx/${tx.hash}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {tx.label} ↗
                  </a>
                ))}
              </div>
            )}

            {hireStep === "done" && (
              <div style={styles.doneBox}>
                <div style={styles.doneTitle}>
                  ✓ Job funded{jobId !== null ? ` — #${jobId.toString()}` : ""}
                </div>
                <p style={styles.doneText}>
                  Escrowed{tokenInfo ? ` 1 ${tokenInfo.symbol}` : ""} for this job on BSC Testnet.
                  If the agent's own runtime is listening for funded jobs, it can now pick this up,
                  work, and submit a deliverable. This marketplace doesn't run the agent itself — only
                  the blockchain connects the two of you.
                </p>
              </div>
            )}

            {hireStep === "error" && (
              <div style={styles.errorBox}>
                {hireError || "Something went wrong with the transaction."}
                <button style={styles.cancelBtn} onClick={() => setHireStep("idle")}>
                  Try again
                </button>
              </div>
            )}

            <p style={styles.demoNote}>
              This creates a real ERC-8183 escrow job on BSC Testnet
              (AgenticCommerce {shortAddr(ERC8183_ADDRESSES.commerce)}). Funding it does not
              guarantee the agent will respond — that depends on whether this agent's operator has a
              live ERC-8183 provider server listening for funded jobs.
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
