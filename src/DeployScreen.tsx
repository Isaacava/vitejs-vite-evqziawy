import { useState } from "react";
import {
  createPublicClient,
  createWalletClient,
  custom,
  formatEther,
  http,
  type EIP1193Provider,
  type Hex,
} from "viem";
import { bscTestnet } from "viem/chains";
import { EthereumProvider } from "@walletconnect/ethereum-provider";
import {
  JOB_ESCROW_ABI,
  JOB_ESCROW_BYTECODE,
} from "./contractArtifacts";

const WALLETCONNECT_PROJECT_ID =
  "1dbe8fd5e4974ae7c80d074c4082b5a0";

const BSC_TESTNET_CHAIN_ID = 97;

type DeployState =
  | "idle"
  | "connecting"
  | "connected"
  | "checking"
  | "deploying"
  | "confirming"
  | "done"
  | "error";

type Diagnostics = {
  chainId?: number;
  rawChainId?: string;
  balance?: string;
  gasEstimate?: string;
};

const publicClient = createPublicClient({
  chain: bscTestnet,
  transport: http(),
});

/**
 * Normalize chain IDs returned by different wallet providers.
 *
 * Examples:
 * "97"   -> 97
 * "0x61" -> 97
 * 97     -> 97
 */
function normalizeChainId(value: unknown): number {
  if (typeof value === "number") {
    return value;
  }

  if (typeof value === "bigint") {
    return Number(value);
  }

  if (typeof value === "string") {
    const valueTrimmed = value.trim();

    if (valueTrimmed.toLowerCase().startsWith("0x")) {
      return parseInt(valueTrimmed, 16);
    }

    const decimalValue = Number(valueTrimmed);

    if (Number.isFinite(decimalValue)) {
      return decimalValue;
    }
  }

  throw new Error(
    `Unable to determine wallet chain ID. Received: ${String(value)}`
  );
}

/**
 * Read chain ID from the connected wallet provider.
 */
async function getChainInfo(
  walletProvider: EIP1193Provider
): Promise<{
  raw: string;
  chainId: number;
}> {
  const result = await walletProvider.request({
    method: "eth_chainId",
  });

  return {
    raw: String(result),
    chainId: normalizeChainId(result),
  };
}

export default function DeployScreen() {
  const [state, setState] =
    useState<DeployState>("idle");

  const [address, setAddress] =
    useState<string | null>(null);

  const [provider, setProvider] =
    useState<EIP1193Provider | null>(null);

  const [txHash, setTxHash] =
    useState<string | null>(null);

  const [contractAddress, setContractAddress] =
    useState<string | null>(null);

  const [error, setError] =
    useState<string | null>(null);

  const [diagnostics, setDiagnostics] =
    useState<Diagnostics>({});

  /**
   * Connect WalletConnect wallet.
   */
  async function connect() {
    setState("connecting");
    setError(null);
    setTxHash(null);
    setContractAddress(null);
    setDiagnostics({});

    try {
      const wcProvider =
        await EthereumProvider.init({
          projectId:
            WALLETCONNECT_PROJECT_ID,

          chains: [
            BSC_TESTNET_CHAIN_ID,
          ],

          optionalChains: [
            BSC_TESTNET_CHAIN_ID,
          ],

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

      const accounts =
        wcProvider.accounts as string[];

      if (!accounts || accounts.length === 0) {
        throw new Error(
          "No wallet account was returned."
        );
      }

      const connectedAddress =
        accounts[0];

      const chainInfo =
        await getChainInfo(
          wcProvider as unknown as EIP1193Provider
        );

      console.log(
        "WalletConnect raw chain ID:",
        chainInfo.raw
      );

      console.log(
        "WalletConnect normalized chain ID:",
        chainInfo.chainId
      );

      setAddress(
        connectedAddress
      );

      setProvider(
        wcProvider as unknown as EIP1193Provider
      );

      setDiagnostics({
        rawChainId:
          chainInfo.raw,

        chainId:
          chainInfo.chainId,
      });

      /**
       * IMPORTANT:
       *
       * "97" and "0x61" both become 97.
       */
      if (
        chainInfo.chainId !==
        BSC_TESTNET_CHAIN_ID
      ) {
        throw new Error(
          `Wrong network. Wallet reports chain ID ${chainInfo.chainId}. BNB Smart Chain Testnet requires chain ID 97.`
        );
      }

      setState("connected");
    } catch (e) {
      console.error(
        "Wallet connection failed:",
        e
      );

      setError(
        formatError(e)
      );

      setState("error");
    }
  }

  /**
   * Verify everything before deployment.
   */
  async function checkDeployment() {
    if (!provider || !address) {
      setError(
        "Connect your wallet before checking deployment."
      );

      setState("error");

      return;
    }

    setState("checking");
    setError(null);

    try {
      /**
       * Check network.
       */
      const chainInfo =
        await getChainInfo(provider);

      if (
        chainInfo.chainId !==
        BSC_TESTNET_CHAIN_ID
      ) {
        throw new Error(
          `Wrong network. Wallet reports chain ID ${chainInfo.chainId}. BNB Smart Chain Testnet requires chain ID 97.`
        );
      }

      /**
       * Check wallet balance.
       */
      const balance =
        await publicClient.getBalance({
          address:
            address as `0x${string}`,
        });

      const formattedBalance =
        formatEther(balance);

      if (balance === 0n) {
        throw new Error(
          "Your wallet has 0 BNB on BNB Smart Chain Testnet. Get testnet BNB before deploying."
        );
      }

      /**
       * Check bytecode.
       */
      if (
        !JOB_ESCROW_BYTECODE ||
        typeof JOB_ESCROW_BYTECODE !==
          "string"
      ) {
        throw new Error(
          "JobEscrow bytecode is missing."
        );
      }

      if (
        !JOB_ESCROW_BYTECODE.startsWith(
          "0x"
        )
      ) {
        throw new Error(
          "JobEscrow bytecode is not valid hexadecimal data."
        );
      }

      if (
        JOB_ESCROW_BYTECODE.length < 100
      ) {
        throw new Error(
          "JobEscrow bytecode appears to be incomplete."
        );
      }

      /**
       * Estimate deployment gas.
       */
      const gasEstimate =
        await publicClient.estimateGas({
          account:
            address as `0x${string}`,

          data:
            JOB_ESCROW_BYTECODE as Hex,
        });

      setDiagnostics({
        rawChainId:
          chainInfo.raw,

        chainId:
          chainInfo.chainId,

        balance:
          formattedBalance,

        gasEstimate:
          gasEstimate.toString(),
      });

      setState("connected");
    } catch (e) {
      console.error(
        "Deployment check failed:",
        e
      );

      setError(
        formatError(e)
      );

      setState("error");
    }
  }

  /**
   * Deploy JobEscrow.
   */
  async function deploy() {
    if (!provider || !address) {
      setError(
        "Wallet is not connected."
      );

      setState("error");

      return;
    }

    setState("deploying");
    setError(null);

    try {
      /**
       * Re-check chain immediately before
       * requesting the wallet signature.
       */
      const chainInfo =
        await getChainInfo(provider);

      console.log(
        "Deployment chain:",
        chainInfo
      );

      if (
        chainInfo.chainId !==
        BSC_TESTNET_CHAIN_ID
      ) {
        throw new Error(
          `Wrong network. Wallet reports chain ID ${chainInfo.chainId}. BNB Smart Chain Testnet requires chain ID 97.`
        );
      }

      /**
       * Check balance.
       */
      const balance =
        await publicClient.getBalance({
          address:
            address as `0x${string}`,
        });

      if (balance === 0n) {
        throw new Error(
          "Insufficient testnet BNB. Your wallet has 0 BNB."
        );
      }

      /**
       * Estimate deployment gas before
       * opening the wallet confirmation.
       */
      const gasEstimate =
        await publicClient.estimateGas({
          account:
            address as `0x${string}`,

          data:
            JOB_ESCROW_BYTECODE as Hex,
        });

      setDiagnostics({
        rawChainId:
          chainInfo.raw,

        chainId:
          chainInfo.chainId,

        balance:
          formatEther(balance),

        gasEstimate:
          gasEstimate.toString(),
      });

      /**
       * Create wallet client.
       */
      const walletClient =
        createWalletClient({
          account:
            address as `0x${string}`,

          chain:
            bscTestnet,

          transport:
            custom(provider),
        });

      /**
       * Send deployment transaction.
       */
      let hash:
        | `0x${string}`
        | undefined;

      try {
        hash =
          await walletClient.deployContract({
            account:
              address as `0x${string}`,

            abi:
              JOB_ESCROW_ABI,

            bytecode:
              JOB_ESCROW_BYTECODE,
          });
      } catch (walletError) {
        console.error(
          "Wallet deployment error:",
          walletError
        );

        throw new Error(
          `Wallet rejected or failed the deployment request.\n\n${formatError(
            walletError
          )}`
        );
      }

      setTxHash(hash);

      setState("confirming");

      /**
       * Wait for transaction confirmation.
       */
      const receipt =
        await publicClient.waitForTransactionReceipt(
          {
            hash,
          }
        );

      console.log(
        "Deployment receipt:",
        receipt
      );

      if (
        receipt.status !==
        "success"
      ) {
        throw new Error(
          "Deployment transaction was mined but failed."
        );
      }

      if (
        !receipt.contractAddress
      ) {
        throw new Error(
          "Deployment succeeded but no contract address was returned."
        );
      }

      setContractAddress(
        receipt.contractAddress
      );

      setState("done");
    } catch (e) {
      console.error(
        "Deployment failed:",
        e
      );

      setError(
        formatError(e)
      );

      setState("error");
    }
  }

  /**
   * Reset screen.
   */
  function reset() {
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
          One-time deployment to BNB Smart Chain{" "}
          <strong>Testnet</strong>.
          <br />
          Required chain ID:{" "}
          <strong>97</strong>.
          <br />
          You'll need free testnet BNB for gas.
        </p>

        <div style={styles.card}>
          {/* IDLE */}
          {state === "idle" && (
            <>
              <div style={styles.infoBox}>
                <div style={styles.infoTitle}>
                  BNB Smart Chain Testnet
                </div>

                <p style={styles.infoText}>
                  Connect the wallet that will deploy
                  the JobEscrow contract.
                </p>

                <a
                  href="https://testnet.bnbchain.org/faucet-smart"
                  target="_blank"
                  rel="noreferrer"
                  style={styles.link}
                >
                  Open BNB Testnet Faucet ↗
                </a>
              </div>

              <button
                style={styles.primaryButton}
                onClick={connect}
              >
                Connect Wallet
              </button>
            </>
          )}

          {/* CONNECTING */}
          {state === "connecting" && (
            <div style={styles.status}>
              <span style={styles.spinner} />
              Opening wallet connection…
            </div>
          )}

          {/* CONNECTED / CHECKING / DEPLOYING / CONFIRMING */}
          {(
            state === "connected" ||
            state === "checking" ||
            state === "deploying" ||
            state === "confirming"
          ) && (
            <>
              <div style={styles.label}>
                Connected wallet
              </div>

              <div style={styles.address}>
                {address}
              </div>

              <div style={styles.infoPanel}>
                <div style={styles.infoRow}>
                  <span style={styles.infoKey}>
                    Raw chain ID
                  </span>

                  <strong style={styles.infoValue}>
                    {diagnostics.rawChainId ??
                      "97"}
                  </strong>
                </div>

                <div style={styles.infoRow}>
                  <span style={styles.infoKey}>
                    Normalized chain ID
                  </span>

                  <strong style={styles.infoValue}>
                    {diagnostics.chainId ??
                      "97"}
                  </strong>
                </div>

                <div style={styles.infoRow}>
                  <span style={styles.infoKey}>
                    Network
                  </span>

                  <strong style={styles.infoValue}>
                    BNB Smart Chain Testnet
                  </strong>
                </div>

                {diagnostics.balance && (
                  <div style={styles.infoRow}>
                    <span style={styles.infoKey}>
                      Testnet BNB
                    </span>

                    <strong style={styles.infoValue}>
                      {diagnostics.balance}
                    </strong>
                  </div>
                )}

                {diagnostics.gasEstimate && (
                  <div style={styles.infoRow}>
                    <span style={styles.infoKey}>
                      Estimated gas
                    </span>

                    <strong style={styles.infoValue}>
                      {diagnostics.gasEstimate}
                    </strong>
                  </div>
                )}
              </div>

              {/* CHECK DEPLOYMENT */}
              {state === "connected" && (
                <>
                  <button
                    style={
                      styles.secondaryButton
                    }
                    onClick={
                      checkDeployment
                    }
                  >
                    Check Deployment
                  </button>

                  {diagnostics.balance &&
                    diagnostics.gasEstimate && (
                      <button
                        style={
                          styles.primaryButton
                        }
                        onClick={deploy}
                      >
                        Deploy JobEscrow
                      </button>
                    )}
                </>
              )}

              {/* CHECKING */}
              {state === "checking" && (
                <div style={styles.status}>
                  <span style={styles.spinner} />
                  Checking network, balance,
                  bytecode and gas…
                </div>
              )}

              {/* DEPLOYING */}
              {state === "deploying" && (
                <div style={styles.status}>
                  <span style={styles.spinner} />
                  Waiting for wallet signature…
                </div>
              )}

              {/* CONFIRMING */}
              {state === "confirming" && (
                <div>
                  <div style={styles.status}>
                    <span style={styles.spinner} />
                    Confirming deployment on
                    BNB Smart Chain Testnet…
                  </div>

                  {txHash && (
                    <a
                      href={`https://testnet.bscscan.com/tx/${txHash}`}
                      target="_blank"
                      rel="noreferrer"
                      style={styles.linkBlock}
                    >
                      View deployment transaction ↗
                    </a>
                  )}
                </div>
              )}
            </>
          )}

          {/* SUCCESS */}
          {state === "done" &&
            contractAddress && (
              <div style={styles.doneBox}>
                <div style={styles.doneTitle}>
                  ✓ Contract deployed successfully
                </div>

                <p style={styles.doneText}>
                  JobEscrow is now deployed on
                  BNB Smart Chain Testnet.
                </p>

                <div style={styles.label}>
                  Contract address
                </div>

                <code style={styles.codeBox}>
                  {contractAddress}
                </code>

                <button
                  style={
                    styles.secondaryButton
                  }
                  onClick={() =>
                    navigator.clipboard.writeText(
                      contractAddress
                    )
                  }
                >
                  Copy Contract Address
                </button>

                {txHash && (
                  <a
                    href={`https://testnet.bscscan.com/tx/${txHash}`}
                    target="_blank"
                    rel="noreferrer"
                    style={styles.linkBlock}
                  >
                    View deployment transaction ↗
                  </a>
                )}

                <a
                  href={`https://testnet.bscscan.com/address/${contractAddress}`}
                  target="_blank"
                  rel="noreferrer"
                  style={styles.linkBlock}
                >
                  View contract on BscScan Testnet ↗
                </a>
              </div>
            )}

          {/* ERROR */}
          {state === "error" && (
            <div style={styles.errorBox}>
              <div style={styles.errorTitle}>
                Deployment Error
              </div>

              <pre style={styles.errorText}>
                {error}
              </pre>

              <button
                style={styles.primaryButton}
                onClick={reset}
              >
                Try Again
              </button>
            </div>
          )}
        </div>
      </div>

      <style>
        {`
          @keyframes spin {
            from {
              transform: rotate(0deg);
            }

            to {
              transform: rotate(360deg);
            }
          }
        `}
      </style>
    </div>
  );
}

/**
 * Format unknown errors into useful
 * readable messages.
 */
function formatError(
  error: unknown
): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  try {
    return JSON.stringify(
      error,
      null,
      2
    );
  } catch {
    return String(error);
  }
}

const styles: Record<
  string,
  React.CSSProperties
> = {
  page: {
    minHeight: "100vh",
    background: "#0b0d0e",
    color: "#e8e6e1",
    fontFamily:
      "'Inter', system-ui, sans-serif",
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
    fontSize: 13,
    color: "#8a8880",
    lineHeight: 1.6,
    marginBottom: 24,
  },

  card: {
    background: "#111314",
    border:
      "1px solid #26282a",
    borderRadius: 14,
    padding: 20,
  },

  infoBox: {
    background: "#17191a",
    border:
      "1px solid #292c2e",
    borderRadius: 12,
    padding: 15,
    marginBottom: 16,
  },

  infoTitle: {
    fontSize: 14,
    fontWeight: 800,
    color: "#f0b90b",
    marginBottom: 8,
  },

  infoText: {
    fontSize: 13,
    color: "#aaa69e",
    lineHeight: 1.6,
    margin: "0 0 8px",
  },

  primaryButton: {
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

  secondaryButton: {
    width: "100%",
    background: "#1b1d1f",
    border:
      "1px solid #34383a",
    borderRadius: 10,
    color: "#e8e6e1",
    fontSize: 14,
    fontWeight: 700,
    padding: "13px 18px",
    cursor: "pointer",
    marginTop: 12,
  },

  status: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    fontSize: 13,
    color: "#a3a09a",
    lineHeight: 1.5,
    padding: "6px 0",
  },

  spinner: {
    width: 14,
    height: 14,
    minWidth: 14,
    borderRadius: "50%",
    border:
      "2px solid #292c2e",
    borderTopColor: "#f0b90b",
    display: "inline-block",
    animation:
      "spin 0.8s linear infinite",
  },

  label: {
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    color: "#77746d",
    marginBottom: 6,
  },

  address: {
    fontSize: 12,
    color: "#7ee2a8",
    fontFamily: "monospace",
    marginBottom: 14,
    wordBreak: "break-all",
  },

  infoPanel: {
    background: "#0d0f10",
    border:
      "1px solid #25282a",
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
  },

  infoRow: {
    display: "flex",
    justifyContent:
      "space-between",
    alignItems: "flex-start",
    gap: 12,
    padding: "7px 0",
  },

  infoKey: {
    color: "#77746d",
    fontSize: 12,
  },

  infoValue: {
    color: "#e8e6e1",
    fontSize: 12,
    fontFamily: "monospace",
    textAlign: "right",
    wordBreak: "break-all",
  },

  doneBox: {
    background:
      "rgba(126,226,168,0.08)",
    border:
      "1px solid rgba(126,226,168,0.3)",
    borderRadius: 12,
    padding: 16,
  },

  doneTitle: {
    fontSize: 16,
    fontWeight: 800,
    color: "#7ee2a8",
    marginBottom: 10,
  },

  doneText: {
    fontSize: 13,
    color: "#aaa69e",
    lineHeight: 1.6,
    marginBottom: 16,
  },

  codeBox: {
    display: "block",
    background: "#0b0d0e",
    border:
      "1px solid #26282a",
    borderRadius: 8,
    padding: "11px 12px",
    fontSize: 12,
    color: "#f0b90b",
    wordBreak: "break-all",
    lineHeight: 1.5,
  },

  errorBox: {
    background: "#2a1616",
    border:
      "1px solid #4a2323",
    color: "#f0a3a3",
    padding: "14px 15px",
    borderRadius: 10,
  },

  errorTitle: {
    fontSize: 14,
    fontWeight: 800,
    color: "#ffb0b0",
    marginBottom: 8,
  },

  errorText: {
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
    fontFamily: "monospace",
    fontSize: 12,
    lineHeight: 1.6,
    color: "#ffb0b0",
    margin: 0,
  },

  link: {
    fontSize: 12,
    color: "#f0b90b",
    textDecoration: "none",
    fontWeight: 700,
  },

  linkBlock: {
    display: "block",
    marginTop: 12,
    fontSize: 12,
    color: "#f0b90b",
    textDecoration: "none",
    fontWeight: 700,
    wordBreak: "break-all",
  },
};
