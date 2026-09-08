import { useEffect } from "react";
import MarketplaceWorkspace from "./MarketplaceWorkspace";

export default function MarketplaceWorkspaceAutoHire() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requestedAgent = params.get("agent")?.trim() || "";
    const requestedGoal = params.get("goal")?.trim() || "";
    if (!requestedAgent) return;

    document.cookie = `agentmarket_selected_agent=${encodeURIComponent(requestedAgent)}; Path=/; Max-Age=600; SameSite=Lax`;

    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      try {
        const url = typeof input === "string" ? input : input instanceof Request ? input.url : String(input);
        if (requestedAgent && /\/api\/testnet\/match(?:\?|$)/.test(url) && (init?.method || "GET").toUpperCase() === "POST") {
          const headers = new Headers(init?.headers || {});
          headers.set("Content-Type", "application/json");
          let body: Record<string, unknown> = {};
          try { body = JSON.parse(String(init?.body || "{}")); } catch { body = {}; }
          body.agent_id = requestedAgent;
          if (requestedGoal) body.goal = requestedGoal;
          return originalFetch(input, { ...init, headers, body: JSON.stringify(body), credentials: init?.credentials || "include" });
        }
      } catch {
        // Fall through to the original fetch for unrelated requests.
      }
      return originalFetch(input, init);
    };

    let attempts = 0;
    const timer = window.setInterval(() => {
      attempts += 1;

      const textarea = document.querySelector("textarea") as HTMLTextAreaElement | null;
      if (textarea && requestedGoal && textarea.value !== requestedGoal) {
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
        setter?.call(textarea, requestedGoal);
        textarea.dispatchEvent(new Event("input", { bubbles: true }));
      }

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

    return () => {
      window.clearInterval(timer);
      window.fetch = originalFetch;
    };
  }, []);

  return <MarketplaceWorkspace />;
}
