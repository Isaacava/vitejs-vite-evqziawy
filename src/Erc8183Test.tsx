import { useState } from "react";
import {
  createWalletClient,
  custom,
  formatUnits,
  type Address,
  type EIP1193Provider,
} from "viem";
import { EthereumProvider } from "@walletconnect/ethereum-provider";

import {
  ERC8183_ADDRESSES,
  COMMERCE_ABI,
  ERC20_ABI,
  publicClient,
} from "./lib/erc8183";

const WALLETCONNECT_PROJECT_ID =
  "1dbe8fd5e4974ae7c80d074c4082b5a0";

const BSC_TESTNET_CHAIN_ID = 97;

type WalletState =
  | "disconnected"
  | "connecting"
  | "connected";

export default function Erc8183Test() {
  const [walletState, setWalletState] =
    useState<WalletState>("disconnected");

  const [provider, setProvider] =
    useState<EIP1193Provider | null>(null);

  const [address, setAddress] =
    useState<Address | null>(null);

  const [tokenSymbol, setTokenSymbol] =
    useState("—");

  const [tokenDecimals, setTokenDecimals] =
    useState<number | null>(null);

  const [tokenBalance, setTokenBalance] =
    useState("—");

  const [description, setDescription] =
    useState(
      "Analyze recent BNB wallet activity and return a short risk summary."
    );

  const [jobId, setJobId] =
    useState<bigint | null>(null);

  const [transactionHash, setTransactionHash] =
    useState<`0x${string}` | null>(null);

  const [loading, setLoading] =
    useState(false);

  const [error, setError] =
    useState<string | null>(null);

  async function connectWallet() {
    setWalletState("connecting");
    setError(null);

    try {
      const wcProvider =
        await EthereumProvider.init({
          projectId:
            WALLETCONNECT_PROJECT_ID,

          optionalChains: [
            BSC_TESTNET_CHAIN_ID,
          ],

          showQrModal: true,

          metadata: {
            name: "BNB Agent Marketplace",
            description:
              "ERC-8183 Testnet",
            url: window.location.origin,
            icons: [],
          },

          rpcMap: {
            [BSC_TESTNET_CHAIN_ID]:
              "https://data-seed-prebsc-1-s1.bnbchain.org:8545",
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
          "No wallet account was returned."
        );
      }

      const connectedAddress =
        accounts[0] as Address;

      const rawChainId =
        await wcProvider.request({
          method: "eth_chainId",
        });

      const chainId =
        normalizeChainId(rawChainId);

      if (
        chainId !==
        BSC_TESTNET_CHAIN_ID
      ) {
        throw new Error(
          `Wrong network. Wallet is on chain ${chainId}. BSC Testnet requires chain 97.`
        );
      }

      setAddress(
        connectedAddress
      );

      setProvider(
        wcProvider as unknown as EIP1193Provider
      );

      setWalletState(
        "connected"
      );
    } catch (err) {
      console.error(
        "Wallet connection error:",
        err
      );

      setError(
        formatError(err)
      );

      setWalletState(
        "disconnected"
      );
    }
  }

  async function loadPaymentToken() {
    if (!address) {
      throw new Error(
        "Connect your wallet first."
      );
    }

    /*
     * Ask the official AgenticCommerce
     * contract which payment token it uses.
     */
    const paymentToken =
      (await publicClient.readContract(
        {
          address:
            ERC8183_ADDRESSES.commerce,

          abi: COMMERCE_ABI,

          functionName:
            "paymentToken",
        }
      )) as Address;

    /*
     * Read token information.
     */
    const decimals =
      (await publicClient.readContract(
        {
          address:
            paymentToken,

          abi: ERC20_ABI,

          functionName:
            "decimals",
        }
      )) as number;

    const symbol =
      (await publicClient.readContract(
        {
          address:
            paymentToken,

          abi: ERC20_ABI,

          functionName:
            "symbol",
        }
      )) as string;

    const balance =
      (await publicClient.readContract(
        {
          address:
            paymentToken,

          abi: ERC20_ABI,

          functionName:
            "balanceOf",

          args: [
            address,
          ],
        }
      )) as bigint;

    setTokenDecimals(
      Number(decimals)
    );

    setTokenSymbol(symbol);

    setTokenBalance(
      formatUnits(
        balance,
        Number(decimals)
      )
    );

    console.log(
      "Payment token:",
      paymentToken
    );

    console.log(
      "Token decimals:",
      decimals
    );

    console.log(
      "Token symbol:",
      symbol
    );

    console.log(
      "Token balance:",
      balance
    );
  }

  async function createTestJob() {
    if (!provider) {
      setError(
        "Connect your wallet first."
      );

      return;
    }

    if (!address) {
      setError(
        "Wallet address is missing."
      );

      return;
    }

    setLoading(true);
    setError(null);
    setJobId(null);
    setTransactionHash(
      null
    );

    try {
      /*
       * Load payment token information
       * before creating the job.
       */
      if (
        tokenDecimals === null
      ) {
        await loadPaymentToken();
      }

      /*
       * For our FIRST test:
       *
       * Your own wallet is temporarily the
       * provider.
       *
       * Later this will be the selected
       * marketplace agent's wallet.
       */
      const providerAddress =
        address;

      /*
       * Official BNB EvaluatorRouter.
       */
      const evaluator =
        ERC8183_ADDRESSES.router;

      /*
       * Official router is also used
       * as the hook.
       */
      const hook =
        ERC8183_ADDRESSES.router;

      /*
       * Job expires in one hour.
       */
      const expiredAt =
        BigInt(
          Math.floor(
            Date.now() / 1000
          ) +
            60 * 60
        );

      const walletClient =
        createWalletClient({
          account:
            address,

          chain: {
            ...getBscTestnetChain(),
          },

          transport:
            custom(provider),
        });

      /*
       * CREATE JOB
       */
      const hash =
        await walletClient.writeContract(
          {
            address:
              ERC8183_ADDRESSES.commerce,

            abi:
              COMMERCE_ABI,

            functionName:
              "createJob",

            args: [
              providerAddress,
              evaluator,
              expiredAt,
              description,
              hook,
            ],
          }
        );

      setTransactionHash(
        hash
      );

      /*
       * Wait for the transaction.
       */
      const receipt =
        await publicClient.waitForTransactionReceipt(
          {
            hash,
          }
        );

      if (
        receipt.status !==
        "success"
      ) {
        throw new Error(
          "The createJob transaction failed."
        );
      }

      /*
       * Get the newest job ID.
       *
       * This is enough for our first test.
       * Later we'll retrieve the exact ID
       * directly from the JobCreated event.
       */
      const latestJobId =
        (await publicClient.readContract(
          {
            address:
              ERC8183_ADDRESSES.commerce,

            abi: COMMERCE_ABI,

            functionName:
              "jobCounter",
          }
        )) as bigint;

      setJobId(
        latestJobId
      );
    } catch (err) {
      console.error(
        "createJob error:",
        err
      );

      setError(
        formatError(err)
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#0b0d0e",
        color: "#e8e6e1",
        padding: 24,
        fontFamily:
          "system-ui, sans-serif",
      }}
    >
      <div
        style={{
          maxWidth: 650,
          margin: "0 auto",
        }}
      >
        <h1>
          ERC-8183 Test
        </h1>

        <p
          style={{
            color: "#aaa",
            lineHeight: 1.6,
          }}
        >
          This page is only for testing the
          official BNB Agent commerce contracts
          on BSC Testnet.
        </p>

        {walletState !==
          "connected" && (
          <button
            onClick={
              connectWallet
            }
            disabled={
              walletState ===
              "connecting"
            }
            style={
              styles.primaryButton
            }
          >
            {walletState ===
            "connecting"
              ? "Connecting..."
              : "Connect Wallet"}
          </button>
        )}

        {address && (
          <div
            style={
              styles.panel
            }
          >
            <div
              style={
                styles.label
              }
            >
              Connected wallet
            </div>

            <code
              style={
                styles.code
              }
            >
              {address}
            </code>
          </div>
        )}

        {walletState ===
          "connected" && (
          <>
            <div
              style={
                styles.panel
              }
            >
              <h3>
                Payment Token
              </h3>

              <p>
                Token:{" "}
                <strong>
                  {tokenSymbol}
                </strong>
              </p>

              <p>
                Decimals:{" "}
                <strong>
                  {tokenDecimals ??
                    "—"}
                </strong>
              </p>

              <p>
                Balance:{" "}
                <strong>
                  {tokenBalance}
                </strong>
              </p>

              <button
                onClick={
                  async () => {
                    setError(
                      null
                    );

                    try {
                      await loadPaymentToken();
                    } catch (
                      err
                    ) {
                      setError(
                        formatError(
                          err
                        )
                      );
                    }
                  }
                }
                disabled={
                  loading
                }
                style={
                  styles.secondaryButton
                }
              >
                Check Payment Token
              </button>
            </div>

            <div
              style={
                styles.panel
              }
            >
              <h3>
                Create Test Job
              </h3>

              <label>
                Task description
              </label>

              <textarea
                value={
                  description
                }
                onChange={(
                  event
                ) =>
                  setDescription(
                    event.target
                      .value
                  )
                }
                rows={5}
                style={
                  styles.textarea
                }
              />

              <p>
                Provider:
              </p>

              <code
                style={
                  styles.code
                }
              >
                {address}
              </code>

              <p>
                Evaluator:
              </p>

              <code
                style={
                  styles.code
                }
              >
                {
                  ERC8183_ADDRESSES.router
                }
              </code>

              <button
                onClick={
                  createTestJob
                }
                disabled={
                  loading
                }
                style={
                  styles.primaryButton
                }
              >
                {loading
                  ? "Creating Job..."
                  : "Create ERC-8183 Job"}
              </button>
            </div>
          </>
        )}

        {transactionHash && (
          <div
            style={
              styles.success
            }
          >
            <strong>
              ✓ Transaction submitted
            </strong>

            <p>
              The createJob transaction has
              been submitted.
            </p>

            <code
              style={
                styles.code
              }
            >
              {
                transactionHash
              }
            </code>

            <a
              href={`https://testnet.bscscan.com/tx/${transactionHash}`}
              target="_blank"
              rel="noreferrer"
              style={
                styles.link
              }
            >
              View on BscScan ↗
            </a>
          </div>
        )}

        {jobId !==
          null && (
          <div
            style={
              styles.success
            }
          >
            <strong>
              ✓ Job created
            </strong>

            <p>
              Job ID:
            </p>

            <code
              style={
                styles.jobId
              }
            >
              {jobId.toString()}
            </code>

            <p
              style={{
                marginTop: 12,
              }}
            >
              We have successfully created a
              real ERC-8183 job on BSC Testnet.
            </p>
          </div>
        )}

        {error && (
          <div
            style={
              styles.error
            }
          >
            <strong>
              Error
            </strong>

            <pre
              style={
                styles.errorText
              }
            >
              {error}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}

function normalizeChainId(
  value: unknown
): number {
  if (
    typeof value ===
    "number"
  ) {
    return value;
  }

  if (
    typeof value ===
    "bigint"
  ) {
    return Number(
      value
    );
  }

  if (
    typeof value ===
    "string"
  ) {
    const trimmed =
      value.trim();

    if (
      trimmed
        .toLowerCase()
        .startsWith("0x")
    ) {
      return parseInt(
        trimmed,
        16
      );
    }

    return Number(
      trimmed
    );
  }

  throw new Error(
    `Unable to determine chain ID: ${String(
      value
    )}`
  );
}

function getBscTestnetChain() {
  return {
    id: 97,
    name: "BNB Smart Chain Testnet",

    nativeCurrency: {
      name: "tBNB",
      symbol: "tBNB",
      decimals: 18,
    },

    rpcUrls: {
      default: {
        http: [
          "https://data-seed-prebsc-1-s1.bnbchain.org:8545",
        ],
      },

      public: {
        http: [
          "https://data-seed-prebsc-1-s1.bnbchain.org:8545",
        ],
      },
    },

    blockExplorers: {
      default: {
        name: "BscScan",
        url:
          "https://testnet.bscscan.com",
      },
    },

    testnet: true,
  } as const;
}

function formatError(
  error: unknown
): string {
  if (
    error instanceof Error
  ) {
    return error.message;
  }

  if (
    typeof error ===
    "string"
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
    return String(
      error
    );
  }
}

const styles: Record<
  string,
  React.CSSProperties
> = {
  panel: {
    marginTop: 20,
    padding: 18,
    borderRadius: 12,
    border:
      "1px solid #2b2f31",
    background: "#111516",
  },

  label: {
    fontSize: 11,
    textTransform:
      "uppercase",
    letterSpacing:
      "0.08em",
    color: "#777",
    marginBottom: 8,
  },

  code: {
    display: "block",
    background: "#090b0c",
    padding: 10,
    borderRadius: 8,
    fontSize: 12,
    wordBreak:
      "break-all",
  },

  textarea: {
    width: "100%",
    minHeight: 100,
    boxSizing:
      "border-box",
    marginTop: 8,
    padding: 10,
    borderRadius: 8,
    border:
      "1px solid #34383a",
    background: "#090b0c",
    color: "#fff",
    resize: "vertical",
  },

  primaryButton: {
    width: "100%",
    marginTop: 16,
    padding:
      "13px 16px",
    border: "none",
    borderRadius: 9,
    background:
      "#f0b90b",
    color: "#111",
    fontWeight: 800,
    cursor:
      "pointer",
  },

  secondaryButton: {
    marginTop: 10,
    padding:
      "10px 14px",
    borderRadius: 8,
    border:
      "1px solid #3a3e40",
    background:
      "#1b1e20",
    color: "#fff",
    fontWeight: 700,
    cursor:
      "pointer",
  },

  success: {
    marginTop: 20,
    padding: 18,
    borderRadius: 12,
    border:
      "1px solid rgba(126,226,168,.3)",
    background:
      "rgba(126,226,168,.08)",
  },

  jobId: {
    fontSize: 24,
    fontWeight: 800,
    color:
      "#7ee2a8",
  },

  link: {
    display: "block",
    marginTop: 12,
    color:
      "#f0b90b",
    fontWeight: 700,
    textDecoration:
      "none",
  },

  error: {
    marginTop: 20,
    padding: 18,
    borderRadius: 12,
    border:
      "1px solid #5a2929",
    background:
      "#281616",
  },

  errorText: {
    whiteSpace:
      "pre-wrap",
    overflowWrap:
      "anywhere",
    fontFamily:
      "monospace",
    fontSize: 12,
    lineHeight: 1.6,
    color:
      "#ffaaaa",
  },
};
