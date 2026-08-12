import { useState } from "react";
import { createWalletClient, custom, createPublicClient, http, type EIP1193Provider } from "viem";
import { bscTestnet } from "viem/chains";
import { EthereumProvider } from "@walletconnect/ethereum-provider";
import { JOB_ESCROW_ABI, JOB_ESCROW_BYTECODE } from "./contractArtifacts";

const WALLETCONNECT_PROJECT_ID = "1dbe8fd5e4974ae7c80d074c4082b5a0";

type DeployState = "idle" | "connecting" | "connected" | "deploying" | "confirming" | "done" | "error";

const publicClient = createPublicClient({
  chain: bscTestnet,
  transport: http(),
});

/**
 * One-time deployment screen for the JobEscrow contract, targeting BNB
 * Smart Chain TESTNET. Once deployed, copy the resulting contract address
 * out of this screen and hardcode it into the main app — this component
 * doesn't need to ship in the final product.
 */
export default function DeployScreen() {
  const [state, setState] = useState<DeployState>("idle");
  const [address, setAddress] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [contractAddress, setContractAddress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [provider, setProvider] = useState<EIP1193Provider | null>(null);

  async function connect() {
    setState("connecting");
    setError(null);
    try {
      const wcProvider = await EthereumProvider.init({
        projectId: WALLETCONNECT_PROJECT_ID,
        chains: [97], // BNB Smart Chain TESTNET
        showQrModal: true,
        metadata: {
          name: "JobEscrow Deployer",
          description: "One-time contract deployment",
          url: window.location.origin,
          icons: [],
        },
      });
      await wcProvider.connect();
      const accounts = wcProvider.accounts as string[];
      if (!accounts?.length) throw new Error("No account returned.");
      setAddress(accounts[0]);
      setProvider(wcProvider as unknown as EIP1193Provider);
      setState("connected");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Connection failed.");
      setState("error");
    }
  }

  async function deploy() {
    if (!provider || !address) return;
    setState("deploying");
    setError(null);
    try {
      const walletClient = createWalletClient({
        chain: bscTestnet,
        transport: custom(provider),
      });

      const hash = await walletClient.deployContract({
        account: address as `0x${string}`,
        abi: JOB_ESCROW_ABI,
        bytecode: JOB_ESCROW_BYTECODE,
      });

      setTxHash(hash);
      setState("confirming");

      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.contractAddress) {
        setContractAddress(receipt.contractAddress);
        setState("done");
      } else {
        throw new Error("Deployment succeeded but no contract address was returned.");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Deployment failed.");
      setState("error");
    }
  }

  return (
    <div style={styles.page}>
      <div style={styles.container}>
        <h1 style={styles.title}>Deploy JobEscrow</h1>
        <p style={styles.subtitle}>
          One-time deployment to BNB Smart Chain <strong>Testnet</strong>. You'll need free
          testnet BNB — get some from{" "}
          <a
            href="https://testnet.bnbchain.org/faucet-smart"
            target="_blank"
            rel="noreferrer"
            style={styles.link}
          >
            the BNB testnet faucet
          </a>{" "}
          first.
        </p>

        <div style={styles.card}>
          {state === "idle" && (
            <button style={styles.btn} onClick={connect}>
              Connect Wallet
            </button>
          )}

          {state === "connecting" && (
            <div style={styles.row}>
              <span style={styles.spinner} /> Opening wallet connect…
            </div>
          )}

          {(state === "connected" || state === "deploying" || state === "confirming") && (
            <>
              <div style={styles.walletRow}>Connected: {address}</div>
              {state === "connected" && (
                <button style={styles.btn} onClick={deploy}>
                  Deploy Contract
                </button>
              )}
              {state === "deploying" && (
                <div style={styles.row}>
                  <span style={styles.spinner} /> Waiting for signature…
                </div>
              )}
              {state === "confirming" && (
                <div style={styles.row}>
                  <span style={styles.spinner} /> Confirming on testnet…
                  {txHash && (
                    <a
                      style={styles.link}
                      href={`https://testnet.bscscan.com/tx/${txHash}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      View tx ↗
                    </a>
                  )}
                </div>
              )}
            </>
          )}

          {state === "done" && contractAddress && (
            <div style={styles.doneBox}>
              <div style={styles.doneTitle}>✓ Deployed successfully</div>
              <p style={styles.doneLabel}>Contract address (copy this):</p>
              <code style={styles.codeBox}>{contractAddress}</code>
              <a
                style={styles.link}
                href={`https://testnet.bscscan.com/address/${contractAddress}`}
                target="_blank"
                rel="noreferrer"
              >
                View on BscScan Testnet ↗
              </a>
            </div>
          )}

          {state === "error" && (
            <div style={styles.errorBox}>
              {error}
              <button style={styles.btn} onClick={() => setState(address ? "connected" : "idle")}>
                Try again
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { minHeight: "100vh", background: "#0b0d0e", color: "#e8e6e1", fontFamily: "'Inter', sans-serif", padding: "32px 20px" },
  container: { maxWidth: 480, margin: "0 auto" },
  title: { fontSize: 24, fontWeight: 800, margin: "0 0 8px" },
  subtitle: { fontSize: 13, color: "#8a8880", lineHeight: 1.6, marginBottom: 24 },
  card: { background: "#111314", border: "1px solid #26282a", borderRadius: 14, padding: 20 },
  btn: { width: "100%", background: "#f0b90b", border: "none", borderRadius: 10, color: "#0b0d0e", fontSize: 14, fontWeight: 700, padding: "12px 18px", cursor: "pointer" },
  row: { display: "flex", alignItems: "center", gap: 10, fontSize: 13, color: "#a3a09a" },
  walletRow: { fontSize: 12, color: "#7ee2a8", fontFamily: "monospace", marginBottom: 12, wordBreak: "break-all" },
  spinner: { width: 14, height: 14, borderRadius: "50%", border: "2px solid #26282a", borderTopColor: "#f0b90b", display: "inline-block" },
  doneBox: { background: "rgba(126,226,168,0.08)", border: "1px solid rgba(126,226,168,0.3)", borderRadius: 12, padding: 16 },
  doneTitle: { fontSize: 15, fontWeight: 700, color: "#7ee2a8", marginBottom: 10 },
  doneLabel: { fontSize: 12, color: "#7a776f", marginBottom: 6 },
  codeBox: { display: "block", background: "#0b0d0e", border: "1px solid #26282a", borderRadius: 8, padding: "10px 12px", fontSize: 12, color: "#f0b90b", wordBreak: "break-all", marginBottom: 12 },
  link: { fontSize: 12, color: "#f0b90b", textDecoration: "none", fontWeight: 600 },
  errorBox: { background: "#2a1616", border: "1px solid #4a2323", color: "#f0a3a3", padding: "12px 14px", borderRadius: 10, fontSize: 13 },
};
