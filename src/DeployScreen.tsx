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

const publicClient = createPublicClient({
  chain: bscTestnet,
  transport: http(),
});

/**
 * Handles both:
 *
 * "0x61" -> 97
 * "97"   -> 97
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
    const trimmed = value.trim();

    if (trimmed.startsWith("0x")) {
      return parseInt(trimmed, 16);
    }

    return Number(trimmed);
  }

  throw new Error(
    `Unable to determine wallet chain ID. Received: ${String(
      value
    )}`
  );
}

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

export default function DeployScreen() {
  const [state, setState] =
    useState<DeployState>("idle");

  const [provider, setProvider] =
    useState<EIP1193Provider | null>(null);

  const [address, setAddress] =
    useState<string | null>(null);

  const [txHash, setTxHash] =
    useState<string | null>(null);

  const [contractAddress, setContractAddress] =
    useState<string | null>(null);

  const [error, setError] =
    useState<string | null>(null);

  const [diagnostics, setDiagnostics] =
    useState<Diagnostics>({});

  /**
   * Read the chain from the connected provider.
   */
  async function getProviderChainId(
    walletProvider: EIP1193Provider
  ) {
    const result = await walletProvider.request({
      method: "eth_chainId",
    });

    const normalized = normalizeChainId(result);

    return {
      raw: String(result),
      normalized,
    };
  }

  /**
   * Connect wallet specifically for BSC Testnet.
   */
  async function connectWallet() {
    setState("connecting");
    setError(null);
    setDiagnostics({});
    setTxHash(null);
    setContractAddress(null);

    try {
      const wcProvider =
        await EthereumProvider.init({
          projectId:
            WALLETCONNECT_PROJECT_ID,

          chains: [BSC_TESTNET_CHAIN_ID],

          optionalChains: [
            BSC_TESTNET_CHAIN_ID,
          ],

          showQrModal: true,

          metadata: {
            name: "JobEscrow Deployer",

            description:
              "Deploy JobEscrow to BNB Smart Chain Testnet",

            url: window.location.origin,

            icons: [],
          },
        });

      await wcProvider.connect({
        chains: [BSC_TESTNET_CHAIN_ID],
      });

      const accounts =
        wcProvider.accounts as string[];

      if (!accounts || accounts.length === 0) {
        throw new Error(
          "Wallet connected but no account was returned."
        );
      }

      const connectedAddress =
        accounts[0];

      const chain =
        await getProviderChainId(
          wcProvider as unknown as EIP1193Provider
        );

      console.log(
        "WalletConnect raw chain ID:",
        chain.raw
      );

      console.log(
        "WalletConnect normalized chain ID:",
        chain.normalized
      );

      setProvider(
        wcProvider as unknown as EIP1193Provider
      );

      setAddress(connectedAddress);

      setDiagnostics({
        chainId: chain.normalized,
        rawChainId: chain.raw,
      });

      /**
       * IMPORTANT:
       *
       * Do not treat "97" as hexadecimal.
       * normalizeChainId() handles both formats.
       */
      if (
        chain.normalized !==
        BSC_TESTNET_CHAIN_ID
      ) {
        throw new Error(
          `Wrong network. Wallet reports chain ID ${chain.normalized}. BNB Smart Chain Testnet requires chain ID 97.`
        );
      }

      setState("connected");
    } catch (err) {
      console.error(
        "Wallet connection error:",
        err
      );

      setError(formatError(err));
      setState("error");
    }
  }

  /**
   * Check everything before deployment.
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
      const chain =
        await getProviderChainId(provider);

      console.log(
        "Checking chain:",
        chain
      );

      if (
        chain.normalized !==
        BSC_TESTNET_CHAIN_ID
      ) {
        throw new Error(
          `Wrong network. Wallet reports chain ID ${chain.normalized}. BNB Smart Chain Testnet requires 97.`
        );
      }

      /**
       * Get wallet balance.
       */
      const balance =
        await publicClient.getBalance({
          address:
            address as `0x${string}`,
        });

      const balanceFormatted =
        formatEther(balance);

      if (balance === 0n) {
        throw new Error(
          "Your wallet has 0 BNB on BNB Smart Chain Testnet. Get testnet BNB before deploying."
        );
      }

      /**
       * Validate bytecode.
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
        chainId: chain.normalized,

        rawChainId: chain.raw,

        balance:
          balanceFormatted,

        gasEstimate:
          gasEstimate.toString(),
      });

      setState("connected");
    } catch (err) {
      console.error(
        "Deployment check failed:",
        err
      );

      setError(formatError(err));
      setState("error");
    }
  }

  /**
   * Deploy JobEscrow.
   */
  async function deployContract() {
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
       * Verify chain immediately before
       * asking the wallet to sign.
       */
      const chain =
        await getProviderChainId(provider);

      console.log(
        "Deployment chain:",
        chain
      );

      if (
        chain.normalized !==
        BSC_TESTNET_CHAIN_ID
      ) {
        throw new Error(
          `Wrong network. Wallet reports chain ID ${chain.normalized}. BNB Smart Chain Testnet requires 97.`
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
       * Estimate gas.
       */
      const gasEstimate =
        await publicClient.estimateGas({
          account:
            address as `0x${string}`,

          data:
            JOB_ESCROW_BYTECODE as Hex,
        });

      setDiagnostics({
        chainId: chain.normalized,

        rawChainId: chain.raw,

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
       * Wait for mining.
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
    } catch (err) {
      console.error(
        "Deployment failed:",
        err
      );

      setError(formatError(err));

      setState("error");
    }
  }

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
          JobEscrow Deployment
        </h1>

        <p style={styles.subtitle}>
          Deploy the JobEscrow smart contract
          to BNB Smart Chain Testnet.
          <br />
          Required chain ID:{" "}
          <strong>97</strong>
        </p>

        <div style={styles.card}>
          {state === "idle" && (
            <>
              <div style={styles.infoBox}>
                <strong>
                  BNB Smart Chain Testnet
                </strong>

                <p>
                  Connect your wallet and deploy
                  JobEscrow using testnet BNB.
                </p>

                <a
                  href="https://testnet.bnbchain.org/faucet-smart"
                  target="_blank"
                  rel="noreferrer"
                  style={styles.link}
                >
                  Get Testnet BNB ↗
                </a>
              </div>

              <button
                style={styles.primaryButton}
                onClick={connectWallet}
              >
                Connect Wallet
              </button>
            </>
          )}

          {state === "connecting" && (
            <div style={styles.status}>
              Connecting wallet…
            </div>
          )}

          {(
            state === "connected" ||
            state === "checking" ||
            state === "deploying" ||
            state === "confirming"
          ) && (
            <>
              <div style={styles.label}>
                Wallet
              </div>

              <div style={styles.address}>
                {address}
              </div>

              <div style={styles.infoPanel}>
                <div>
                  <span>
                    Raw chain ID:
                  </span>

                  <strong>
                    {diagnostics.rawChainId ??
                      "97"}
                  </strong>
                </div>

                <div>
                  <span>
                    Normalized chain ID:
                  </span>

                  <strong>
                    {diagnostics.chainId ??
                      "97"}
                  </strong>
                </div>

                <div>
                  <span>
                    Network:
                  </span>

                  <strong>
                    BNB Smart Chain Testnet
                  </strong>
                </div>

                {diagnostics.balance && (
                  <div>
                    <span>
                      Testnet BNB:
                    </span>

                    <strong>
                      {diagnostics.balance}
                    </strong>
                  </div>
                )}

                {diagnostics.gasEstimate && (
                  <div>
                    <span>
                      Estimated gas:
                    </span>

                    <strong>
                      {diagnostics.gasEstimate}
                    </strong>
                  </div>
                )}
              </div>

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
                        onClick={
                          deployContract
                        }
                      >
                        Deploy JobEscrow
                      </button>
                    )}
                </>
              )}

              {state === "checking" && (
                <div style={styles.status}>
                  Checking network, balance,
                  bytecode and gas…
                </div>
              )}

              {state === "deploying" && (
                <div style={styles.status}>
                  Confirm the deployment in
                  your wallet…
                </div>
              )}

              {state === "confirming" && (
                <>
                  <div style={styles.status}>
                    Deployment submitted.
                    Waiting for blockchain
                    confirmation…
                  </div>

                  {txHash && (
                    <a
                      href={`https://testnet.bscscan.com/tx/${txHash}`}
                      target="_blank"
                      rel="noreferrer"
                      style={styles.linkBlock}
                    >
                      View transaction on
                      BscScan ↗
                    </a>
                  )}
                </>
              )}
            </>
          )}

          {state === "done" &&
            contractAddress && (
              <div style={styles.successBox}>
                <h2>
                  Contract deployed successfully
                </h2>

                <p>
                  JobEscrow is now deployed on
                  BNB Smart Chain Testnet.
                </p>

                <div style={styles.label}>
                  Contract address
                </div>

                <code style={styles.code}>
                  {contractAddress}
                </code>

                <button
                  style={styles.secondaryButton}
                  onClick={() =>
                    navigator.clipboard.writeText(
                      contractAddress
                    )
                  }
                >
                  Copy Address
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
                  View contract on BscScan ↗
                </a>
              </div>
            )}

          {state === "error" && (
            <div style={styles.errorBox}>
              <h2>
                Deployment Error
              </h2>

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

/* ========================================================= */
/* ERROR HANDLING                                             */
/* ========================================================= */

function formatError(
  error: unknown
): string {
  if (
    error instanceof Error
  ) {
    return error.message;
  }

  if (
    typeof error === "string"
  ) {
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

/* ========================================================= */
/* STYLES                                                     */
/* ========================================================= */

const styles: Record<
  string,
  React.CSSProperties
> = {
  page: {
    minHeight: "100vh",
    background: "#0b0d0e",
    color: "#f1f1f1",
    padding: "32px 20px",
    boxSizing: "border-box",
    fontFamily:
      "Inter, system-ui, sans-serif",
  },

  container: {
    maxWidth: 560,
    margin: "0 auto",
  },

  title: {
    fontSize: 28,
    fontWeight: 800,
    marginBottom: 8,
  },

  subtitle: {
    color: "#999",
    lineHeight: 1.6,
    marginBottom: 24,
  },

  card: {
    background: "#131516",
    border: "1px solid #292d2f",
    borderRadius: 16,
    padding: 20,
  },

  infoBox: {
    background: "#191a1c",
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    color: "#aaa",
    lineHeight: 1.6,
  },

  primaryButton: {
    width: "100%",
    marginTop: 12,
    padding: "14px 16px",
    border: 0,
    borderRadius: 10,
    background: "#f0b90b",
    color: "#111",
    fontWeight: 800,
    fontSize: 14,
    cursor: "pointer",
  },

  secondaryButton: {
    width: "100%",
    marginTop: 12,
    padding: "13px 16px",
    borderRadius: 10,
    border: "1px solid #34383a",
    background: "#1b1e20",
    color: "#fff",
    fontWeight: 700,
    fontSize: 14,
    cursor: "pointer",
  },

  status: {
    padding: "14px 0",
    color: "#aaa",
    lineHeight: 1.6,
  },

  label: {
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    color: "#777",
    marginBottom: 6,
  },

  address: {
    fontFamily: "monospace",
    fontSize: 12,
    color: "#74e3a0",
    wordBreak: "break-all",
    marginBottom: 16,
  },

  infoPanel: {
    background: "#0d0f10",
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
  },

  infoPanelRow: {},

  infoPanel: {
    background: "#0d0f10",
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
  },

  successBox: {
    background:
      "rgba(70, 190, 120, 0.08)",
    border:
      "1px solid rgba(70, 190, 120, 0.3)",
    borderRadius: 12,
    padding: 16,
  },

  errorBox: {
    background:
      "rgba(220, 70, 70, 0.08)",
    border:
      "1px solid rgba(220, 70, 70, 0.3)",
    borderRadius: 12,
    padding: 16,
  },

  errorText: {
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
    fontFamily: "monospace",
    fontSize: 12,
    lineHeight: 1.6,
    color: "#ffb0b0",
  },

  code: {
    display: "block",
    background: "#0c0e0f",
    borderRadius: 8,
    padding: 12,
    fontSize: 12,
    wordBreak: "break-all",
    color: "#f0b90b",
  },

  link: {
    color: "#f0b90b",
    textDecoration: "none",
    fontWeight: 700,
  },

  linkBlock: {
    display: "block",
    marginTop: 12,
    color: "#f0b90b",
    textDecoration: "none",
    fontWeight: 700,
    fontSize: 13,
  },
};
