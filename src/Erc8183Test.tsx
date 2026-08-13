import { useState } from "react";

import {
  createWalletClient,
  custom,
  type Address,
  type EIP1193Provider,
} from "viem";

import { EthereumProvider } from "@walletconnect/ethereum-provider";

import {
  ERC8183_ADDRESSES,
  COMMERCE_ABI,
  ROUTER_ABI,
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
    useState<WalletState>(
      "disconnected"
    );

  const [provider, setProvider] =
    useState<EIP1193Provider | null>(
      null
    );

  const [address, setAddress] =
    useState<Address | null>(
      null
    );

  const [status, setStatus] =
    useState("Not connected");

  const [jobId, setJobId] =
    useState<bigint | null>(
      null
    );

  const [description, setDescription] =
    useState(
      "Test ERC-8183 job from our BSC agent marketplace."
    );

  const [transactionHash, setTransactionHash] =
    useState<`0x${string}` | null>(
      null
    );

  const [registerTransactionHash, setRegisterTransactionHash] =
    useState<`0x${string}` | null>(
      null
    );

  const [registeredPolicy, setRegisteredPolicy] =
    useState<Address | null>(
      null
    );

  const [loading, setLoading] =
    useState(false);

  const [error, setError] =
    useState<string | null>(
      null
    );

  async function connect() {
    try {
      setError(null);
      setStatus("Connecting...");

      const wc =
        await EthereumProvider.init({
          projectId:
            WALLETCONNECT_PROJECT_ID,

          optionalChains: [
            BSC_TESTNET_CHAIN_ID,
          ],

          showQrModal: true,

          metadata: {
            name:
              "BNB Agent Marketplace",

            description:
              "ERC-8183 Testnet",

            url:
              window.location.origin,

            icons: [],
          },

          rpcMap: {
            [BSC_TESTNET_CHAIN_ID]:
              "https://data-seed-prebsc-1-s1.bnbchain.org:8545",
          },
        });

      await wc.connect();

      const accounts =
        wc.accounts as string[];

      if (
        !accounts ||
        accounts.length === 0
      ) {
        throw new Error(
          "No wallet account returned."
        );
      }

      const walletProvider =
        wc as unknown as EIP1193Provider;

      const chain =
        await walletProvider.request(
          {
            method:
              "eth_chainId",
          }
        );

      const chainId =
        normalizeChainId(
          chain
        );

      if (
        chainId !==
        BSC_TESTNET_CHAIN_ID
      ) {
        throw new Error(
          `Wrong network: ${chainId}. BSC Testnet is 97.`
        );
      }

      const walletAddress =
        accounts[0] as Address;

      setAddress(
        walletAddress
      );

      setProvider(
        walletProvider
      );

      setWalletState(
        "connected"
      );

      setStatus(
        "Connected to BSC Testnet"
      );
    } catch (err) {
      console.error(
        "Wallet connection error:",
        err
      );

      setWalletState(
        "disconnected"
      );

      setStatus(
        "Connection failed"
      );

      setError(
        formatError(err)
      );
    }
  }

  /*
   * --------------------------------------------------
   * CREATE JOB
   * --------------------------------------------------
   *
   * Creates an ERC-8183 job on the official
   * AgenticCommerce contract.
   */
  async function createJob() {
    if (
      !provider ||
      !address
    ) {
      setError(
        "Connect your wallet first."
      );

      return;
    }

    try {
      setError(null);
      setLoading(true);

      setJobId(null);
      setTransactionHash(
        null
      );
      setRegisterTransactionHash(
        null
      );
      setRegisteredPolicy(
        null
      );

      setStatus(
        "Preparing job..."
      );

      const walletClient =
        createWalletClient({
          account:
            address,

          chain:
            getBscTestnetChain(),

          transport:
            custom(provider),
        });

      const expiry =
        BigInt(
          Math.floor(
            Date.now() /
              1000
          ) +
            60 * 60
        );

      setStatus(
        "Waiting for wallet confirmation..."
      );

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
              /*
               * Temporary test provider:
               * our own wallet.
               *
               * Later this will become
               * the selected agent address.
               */
              address,

              /*
               * Official EvaluatorRouter.
               */
              ERC8183_ADDRESSES.router,

              /*
               * Expiry.
               */
              expiry,

              /*
               * Task description.
               */
              description,

              /*
               * Official Router is also
               * the hook.
               */
              ERC8183_ADDRESSES.router,
            ],
          }
        );

      setTransactionHash(
        hash
      );

      setStatus(
        "Transaction submitted. Waiting for BSC confirmation..."
      );

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
          "The createJob transaction failed on BSC."
        );
      }

      /*
       * Read the latest job counter.
       *
       * For our first testing stage this is
       * sufficient. Later we will capture the
       * exact JobCreated event.
       */
      const latestJobId =
        (await publicClient.readContract(
          {
            address:
              ERC8183_ADDRESSES.commerce,

            abi:
              COMMERCE_ABI,

            functionName:
              "jobCounter",
          }
        )) as bigint;

      setJobId(
        latestJobId
      );

      setStatus(
        `✅ Job #${latestJobId.toString()} created successfully`
      );
    } catch (err) {
      console.error(
        "createJob failed:",
        err
      );

      setStatus(
        "Job creation failed"
      );

      setError(
        formatError(err)
      );
    } finally {
      setLoading(false);
    }
  }

  /*
   * --------------------------------------------------
   * REGISTER JOB
   * --------------------------------------------------
   *
   * This is the next step after createJob().
   *
   * It calls the official EvaluatorRouter and
   * attaches the OptimisticPolicy to the job.
   */
  async function registerJob() {
    if (
      !provider ||
      !address
    ) {
      setError(
        "Connect your wallet first."
      );

      return;
    }

    if (
      jobId === null
    ) {
      setError(
        "Create a job first."
      );

      return;
    }

    try {
      setError(null);
      setLoading(true);

      setRegisterTransactionHash(
        null
      );

      setStatus(
        `Preparing registration for Job #${jobId.toString()}...`
      );

      /*
       * First verify the policy is actually
       * whitelisted by the Router.
       */
      const policyWhitelisted =
        (await publicClient.readContract(
          {
            address:
              ERC8183_ADDRESSES.router,

            abi:
              ROUTER_ABI,

            functionName:
              "policyWhitelist",

            args: [
              ERC8183_ADDRESSES.policy,
            ],
          }
        )) as boolean;

      if (
        !policyWhitelisted
      ) {
        throw new Error(
          "The official OptimisticPolicy is not currently whitelisted by the BSC Testnet EvaluatorRouter."
        );
      }

      /*
       * Verify the Router points to the
       * expected AgenticCommerce contract.
       */
      const routerCommerce =
        (await publicClient.readContract(
          {
            address:
              ERC8183_ADDRESSES.router,

            abi:
              ROUTER_ABI,

            functionName:
              "commerce",
          }
        )) as Address;

      if (
        routerCommerce.toLowerCase() !==
        ERC8183_ADDRESSES.commerce.toLowerCase()
      ) {
        throw new Error(
          [
            "EvaluatorRouter is pointing at a different Commerce contract.",
            "",
            `Router commerce: ${routerCommerce}`,
            `Expected commerce: ${ERC8183_ADDRESSES.commerce}`,
          ].join("\n")
        );
      }

      /*
       * Create wallet client.
       */
      const walletClient =
        createWalletClient({
          account:
            address,

          chain:
            getBscTestnetChain(),

          transport:
            custom(provider),
        });

      setStatus(
        "Waiting for wallet confirmation..."
      );

      /*
       * REGISTER JOB
       */
      const hash =
        await walletClient.writeContract(
          {
            address:
              ERC8183_ADDRESSES.router,

            abi:
              ROUTER_ABI,

            functionName:
              "registerJob",

            args: [
              jobId,

              ERC8183_ADDRESSES.policy,
            ],
          }
        );

      setRegisterTransactionHash(
        hash
      );

      setStatus(
        "Registration submitted. Waiting for BSC confirmation..."
      );

      /*
       * Wait for confirmation.
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
          "The registerJob transaction failed on BSC."
        );
      }

      /*
       * IMPORTANT:
       *
       * Don't just trust the successful transaction.
       *
       * Read jobPolicy(jobId) directly from
       * the Router to verify the state.
       */
      const policy =
        (await publicClient.readContract(
          {
            address:
              ERC8183_ADDRESSES.router,

            abi:
              ROUTER_ABI,

            functionName:
              "jobPolicy",

            args: [
              jobId,
            ],
          }
        )) as Address;

      if (
        policy.toLowerCase() !==
        ERC8183_ADDRESSES.policy.toLowerCase()
      ) {
        throw new Error(
          [
            "Transaction succeeded, but the job policy does not match.",
            "",
            `Expected: ${ERC8183_ADDRESSES.policy}`,
            `Returned: ${policy}`,
          ].join("\n")
        );
      }

      setRegisteredPolicy(
        policy
      );

      setStatus(
        `✅ Job #${jobId.toString()} registered successfully`
      );
    } catch (err) {
      console.error(
        "registerJob failed:",
        err
      );

      setStatus(
        "Job registration failed"
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
      style={
        styles.page
      }
    >
      <div
        style={
          styles.container
        }
      >
        <h1>
          ERC-8183 Test
        </h1>

        <p
          style={
            styles.subtitle
          }
        >
          Testing the official BNB Agent
          Commerce layer on BSC Testnet.
        </p>

        {/* ------------------------------------------- */}
        {/* WALLET                                      */}
        {/* ------------------------------------------- */}

        <div
          style={
            styles.panel
          }
        >
          <h3>
            Wallet
          </h3>

          {!address ? (
            <button
              onClick={
                connect
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
          ) : (
            <>
              <div
                style={
                  styles.label
                }
              >
                Connected address
              </div>

              <code
                style={
                  styles.code
                }
              >
                {address}
              </code>

              <p>
                Status:{" "}
                <strong>
                  {status}
                </strong>
              </p>
            </>
          )}
        </div>

        {/* ------------------------------------------- */}
        {/* JOB                                      */}
        {/* ------------------------------------------- */}

        {address && (
          <div
            style={
              styles.panel
            }
          >
            <h3>
              Test Job
            </h3>

            <label
              style={
                styles.label
              }
            >
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
              disabled={
                loading
              }
              style={
                styles.textarea
              }
            />

            <div
              style={
                styles.addressBlock
              }
            >
              <div
                style={
                  styles.label
                }
              >
                Provider
              </div>

              <code
                style={
                  styles.code
                }
              >
                {address}
              </code>
            </div>

            <div
              style={
                styles.addressBlock
              }
            >
              <div
                style={
                  styles.label
                }
              >
                EvaluatorRouter
              </div>

              <code
                style={
                  styles.code
                }
              >
                {
                  ERC8183_ADDRESSES.router
                }
              </code>
            </div>

            <div
              style={
                styles.addressBlock
              }
            >
              <div
                style={
                  styles.label
                }
              >
                OptimisticPolicy
              </div>

              <code
                style={
                  styles.code
                }
              >
                {
                  ERC8183_ADDRESSES.policy
                }
              </code>
            </div>

            <button
              onClick={
                createJob
              }
              disabled={
                loading
              }
              style={
                styles.primaryButton
              }
            >
              {loading
                ? "Working..."
                : "Create ERC-8183 Job"}
            </button>

            {jobId !== null && (
              <div
                style={
                  styles.success
                }
              >
                <h3>
                  ✓ Job created
                </h3>

                <p>
                  Job ID:
                </p>

                <div
                  style={
                    styles.jobId
                  }
                >
                  {jobId.toString()}
                </div>

                {transactionHash && (
                  <>
                    <p>
                      Create transaction:
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
                      View createJob transaction ↗
                    </a>
                  </>
                )}
              </div>
            )}
          </div>
        )}

        {/* ------------------------------------------- */}
        {/* REGISTRATION                                */}
        {/* ------------------------------------------- */}

        {jobId !== null &&
          address && (
            <div
              style={
                styles.panel
              }
            >
              <h3>
                Register Job
              </h3>

              <p
                style={
                  styles.subtitleSmall
                }
              >
                This attaches the official
                OptimisticPolicy to the job.
              </p>

              <button
                onClick={
                  registerJob
                }
                disabled={
                  loading ||
                  registeredPolicy !==
                    null
                }
                style={
                  styles.primaryButton
                }
              >
                {registeredPolicy
                  ? "Job Registered"
                  : loading
                  ? "Registering..."
                  : `Register Job #${jobId.toString()}`}
              </button>

              {registerTransactionHash && (
                <div
                  style={
                    styles.success
                  }
                >
                  <h3>
                    ✓ Registration transaction confirmed
                  </h3>

                  <p>
                    Transaction:
                  </p>

                  <code
                    style={
                      styles.code
                    }
                  >
                    {
                      registerTransactionHash
                    }
                  </code>

                  <a
                    href={`https://testnet.bscscan.com/tx/${registerTransactionHash}`}
                    target="_blank"
                    rel="noreferrer"
                    style={
                      styles.link
                    }
                  >
                    View registration transaction ↗
                  </a>
                </div>
              )}

              {registeredPolicy && (
                <div
                  style={
                    styles.verified
                  }
                >
                  <strong>
                    ✓ Policy verified on-chain
                  </strong>

                  <p>
                    Job #{jobId.toString()}
                    is registered with:
                  </p>

                  <code
                    style={
                      styles.code
                    }
                  >
                    {
                      registeredPolicy
                    }
                  </code>
                </div>
              )}
            </div>
          )}

        {/* ------------------------------------------- */}
        {/* ERROR                                      */}
        {/* ------------------------------------------- */}

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

/*
 * Normalize:
 *
 * "97"   -> 97
 * "0x61" -> 97
 */
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

    name:
      "BNB Smart Chain Testnet",

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
    },

    blockExplorers: {
      default: {
        name:
          "BscScan",

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
  page: {
    minHeight: "100vh",
    padding: 24,
    background:
      "#0b0d0e",
    color: "#e8e6e1",
    fontFamily:
      "system-ui, sans-serif",
  },

  container: {
    maxWidth: 650,
    margin:
      "0 auto",
  },

  panel: {
    marginTop: 20,
    padding: 18,
    borderRadius: 12,
    background:
      "#151819",
    border:
      "1px solid #2c3032",
  },

  label: {
    display:
      "block",
    marginBottom: 7,
    color: "#777",
    fontSize: 11,
    textTransform:
      "uppercase",
    letterSpacing:
      "0.08em",
  },

  subtitle: {
    color: "#aaa",
    lineHeight: 1.6,
  },

  subtitleSmall: {
    color: "#999",
    fontSize: 13,
    lineHeight: 1.5,
  },

  code: {
    display:
      "block",
    background:
      "#090b0c",
    padding: 10,
    borderRadius: 8,
    fontSize: 12,
    wordBreak:
      "break-all",
    fontFamily:
      "monospace",
  },

  textarea: {
    width:
      "100%",
    minHeight: 110,
    boxSizing:
      "border-box",
    marginBottom: 16,
    padding: 11,
    borderRadius: 8,
    border:
      "1px solid #34383a",
    background:
      "#090b0c",
    color:
      "#fff",
    resize:
      "vertical",
    fontFamily:
      "inherit",
  },

  addressBlock: {
    marginTop: 14,
  },

  primaryButton: {
    width:
      "100%",
    marginTop: 16,
    padding:
      "13px 18px",
    border:
      "none",
    borderRadius: 9,
    background:
      "#f0b90b",
    color:
      "#111",
    fontWeight:
      800,
    cursor:
      "pointer",
  },

  success: {
    marginTop: 18,
    padding: 16,
    borderRadius: 10,
    background:
      "rgba(50,200,120,.1)",
    border:
      "1px solid rgba(50,200,120,.3)",
  },

  verified: {
    marginTop: 14,
    padding: 14,
    borderRadius: 10,
    background:
      "rgba(126,226,168,.08)",
    border:
      "1px solid rgba(126,226,168,.25)",
    color:
      "#7ee2a8",
  },

  jobId: {
    fontSize: 26,
    fontWeight:
      800,
    color:
      "#7ee2a8",
  },

  error: {
    marginTop: 20,
    padding: 16,
    borderRadius: 10,
    background:
      "#291616",
    border:
      "1px solid #5a2929",
    color:
      "#ffaaaa",
  },

  errorText: {
    whiteSpace:
      "pre-wrap",
    overflowWrap:
      "anywhere",
    fontFamily:
      "monospace",
    fontSize: 12,
    lineHeight:
      1.6,
  },

  link: {
    display:
      "block",
    marginTop: 10,
    color:
      "#f0b90b",
    fontWeight:
      700,
    textDecoration:
      "none",
  },
};
