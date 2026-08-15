import { useEffect, useState } from "react";
import "./session-permissions.css";

type Permission = {
  id: string;
  wallet_address: string;
  allowed_tokens: string[];
  allowed_protocols: string[];
  max_total_value: number;
  max_single_action_value: number;
  starts_at: string;
  expires_at: string;
  revoked_at: string | null;
  status: "active" | "expired" | "revoked";
  created_at: string;
};

const compact = (value: string) => `${value.slice(0, 8)}…${value.slice(-6)}`;
const statusClass = (status: Permission["status"]) => status === "active" ? "green" : status === "expired" ? "brass" : "rust";

export default function SessionPermissions() {
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState("");
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/session-permissions", { credentials: "include" });
      if (response.status === 401) {
        window.location.href = "/dashboard";
        return;
      }
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error || "Unable to load permissions");
      setPermissions(body.permissions || []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load permissions");
    } finally {
      setLoading(false);
    }
  }

  async function revoke(id: string) {
    setWorking(id);
    setError("");
    try {
      const response = await fetch("/api/session-permissions", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "revoke", id }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error || "Unable to revoke permission");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to revoke permission");
    } finally {
      setWorking("");
    }
  }

  useEffect(() => { void load(); }, []);

  return (
    <main className="permissions-page">
      <div className="permissions-curve permissions-curve-a" aria-hidden="true" />
      <div className="permissions-curve permissions-curve-b" aria-hidden="true" />
      <div className="permissions-shell">
        <header className="permissions-nav">
          <a href="/" className="permissions-brand">AgentMarket</a>
          <span>USER / PERMISSIONS</span>
          <a href="/dashboard">Dashboard →</a>
        </header>

        {error && <div className="permissions-alert">{error}</div>}

        <section className="permissions-hero">
          <div>
            <span className="permissions-kicker">EXECUTION CONTROL / 01</span>
            <h1>Make the boundary<br /><em>visible.</em></h1>
            <p>Permissions describe what a future execution session may be allowed to do. They are scoped by wallet, token, protocol, value cap and expiry. AgentMarket never stores your private key.</p>
          </div>
          <div className="permissions-instrument">
            <small>CONTROL MODEL</small>
            <strong>NON-CUSTODIAL</strong>
            <span>Private keys stored</span><b>NO</b>
            <span>Revocable</span><b>YES</b>
            <span>Token allowlist</span><b>YES</b>
            <span>Expiry</span><b>REQUIRED</b>
          </div>
        </section>

        <section className="permissions-rule">
          <div><span>WALLET</span><strong>Scoped session</strong></div>
          <i>+</i>
          <div><span>ASSETS</span><strong>Token allowlist</strong></div>
          <i>+</i>
          <div><span>PROTOCOLS</span><strong>Approved venues</strong></div>
          <i>+</i>
          <div><span>LIMITS</span><strong>Caps + expiry</strong></div>
        </section>

        <section className="permissions-card">
          <div className="permissions-card-head"><span>02 / YOUR PERMISSIONS</span><b>{permissions.length} RECORDS</b></div>
          {loading ? <div className="permissions-empty">Loading permission records…</div> : permissions.length === 0 ? (
            <div className="permissions-empty"><strong>No execution permissions yet.</strong><p>When you authorize an agent for a specific strategy, its scope will appear here.</p></div>
          ) : permissions.map((permission) => (
            <article className="permission-row" key={permission.id}>
              <div className="permission-main">
                <div className="permission-title"><span className={`permission-dot ${statusClass(permission.status)}`} /> <strong>{permission.status.toUpperCase()}</strong><small>{compact(permission.wallet_address)}</small></div>
                <div className="permission-scope">
                  <div><span>Tokens</span><b>{permission.allowed_tokens.length ? permission.allowed_tokens.join(", ") : "None specified"}</b></div>
                  <div><span>Protocols</span><b>{permission.allowed_protocols.length ? permission.allowed_protocols.join(", ") : "None specified"}</b></div>
                  <div><span>Total cap</span><b>{permission.max_total_value}</b></div>
                  <div><span>Single-action cap</span><b>{permission.max_single_action_value}</b></div>
                  <div><span>Expires</span><b>{new Date(permission.expires_at).toLocaleString()}</b></div>
                </div>
              </div>
              {permission.status === "active" && <button className="permission-revoke" onClick={() => void revoke(permission.id)} disabled={working === permission.id}>{working === permission.id ? "Revoking…" : "Revoke access"}</button>}
            </article>
          ))}
        </section>

        <section className="permissions-note">
          <span className="permissions-kicker">IMPORTANT</span>
          <p>Creating a permission record does not itself grant a smart contract, exchange, or DeFi protocol authority. The actual execution layer must enforce these limits before a transaction is signed.</p>
        </section>
      </div>
    </main>
  );
}
