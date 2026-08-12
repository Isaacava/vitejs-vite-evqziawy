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

// Safety margin for the displayed maximum fee.
// This is NOT added to the transaction itself.
// It is only used to decide whether the balance is
// comfortably above the estimated deployment fee.
const FEE_SAFETY_BPS = 2000n; // +20%

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

type Diagnostics = {
  chainId?: number;
  rawChainId?: string;
  balance?: string;
  gasEstimate?: string;
  gasPrice?: string;
  estimatedFee?: string;
  maxFeeWithBuffer?: string;
  enoughBalance?: boolean;
  shortfall?: string;
};

function normalizeChainId(value: unknown): number {
  if (typeof value === "number") {
    return value;
  }

  if (typeof value === "bigint") {
    return Number(value);
  }

  if (typeof value === "string") {
    const trimmed = value.trim();

    if (trimmed.toLowerCase().startsWith("0x")) {
      return parseInt(trimmed, 16);
    }

    const decimal = Number(trimmed);

    if (Number.isFinite(decimal)) {
      return decimal;
    }
  }

  throw new Error(
    `Unable to determine wallet chain ID. Received: ${String(
      value
    )}`
  );
}

async function getChainInfo(
  walletProvider: EIP1193Provider
) {
  const result = await walletProvider.request({
    method: "eth_chainId",
  });

  return {
    raw: String(result),
    chainId: normalizeChainId(result),
  };
}

function formatTbnb(value: bigint): string {
  return Number(formatEther(value)).toFixed(8);
}

function calculateMaxFeeWithBuffer(
  fee: bigint
): bigint {
  return (
    fee +
    (fee * FEE_SAFETY_BPS) /
      10000n
  );
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
              "Deploy JobEscrow to BNB Smart Chain Testnet",
            url: window.location.origin,
            icons: [],
          },
        });

      await wcProvider.connect();

      const accounts =
        wcProvider.accounts as string[];

      if (
        !accounts ||
        accounts.length === 0
      ) {
        throw new Error(
          "Wallet connected but no account was returned."
        );
      }

      const connectedAddress =
        accounts[0];

      const chainInfo =
        await getChainInfo(
          wcProvider as unknown as EIP1193Provider
        );

      console.log(
        "WalletConnect chain:",
        chainInfo
      );

      setAddress(connectedAddress);

      setProvider(
        wcProvider as unknown as EIP1193Provider
      );

      setDiagnostics({
        rawChainId:
          chainInfo.raw,

        chainId:
          chainInfo.chainId,
      });

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
        "Wallet connection error:",
        e
      );

      setError(formatError(e));
      setState("error");
    }
  }

  async function analyzeDeployment() {
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
      // --------------------------------------------------
      // 1. Network
      // --------------------------------------------------
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

      // --------------------------------------------------
      // 2. Balance
      // --------------------------------------------------
      const balance =
        await publicClient.getBalance({
          address:
            address as `0x${string}`,
        });

      // --------------------------------------------------
      // 3. Validate bytecode
      // --------------------------------------------------
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

      // --------------------------------------------------
      // 4. Estimate gas
      // --------------------------------------------------
      const gasEstimate =
        await publicClient.estimateGas({
          account:
            address as `0x${string}`,

          data:
            JOB_ESCROW_BYTECODE as Hex,
        });

      // --------------------------------------------------
      // 5. Current gas price
      // --------------------------------------------------
      const gasPrice =
        await publicClient.getGasPrice();

      // --------------------------------------------------
      // 6. Estimated deployment fee
      //
      // fee = gas * gas price
      // --------------------------------------------------
      const estimatedFee =
        gasEstimate * gasPrice;

      // --------------------------------------------------
      // 7. Add 20% display safety buffer
      // --------------------------------------------------
      const maxFeeWithBuffer =
        calculateMaxFeeWithBuffer(
          estimatedFee
        );

      const enoughBalance =
        balance >= maxFeeWithBuffer;

      const shortfall =
        enoughBalance
          ? 0n
          : maxFeeWithBuffer - balance;

      setDiagnostics({
        rawChainId:
          chainInfo.raw,

        chainId:
          chainInfo.chainId,

        balance:
          formatTbnb(balance),

        gasEstimate:
          gasEstimate.toString(),

        gasPrice:
          `${formatEther(gasPrice)} BNB`,

        estimatedFee:
          `${formatTbnb(
            estimatedFee
          )} tBNB`,

        maxFeeWithBuffer:
          `${formatTbnb(
            maxFeeWithBuffer
          )} tBNB`,

        enoughBalance,

        shortfall:
          shortfall > 0n
            ? `${formatTbnb(
                shortfall
              )} tBNB`
            : "0",
      });

      setState("connected");
    } catch (e) {
      console.error(
        "Deployment analysis failed:",
        e
      );

      setError(formatError(e));
      setState("error");
    }
  }

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
      // --------------------------------------------------
      // Re-check network
      // --------------------------------------------------
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

      // --------------------------------------------------
      // Get latest balance
      // --------------------------------------------------
      const balance =
        await publicClient.getBalance({
          address:
            address as `0x${string}`,
        });

      // --------------------------------------------------
      // Re-estimate gas
      // --------------------------------------------------
      const gasEstimate =
        await publicClient.estimateGas({
          account:
            address as `0x${string}`,

          data:
            JOB_ESCROW_BYTECODE as Hex,
        });

      // --------------------------------------------------
      // Get latest gas price
      // --------------------------------------------------
      const gasPrice =
        await publicClient.getGasPrice();

      const estimatedFee =
        gasEstimate * gasPrice;

      const maxFeeWithBuffer =
        calculateMaxFeeWithBuffer(
          estimatedFee
        );

      const enoughBalance =
        balance >= maxFeeWithBuffer;

      if (!enoughBalance) {
        const shortfall =
          maxFeeWithBuffer - balance;

        setDiagnostics({
          rawChainId:
            chainInfo.raw,

          chainId:
            chainInfo.chainId,

          balance:
            formatTbnb(balance),

          gasEstimate:
            gasEstimate.toString(),

          gasPrice:
            `${formatEther(
              gasPrice
            )} BNB`,

          estimatedFee:
            `${formatTbnb(
              estimatedFee
            )} tBNB`,

          maxFeeWithBuffer:
            `${formatTbnb(
              maxFeeWithBuffer
            )} tBNB`,

          enoughBalance: false,

          shortfall:
            `${formatTbnb(
              shortfall
            )} tBNB`,
        });

        throw new Error(
          `Insufficient testnet BNB.\n\nBalance: ${formatTbnb(
            balance
          )} tBNB\nEstimated fee: ${formatTbnb(
            estimatedFee
          )} tBNB\nRecommended minimum: ${formatTbnb(
            maxFeeWithBuffer
          )} tBNB\nShortfall: ${formatTbnb(
            shortfall
          )} tBNB\n\nGet more BNB Smart Chain Testnet BNB before deploying.`
        );
      }

      setDiagnostics({
        rawChainId:
          chainInfo.raw,

        chainId:
          chainInfo.chainId,

        balance:
          formatTbnb(balance),

        gasEstimate:
          gasEstimate.toString(),

        gasPrice:
          `${formatEther(
            gasPrice
          )} BNB`,

        estimatedFee:
          `${formatTbnb(
            estimatedFee
          )} tBNB`,

        maxFeeWithBuffer:
          `${formatTbnb(
            maxFeeWithBuffer
          )} tBNB`,

        enoughBalance: true,

        shortfall: "0",
      });

      // --------------------------------------------------
      // Create wallet client
      // --------------------------------------------------
      const walletClient =
        createWalletClient({
          account:
            address as `0x${string}`,

          chain:
            bscTestnet,

          transport:
            custom(provider),
        });

      // --------------------------------------------------
      // Wallet confirmation
      // --------------------------------------------------
      let hash:
        | `0x${string}`;

      try {
        hash =
          await walletClient.deployContract({
            account:
              address as `0x${string}`,

            abi:
              JOB_ESCROW_ABI,

            bytecode:
              JOB_ESCROW_BYTECODE,

            // Let the wallet/provider choose
            // the final gas settings.
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

      // --------------------------------------------------
      // Wait for receipt
      // --------------------------------------------------
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
          "Deployment succeeded, but no contract address was returned."
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

      setError(formatError(e));
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
          Deploy JobEscrow to{" "}
          <strong>
            BNB Smart Chain Testnet
          </strong>
          .
          <br />
          Chain ID: <strong>97</strong>
        </p>

        <div style={styles.card}>
          {/* ------------------------------------------ */}
          {/* IDLE */}
          {/* ------------------------------------------ */}

          {state === "idle" && (
            <>
              <div style={styles.infoBox}>
                <div style={styles.infoTitle}>
                  Testnet Deployment
                </div>

                <p style={styles.infoText}>
                  Connect the wallet that will
                  deploy the contract.
                </p>

                <p style={styles.infoText}>
                  The page will check your
                  balance and calculate the
                  deployment fee before asking
                  you to sign.
                </p>

                <a
                  href="https://testnet.bnbchain.org/faucet-smart"
                  target="_blank"
                  rel="noreferrer"
                  style={styles.link}
                >
                  Get BSC Testnet BNB ↗
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

          {/* ------------------------------------------ */}
          {/* CONNECTING */}
          {/* ------------------------------------------ */}

          {state === "connecting" && (
            <div style={styles.status}>
              <span style={styles.spinner} />
              Connecting wallet…
            </div>
          )}

          {/* ------------------------------------------ */}
          {/* CONNECTED / CHECKING / DEPLOYING */}
          {/* ------------------------------------------ */}

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
                      "—"}
                  </strong>
                </div>

                <div style={styles.infoRow}>
                  <span style={styles.infoKey}>
                    Chain ID
                  </span>

                  <strong style={styles.infoValue}>
                    {diagnostics.chainId ??
                      "—"}
                  </strong>
                </div>

                <div style={styles.infoRow}>
                  <span style={styles.infoKey}>
                    Network
                  </span>

                  <strong style={styles.successValue}>
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

                {diagnostics.gasPrice && (
                  <div style={styles.infoRow}>
                    <span style={styles.infoKey}>
                      Current gas price
                    </span>

                    <strong style={styles.infoValue}>
                      {diagnostics.gasPrice}
                    </strong>
                  </div>
                )}

                {diagnostics.estimatedFee && (
                  <div style={styles.feeRow}>
                    <span style={styles.infoKey}>
                      Estimated deployment fee
                    </span>

                    <strong style={styles.feeValue}>
                      {diagnostics.estimatedFee}
                    </strong>
                  </div>
                )}

                {diagnostics.maxFeeWithBuffer && (
                  <div style={styles.feeRow}>
                    <span style={styles.infoKey}>
                      Recommended minimum
                    </span>

                    <strong style={styles.feeValue}>
                      {diagnostics.maxFeeWithBuffer}
                    </strong>
                  </div>
                )}

                {diagnostics.enoughBalance !==
                  undefined && (
                  <div
                    style={
                      diagnostics.enoughBalance
                        ? styles.balanceGood
                        : styles.balanceBad
                    }
                  >
                    {diagnostics.enoughBalance
                      ? "✓ Balance is sufficient for the estimated deployment."
                      : "✕ Balance may be insufficient for the estimated deployment."}
                  </div>
                )}

                {diagnostics.shortfall &&
                  diagnostics.shortfall !==
                    "0" && (
                    <div style={styles.shortfall}>
                      Shortfall:{" "}
                      <strong>
                        {diagnostics.shortfall}
                      </strong>
                    </div>
                  )}
              </div>

              {/* -------------------------------------- */}
              {/* CONNECTED */}
              {/* -------------------------------------- */}

              {state === "connected" && (
                <>
                  <button
                    style={
                      styles.secondaryButton
                    }
                    onClick={
                      analyzeDeployment
                    }
                  >
                    Check Deployment Cost
                  </button>

                  {diagnostics.enoughBalance &&
                    diagnostics.balance &&
                    diagnostics.estimatedFee && (
                      <button
                        style={
                          styles.primaryButton
                        }
                        onClick={deploy}
                      >
                        Deploy JobEscrow
                      </button>
                    )}

                  {!diagnostics.enoughBalance &&
                    diagnostics.balance && (
                      <div
                        style={
                          styles.warningBox
                        }
                      >
                        You need more testnet BNB
                        before deployment can
                        continue.
                      </div>
                    )}
                </>
              )}

              {/* -------------------------------------- */}
              {/* CHECKING */}
              {/* -------------------------------------- */}

              {state === "checking" && (
                <div style={styles.status}>
                  <span style={styles.spinner} />
                  Calculating deployment gas and
                  fee…
                </div>
              )}

              {/* -------------------------------------- */}
              {/* DEPLOYING */}
              {/* -------------------------------------- */}

              {state === "deploying" && (
                <div style={styles.status}>
                  <span style={styles.spinner} />
                  Confirm the deployment in your
                  wallet…
                </div>
              )}

              {/* -------------------------------------- */}
              {/* CONFIRMING */}
              {/* -------------------------------------- */}

              {state === "confirming" && (
                <>
                  <div style={styles.status}>
                    <span style={styles.spinner} />
                    Waiting for blockchain
                    confirmation…
                  </div>

                  {txHash && (
                    <a
                      href={`https://testnet.bscscan.com/tx/${txHash}`}
                      target="_blank"
                      rel="noreferrer"
                      style={
                        styles.linkBlock
                      }
                    >
                      View transaction on
                      BscScan ↗
                    </a>
                  )}
                </>
              )}
            </>
          )}

          {/* ------------------------------------------ */}
          {/* SUCCESS */}
          {/* ------------------------------------------ */}

          {state === "done" &&
            contractAddress && (
              <div style={styles.doneBox}>
                <div style={styles.doneTitle}>
                  ✓ JobEscrow deployed
                  successfully
                </div>

                <p style={styles.doneText}>
                  The smart contract has been
                  successfully deployed to BNB
                  Smart Chain Testnet.
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
                    style={
                      styles.linkBlock
                    }
                  >
                    View deployment transaction
                    ↗
                  </a>
                )}

                <a
                  href={`https://testnet.bscscan.com/address/${contractAddress}`}
                  target="_blank"
                  rel="noreferrer"
                  style={
                    styles.linkBlock
                  }
                >
                  View contract on BscScan ↗
                </a>
              </div>
            )}

          {/* ------------------------------------------ */}
          {/* ERROR */}
          {/* ------------------------------------------ */}

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
    maxWidth: 560,
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

  feeRow: {
    display: "flex",
    justifyContent:
      "space-between",
    alignItems: "flex-start",
    gap: 12,
    padding: "9px 0",
    marginTop: 4,
    borderTop:
      "1px solid #25282a",
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

  successValue: {
    color: "#7ee2a8",
    fontSize: 12,
    fontFamily: "monospace",
    textAlign: "right",
  },

  feeValue: {
    color: "#f0b90b",
    fontSize: 12,
    fontWeight: 800,
    fontFamily: "monospace",
    textAlign: "right",
  },

  balanceGood: {
    marginTop: 12,
    padding: 10,
    borderRadius: 8,
    background:
      "rgba(126,226,168,0.08)",
    color: "#7ee2a8",
    fontSize: 12,
    lineHeight: 1.5,
  },

  balanceBad: {
    marginTop: 12,
    padding: 10,
    borderRadius: 8,
    background:
      "rgba(240,100,100,0.08)",
    color: "#ff9c9c",
    fontSize: 12,
    lineHeight: 1.5,
  },

  shortfall: {
    marginTop: 8,
    color: "#ff9c9c",
    fontSize: 12,
  },

  warningBox: {
    marginTop: 12,
    padding: 12,
    borderRadius: 10,
    background:
      "rgba(240,185,11,0.07)",
    border:
      "1px solid rgba(240,185,11,0.2)",
    color: "#d8c78c",
    fontSize: 12,
    lineHeight: 1.5,
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
