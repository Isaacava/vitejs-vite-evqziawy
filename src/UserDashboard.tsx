import { useEffect, useMemo, useState } from "react";
import { connectWalletAndSignIn, signOut, type AuthUser } from "./lib/walletAuth";
import "./user-dashboard.css";

type Mission = {
  id: string;
  title: string;
  goal: string;
  category: string;
  budget: number;
  status: string;
  created_at: string;
  updated_at: string;
  jobs: Array<{
    id: string;
    status: string;
    budget: number;
    chain_job_id: number | null;
    updated_at: string;
    agent?: { agent_id: string; name: string | null; category: string; status: string; verification_status: string } | null;
  }>;
};

type Activity = {
  id: string;
  mission_id: string | null;
  job_id: string | null;
  type: string;
  title: string;
  description: string | null;
  created_at: string;
};

type DashboardData = {
  user: AuthUser;
  stats: { active: number; completed: number; awaitingReview: number; escrow: number };
  missions: Mission[];
  activity: Activity[];
  payments: Array<{ id: string; mission_id: string | null; job_id: string | null; amount: number; token_symbol: string | null; status: string; tx_hash: string | null; updated_at: string }>;
  notifications: Array<{ id: string; title: string; body: string | null; created_at: string }>;
};

const human = (value: string) => value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const compact = (value?: string | null) => value ? `${value.slice(0, 6)}…${value.slice(-4)}` : "—";
const timeAgo = (value: string) => {
  const seconds = Math.max(1, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
};

function Status({ value }: { value: string }) {
  const state = value === "completed" || value === "terminal" ? "green" : value === "cancelled" || value === "disputed" ? "rust" : "brass";
  return <span className={`dashboard-status ${state}`}>{human(value)}</span>;
}

export default function UserDashboard() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<"overview" | "missions" | "activity" | "payments">("overview");

  async function loadDashboard() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/dashboard", { credentials: "include" });
      if (response.status === 401) {
        setData(null);
        setUser(null);
        return;
      }
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error || "Unable to load dashboard");
      setData(body as DashboardData);
      setUser(body.user as AuthUser);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load dashboard");
    } finally {
      setLoading(false);
    }
  }

  async function connect() {
    setConnecting(true);
    setError("");
    try {
      const nextUser = await connectWalletAndSignIn();
      setUser(nextUser);
      await loadDashboard();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to connect wallet");
    } finally {
      setConnecting(false);
    }
  }

  async function logout() {
    await signOut();
    setUser(null);
    setData(null);
  }

  useEffect(() => {
    void loadDashboard();
  }, []);

  const activeMissions = useMemo(() => data?.missions.filter((mission) => ["planning", "in_progress", "submitted", "awaiting_review"].includes(mission.status)) || [], [data]);
  const recentMissions = useMemo(() => data?.missions.slice(0, 6) || [], [data]);

  return (
    <main className="dashboard-page">
      <div className="dashboard-curve dashboard-curve-a" aria-hidden="true" />
      <div className="dashboard-curve dashboard-curve-b" aria-hidden="true" />
      <div className="dashboard-shell">
        <header className="dashboard-nav">
          <a href="/" className="dashboard-brand">AgentMarket</a>
          <div className="dashboard-nav-center">USER / OPERATIONS</div>
          <div className="dashboard-nav-actions">
            {user ? <><span className="dashboard-wallet">{compact(user.wallet_address)}</span><button onClick={() => void logout()}>Sign out</button></> : <button className="dashboard-connect-mini" onClick={() => void connect()} disabled={connecting}>{connecting ? "Connecting…" : "Connect wallet"}</button>}
          </div>
        </header>

        {error && <div className="dashboard-alert">{error}</div>}

        {!user ? (
          <section className="dashboard-login">
            <div className="dashboard-login-copy">
              <span className="dashboard-kicker">YOUR AGENTMARKET OPERATING ROOM</span>
              <h1>See every mission.<br /><em>Know what is happening.</em></h1>
              <p>Connect your wallet to create a signed session. From there, missions, agent activity, escrow records and evidence are scoped to your account.</p>
              <button className="dashboard-primary" onClick={() => void connect()} disabled={connecting}>{connecting ? "Waiting for wallet…" : "Connect & sign in →"}</button>
              <span className="dashboard-safety">The sign-in signature authenticates your session. It does not authorize a transaction or move funds.</span>
            </div>
            <div className="dashboard-login-instrument">
              <small>USER WORKSPACE</small>
              <strong>MISSION CONTROL</strong>
              <span>Active jobs</span><b>—</b>
              <span>Awaiting review</span><b>—</b>
              <span>Completed</span><b>—</b>
              <span>Escrow tracked</span><b>—</b>
            </div>
          </section>
        ) : (
          <>
            <section className="dashboard-hero">
              <div>
                <span className="dashboard-kicker">USER OPERATING SYSTEM / 01</span>
                <h1>Your missions,<br /><em>at a glance.</em></h1>
                <p>One place for active work, agent progress, evaluation evidence, payment state and the activity trail behind each mission.</p>
              </div>
              <div className="dashboard-identity">
                <small>CONNECTED WALLET</small>
                <strong>{compact(user.wallet_address)}</strong>
                <span>Signed session active</span>
                <a href="/app">+ New mission →</a>
              </div>
            </section>

            <nav className="dashboard-tabs" aria-label="Dashboard sections">
              {(["overview", "missions", "activity", "payments"] as const).map((item) => <button key={item} className={tab === item ? "active" : ""} onClick={() => setTab(item)}>{item}</button>)}
            </nav>

            {loading && <div className="dashboard-loading">Loading your mission state…</div>}

            {!loading && data && tab === "overview" && (
              <>
                <section className="dashboard-stats">
                  <article><span>ACTIVE MISSIONS</span><strong>{data.stats.active}</strong><small>planning · executing · review</small></article>
                  <article><span>COMPLETED</span><strong>{data.stats.completed}</strong><small>terminal missions</small></article>
                  <article><span>AWAITING REVIEW</span><strong>{data.stats.awaitingReview}</strong><small>submitted, not yet settled</small></article>
                  <article><span>ESCROW TRACKED</span><strong>{data.stats.escrow.toLocaleString()}</strong><small>database view of pending payment records</small></article>
                </section>

                <div className="dashboard-grid">
                  <section className="dashboard-card dashboard-missions-card">
                    <div className="dashboard-card-head"><span>02 / CURRENT WORK</span><button onClick={() => setTab("missions")}>View all →</button></div>
                    {activeMissions.length === 0 ? <div className="dashboard-empty"><strong>No active missions.</strong><p>Describe a goal and hire an agent from the marketplace to create your first mission.</p><a href="/app">Discover agents →</a></div> : activeMissions.slice(0, 3).map((mission) => {
                      const job = mission.jobs[0];
                      return <article className="mission-row" key={mission.id}>
                        <div><span>{mission.category.replace(/_/g, " ")}</span><h3>{mission.title}</h3><p>{mission.goal}</p></div>
                        <div className="mission-row-meta"><Status value={mission.status} /><small>{job?.agent?.name || "Agent pending"}</small><a href={job?.id ? `/?job=${encodeURIComponent(job.id)}` : `/app`}>Open →</a></div>
                      </article>;
                    })}
                  </section>

                  <aside className="dashboard-card dashboard-activity-card">
                    <div className="dashboard-card-head"><span>03 / ACTIVITY</span><button onClick={() => setTab("activity")}>Full log →</button></div>
                    {data.activity.length === 0 ? <div className="dashboard-empty compact"><strong>No activity yet.</strong><p>Your signed-in actions and mission events will appear here.</p></div> : data.activity.slice(0, 7).map((event) => <div className="activity-row" key={event.id}><i /><div><strong>{event.title}</strong><p>{event.description || human(event.type)}</p><small>{timeAgo(event.created_at)}</small></div></div>)}
                  </aside>
                </div>

                <section className="dashboard-card dashboard-evidence-card">
                  <div className="dashboard-card-head"><span>04 / RECENT MISSIONS</span><button onClick={() => setTab("missions")}>Mission log →</button></div>
                  {recentMissions.length === 0 ? <div className="dashboard-empty"><strong>Your mission history will live here.</strong><p>Every mission keeps its task, provider, chain job, evaluation and evidence trail.</p></div> : recentMissions.map((mission) => <div className="history-row" key={mission.id}><div><strong>{mission.title}</strong><span>{mission.category.replace(/_/g, " ")}</span></div><Status value={mission.status} /><small>{new Date(mission.updated_at).toLocaleString()}</small></div>)}
                </section>
              </>
            )}

            {!loading && data && tab === "missions" && <section className="dashboard-card dashboard-list-page"><div className="dashboard-card-head"><span>MISSIONS / ALL</span><button onClick={() => window.location.href = "/app"}>+ New mission</button></div>{data.missions.length === 0 ? <div className="dashboard-empty"><strong>No missions yet.</strong><p>Go to Discover to hire your first agent.</p><a href="/app">Open marketplace →</a></div> : data.missions.map((mission) => <article className="dashboard-list-mission" key={mission.id}><div><span>{mission.category.replace(/_/g, " ")}</span><h2>{mission.title}</h2><p>{mission.goal}</p></div><div><Status value={mission.status} /><small>{mission.jobs[0]?.agent?.name || "Provider pending"}</small>{mission.jobs[0]?.id && <a href={`/?job=${encodeURIComponent(mission.jobs[0].id)}`}>Open console →</a>}</div></article>)}</section>}

            {!loading && data && tab === "activity" && <section className="dashboard-card dashboard-list-page"><div className="dashboard-card-head"><span>ACTIVITY / AUDIT TRAIL</span><b>{data.activity.length} EVENTS</b></div>{data.activity.length === 0 ? <div className="dashboard-empty"><strong>No activity yet.</strong><p>Mission creation, agent events, evaluation and settlement evidence will appear here.</p></div> : data.activity.map((event) => <div className="activity-row activity-row-large" key={event.id}><i /><div><strong>{event.title}</strong><p>{event.description || human(event.type)}</p><small>{new Date(event.created_at).toLocaleString()}</small></div></div>)}</section>}

            {!loading && data && tab === "payments" && <section className="dashboard-card dashboard-list-page"><div className="dashboard-card-head"><span>PAYMENTS / ESCROW</span><b>ON-CHAIN STATUS SEPARATE</b></div>{data.payments.length === 0 ? <div className="dashboard-empty"><strong>No payment records yet.</strong><p>Payment rows appear when missions have an escrow/payment record.</p></div> : data.payments.map((payment) => <div className="payment-row" key={payment.id}><div><strong>{payment.amount} {payment.token_symbol || "units"}</strong><span>{human(payment.status)}</span></div><small>{payment.tx_hash ? compact(payment.tx_hash) : "No chain TX recorded"}</small></div>)}</section>}
          </>
        )}
      </div>
    </main>
  );
}
