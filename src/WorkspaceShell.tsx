import { useEffect, useState, type ReactNode } from "react";
import { signOut } from "./lib/walletAuth";

type WorkspacePage = "Overview" | "Discover" | "Missions" | "Activity" | "Payments" | "Create mission" | "Testnet" | "Register agent" | "Permissions";

const primaryLinks: Array<{ label: Exclude<WorkspacePage, "Create mission" | "Testnet" | "Register agent" | "Permissions">; href: string }> = [
  { label: "Overview", href: "/dashboard" },
  { label: "Discover", href: "/discover" },
  { label: "Missions", href: "/missions" },
  { label: "Activity", href: "/dashboard?tab=activity" },
  { label: "Payments", href: "/dashboard?tab=payments" },
];

const manageLinks: Array<{ label: Exclude<WorkspacePage, "Overview" | "Discover" | "Missions" | "Activity" | "Payments" | "Create mission">; href: string; detail: string; icon: string }> = [
  { label: "Testnet", href: "/testnet/jobs", detail: "BSC Testnet · Chain 97 sandbox", icon: "◎" },
  { label: "Register agent", href: "/agents/register", detail: "List a new provider", icon: "+" },
  { label: "Permissions", href: "/permissions", detail: "Session scopes & allowances", icon: "◈" },
];

const compact = (value?: string | null) => (value ? `${value.slice(0, 6)}…${value.slice(-4)}` : "Wallet");

function currentPage(): WorkspacePage {
  const path = window.location.pathname;
  const tab = new URLSearchParams(window.location.search).get("tab");
  if (path === "/discover") return "Discover";
  if (path === "/app") return "Create mission";
  if (path === "/missions" || path === "/mission") return "Missions";
  if (path === "/agents/register") return "Register agent";
  if (path === "/permissions") return "Permissions";
  if (path.startsWith("/testnet")) return "Testnet";
  if (tab === "activity") return "Activity";
  if (tab === "payments") return "Payments";
  return "Overview";
}

export default function WorkspaceShell({ children }: { children: ReactNode }) {
  const [page, setPage] = useState<WorkspacePage>(currentPage);
  const [manageOpen, setManageOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [wallet, setWallet] = useState("");
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const pop = () => setPage(currentPage());
    const close = () => setManageOpen(false);
    const onScroll = () => setScrolled(window.scrollY > 8);

    window.addEventListener("popstate", pop);
    window.addEventListener("scroll", onScroll, { passive: true });
    document.addEventListener("click", close);
    onScroll();

    void fetch("/api/auth/me", { credentials: "include" })
      .then((response) => (response.ok ? response.json() : null))
      .then((body) => setWallet(body?.user?.wallet_address || ""))
      .catch(() => undefined);

    return () => {
      window.removeEventListener("popstate", pop);
      window.removeEventListener("scroll", onScroll);
      document.removeEventListener("click", close);
    };
  }, []);

  const navigate = (href: string, next?: WorkspacePage) => {
    setPage(next || currentPage());
    setManageOpen(false);
    setMobileOpen(false);
    window.location.assign(href);
  };

  const handleSignOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await signOut();
    } finally {
      window.location.assign("/");
    }
  };

  return (
    <div className="min-h-screen bg-paper text-ink antialiased font-body">
      <style>{`
        .workspace-host .workspace-nav,
        .workspace-host .agent-register-nav,
        .workspace-host .permissions-nav,
        .workspace-host .console-nav { display: none !important; }
        .workspace-host .workspace { padding-top: 28px; }
        .workspace-host .agent-register-shell,
        .workspace-host .permissions-shell {
          width: min(1240px, calc(100% - 48px));
          margin: 0 auto;
        }
        @media (max-width: 640px) {
          .workspace-host .agent-register-shell,
          .workspace-host .permissions-shell { width: calc(100% - 28px); }
        }
      `}</style>

      <header
        className={`sticky top-0 z-50 border-b border-line bg-paper/90 backdrop-blur transition-shadow duration-200 ${
          scrolled ? "shadow-[0_8px_24px_rgba(23,23,20,.06)]" : ""
        }`}
      >
        <div className="mx-auto flex h-[72px] max-w-[1240px] items-center justify-between gap-6 px-6 md:px-8">
          <a href="/dashboard" className="flex shrink-0 items-center gap-2.5 no-underline">
            <span className="h-7 w-7 text-brass">
              <svg viewBox="0 0 28 28" fill="none" aria-hidden="true">
                <rect x="1.5" y="1.5" width="25" height="25" rx="7" stroke="currentColor" strokeWidth="1.5" />
                <path d="M7 18L11.4 10.2L15.2 15L20.8 7.7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
            <span className="font-display text-[16px] font-bold tracking-tight">AgentMarket</span>
          </a>

          <nav className="hidden items-center gap-7 font-mono text-[11px] font-medium uppercase tracking-wide text-inksoft lg:flex">
            {primaryLinks.map((link) => (
              <button
                key={link.label}
                type="button"
                onClick={() => navigate(link.href, link.label)}
                className={`nav-link relative pb-1 transition-colors ${
                  page === link.label ? "text-ink current" : "hover:text-ink"
                }`}
              >
                {link.label}
              </button>
            ))}

            <div className="relative">
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  setManageOpen((value) => !value);
                }}
                className={`nav-link relative flex items-center gap-1.5 pb-1 transition-colors ${
                  manageOpen ? "text-ink current" : "hover:text-ink"
                }`}
                aria-expanded={manageOpen}
              >
                Manage
                <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                  <path d="m6 9 6 6 6-6" />
                </svg>
              </button>

              <div
                className={`absolute left-0 top-[calc(100%+14px)] w-64 card-asym border border-line bg-paperhi p-2 shadow-[0_20px_50px_-24px_rgba(23,23,20,.35)] transition-all ${
                  manageOpen ? "pointer-events-auto translate-y-0 scale-100 opacity-100" : "pointer-events-none -translate-y-1.5 scale-[.98] opacity-0"
                }`}
              >
                {manageLinks.map((link) => (
                  <button
                    key={link.label}
                    type="button"
                    onClick={() => navigate(link.href, link.label)}
                    className="flex w-full items-start gap-3 rounded-lg p-3 text-left hover:bg-paper"
                  >
                    <span className="mt-0.5 text-brass">{link.icon}</span>
                    <span>
                      <span className="block text-[13px] font-semibold normal-case text-ink">{link.label}</span>
                      <span className="block text-[11px] text-inksoft normal-case">{link.detail}</span>
                    </span>
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => void handleSignOut()}
                  disabled={signingOut}
                  className="mt-1 flex w-full items-start gap-3 rounded-lg border-t border-linesoft p-3 text-left text-inksoft hover:bg-paper hover:text-ink"
                >
                  <span className="mt-0.5 text-brass">↪</span>
                  <span>
                    <span className="block text-[13px] font-semibold normal-case text-ink">{signingOut ? "Signing out…" : "Sign out"}</span>
                    <span className="block text-[11px] normal-case">End the signed workspace session</span>
                  </span>
                </button>
              </div>
            </div>
          </nav>

          <div className="hidden shrink-0 items-center gap-3 md:flex">
            <span className="flex items-center gap-2 rounded-lg border border-line bg-paperhi px-3 py-2 font-mono text-[9.5px] text-inksoft">
              <span className="h-1.5 w-1.5 rounded-full bg-green" /> CHAIN 97
            </span>
            <button
              type="button"
              onClick={() => navigate("/dashboard", "Overview")}
              className="btn-asym bg-ink px-3 py-2 font-mono text-[11.5px] font-semibold text-paperhi"
              title={wallet || "Authenticated wallet"}
            >
              {compact(wallet)}
            </button>
            <button
              type="button"
              onClick={() => navigate("/app", "Create mission")}
              className="btn-asym flex items-center gap-2 bg-ink px-4 py-2.5 font-display text-[11px] font-bold text-paperhi hover:bg-black"
            >
              Create mission <span className="text-brasslt">+</span>
            </button>
          </div>

          <button
            type="button"
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-line lg:hidden"
            onClick={() => setMobileOpen((value) => !value)}
            aria-expanded={mobileOpen}
            aria-label="Open workspace navigation"
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M4 7h16M4 12h16M4 17h16" />
            </svg>
          </button>
        </div>

        <div className={`border-t border-linesoft bg-paperhi px-6 py-5 lg:hidden ${mobileOpen ? "block" : "hidden"}`}>
          <div className="grid gap-1 font-mono text-[11px] uppercase tracking-wide">
            {primaryLinks.map((link) => (
              <button
                key={link.label}
                type="button"
                className="border-b border-linesoft py-2.5 text-left"
                onClick={() => navigate(link.href, link.label)}
              >
                {link.label}
              </button>
            ))}
            {manageLinks.map((link) => (
              <button
                key={link.label}
                type="button"
                className="border-b border-linesoft py-2.5 text-left"
                onClick={() => navigate(link.href, link.label)}
              >
                {link.label}
              </button>
            ))}
            <button type="button" className="py-2.5 text-left" onClick={() => void handleSignOut()} disabled={signingOut}>
              {signingOut ? "Signing out…" : "Sign out"}
            </button>
          </div>
        </div>
      </header>

      <div className="border-b border-line bg-paper">
        <div className="mx-auto flex max-w-[1240px] items-center justify-between px-6 py-3 md:px-8">
          <span className="font-mono text-[9.5px] uppercase tracking-widest text-inksoft">
            Workspace / <b className="text-brass">{page}</b>
          </span>
          <span className="hidden font-mono text-[9.5px] uppercase tracking-widest text-inksoft sm:inline">
            Testnet mode — faucet funds only
          </span>
        </div>
      </div>

      <main className="workspace-host min-h-[calc(100vh-108px)]">{children}</main>
    </div>
  );
}
