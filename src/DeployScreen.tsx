import { useState } from "react";
import {
  createPublicClient,
  formatEther,
  http,
  type EIP1193Provider,
  type Hex,
} from "viem";
import { bscTestnet } from "viem/chains";
import { EthereumProvider } from "@walletconnect/ethereum-provider";
import {
  JOB_ESCROW_BYTECODE,
} from "./contractArtifacts";

const WALLETCONNECT_PROJECT_ID =
  "1dbe8fd5e4974ae7c80d074c4082b5a0";

const BSC_TESTNET_CHAIN_ID = 97;

const FEE_SAFETY_BPS = 2000n;

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
  rawChainId?: string;
  chainId?: number;
  balance?: string;
  gasEstimate?: string;
  gasPrice?: string;
  estimatedFee?: string;
  recommendedMinimum?: string;
  enoughBalance?: boolean;
  approvedSession?: string;
};

type WalletConnectSessionInfo = {
  approvedChains: string[];
};

function normalizeChainId(
  value: unknown
): number {
  if (typeof value === "number") {
    return value;
  }

  if (typeof value === "bigint") {
    return Number(value);
  }

  if (typeof value === "string") {
    const trimmed = value.trim();

    if (
      trimmed
        .toLowerCase()
        .startsWith("0x")
    ) {
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
  provider: EIP1193Provider
) {
  const result =
    await provider.request({
      method: "eth_chainId",
    });

  return {
    raw: String(result),
    chainId:
      normalizeChainId(result),
  };
}

function formatTbnb(
  value: bigint
): string {
  return Number(
    formatEther(value)
  ).toFixed(8);
}

function addSafetyMargin(
  fee: bigint
): bigint {
  return (
    fee +
    (fee * FEE_SAFETY_BPS) /
      10000n
  );
}

function toRpcQuantity(
  value: bigint
): `0x${string}` {
  return `0x${value.toString(
    16
  )}`;
}

function getApprovedChains(
  session: WalletConnectSessionInfo | null
): string[] {
  return session?.approvedChains ?? [];
}

export default function DeployScreen() {
  const [state, setState] =
    useState<DeployState>(
      "idle"
    );

  const [provider, setProvider] =
    useState<EIP1193Provider | null>(
      null
    );

  const [
    sessionInfo,
    setSessionInfo,
  ] =
    useState<WalletConnectSessionInfo | null>(
      null
    );

  const [address, setAddress] =
    useState<string | null>(
      null
    );

  const [txHash, setTxHash] =
    useState<string | null>(
      null
    );

  const [
    contractAddress,
    setContractAddress,
  ] =
    useState<string | null>(
      null
    );

  const [error, setError] =
    useState<string | null>(
      null
    );

  const [
    diagnostics,
    setDiagnostics,
  ] =
    useState<Diagnostics>(
      {}
    );

  async function connect() {
    setState(
      "connecting"
    );

    setError(null);
    setTxHash(null);
    setContractAddress(
      null
    );
    setDiagnostics({});

    try {
      const wcProvider =
        await EthereumProvider.init(
          {
            projectId:
              WALLETCONNECT_PROJECT_ID,

            optionalChains: [
              BSC_TESTNET_CHAIN_ID,
            ],

            showQrModal: true,

            metadata: {
              name:
                "JobEscrow Deployer",

              description:
                "Deploy JobEscrow to BNB Smart Chain Testnet",

              url:
                window.location
                  .origin,

              icons: [],
            },

            rpcMap: {
              [BSC_TESTNET_CHAIN_ID]:
                "https://data-seed-prebsc-1-s1.bnbchain.org:8545",
            },
          }
        );

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

      const walletProvider =
        wcProvider as unknown as EIP1193Provider;

      const chainInfo =
        await getChainInfo(
          walletProvider
        );

      console.log(
        "WalletConnect chain:",
        chainInfo
      );

      /*
       * Read the approved WalletConnect
       * session namespaces.
       */
      const namespace =
        wcProvider.session
          ?.namespaces?.eip155;

      const approvedAccounts: string[] =
        Array.isArray(
          namespace?.accounts
        )
          ? namespace.accounts
          : [];

      const approvedChains =
        approvedAccounts.map(
          (
            account: string
          ) => {
            const parts =
              account.split(
                ":"
              );

            if (
              parts.length >= 2
            ) {
              return `eip155:${parts[1]}`;
            }

            return account;
          }
        );

      console.log(
        "Approved WalletConnect chains:",
        approvedChains
      );

      if (
        chainInfo.chainId !==
        BSC_TESTNET_CHAIN_ID
      ) {
        throw new Error(
          [
            "Wallet is not connected to BNB Smart Chain Testnet.",
            "",
            `Provider chain ID: ${chainInfo.chainId}`,
            `Required chain ID: ${BSC_TESTNET_CHAIN_ID}`,
            "",
            "Switch the wallet to BNB Smart Chain Testnet and reconnect.",
          ].join("\n")
        );
      }

      if (
        approvedChains.length >
          0 &&
        !approvedChains.includes(
          `eip155:${BSC_TESTNET_CHAIN_ID}`
        )
      ) {
        throw new Error(
          [
            "The WalletConnect session was not approved for BSC Testnet.",
            "",
            `Approved chains: ${approvedChains.join(
              ", "
            )}`,
            "",
            "Disconnect the existing WalletConnect session and reconnect.",
          ].join("\n")
        );
      }

      const nextSessionInfo: WalletConnectSessionInfo =
        {
          approvedChains,
        };

      setAddress(
        connectedAddress
      );

      setProvider(
        walletProvider
      );

      setSessionInfo(
        nextSessionInfo
      );

      setDiagnostics({
        rawChainId:
          chainInfo.raw,

        chainId:
          chainInfo.chainId,

        approvedSession:
          approvedChains.length >
          0
            ? approvedChains.join(
                ", "
              )
            : "Unavailable",
      });

      setState(
        "connected"
      );
    } catch (e) {
      console.error(
        "WalletConnect connection error:",
        e
      );

      setError(
        formatError(e)
      );

      setState("error");
    }
  }

  async function analyzeDeployment() {
    if (
      !provider ||
      !address
    ) {
      setError(
        "Connect your wallet before checking deployment."
      );

      setState("error");

      return;
    }

    setState("checking");
    setError(null);

    try {
      const chainInfo =
        await getChainInfo(
          provider
        );

      if (
        chainInfo.chainId !==
        BSC_TESTNET_CHAIN_ID
      ) {
        throw new Error(
          `Wrong network. Current wallet chain is ${chainInfo.chainId}; BNB Smart Chain Testnet requires 97.`
        );
      }

      if (
        !JOB_ESCROW_BYTECODE ||
        !JOB_ESCROW_BYTECODE.startsWith(
          "0x"
        )
      ) {
        throw new Error(
          "JobEscrow deployment bytecode is missing or invalid."
        );
      }

      const balance =
        await publicClient.getBalance(
          {
            address:
              address as `0x${string}`,
          }
        );

      const gasEstimate =
        await publicClient.estimateGas(
          {
            account:
              address as `0x${string}`,

            data:
              JOB_ESCROW_BYTECODE as Hex,
          }
        );

      const gasPrice =
        await publicClient.getGasPrice();

      const estimatedFee =
        gasEstimate *
        gasPrice;

      const recommendedMinimum =
        addSafetyMargin(
          estimatedFee
        );

      const enoughBalance =
        balance >=
        recommendedMinimum;

      setDiagnostics(
        (
          previous
        ) => ({
          ...previous,

          rawChainId:
            chainInfo.raw,

          chainId:
            chainInfo.chainId,

          balance:
            `${formatTbnb(
              balance
            )} tBNB`,

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

          recommendedMinimum:
            `${formatTbnb(
              recommendedMinimum
            )} tBNB`,

          enoughBalance,
        })
      );

      setState(
        "connected"
      );
    } catch (e) {
      console.error(
        "Deployment analysis failed:",
        e
      );

      setError(
        formatError(e)
      );

      setState("error");
    }
  }

  async function deploy() {
    if (
      !provider ||
      !address
    ) {
      setError(
        "Wallet is not connected."
      );

      setState("error");

      return;
    }

    setState("deploying");
    setError(null);

    try {
      /*
       * -----------------------------------------
       * 1. Check chain again.
       * -----------------------------------------
       */
      const chainInfo =
        await getChainInfo(
          provider
        );

      if (
        chainInfo.chainId !==
        BSC_TESTNET_CHAIN_ID
      ) {
        throw new Error(
          `Wrong network. Current wallet chain is ${chainInfo.chainId}; BNB Smart Chain Testnet requires 97.`
        );
      }

      /*
       * -----------------------------------------
       * 2. Check WalletConnect session.
       * -----------------------------------------
       */
      const approvedChains =
        getApprovedChains(
          sessionInfo
        );

      if (
        approvedChains.length >
          0 &&
        !approvedChains.includes(
          `eip155:${BSC_TESTNET_CHAIN_ID}`
        )
      ) {
        throw new Error(
          [
            "WalletConnect session is not approved for BSC Testnet.",
            "",
            `Approved chains: ${approvedChains.join(
              ", "
            )}`,
            "",
            "Disconnect and reconnect the wallet on BSC Testnet.",
          ].join("\n")
        );
      }

      /*
       * -----------------------------------------
       * 3. Check balance.
       * -----------------------------------------
       */
      const balance =
        await publicClient.getBalance(
          {
            address:
              address as `0x${string}`,
          }
        );

      /*
       * -----------------------------------------
       * 4. Estimate gas.
       * -----------------------------------------
       */
      const gasEstimate =
        await publicClient.estimateGas(
          {
            account:
              address as `0x${string}`,

            data:
              JOB_ESCROW_BYTECODE as Hex,
          }
        );

      /*
       * -----------------------------------------
       * 5. Current gas price.
       * -----------------------------------------
       */
      const gasPrice =
        await publicClient.getGasPrice();

      /*
       * -----------------------------------------
       * 6. Calculate deployment cost.
       * -----------------------------------------
       */
      const estimatedFee =
        gasEstimate *
        gasPrice;

      const recommendedMinimum =
        addSafetyMargin(
          estimatedFee
        );

      if (
        balance <
        recommendedMinimum
      ) {
        throw new Error(
          [
            "Insufficient testnet BNB.",
            "",
            `Balance: ${formatTbnb(
              balance
            )} tBNB`,
            `Estimated fee: ${formatTbnb(
              estimatedFee
            )} tBNB`,
            `Recommended minimum: ${formatTbnb(
              recommendedMinimum
            )} tBNB`,
          ].join("\n")
        );
      }

      setDiagnostics(
        (
          previous
        ) => ({
          ...previous,

          rawChainId:
            chainInfo.raw,

          chainId:
            chainInfo.chainId,

          balance:
            `${formatTbnb(
              balance
            )} tBNB`,

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

          recommendedMinimum:
            `${formatTbnb(
              recommendedMinimum
            )} tBNB`,

          enoughBalance:
            true,
        })
      );

      /*
       * -----------------------------------------
       * 7. Build raw EIP-1193 transaction.
       *
       * No "to" field means contract creation.
       * -----------------------------------------
       */
      const transaction = {
        from:
          address as `0x${string}`,

        data:
          JOB_ESCROW_BYTECODE as Hex,

        gas:
          toRpcQuantity(
            gasEstimate
          ),

        gasPrice:
          toRpcQuantity(
            gasPrice
          ),

        value:
          "0x0" as const,
      };

      console.log(
        "Raw deployment transaction:",
        transaction
      );

      /*
       * EIP-1193 providers support
       * eth_sendTransaction, but the exact
       * TypeScript overload exposed by the
       * provider package is too narrow for this
       * raw contract-creation request.
       *
       * The runtime call is still standard
       * EIP-1193.
       */
      const eip1193 =
        provider as EIP1193Provider & {
          request: (
            args: {
              method: string;
              params?: unknown[];
            }
          ) => Promise<unknown>;
        };

      let hash: string;

      try {
        const result =
          await eip1193.request(
            {
              method:
                "eth_sendTransaction",

              params: [
                transaction,
              ],
            }
          );

        hash =
          String(result);
      } catch (walletError) {
        console.error(
          "Wallet transaction error:",
          walletError
        );

        throw new Error(
          [
            "Wallet rejected or failed the raw deployment transaction.",
            "",
            formatError(
              walletError
            ),
            "",
            "The request was sent directly using EIP-1193 eth_sendTransaction.",
          ].join("\n")
        );
      }

      if (
        !hash ||
        hash === "undefined" ||
        hash === "null"
      ) {
        throw new Error(
          "Wallet did not return a transaction hash."
        );
      }

      setTxHash(
        hash
      );

      setState(
        "confirming"
      );

      /*
       * -----------------------------------------
       * 8. Wait for the blockchain receipt.
       * -----------------------------------------
       */
      const receipt =
        await publicClient.waitForTransactionReceipt(
          {
            hash:
              hash as `0x${string}`,
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
          "The deployment transaction was mined but failed."
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

      setState(
        "done"
      );
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

  function reset() {
    setError(null);
    setTxHash(null);
    setContractAddress(
      null
    );
    setDiagnostics({});

    if (
      provider &&
      address
    ) {
      setState(
        "connected"
      );
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
          Deploy JobEscrow to BNB Smart Chain
          Testnet.
          <br />
          Required chain ID:
          <strong> 97</strong>
        </p>

        <div style={styles.card}>
          {state === "idle" && (
            <>
              <div style={styles.infoBox}>
                <div
                  style={
                    styles.infoTitle
                  }
                >
                  Testnet Deployment
                </div>

                <p
                  style={
                    styles.infoText
                  }
                >
                  Connect your wallet. The
                  application will verify the
                  network, WalletConnect session,
                  balance and gas cost before
                  requesting the deployment
                  signature.
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
                style={
                  styles.primaryButton
                }
                onClick={connect}
              >
                Connect Wallet
              </button>
            </>
          )}

          {state ===
            "connecting" && (
            <div style={styles.status}>
              <span
                style={styles.spinner}
              />
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
                Connected wallet
              </div>

              <div style={styles.address}>
                {address}
              </div>

              <div
                style={
                  styles.infoPanel
                }
              >
                <InfoRow
                  label="Raw chain ID"
                  value={
                    diagnostics.rawChainId ??
                    "—"
                  }
                />

                <InfoRow
                  label="Chain ID"
                  value={
                    diagnostics.chainId !==
                    undefined
                      ? String(
                          diagnostics.chainId
                        )
                      : "—"
                  }
                />

                <InfoRow
                  label="Network"
                  value="BNB Smart Chain Testnet"
                  success
                />

                <InfoRow
                  label="Approved session"
                  value={
                    diagnostics.approvedSession ??
                    "—"
                  }
                />

                {diagnostics.balance && (
                  <InfoRow
                    label="Testnet BNB"
                    value={
                      diagnostics.balance
                    }
                  />
                )}

                {diagnostics.gasEstimate && (
                  <InfoRow
                    label="Estimated gas"
                    value={
                      diagnostics.gasEstimate
                    }
                  />
                )}

                {diagnostics.gasPrice && (
                  <InfoRow
                    label="Gas price"
                    value={
                      diagnostics.gasPrice
                    }
                  />
                )}

                {diagnostics.estimatedFee && (
                  <InfoRow
                    label="Estimated deployment fee"
                    value={
                      diagnostics.estimatedFee
                    }
                    highlighted
                  />
                )}

                {diagnostics.recommendedMinimum && (
                  <InfoRow
                    label="Recommended minimum"
                    value={
                      diagnostics.recommendedMinimum
                    }
                    highlighted
                  />
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
                      ? "✓ Balance is sufficient."
                      : "✕ Balance is insufficient."}
                  </div>
                )}
              </div>

              {state ===
                "connected" && (
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

                  {diagnostics.enoughBalance && (
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

              {state ===
                "checking" && (
                <div style={styles.status}>
                  <span
                    style={
                      styles.spinner
                    }
                  />
                  Calculating deployment cost…
                </div>
              )}

              {state ===
                "deploying" && (
                <div style={styles.status}>
                  <span
                    style={
                      styles.spinner
                    }
                  />
                  Confirm the contract deployment
                  in your wallet…
                </div>
              )}

              {state ===
                "confirming" && (
                <>
                  <div style={styles.status}>
                    <span
                      style={
                        styles.spinner
                      }
                    />
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
                      View transaction on BscScan ↗
                    </a>
                  )}
                </>
              )}
            </>
          )}

          {state === "done" &&
            contractAddress && (
              <div style={styles.doneBox}>
                <div
                  style={
                    styles.doneTitle
                  }
                >
                  ✓ JobEscrow deployed
                  successfully
                </div>

                <p
                  style={
                    styles.doneText
                  }
                >
                  The contract has been successfully
                  deployed to BNB Smart Chain Testnet.
                </p>

                <div style={styles.label}>
                  Contract address
                </div>

                <code
                  style={
                    styles.codeBox
                  }
                >
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
                    View deployment transaction ↗
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

          {state === "error" && (
            <div style={styles.errorBox}>
              <div
                style={
                  styles.errorTitle
                }
              >
                Deployment Error
              </div>

              <pre
                style={
                  styles.errorText
                }
              >
                {error}
              </pre>

              <button
                style={
                  styles.primaryButton
                }
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

function InfoRow({
  label,
  value,
  success = false,
  highlighted = false,
}: {
  label: string;
  value: string;
  success?: boolean;
  highlighted?: boolean;
}) {
  return (
    <div style={styles.infoRow}>
      <span style={styles.infoKey}>
        {label}
      </span>

      <strong
        style={
          success
            ? styles.successValue
            : highlighted
            ? styles.highlightValue
            : styles.infoValue
        }
      >
        {value}
      </strong>
    </div>
  );
}

function formatError(
  error: unknown
): string {
  if (error instanceof Error) {
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
    fontSize: 27,
    fontWeight: 800,
    margin: "0 0 8px",
  },

  subtitle: {
    fontSize: 13,
    color: "#8b8982",
    lineHeight: 1.6,
    marginBottom: 24,
  },

  card: {
    background: "#111314",
    border:
      "1px solid #272a2c",
    borderRadius: 15,
    padding: 20,
  },

  infoBox: {
    background: "#17191a",
    border:
      "1px solid #2a2d2f",
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
    background: "#1b1e20",
    border:
      "1px solid #363a3c",
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
    color: "#a8a49c",
    fontSize: 13,
    lineHeight: 1.5,
    padding: "6px 0",
  },

  spinner: {
    width: 14,
    height: 14,
    minWidth: 14,
    borderRadius: "50%",
    border:
      "2px solid #2b2e30",
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
    fontFamily: "monospace",
    fontSize: 12,
    color: "#7ee2a8",
    wordBreak: "break-all",
    marginBottom: 15,
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

  successValue: {
    color: "#7ee2a8",
    fontSize: 12,
    fontFamily: "monospace",
    textAlign: "right",
    wordBreak: "break-all",
  },

  highlightValue: {
    color: "#f0b90b",
    fontSize: 12,
    fontFamily: "monospace",
    textAlign: "right",
    wordBreak: "break-all",
  },

  balanceGood: {
    marginTop: 10,
    padding: 10,
    borderRadius: 8,
    background:
      "rgba(126,226,168,0.08)",
    color: "#7ee2a8",
    fontSize: 12,
  },

  balanceBad: {
    marginTop: 10,
    padding: 10,
    borderRadius: 8,
    background:
      "rgba(255,100,100,0.08)",
    color: "#ff9c9c",
    fontSize: 12,
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
    color: "#7ee2a8",
    fontWeight: 800,
    fontSize: 16,
    marginBottom: 8,
  },

  doneText: {
    color: "#aaa69e",
    fontSize: 13,
    lineHeight: 1.6,
  },

  codeBox: {
    display: "block",
    background: "#0b0d0e",
    border:
      "1px solid #292c2e",
    borderRadius: 8,
    padding: 12,
    color: "#f0b90b",
    fontSize: 12,
    fontFamily: "monospace",
    wordBreak: "break-all",
  },

  errorBox: {
    background: "#2a1616",
    border:
      "1px solid #4d2626",
    borderRadius: 11,
    padding: 15,
  },

  errorTitle: {
    color: "#ffb0b0",
    fontSize: 14,
    fontWeight: 800,
    marginBottom: 8,
  },

  errorText: {
    color: "#ffb0b0",
    fontFamily: "monospace",
    fontSize: 12,
    lineHeight: 1.6,
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
    margin: 0,
  },

  link: {
    color: "#f0b90b",
    textDecoration: "none",
    fontWeight: 700,
    fontSize: 12,
  },

  linkBlock: {
    display: "block",
    color: "#f0b90b",
    textDecoration: "none",
    fontWeight: 700,
    fontSize: 12,
    marginTop: 12,
    wordBreak: "break-all",
  },
};
