import UserDashboard from "./UserDashboard";
import "./dashboard-shell.css";

const links = [
  ["Overview", "/dashboard"],
  ["Discover agents", "/app"],
  ["Missions", "/dashboard?tab=missions"],
  ["Activity", "/dashboard?tab=activity"],
  ["Payments & escrow", "/dashboard?tab=payments"],
  ["Testnet", "/testnet"],
  ["Agent registration", "/agents/register"],
  ["Permissions", "/permissions"],
] as const;

export default function DashboardShell() {
  return (
    <div className="workspace-shell">
      <aside className="workspace-sidebar" aria-label="AgentMarket workspace navigation">
        <a className="workspace-sidebar-brand" href="/dashboard">AgentMarket</a>
        <div className="workspace-sidebar-label">WORKSPACE</div>
        <nav>
          {links.map(([label, href], index) => (
            <a className={index === 0 ? "active" : ""} key={label} href={href}>
              <span>{String(index + 1).padStart(2, "0")}</span>{label}
            </a>
          ))}
        </nav>
        <div className="workspace-sidebar-foot">
          <span>ENVIRONMENT</span>
          <strong>TESTNET</strong>
          <small>BSC · Chain 97</small>
        </div>
      </aside>
      <div className="workspace-main"><UserDashboard /></div>
    </div>
  );
}
