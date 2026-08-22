import { useEffect, useState } from "react";
import UserDashboard from "./UserDashboard";
import "./dashboard-shell.css";

const primaryLinks = [
  { label: "Overview", href: "/dashboard" },
  { label: "Discover", href: "/app" },
  { label: "Missions", href: "/dashboard?tab=missions" },
  { label: "Activity", href: "/dashboard?tab=activity" },
  { label: "Payments", href: "/dashboard?tab=payments" },
];

const manageLinks = [
  { label: "Testnet", href: "/testnet" },
  { label: "Register agent", href: "/agents/register" },
  { label: "Permissions", href: "/permissions" },
];

function currentPage() {
  const path = window.location.pathname;
  const tab = new URLSearchParams(window.location.search).get("tab");
  if (path === "/app") return "Discover";
  if (tab === "missions") return "Missions";
  if (tab === "activity") return "Activity";
  if (tab === "payments") return "Payments";
  return "Overview";
}

export default function DashboardShell() {
  const [page, setPage] = useState(currentPage);
  const [manageOpen, setManageOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const onPopState = () => setPage(currentPage());
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  function navigate(href: string) {
    setManageOpen(false);
    setMobileOpen(false);
    window.location.assign(href);
  }

  return (
    <div className="market-shell">
      <header className="market-topbar">
        <div className="market-topbar-inner">
          <a className="market-brand" href="/" aria-label="AgentMarket home">
            <span className="market-brand-glyph" aria-hidden="true">
              <svg viewBox="0 0 28 28" fill="none">
                <rect x="1.5" y="1.5" width="25" height="25" rx="7" stroke="currentColor" strokeWidth="1.5" />
                <path d="M7 18L11.4 10.2L15.2 15L20.8 7.7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
            <span>AgentMarket</span>
          </a>

          <nav className="market-primary-nav" aria-label="Workspace navigation">
            {primaryLinks.map((link) => (
              <button
                key={link.label}
                className={`market-nav-link ${page === link.label ? "current" : ""}`}
                onClick={() => navigate(link.href)}
              >
                {link.label}
              </button>
            ))}

            <div className="market-manage-wrap">
              <button
                className={`market-nav-link manage-button ${manageOpen ? "current" : ""}`}
                onClick={(event) => {
                  event.stopPropagation();
                  setManageOpen((value) => !value);
                }}
                aria-expanded={manageOpen}
              >
                Manage <span className="manage-chevron">⌄</span>
              </button>
              {manageOpen && (
                <div className="market-manage-menu" onClick={(event) => event.stopPropagation()}>
                  {manageLinks.map((link) => (
                    <button key={link.label} onClick={() => navigate(link.href)}>
                      <strong>{link.label}</strong>
                      <span>{
                        link.label === "Testnet"
                          ? "BSC Testnet sandbox"
                          : link.label === "Register agent"
                            ? "List an external provider"
                            : "Scoped execution permissions"
                      }</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </nav>

          <div className="market-top-actions">
            <span className="market-network-pill"><i /> BSC TESTNET · 97</span>
            <button className="market-mobile-button" onClick={() => setMobileOpen((value) => !value)} aria-label="Open navigation">
              <span /><span /><span />
            </button>
          </div>
        </div>

        {mobileOpen && (
          <div className="market-mobile-menu">
            {primaryLinks.map((link) => (
              <button key={link.label} className={page === link.label ? "current" : ""} onClick={() => navigate(link.href)}>
                {link.label}
              </button>
            ))}
            <div className="market-mobile-divider" />
            {manageLinks.map((link) => (
              <button key={link.label} onClick={() => navigate(link.href)}>{link.label}</button>
            ))}
          </div>
        )}
      </header>

      <div className="market-crumbbar">
        <div className="market-page-width">
          <span>WORKSPACE / <b>{page}</b></span>
          <span className="market-testnet-note">TESTNET MODE — FAUCET FUNDS ONLY</span>
        </div>
      </div>

      <main className="market-page-width market-workspace-content">
        <UserDashboard />
      </main>
    </div>
  );
}
