import { useEffect } from "react";
import MarketplaceWorkspace from "./MarketplaceWorkspace";

export default function MarketplaceWorkspaceAutoHire() {
  useEffect(() => {
    const requestedAgent = new URLSearchParams(window.location.search).get("agent");
    if (!requestedAgent) return;

    document.cookie = `agentmarket_selected_agent=${encodeURIComponent(requestedAgent)}; Path=/; Max-Age=600; SameSite=Lax`;

    let attempts = 0;
    const timer = window.setInterval(() => {
      attempts += 1;
      const button = Array.from(document.querySelectorAll("button")).find((candidate) => {
        return candidate.textContent?.includes("Find matching agents");
      }) as HTMLButtonElement | undefined;

      if (button && !button.disabled) {
        window.clearInterval(timer);
        button.click();
        return;
      }

      if (attempts >= 120) window.clearInterval(timer);
    }, 50);

    return () => window.clearInterval(timer);
  }, []);

  return <MarketplaceWorkspace />;
}
