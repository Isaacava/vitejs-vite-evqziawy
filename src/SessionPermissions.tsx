import { useEffect, useMemo, useState } from "react";
import "./session-permissions.css";
import { revokeAltanaExecutionSession } from "./lib/altanaSession";
import { bscExplorerUrl } from "./lib/erc8183Adapter";

type Session = {
  id: string;
  job_id: string;
  agent_id: string | null;
  session_key_id: string | null;
  capital_requested: string | null;
  capital_authorized: string | null;
  capital_token: string;
  spend_cap: string | null;
  session_expires_at: string | null;
  status: "requested" | "authorized" | "active" | "exit_pending" | "settled" | "revoked" | "expired";
  authorization_verified_at: string | null;
  session_grant_tx_hash: string | null;
  session_revoke_tx_hash: string | null;
  revoked_at: string | null;
  agent: { id: string; agent_id: string; name: string | null } | null;
};

const compact = (value?: string | null) => value ? `${value.slice(0, 8)}…${value.slice(-6)}` : "—";
function timeLeft(value?: string | null) {
  if (!value) return "No expiry";
  const seconds = Math.floor((new Date(value).getTime() - Date.now()) / 1000);
  if (seconds <= 0) return "Expired";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours ? `${hours}h remaining` : `${Math.max(1, minutes)}m remaining`;
}

export default function SessionPermissions() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/session-permissions", { credentials: "include", cache: "no-store" });
      if (response.status === 401) {
        window.location.assign("/dashboard");
        return;
      }
      const body = await response.json() as { sessions?: Session[]; error?: string };
      if (!response.ok) throw new Error(body.error || "Unable to load sessions");
      setSessions(Array.isArray(body.sessions) ? body.sessions : []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load sessions");
    } finally {
      setLoading(false);
    }
  }

  async function revoke(session: Session) {
    if (!session.session_key_id) {
      setError("This session has no verified Altana session key.");
      return;
    }
    setWorking(session.id);
    setMessage("");
    setError("");
    try {
      const txHash = await revokeAltanaExecutionSession(session.session_key_id);
      const response = await fetch("/api/session-permissions", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "revoke", id: session.id, tx_hash: txHash }),
      });
      const body = await response.json() as { ok?: boolean; error?: string };
      if (!response.ok) throw new Error(body.error || "The on-chain revoke succeeded, but AgentMarket could not record it.");
      setMessage("Session revoked. The agent can no longer use this authorization.");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to revoke session");
    } finally {
      setWorking("");
    }
  }

  useEffect(() => { void load(); }, []);

  const active = useMemo(() => sessions.filter((session) => session.status === "authorized" || session.status === "active"), [sessions]);
  const history = useMemo(() => sessions.filter((session) => !active.includes(session)), [sessions, active]);

  return (
    <main className="mx-auto max-w-[1240px] px-6 py-8 md:px-8 font-body text-ink">
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <span className="block font-mono text-[9.5px] uppercase tracking-wide text-[#8a8477] mb-2">Manage / Permissions</span>
          <h1 className="font-display text-[28px] font-bold tracking-tight md:text-[34px]">Session permissions</h1>
          <p className="mt-1.5 text-[12px] text-inksoft">Active Altana execution sessions.</p>
        </div>
        <a href="/dashboard" className="text-[11px] font-bold text-inksoft no-underline">← Dashboard</a>
      </div>

      {error && <div className="mb-4 rounded-[14px_8px_15px_9px] border border-[#cfad9f] bg-rustsoft px-4 py-3 text-[11px] text-rust">{error}</div>}
      {message && <div className="mb-4 rounded-[14px_8px_15px_9px] border border-[#b9d2c3] bg-greensoft px-4 py-3 text-[11px] text-green">{message}</div>}

      <section className="card-asym-lg border border-line bg-paperhi overflow-hidden">
        <div className="flex items-center justify-between gap-3 border-b border-dashed border-[#c8c0af] px-5 py-4">
          <div>
            <strong className="font-display text-[16px] font-bold">Active</strong>
            <span className="block text-[10.5px] text-inksoft mt-0.5">Revoke a live session from here.</span>
          </div>
          <span className="font-mono text-[9px] text-[#8a8477]">{active.length} active</span>
        </div>

        {loading ? <div className="p-5 text-[12px] text-inksoft">Loading…</div> : active.length === 0 ? (
          <div className="p-5">
            <strong className="font-display text-[17px]">No active Altana sessions</strong>
            <p className="mt-1 text-[11px] text-inksoft">An authorized execution session will appear here.</p>
          </div>
        ) : active.map((session) => {
          const name = session.agent?.name || (session.agent?.agent_id ? `Agent #${session.agent.agent_id}` : "Agent");
          return <article key={session.id} className="flex flex-col gap-4 border-b border-linesoft p-5 last:border-b-0 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-green" />
                <strong className="text-[14px] font-bold">{name}</strong>
                <span className="rounded-lg bg-greensoft px-2 py-1 font-mono text-[9px] text-green">{session.status}</span>
              </div>
              <div className="mt-2 grid gap-1 text-[10.5px] text-inksoft sm:grid-cols-3 sm:gap-x-5">
                <span>{session.capital_authorized || session.capital_requested || "—"} authorized</span>
                <span>{timeLeft(session.session_expires_at)}</span>
                <span>Session {compact(session.session_key_id)}</span>
              </div>
            </div>
            <button type="button" disabled={working === session.id} onClick={() => void revoke(session)} className="btn-asym shrink-0 border border-rust px-4 py-2.5 font-display text-[11px] font-bold text-rust">
              {working === session.id ? "Revoking…" : "Revoke session"}
            </button>
          </article>;
        })}
      </section>

      {history.length > 0 && <section className="mt-4 border-t border-line pt-5">
        <div className="mb-3 flex items-center justify-between"><span className="font-mono text-[9px] uppercase tracking-wide text-[#8a8477]">History</span><span className="font-mono text-[9px] text-[#8a8477]">{history.length}</span></div>
        <div className="overflow-hidden rounded-[16px_8px_18px_9px] border border-line bg-paperhi">
          {history.slice(0, 8).map((session) => <div key={session.id} className="flex flex-col gap-1 border-b border-linesoft p-4 last:border-b-0 sm:flex-row sm:items-center sm:justify-between"><div><strong className="text-[12px] font-bold">{session.agent?.name || "Agent"}</strong><div className="font-mono text-[9px] text-[#8a8477]">{session.status} · {session.session_revoke_tx_hash ? <a href={bscExplorerUrl(session.session_revoke_tx_hash as `0x${string}`)} target="_blank" rel="noreferrer" className="text-brass underline">revoke tx ↗</a> : session.revoked_at ? new Date(session.revoked_at).toLocaleString() : "—"}</div></div><span className="font-mono text-[9px] text-[#8a8477]">{compact(session.session_key_id)}</span></div>)}
        </div>
      </section>}
    </main>
  );
}
