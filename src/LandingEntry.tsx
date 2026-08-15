import { useEffect, useRef, useState } from "react";
import LandingPage from "./LandingPage";
import { connectWalletAndSignIn } from "./lib/walletAuth";

export default function LandingEntry() {
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState("");
  const handled = useRef(false);

  useEffect(() => {
    const anchors = Array.from(document.querySelectorAll<HTMLAnchorElement>('.landing a[href="/app"]'));
    anchors.forEach((anchor) => {
      const text = anchor.textContent?.trim().toLowerCase() || "";
      if (text.includes("launch") || text.includes("try the live") || text.includes("explore the live") || text.includes("open registry")) {
        anchor.textContent = "Connect wallet";
      }
    });

    const onClick = async (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('.landing a[href="/app"]') : null;
      if (!target || handled.current) return;
      event.preventDefault();
      event.stopPropagation();
      handled.current = true;
      setConnecting(true);
      setError("");
      try {
        await connectWalletAndSignIn();
        window.location.assign("/dashboard");
      } catch (cause) {
        handled.current = false;
        setError(cause instanceof Error ? cause.message : "Wallet sign-in failed");
      } finally {
        setConnecting(false);
      }
    };

    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  return (
    <>
      <LandingPage />
      {(connecting || error) && (
        <div style={{ position: "fixed", inset: 0, zIndex: 1000, display: "grid", placeItems: "center", background: "rgba(23,23,20,.45)", padding: 20 }}>
          <div style={{ width: "min(420px, 100%)", background: "#fbfaf5", border: "1px solid #d5cfbf", borderRadius: 24, padding: 24, boxShadow: "0 30px 80px rgba(0,0,0,.2)" }}>
            <strong style={{ display: "block", fontSize: 20, marginBottom: 8 }}>{connecting ? "Connect your wallet" : "Sign-in could not be completed"}</strong>
            <p style={{ margin: 0, color: "#6d6a61", lineHeight: 1.6 }}>{connecting ? "Approve the wallet connection, then sign the AgentMarket authentication message. The signature does not move funds." : error}</p>
            {!connecting && <button onClick={() => setError("")} style={{ marginTop: 18, border: 0, background: "#171714", color: "#fbfaf5", borderRadius: 12, padding: "11px 15px", cursor: "pointer" }}>Close</button>}
          </div>
        </div>
      )}
    </>
  );
}
