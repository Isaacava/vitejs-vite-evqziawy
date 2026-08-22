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
  { label: "Testnet", href: "/testnet/jobs", detail: "BSC Testnet · Chain 97 sandbox", icon: "◎" },
  { label: "Register agent", href: "/agents/register", detail: "List a new provider", icon: "+" },
  { label: "Permissions", href: "/permissions", detail: "Session scopes & allowances", icon: "◈" },
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
    const onDocumentClick = () => setManageOpen(false);
    window.addEventListener("popstate", onPopState);
    document.addEventListener("click", onDocumentClick);
    return () => {
      window.removeEventListener("popstate", onPopState);
      document.removeEventListener("click", onDocumentClick);
    };
  }, []);

  function navigate(href: string, nextPage?: string) {
    setPage(nextPage || currentPage());
    setManageOpen(false);
    setMobileOpen(false);
    window.location.assign(href);
  }

  return (
    <div className="market-shell">
      <header className="market-topbar" id="agentmarket-topbar">
        <div className="market-topbar-inner">
          <a className="market-brand" href="/dashboard" aria-label="AgentMarket home">
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
              <button key={link.label} type="button" className={`market-nav-link ${page === link.label ? "current" : ""}`} onClick={() => navigate(link.href, link.label)}>
                {link.label}
              </button>
            ))}

            <div className="market-manage-wrap">
              <button
                type="button"
                className={`market-nav-link manage-button ${manageOpen ? "current" : ""}`}
                onClick={(event) => {
                  event.stopPropagation();
                  setManageOpen((value) => !value);
                }}
                aria-expanded={manageOpen}
              >
                <span>Manage</span>
                <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
              </button>
              <div className={`market-manage-menu ${manageOpen ? "open" : ""}`}>
                {manageLinks.map((link) => (
                  <button key={link.label} type="button" onClick={() => navigate(link.href, link.label)}>
                    <span className="market-manage-icon">{link.icon}</span>
                    <span className="market-manage-copy"><strong>{link.label}</strong><small>{link.detail}</small></span>
                  </button>
                ))}
              </div>
            </div>
          </nav>

          <div className="market-top-actions">
            <span className="market-network-pill"><i /> CHAIN 97</span>
            <button type="button" className="market-wallet-pill" onClick={() => navigate("/dashboard", "Overview")}>Wallet session</button>
            <button type="button" className="market-create-btn" onClick={() => navigate("/app", "Discover")}>Create mission <span>+</span></button>
            <button type="button" className="market-mobile-button" onClick={() => setMobileOpen((value) => !value)} aria-label="Open navigation" aria-expanded={mobileOpen}>
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
            </button>
          </div>
        </div>

        <div className={`market-mobile-menu ${mobileOpen ? "open" : ""}`}>
          {primaryLinks.map((link) => <button key={link.label} type="button" onClick={() => navigate(link.href, link.label)}>{link.label}</button>)}
          {manageLinks.map((link) => <button key={link.label} type="button" onClick={() => navigate(link.href, link.label)}>{link.label}</button>)}
        </div>
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
