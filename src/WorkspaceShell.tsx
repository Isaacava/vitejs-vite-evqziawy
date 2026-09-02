import { useEffect, useState, type ReactNode } from "react";

type WorkspacePage = "Home" | "Discover" | "Missions" | "Activity" | "Wallet" | "Create mission" | "Execution Wallet" | "Testnet" | "Register agent" | "Permissions";

const primaryLinks: Array<{ label: Exclude<WorkspacePage, "Create mission" | "Execution Wallet" | "Testnet" | "Register agent" | "Permissions">; href: string }> = [
  { label: "Home", href: "/dashboard" },
  { label: "Discover", href: "/discover" },
  { label: "Missions", href: "/missions" },
  { label: "Activity", href: "/activity" },
  { label: "Wallet", href: "/execution-wallet" },
];

const manageLinks: Array<{ label: Exclude<WorkspacePage, "Home" | "Discover" | "Missions" | "Activity" | "Wallet" | "Create mission">; href: string; detail: string; icon: string }> = [
  { label: "Execution Wallet", href: "/execution-wallet", detail: "Persistent execution wallet & agent access", icon: "◉" },
  { label: "Testnet", href: "/testnet", detail: "BSC Testnet · Chain 97 sandbox", icon: "◎" },
  { label: "Register agent", href: "/agents/register", detail: "List a new provider", icon: "+" },
  { label: "Permissions", href: "/permissions", detail: "Scoped session permissions", icon: "◈" },
];

const compact = (value?: string | null) => (value ? `${value.slice(0, 6)}…${value.slice(-4)}` : "0x••••…••••");

function currentPage(): WorkspacePage {
  const path = window.location.pathname;
  if (path === "/discover") return "Discover";
  if (path === "/app") return "Create mission";
  if (path === "/missions" || path === "/mission" || path === "/missions/history") return "Missions";
  if (path === "/activity") return "Activity";
  if (path === "/payments") return "Wallet";
  if (path === "/execution-wallet") return "Wallet";
  if (path === "/agents/register") return "Register agent";
  if (path === "/permissions") return "Permissions";
  if (path.startsWith("/testnet")) return "Testnet";
  return "Home";
}

export default function WorkspaceShell({ children }: { children: ReactNode }) {
  const [page, setPage] = useState<WorkspacePage>(currentPage);
  const [manageOpen, setManageOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
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

  return (
    <div className="min-h-screen bg-paper text-ink antialiased font-body">
      <header className={`sticky top-0 z-50 border-b border-line bg-paper/90 backdrop-blur transition-shadow duration-200 ${scrolled ? "shadow-[0_8px_24px_rgba(23,23,20,.06)]" : ""}`}>
        <div className="mx-auto flex h-[72px] max-w-[1240px] items-center justify-between gap-6 px-6 md:px-8">
          <a href="/dashboard" className="flex shrink-0 items-center gap-2.5 no-underline">
            <span className="h-7 w-7 text-brass">
              <svg viewBox="0 0 28 28" fill="none" aria-hidden="true"><rect x="1.5" y="1.5" width="25" height="25" rx="7" stroke="currentColor" strokeWidth="1.5"/><path d="M7 18L11.4 10.2L15.2 15L20.8 7.7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </span>
            <span className="font-display text-[16px] font-bold tracking-tight">AgentMarket</span>
          </a>

          <nav className="hidden items-center gap-7 font-mono text-[11px] font-medium uppercase tracking-wide text-inksoft lg:flex">
            {primaryLinks.map((link) => (
              <button key={link.label} type="button" onClick={() => navigate(link.href, link.label)} className={`nav-link relative pb-1 transition-colors ${page === link.label ? "text-ink current" : "hover:text-ink"}`}>
                {link.label}
              </button>
            ))}
            <div className="relative">
              <button type="button" onClick={(event) => { event.stopPropagation(); setManageOpen((value) => !value); }} className={`nav-link relative flex items-center gap-1.5 pb-1 transition-colors ${manageOpen ? "text-ink current" : "hover:text-ink"}`} aria-expanded={manageOpen}>
                Manage
                <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
              </button>
              <div className={`absolute left-0 top-[calc(100%+14px)] w-72 card-asym border border-line bg-paperhi p-2 shadow-[0_20px_50px_-24px_rgba(23,23,20,.35)] transition-all ${manageOpen ? "pointer-events-auto translate-y-0 scale-100 opacity-100" : "pointer-events-none -translate-y-1.5 scale-[.98] opacity-0"}`}>
                {manageLinks.map((link) => (
                  <button key={link.label} type="button" onClick={() => navigate(link.href, link.label)} className="flex w-full items-start gap-3 rounded-lg p-3 text-left hover:bg-paper">
                    <span className="mt-0.5 text-brass">{link.icon}</span>
                    <span>
                      <span className="block text-[13px] font-semibold normal-case text-ink">{link.label}</span>
                      <span className="block text-[11px] text-inksoft normal-case">{link.detail}</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </nav>

          <div className="hidden shrink-0 items-center gap-3 md:flex">
            <span className="env-badge"><span className="h-1.5 w-1.5 rounded-full bg-brass"/> TESTNET · BSC 97</span>
            <button type="button" onClick={() => navigate("/execution-wallet", "Wallet")} className="btn-asym bg-ink px-3 py-2 font-mono text-[11.5px] font-semibold text-paperhi hover:bg-black">
              {compact(wallet)}
            </button>
          </div>

          <button type="button" className="flex h-9 w-9 items-center justify-center border border-line bg-paperhi btn-asym lg:hidden" onClick={() => setMobileOpen((value) => !value)} aria-expanded={mobileOpen} aria-label="Open workspace navigation">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>
          </button>
        </div>

        <div className={`border-t border-linesoft bg-paperhi px-6 py-5 lg:hidden ${mobileOpen ? "block" : "hidden"}`}>
          <div className="grid gap-1 font-mono text-[11px] uppercase tracking-wide">
            {primaryLinks.map((link) => <button key={link.label} type="button" className="border-b border-linesoft py-2.5 text-left" onClick={() => navigate(link.href, link.label)}>{link.label}</button>)}
            {manageLinks.map((link) => <button key={link.label} type="button" className="border-b border-linesoft py-2.5 text-left" onClick={() => navigate(link.href, link.label)}>{link.label}</button>)}
          </div>
        </div>
      </header>

      <div className="border-b border-line bg-paper">
        <div className="mx-auto flex max-w-[1240px] items-center justify-between px-6 py-3 md:px-8">
          <span className="font-mono text-[9.5px] uppercase tracking-widest text-inksoft">AgentMarket / <b className="text-brass">{page}</b></span>
          <span className="hidden font-mono text-[9.5px] uppercase tracking-widest text-inksoft sm:inline">Testnet mode — faucet funds only</span>
        </div>
      </div>
      <main className="min-h-[calc(100vh-108px)]">{children}</main>
    </div>
  );
}
