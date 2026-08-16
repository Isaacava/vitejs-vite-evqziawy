import { useEffect, useRef, useState } from "react";
import LandingPage from "./LandingPage";
import { connectWalletAndSignIn } from "./lib/walletAuth";
import "./landing-auth.css";

const ENTRY_SELECTOR = '.landing a[href="/dashboard"]';

export default function LandingEntry() {
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState("");
  const handled = useRef(false);

  useEffect(() => {
    const onClick = async (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>(ENTRY_SELECTOR) : null;
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
        <div className="landing-auth-overlay" role="dialog" aria-modal="true" aria-live="polite">
          <div className="landing-auth-modal">
            <div className="landing-auth-kicker">AGENTMARKET AUTHENTICATION</div>
            <strong>{connecting ? "Connect your wallet" : "Sign-in could not be completed"}</strong>
            <p>
              {connecting
                ? "WalletConnect will open now. Connect your wallet, then sign the AgentMarket authentication message. The signature does not authorize a transaction or move funds."
                : error}
            </p>
            {!connecting && (
              <button type="button" onClick={() => setError("")} className="landing-auth-close">
                Close
              </button>
            )}
          </div>
        </div>
      )}
    </>
  );
}
