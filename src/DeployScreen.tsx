import { useState } from "react";
import {
  createWalletClient,
  custom,
  createPublicClient,
  http,
  formatEther,
  type EIP1193Provider,
  type Hex,
} from "viem";
import { bscTestnet } from "viem/chains";
import { EthereumProvider } from "@walletconnect/ethereum-provider";
import {
  JOB_ESCROW_ABI,
  JOB_ESCROW_BYTECODE,
} from "./contractArtifacts";

const WALLETCONNECT_PROJECT_ID = "1dbe8fd5e4974ae7c80d074c4082b5a0";

const TESTNET_CHAIN_ID = 97;
const TESTNET_CHAIN_ID_HEX = "0x61";

const publicClient = createPublicClient({
  chain: bscTestnet,
  transport: http(),
});

type DeployState =
  | "idle"
  | "connecting"
  | "connected"
  | "checking"
  | "deploying"
  | "confirming"
  | "done"
  | "error";

type DeployDiagnostics = {
  chainId?: number;
  balance?: string;
  gasEstimate?: string;
};

export default function DeployScreen() {
  const [state, setState] = useState<DeployState>("idle");

  const [address, setAddress] = useState<string | null>(null);
  const [provider, setProvider] =
    useState<EIP1193Provider | null>(null);

  const [txHash, setTxHash] = useState<string | null>(null);
  const [contractAddress, setContractAddress] =
    useState<string | null>(null);

  const [error, setError] = useState<string | null>(null);

  const [diagnostics, setDiagnostics] =
    useState<DeployDiagnostics>({});

  async function connect() {
    setState("connecting");
    setError(null);
    setDiagnostics({});

    try {
      const wcProvider = await EthereumProvider.init({
        projectId: WALLETCONNECT_PROJECT_ID,
        chains: [TESTNET_CHAIN_ID],
        showQrModal: true,
        metadata: {
          name: "JobEscrow Deployer",
          description:
            "One-time JobEscrow deployment to BNB Smart Chain Testnet",
          url: window.location.origin,
          icons: [],
        },
      });

      await wcProvider.connect();

      const accounts = wcProvider.accounts as string[];

      if (!accounts?.length) {
        throw new Error("No wallet account was returned.");
      }

      const connectedAddress = accounts[0];

      // Check the network reported by the wallet.
      const chainIdHex = (await wcProvider.request({
        method: "eth_chainId",
      })) as string;

      const chainId = parseInt(chainIdHex, 16);

      // Try to switch automatically if the wallet is on the wrong chain.
      if (chainId !== TESTNET_CHAIN_ID) {
        try {
          await wcProvider.request({
            method: "wallet_switchEthereumChain",
            params: [{ chainId: TESTNET_CHAIN_ID_HEX }],
          });
        } catch (switchError) {
          const switchMessage =
            switchError instanceof Error
              ? switchError.message
              : String(switchError);

          throw new Error(
            `Wrong network. Please switch your wallet to BNB Smart Chain Testnet (Chain ID 97). Wallet response: ${switchMessage}`
          );
        }
      }

      const finalChainIdHex = (await wcProvider.request({
        method: "eth_chainId",
      })) as string;

      const finalChainId = parseInt(finalChainIdHex, 16);

      if (finalChainId !== TESTNET_CHAIN_ID) {
        throw new Error(
          `Wrong network. Connected chain ID is ${finalChainId}. BNB Smart Chain Testnet requires chain ID 97.`
        );
      }

      setAddress(connectedAddress);
      setProvider(
        wcProvider as unknown as EIP1193Provider
      );

      setDiagnostics({
        chainId: finalChainId,
      });

      setState("connected");
    } catch (e) {
      setError(formatError(e));
      setState("error");
    }
  }

  async function checkDeployment() {
    if (!provider || !address) {
      throw new Error(
        "Wallet is not connected. Connect your wallet first."
      );
    }

    setState("checking");
    setError(null);

    try {
      // -------------------------------------------------------
      // 1. Verify wallet network
      // -------------------------------------------------------
      const walletChainIdHex = (await provider.request({
        method: "eth_chainId",
      })) as string;

      const walletChainId = parseInt(walletChainIdHex, 16);

      if (walletChainId !== TESTNET_CHAIN_ID) {
        throw new Error(
          `Wrong network: wallet is on chain ${walletChainId}, but BNB Smart Chain Testnet requires chain 97.`
        );
      }

      // -------------------------------------------------------
      // 2. Check wallet balance
      // -------------------------------------------------------
      const balance = await publicClient.getBalance({
        address: address as `0x${string}`,
      });

      const balanceFormatted = formatEther(balance);

      if (balance === 0n) {
        throw new Error(
          "Your wallet has 0 BNB on BNB Smart Chain Testnet. You need testnet BNB to pay deployment gas."
        );
      }

      // -------------------------------------------------------
      // 3. Validate deployment bytecode
      // -------------------------------------------------------
      if (
        !JOB_ESCROW_BYTECODE ||
        typeof JOB_ESCROW_BYTECODE !== "string"
      ) {
        throw new Error(
          "JobEscrow deployment bytecode is missing."
        );
      }

      if (!JOB_ESCROW_BYTECODE.startsWith("0x")) {
        throw new Error(
          "JobEscrow bytecode is not valid hexadecimal data."
        );
      }

      if (JOB_ESCROW_BYTECODE.length < 100) {
        throw new Error(
          "JobEscrow bytecode appears to be incomplete."
        );
      }

      // -------------------------------------------------------
      // 4. Estimate deployment gas
      // -------------------------------------------------------
      const gasEstimate = await publicClient.estimateGas({
        account: address as `0x${string}`,
        data: JOB_ESCROW_BYTECODE as Hex,
      });

      setDiagnostics({
        chainId: walletChainId,
        balance: balanceFormatted,
        gasEstimate: gasEstimate.toString(),
      });

      // -------------------------------------------------------
      // 5. Everything looks ready
      // -------------------------------------------------------
      setState("connected");
    } catch (e) {
      setError(formatError(e));
      setState("error");
    }
  }

  async function deploy() {
    if (!provider || !address) {
      setError(
        "Wallet is not connected. Connect your wallet first."
      );
      setState("error");
      return;
    }

    setState("deploying");
    setError(null);

    try {
      // -------------------------------------------------------
      // Verify network one more time immediately before
      // requesting the wallet signature.
      // -------------------------------------------------------
      const chainIdHex = (await provider.request({
        method: "eth_chainId",
      })) as string;

      const chainId = parseInt(chainIdHex, 16);

      if (chainId !== TESTNET_CHAIN_ID) {
        throw new Error(
          `Wrong network. Current wallet chain is ${chainId}. Please switch to BNB Smart Chain Testnet (97).`
        );
      }

      // -------------------------------------------------------
      // Create wallet client
      // -------------------------------------------------------
      const walletClient = createWalletClient({
        account: address as `0x${string}`,
        chain: bscTestnet,
        transport: custom(provider),
      });

      // -------------------------------------------------------
      // Check balance
      // -------------------------------------------------------
      const balance = await publicClient.getBalance({
        address: address as `0x${string}`,
      });

      if (balance === 0n) {
        throw new Error(
          "Insufficient testnet BNB. This wallet has 0 BNB."
        );
      }

      // -------------------------------------------------------
      // Estimate gas before opening the wallet confirmation.
      // -------------------------------------------------------
      const gasEstimate = await publicClient.estimateGas({
        account: address as `0x${string}`,
        data: JOB_ESCROW_BYTECODE as Hex,
      });

      setDiagnostics({
        chainId,
        balance: formatEther(balance),
        gasEstimate: gasEstimate.toString(),
      });

      // -------------------------------------------------------
      // Deploy JobEscrow
      // -------------------------------------------------------
      let hash: `0x${string}`;

      try {
        hash = await walletClient.deployContract({
          account: address as `0x${string}`,
          abi: JOB_ESCROW_ABI,
          bytecode: JOB_ESCROW_BYTECODE,
        });
      } catch (walletError) {
        throw new Error(
          `Wallet rejected the deployment request.\n\n${formatError(
            walletError
          )}`
        );
      }

      setTxHash(hash);
      setState("confirming");

      // -------------------------------------------------------
      // Wait for blockchain confirmation
      // -------------------------------------------------------
      const receipt =
        await publicClient.waitForTransactionReceipt({
          hash,
        });

      if (receipt.status !== "success") {
        throw new Error(
          "The deployment transaction was mined but failed."
        );
      }

      if (!receipt.contractAddress) {
        throw new Error(
          "The transaction succeeded, but no contract address was returned."
        );
      }

      setContractAddress(receipt.contractAddress);
      setState("done");
    } catch (e) {
      setError(formatError(e));
      setState("error");
    }
  }

  function resetDeployment() {
    setError(null);
    setTxHash(null);
    setContractAddress(null);
    setDiagnostics({});

    if (address && provider) {
      setState("connected");
    } else {
      setState("idle");
    }
  }

  return (
    <div style={styles.page}>
      <div style={styles.container}>
        <h1 style={styles.title}>
          Deploy JobEscrow
        </h1>

        <p style={styles.subtitle}>
          One-time deployment to{" "}
          <strong>
            BNB Smart Chain Testnet
          </strong>
          .
          <br />
          Chain ID: <strong>97</strong>
        </p>

        <div style={styles.card}>
          {/* ------------------------------------------------ */}
          {/* IDLE */}
          {/* ------------------------------------------------ */}
          {state === "idle" && (
            <>
              <div style={styles.infoBox}>
                <div style={styles.infoTitle}>
                  Testnet deployment
                </div>

                <div style={styles.infoText}>
                  Connect the wallet that will deploy the
                  JobEscrow contract.
                </div>

                <div style={styles.infoText}>
                  You need free testnet BNB for gas.
                </div>

                <a
                  href="https://testnet.bnbchain.org/faucet-smart"
                  target="_blank"
                  rel="noreferrer"
                  style={styles.link}
                >
                  Open BNB testnet faucet ↗
                </a>
              </div>

              <button
                style={styles.btn}
                onClick={connect}
              >
                Connect Wallet
              </button>
            </>
          )}

          {/* ------------------------------------------------ */}
          {/* CONNECTING */}
          {/* ------------------------------------------------ */}
          {state === "connecting" && (
            <div style={styles.row}>
              <span style={styles.spinner} />
              Connecting wallet…
            </div>
          )}

          {/* ------------------------------------------------ */}
          {/* CONNECTED / CHECKING / DEPLOYING / CONFIRMING */}
          {/* ------------------------------------------------ */}
          {(
            state === "connected" ||
            state === "checking" ||
            state === "deploying" ||
            state === "confirming"
          ) && (
            <>
              <div style={styles.walletLabel}>
                Connected wallet
              </div>

              <div style={styles.walletRow}>
                {address}
              </div>

              <div style={styles.networkBox}>
                <div>
                  <span style={styles.statLabel}>
                    Network
                  </span>

                  <span style={styles.statValue}>
                    BNB Smart Chain Testnet
                  </span>
                </div>

                <div>
                  <span style={styles.statLabel}>
                    Chain ID
                  </span>

                  <span style={styles.statValue}>
                    {diagnostics.chainId ?? 97}
                  </span>
                </div>

                {diagnostics.balance && (
                  <div>
                    <span style={styles.statLabel}>
                      Testnet BNB
                    </span>

                    <span style={styles.statValue}>
                      {diagnostics.balance}
                    </span>
                  </div>
                )}

                {diagnostics.gasEstimate && (
                  <div>
                    <span style={styles.statLabel}>
                      Estimated gas
                    </span>

                    <span style={styles.statValue}>
                      {diagnostics.gasEstimate}
                    </span>
                  </div>
                )}
              </div>

              {/* Initial readiness check */}
              {state === "connected" && (
                <>
                  <button
                    style={styles.secondaryBtn}
                    onClick={checkDeployment}
                  >
                    Check Deployment
                  </button>

                  {diagnostics.balance &&
                    diagnostics.gasEstimate && (
                      <button
                        style={styles.btn}
                        onClick={deploy}
                      >
                        Deploy Contract
                      </button>
                    )}
                </>
              )}

              {/* Checking */}
              {state === "checking" && (
                <div style={styles.row}>
                  <span style={styles.spinner} />
                  Checking network, balance and deployment
                  gas…
                </div>
              )}

              {/* Deploying */}
              {state === "deploying" && (
                <div style={styles.row}>
                  <span style={styles.spinner} />
                  Waiting for wallet signature…
                </div>
              )}

              {/* Confirming */}
              {state === "confirming" && (
                <div>
                  <div style={styles.row}>
                    <span style={styles.spinner} />
                    Waiting for blockchain confirmation…
                  </div>

                  {txHash && (
                    <a
                      style={styles.linkBlock}
                      href={`https://testnet.bscscan.com/tx/${txHash}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      View deployment transaction ↗
                    </a>
                  )}
                </div>
              )}
            </>
          )}

          {/* ------------------------------------------------ */}
          {/* SUCCESS */}
          {/* ------------------------------------------------ */}
          {state === "done" &&
            contractAddress && (
              <div style={styles.doneBox}>
                <div style={styles.doneTitle}>
                  ✓ Contract deployed successfully
                </div>

                {txHash && (
                  <>
                    <div style={styles.doneLabel}>
                      Deployment transaction
                    </div>

                    <a
                      style={styles.linkBlock}
                      href={`https://testnet.bscscan.com/tx/${txHash}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {txHash}
                    </a>
                  </>
                )}

                <div style={styles.doneLabel}>
                  Contract address
                </div>

                <code style={styles.codeBox}>
                  {contractAddress}
                </code>

                <button
                  style={styles.copyBtn}
                  onClick={() =>
                    navigator.clipboard.writeText(
                      contractAddress
                    )
                  }
                >
                  Copy contract address
                </button>

                <a
                  style={styles.linkBlock}
                  href={`https://testnet.bscscan.com/address/${contractAddress}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  View contract on BscScan Testnet ↗
                </a>

                <div style={styles.successNote}>
                  Save this contract address. It will be
                  needed later when connecting the main
                  application to JobEscrow.
                </div>
              </div>
            )}

          {/* ------------------------------------------------ */}
          {/* ERROR */}
          {/* ------------------------------------------------ */}
          {state === "error" && (
            <div style={styles.errorBox}>
              <div style={styles.errorTitle}>
                Deployment error
              </div>

              <pre style={styles.errorText}>
                {error}
              </pre>

              {txHash && (
                <a
                  style={styles.linkBlock}
                  href={`https://testnet.bscscan.com/tx/${txHash}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  View transaction ↗
                </a>
              )}

              <button
                style={styles.btn}
                onClick={resetDeployment}
              >
                Try Again
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ========================================================= */
/* ERROR FORMATTER                                            */
/* ========================================================= */

function formatError(error: unknown): string {
  if (error instanceof Error) {
    const message = error.message;

    // Wallet rejection
    if (
      /user reject/i.test(message) ||
      /user rejected/i.test(message) ||
      /rejected/i.test(message)
    ) {
      return [
        "The wallet rejected the deployment request.",
        "",
        message,
        "",
        "If you did not intentionally press Reject, check:",
        "1. Wallet is connected to BNB Smart Chain Testnet.",
        "2. Wallet contains testnet BNB.",
        "3. The wallet app is open and responding to WalletConnect.",
        "4. Approve the deployment request instead of closing/rejecting it.",
      ].join("\n");
    }

    return message;
  }

  return String(error);
}

/* ========================================================= */
/* STYLES                                                     */
/* ========================================================= */

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: "100vh",
    background: "#0b0d0e",
    color: "#e8e6e1",
    fontFamily: "'Inter', sans-serif",
    padding: "32px 20px",
    boxSizing: "border-box",
  },

  container: {
    maxWidth: 520,
    margin: "0 auto",
  },

  title: {
    fontSize: 26,
    fontWeight: 800,
    margin: "0 0 8px",
  },

  subtitle: {
    fontSize: 14,
    color: "#96938c",
    lineHeight: 1.6,
    marginBottom: 24,
  },

  card: {
    background: "#111314",
    border: "1px solid #292b2d",
    borderRadius: 16,
    padding: 20,
  },

  btn: {
    width: "100%",
    background: "#f0b90b",
    border: "none",
    borderRadius: 10,
    color: "#0b0d0e",
    fontSize: 14,
    fontWeight: 800,
    padding: "13px 18px",
    cursor: "pointer",
    marginTop: 12,
  },

  secondaryBtn: {
    width: "100%",
    background: "#1b1d1f",
    border: "1px solid #303336",
    borderRadius: 10,
    color: "#e8e6e1",
    fontSize: 14,
    fontWeight: 700,
    padding: "13px 18px",
    cursor: "pointer",
    marginTop: 12,
  },

  copyBtn: {
    width: "100%",
    background: "#1b1d1f",
    border: "1px solid #303336",
    borderRadius: 10,
    color: "#e8e6e1",
    fontSize: 13,
    fontWeight: 700,
    padding: "11px 16px",
    cursor: "pointer",
    marginTop: 8,
    marginBottom: 10,
  },

  row: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    fontSize: 13,
    color: "#a3a09a",
    lineHeight: 1.5,
  },

  spinner: {
    width: 14,
    height: 14,
    minWidth: 14,
    borderRadius: "50%",
    border: "2px solid #2a2c2f",
    borderTopColor: "#f0b90b",
    display: "inline-block",
    animation: "spin 0.8s linear infinite",
  },

  infoBox: {
    background: "rgba(240,185,11,0.06)",
    border: "1px solid rgba(240,185,11,0.2)",
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
  },

  infoTitle: {
    fontSize: 14,
    fontWeight: 800,
    marginBottom: 8,
    color: "#f0b90b",
  },

  infoText: {
    fontSize: 13,
    lineHeight: 1.6,
    color: "#aaa69e",
    marginBottom: 4,
  },

  walletLabel: {
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    color: "#77746d",
    marginBottom: 6,
  },

  walletRow: {
    fontSize: 12,
    color: "#7ee2a8",
    fontFamily: "monospace",
    marginBottom: 14,
    wordBreak: "break-all",
  },

  networkBox: {
    background: "#0c0e0f",
    border: "1px solid #252729",
    borderRadius: 12,
    padding: 13,
    marginBottom: 12,
  },

  statLabel: {
    display: "inline-block",
    minWidth: 130,
    color: "#77746d",
    fontSize: 12,
    marginBottom: 7,
  },

  statValue: {
    color: "#e8e6e1",
    fontSize: 12,
    fontFamily: "monospace",
  },

  doneBox: {
    background: "rgba(126,226,168,0.07)",
    border: "1px solid rgba(126,226,168,0.28)",
    borderRadius: 12,
    padding: 16,
  },

  doneTitle: {
    fontSize: 16,
    fontWeight: 800,
    color: "#7ee2a8",
    marginBottom: 16,
  },

  doneLabel: {
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: "0.07em",
    color: "#77746d",
    marginTop: 10,
    marginBottom: 6,
  },

  codeBox: {
    display: "block",
    background: "#0b0d0e",
    border: "1px solid #292b2d",
    borderRadius: 8,
    padding: "11px 12px",
    fontSize: 12,
    color: "#f0b90b",
    wordBreak: "break-all",
    lineHeight: 1.5,
  },

  successNote: {
    fontSize: 12,
    lineHeight: 1.6,
    color: "#85827b",
    marginTop: 14,
  },

  errorBox: {
    background: "#2a1616",
    border: "1px solid #5a2929",
    color: "#f0a3a3",
    padding: 14,
    borderRadius: 10,
  },

  errorTitle: {
    fontSize: 14,
    fontWeight: 800,
    marginBottom: 8,
    color: "#ffb0b0",
  },

  errorText: {
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
    fontFamily: "monospace",
    fontSize: 12,
    lineHeight: 1.6,
    margin: 0,
  },

  link: {
    display: "inline-block",
    marginTop: 8,
    fontSize: 12,
    color: "#f0b90b",
    textDecoration: "none",
    fontWeight: 700,
  },

  linkBlock: {
    display: "block",
    marginTop: 10,
    fontSize: 12,
    color: "#f0b90b",
    textDecoration: "none",
    fontWeight: 700,
    wordBreak: "break-all",
    lineHeight: 1.5,
  },
};
