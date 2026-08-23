import UserDashboard from "./UserDashboard";
import WorkspaceShell from "./WorkspaceShell";

export default function DashboardShell() {
  return (
    <WorkspaceShell>
      <UserDashboard />
    </WorkspaceShell>
  );
}
