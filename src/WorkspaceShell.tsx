import { useEffect, useState, type ReactNode } from "react";
import { getCurrentUser, signOut, type AuthUser } from "./lib/walletAuth";

type WorkspacePage = "Overview" | "Discover" | "Missions" | "Activity" | "Payments" | "Testnet" | "Register agent" | "Permissions";

const primaryLinks: Array<{ label: WorkspacePage; href: string }> = [
  { label: "Overview", href: "/dashboard" },
  { label: "Discover", href: "/app" },
  { label: "Missions", href: "/dashboard?tab=missions" },
  { label: "Activity", href: "/dashboard?tab=activity" },
  { label: "Payments", href: "/dashboard?tab=payments" },
];

const manageLinks: Array<{ label: WorkspacePage; href: string; detail: string; icon: string }> = [
  { label: "Testnet", href: "/testnet/jobs", detail: "BSC Testnet · Chain 97 sandbox", icon: "◎" },
  { label: "Register agent", href: "/agents/register", detail: "List a new provider", icon: "+" },
  { label: "Permissions", href: "/permissions", detail: "Session scopes & allowances", icon: "◈" },
];

function currentPage(): WorkspacePage {
  const path = window.location.pathname;
  const tab = new URLSearchParams(window.location.search).get("tab");
  if (path === "/app") return "Discover";
  if (path === "/agents/register") return "Register agent";
  if (path === "/permissions") return "Permissions";
  if (path.startsWith("/testnet") || path === "/missions") return "Testnet";
  if (tab === "missions") return "Missions";
  if (tab === "activity") return "Activity";
  if (tab === "payments") return "Payments";
  return "Overview";
}

function compact(value?: string | null) {
  return value ? `${value.slice(0, 6)}…${value.slice(-4)}` : "Wallet session";
}

export default function WorkspaceShell({ children }: { children: ReactNode }) {
  const [page, setPage] = useState<WorkspacePage>(currentPage);
  const [manageOpen, setManageOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [user, setUser] = useState<AuthUser | null>(null);

  useEffect(() => {
    const onPopState = () => setPage(currentPage());
    const onDocumentClick = () => setManageOpen(false);
    const onScroll = () => setScrolled(window.scrollY > 8);
    window.addEventListener("popstate", onPopState);
    window.addEventListener("scroll", onScroll, { passive: true });
    document.addEventListener("click", onDocumentClick);
    void getCurrentUser().then(setUser).catch(() => setUser(null));
    return () => {
      window.removeEventListener("popstate", onPopState);
      window.removeEventListener("scroll", onScroll);
      document.removeEventListener("click", onDocumentClick);
    };
  }, []);

  const navigate = (href: string, nextPage?: WorkspacePage) => {
    setPage(nextPage || currentPage());
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
    <div className="min-h-screen bg-[#eeeade] text-[#171714] antialiased [font-family:Manrope,system-ui,sans-serif]">
      <style>{`
        .workspace-host .workspace-nav,
        .workspace-host .agent-register-nav,
        .workspace-host .permissions-nav,
        .workspace-host .console-nav { display:none !important; }
        .workspace-host .workspace { padding-top: 28px; }
        .workspace-host .agent-register-shell,
        .workspace-host .permissions-shell { width:min(1240px,calc(100% - 48px)); margin:0 auto; }
        @media (max-width: 640px) {
          .workspace-host .agent-register-shell,
          .workspace-host .permissions-shell { width:calc(100% - 28px); }
        }
      `}</style>

      <header className={`sticky top-0 z-50 border-b border-[#d5cfbf] bg-[rgba(238,234,222,.92)] backdrop-blur transition-shadow duration-200 ${scrolled ? "shadow-[0_8px_24px_rgba(23,23,20,.06)]" : ""}`}>
        <div className="mx-auto flex h-[72px] max-w-[1240px] items-center justify-between gap-6 px-6 md:px-8">
          <a href="/dashboard" className="flex shrink-0 items-center gap-2.5 no-underline" aria-label="AgentMarket home">
            <span className="h-7 w-7 text-[#9d7428]">
              <svg viewBox="0 0 28 28" fill="none" aria-hidden="true">
                <rect x="1.5" y="1.5" width="25" height="25" rx="7" stroke="currentColor" strokeWidth="1.5" />
                <path d="M7 18L11.4 10.2L15.2 15L20.8 7.7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
            <span className="font-display text-[16px] font-bold tracking-tight">AgentMarket</span>
          </a>

          <nav className="hidden items-center gap-7 font-mono text-[11px] font-medium uppercase tracking-wide text-[#6d6a61] lg:flex" aria-label="Workspace navigation">
            {primaryLinks.map((link) => (
              <button key={link.label} type="button" onClick={() => navigate(link.href, link.label)} className={`relative pb-1 transition-colors ${page === link.label ? "text-[#171714] after:scale-x-100" : "hover:text-[#171714] after:scale-x-0"} after:absolute after:bottom-0 after:left-0 after:right-0 after:h-[2px] after:origin-left after:bg-[#9d7428] after:transition-transform after:duration-200`}>
                {link.label}
              </button>
            ))}

            <div className="relative">
              <button type="button" onClick={(event) => { event.stopPropagation(); setManageOpen((value) => !value); }} className={`relative flex items-center gap-1.5 pb-1 transition-colors ${manageOpen ? "text-[#171714] after:scale-x-100" : "hover:text-[#171714] after:scale-x-0"} after:absolute after:bottom-0 after:left-0 after:right-0 after:h-[2px] after:origin-left after:bg-[#9d7428] after:transition-transform after:duration-200`} aria-expanded={manageOpen}>
                Manage
                <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
              </button>
              <div className={`absolute left-0 top-[calc(100%+14px)] w-64 origin-top-left rounded-[20px_9px_22px_10px] border border-[#d5cfbf] bg-[#fbfaf5] p-2 shadow-[0_20px_50px_-24px_rgba(23,23,20,.35)] transition-all duration-150 ${manageOpen ? "pointer-events-auto translate-y-0 scale-100 opacity-100" : "pointer-events-none -translate-y-1.5 scale-[.98] opacity-0"}`}>
                {manageLinks.map((link) => (
                  <button key={link.label} type="button" onClick={() => navigate(link.href, link.label)} className="flex w-full items-start gap-3 rounded-[10px] p-3 text-left hover:bg-[#eeeade]">
                    <span className="mt-0.5 text-[#9d7428]">{link.icon}</span>
                    <span>
                      <span className="block font-semibold text-[13px] normal-case">{link.label}</span>
                      <span className="block text-[11px] text-[#6d6a61] normal-case">{link.detail}</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </nav>

          <div className="hidden shrink-0 items-center gap-3 md:flex">
            <span className="flex items-center gap-2 rounded-lg border border-[#d5cfbf] bg-[#fbfaf5] px-3 py-2 font-mono text-[9.5px] text-[#6d6a61]">
              <span className="h-1.5 w-1.5 rounded-full bg-[#2d6b4f]" /> CHAIN 97
            </span>
            <button type="button" onClick={() => navigate("/dashboard", "Overview")} className="rounded-[14px_8px_16px_9px] bg-[#171714] px-3 py-2 font-mono text-[11.5px] font-semibold text-[#fbfaf5]">{compact(user?.wallet_address)}</button>
            <button type="button" onClick={() => navigate("/app", "Discover")} className="flex items-center gap-2 rounded-[14px_8px_16px_9px] bg-[#171714] px-4 py-2.5 font-display text-[11px] font-bold text-[#fbfaf5] hover:bg-black">
              Create mission <span className="text-[#d2b05e]">+</span>
            </button>
            <button type="button" onClick={() => void handleSignOut()} disabled={signingOut} className="font-mono text-[10px] font-medium uppercase tracking-wide text-[#6d6a61] hover:text-[#171714] disabled:opacity-50">
              {signingOut ? "Signing out…" : "Sign out"}
            </button>
          </div>

          <button type="button" className="flex h-9 w-9 items-center justify-center rounded-lg border border-[#d5cfbf] lg:hidden" onClick={() => setMobileOpen((value) => !value)} aria-label="Open navigation" aria-expanded={mobileOpen}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
          </button>
        </div>

        <div className={`border-t border-[#e2ddcf] bg-[#fbfaf5] px-6 py-5 lg:hidden transition-all duration-200 ${mobileOpen ? "block opacity-100" : "hidden opacity-0"}`}>
          <div className="grid gap-1 font-mono text-[11px] uppercase tracking-wide">
            {primaryLinks.map((link) => <button key={link.label} type="button" className="border-b border-[#e2ddcf] py-2.5 text-left" onClick={() => navigate(link.href, link.label)}>{link.label}</button>)}
            {manageLinks.map((link) => <button key={link.label} type="button" className="border-b border-[#e2ddcf] py-2.5 text-left" onClick={() => navigate(link.href, link.label)}>{link.label}</button>)}
            <button type="button" className="py-2.5 text-left" onClick={() => void handleSignOut()} disabled={signingOut}>{signingOut ? "Signing out…" : "Sign out"}</button>
          </div>
        </div>
      </header>

      <div className="border-b border-[#d5cfbf] bg-[#eeeade]">
        <div className="mx-auto flex max-w-[1240px] items-center justify-between px-6 py-3 md:px-8">
          <span className="font-mono text-[9.5px] uppercase tracking-widest text-[#6d6a61]">Workspace / <b className="text-[#9d7428]">{page}</b></span>
          <span className="hidden font-mono text-[9.5px] uppercase tracking-widest text-[#6d6a61] sm:inline">Testnet mode — faucet funds only</span>
        </div>
      </div>

      <main className="workspace-host min-h-[calc(100vh-108px)]">
        {children}
      </main>
    </div>
  );
}
