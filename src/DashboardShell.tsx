import { useMemo, useState } from "react";
import UserDashboard from "./UserDashboard";
import "./dashboard-shell.css";

const primaryLinks = [
  { label: "Overview", href: "/dashboard", icon: "⌂" },
  { label: "Discover agents", href: "/app", icon: "⌕" },
  { label: "Missions", href: "/dashboard?tab=missions", icon: "◫" },
  { label: "Activity", href: "/dashboard?tab=activity", icon: "◌" },
  { label: "Payments & escrow", href: "/dashboard?tab=payments", icon: "◇" },
];

const manageLinks = [
  { label: "Testnet", href: "/testnet", icon: "◎" },
  { label: "Register agent", href: "/agents/register", icon: "+" },
  { label: "Permissions", href: "/permissions", icon: "◈" },
];

export default function DashboardShell() {
  const [open, setOpen] = useState(true);
  const [mobileOpen, setMobileOpen] = useState(false);
  const network = useMemo(() => "BSC Testnet", []);

  return (
    <div className={`workspace-shell ${open ? "sidebar-open" : "sidebar-collapsed"}`}>
      <button
        className={`workspace-backdrop ${mobileOpen ? "visible" : ""}`}
        aria-label="Close navigation"
        onClick={() => setMobileOpen(false)}
      />

      <aside className={`workspace-sidebar ${mobileOpen ? "mobile-visible" : ""}`} aria-label="AgentMarket workspace navigation">
        <div className="workspace-brand-row">
          <a className="workspace-sidebar-brand" href="/dashboard" aria-label="AgentMarket home">
            <span className="workspace-logo">A</span>
            <span className="workspace-brand-wordmark">AgentMarket</span>
          </a>
          <button className="workspace-collapse-btn" onClick={() => setOpen((value) => !value)} aria-label={open ? "Collapse sidebar" : "Expand sidebar"}>
            {open ? "‹" : "›"}
          </button>
        </div>

        <div className="workspace-network-card">
          <span className="workspace-network-dot" />
          <div>
            <strong>{network}</strong>
            <small>Chain 97 · Test environment</small>
          </div>
          <span className="workspace-network-chevron">⌄</span>
        </div>

        <div className="workspace-section-label">WORKSPACE</div>
        <nav className="workspace-nav">
          {primaryLinks.map((link) => (
            <a className="workspace-nav-link" key={link.label} href={link.href} onClick={() => setMobileOpen(false)}>
              <span className="workspace-nav-icon">{link.icon}</span>
              <span className="workspace-nav-text">{link.label}</span>
            </a>
          ))}
        </nav>

        <div className="workspace-section-row">
          <span>MANAGE</span>
          <span>⌄</span>
        </div>
        <nav className="workspace-nav workspace-nav-manage">
          {manageLinks.map((link) => (
            <a className="workspace-nav-link" key={link.label} href={link.href} onClick={() => setMobileOpen(false)}>
              <span className="workspace-nav-icon">{link.icon}</span>
              <span className="workspace-nav-text">{link.label}</span>
            </a>
          ))}
        </nav>

        <div className="workspace-sidebar-spacer" />

        <div className="workspace-help-card">
          <span>TESTNET MODE</span>
          <strong>Use faucet funds only.</strong>
          <small>Testnet jobs, balances and contracts never mix with Mainnet.</small>
        </div>

        <div className="workspace-sidebar-foot">
          <div className="workspace-avatar">W</div>
          <div className="workspace-user-copy">
            <strong>Wallet session</strong>
            <small>Authenticated</small>
          </div>
          <button className="workspace-more-btn" aria-label="Account menu">•••</button>
        </div>
      </aside>

      <div className="workspace-main">
        <header className="workspace-topbar">
          <div className="workspace-topbar-left">
            <button className="workspace-mobile-btn" onClick={() => setMobileOpen(true)} aria-label="Open navigation">☰</button>
            <div>
              <span className="workspace-breadcrumb">WORKSPACE / <b>OVERVIEW</b></span>
              <h1>Mission control</h1>
            </div>
          </div>
          <div className="workspace-topbar-right">
            <a className="workspace-activity-chip" href="/dashboard?tab=activity"><span /> Live activity</a>
            <a className="workspace-create-btn" href="/app">Create mission <span>+</span></a>
          </div>
        </header>

        <main className="workspace-content">
          <UserDashboard />
        </main>
      </div>
    </div>
  );
}
