import {
  useEffect,
  useState,
} from "react";

import {
  createWalletClient,
  custom,
  keccak256,
  stringToBytes,
  type Address,
  type EIP1193Provider,
} from "viem";

import {
  EthereumProvider,
} from "@walletconnect/ethereum-provider";

import {
  COMMERCE_ABI,
  ERC8183_ADDRESSES,
  publicClient,
} from "./lib/erc8183";

const WALLETCONNECT_PROJECT_ID =
  "1dbe8fd5e4974ae7c80d074c4082b5a0";

const BSC_TESTNET_CHAIN_ID =
  97;

const SAVED_PROVIDER_JOB_KEY =
  "bnb_agent_marketplace_provider_test_job";

type Job = {
  id: bigint;
  client: Address;
  provider: Address;
  evaluator: Address;
  description: string;
  budget: bigint;
  expiredAt: bigint;
  status: number;
  hook: Address;
  submittedAt: bigint;
  deliverable: `0x${string}`;
};

export default function ProviderTest() {
  const [provider, setProvider] =
    useState<EIP1193Provider | null>(
      null
    );

  const [address, setAddress] =
    useState<Address | null>(
      null
    );

  const [jobIdInput, setJobIdInput] =
    useState("");

  const [job, setJob] =
    useState<Job | null>(
      null
    );

  const [deliverable, setDeliverable] =
    useState("");

  const [deliverableHash, setDeliverableHash] =
    useState<`0x${string}` | null>(
      null
    );

  const [transactionHash, setTransactionHash] =
    useState<`0x${string}` | null>(
      null
    );

  const [status, setStatus] =
    useState(
      "Provider wallet not connected"
    );

  const [error, setError] =
    useState<string | null>(
      null
    );

  const [loading, setLoading] =
    useState(false);

  /*
   * ========================================================
   * RESTORE SAVED JOB
   * ========================================================
   */

  useEffect(() => {
    try {
      const saved =
        window.localStorage.getItem(
          SAVED_PROVIDER_JOB_KEY
        );

      if (
        saved &&
        /^\d+$/.test(saved)
      ) {
        setJobIdInput(
          saved
        );
      }
    } catch (err) {
      console.warn(
        "Could not restore provider job ID:",
        err
      );
    }
  }, []);

  /*
   * ========================================================
   * CONNECT PROVIDER WALLET
   * ========================================================
   */

  async function connectProvider() {
    try {
      setError(null);

      setStatus(
        "Connecting provider wallet..."
      );

      const wallet =
        await EthereumProvider.init({
          projectId:
            WALLETCONNECT_PROJECT_ID,

          optionalChains: [
            BSC_TESTNET_CHAIN_ID,
          ],

          showQrModal: true,

          metadata: {
            name:
              "BNB Agent Marketplace Provider",

            description:
              "ERC-8183 Provider Test",

            url:
              window.location.origin,

            icons: [],
          },

          rpcMap: {
            [BSC_TESTNET_CHAIN_ID]:
              "https://data-seed-prebsc-1-s1.bnbchain.org:8545",
          },
        });

      await wallet.connect();

      const accounts =
        wallet.accounts as string[];

      if (
        !accounts ||
        accounts.length === 0
      ) {
        throw new Error(
          "No provider wallet account returned."
        );
      }

      const walletProvider =
        wallet as unknown as EIP1193Provider;

      const rawChainId =
        await walletProvider.request({
          method:
            "eth_chainId",
        });

      const chainId =
        normalizeChainId(
          rawChainId
        );

      if (
        chainId !==
        BSC_TESTNET_CHAIN_ID
      ) {
        throw new Error(
          `Wrong network: ${chainId}. BSC Testnet requires chain ID 97.`
        );
      }

      const providerAddress =
        accounts[0] as Address;

      setProvider(
        walletProvider
      );

      setAddress(
        providerAddress
      );

      setStatus(
        "✅ Provider wallet connected"
      );

      if (
        jobIdInput
      ) {
        window.setTimeout(() => {
          void loadJob(
            jobIdInput
          );
        }, 0);
      }
    } catch (err) {
      console.error(
        "Provider connection failed:",
        err
      );

      setStatus(
        "Provider wallet connection failed"
      );

      setError(
        formatError(err)
      );
    }
  }

  /*
   * ========================================================
   * LOAD JOB
   * ========================================================
   */

  async function loadJob(
    overrideId?: string
  ) {
    try {
      setError(null);

      const rawId =
        overrideId?.trim() ||
        jobIdInput.trim();

      if (!rawId) {
        throw new Error(
          "Enter a job ID."
        );
      }

      if (
        !/^\d+$/.test(rawId)
      ) {
        throw new Error(
          "Job ID must be a whole number."
        );
      }

      const id =
        BigInt(rawId);

      setLoading(true);

      setStatus(
        `Reading Job #${id.toString()} from BSC...`
      );

      const result =
        (await publicClient.readContract(
          {
            address:
              ERC8183_ADDRESSES.commerce,

            abi:
              COMMERCE_ABI,

            functionName:
              "getJob",

            args: [
              id,
            ],
          }
        )) as {
          id: bigint;
          client: Address;
          provider: Address;
          evaluator: Address;
          description: string;
          budget: bigint;
          expiredAt: bigint;
          status: number;
          hook: Address;
          submittedAt: bigint;
          deliverable: `0x${string}`;
        };

      const loadedJob: Job = {
        id:
          result.id,

        client:
          result.client,

        provider:
          result.provider,

        evaluator:
          result.evaluator,

        description:
          result.description,

        budget:
          result.budget,

        expiredAt:
          result.expiredAt,

        status:
          Number(
            result.status
          ),

        hook:
          result.hook,

        submittedAt:
          result.submittedAt,

        deliverable:
          result.deliverable,
      };

      try {
        window.localStorage.setItem(
          SAVED_PROVIDER_JOB_KEY,
          id.toString()
        );
      } catch (err) {
        console.warn(
          "Could not save provider job ID:",
          err
        );
      }

      setJobIdInput(
        id.toString()
      );

      setJob(
        loadedJob
      );

      setDeliverable(
        `Provider test result for Job #${id.toString()}:\n\nThe provider successfully received and processed this funded ERC-8183 job.\n\nTask:\n${loadedJob.description}`
      );

      setDeliverableHash(
        null
      );

      setTransactionHash(
        null
      );

      setStatus(
        `✅ Job #${id.toString()} loaded`
      );
    } catch (err) {
      console.error(
        "Load provider job failed:",
        err
      );

      setJob(
        null
      );

      setStatus(
        "Could not load job"
      );

      setError(
        formatError(err)
      );
    } finally {
      setLoading(false);
    }
  }

  /*
   * ========================================================
   * VALIDATE CURRENT JOB
   * ========================================================
   */

  function validateProviderJob(
    currentJob: Job
  ) {
    if (!address) {
      throw new Error(
        "Connect the provider wallet first."
      );
    }

    /*
     * Provider must match the job's provider.
     */
    if (
      currentJob.provider.toLowerCase() !==
      address.toLowerCase()
    ) {
      throw new Error(
        [
          "Provider mismatch.",

          "",

          `Job provider: ${currentJob.provider}`,

          `Connected wallet: ${address}`,

          "",

          "This wallet is not the provider assigned to this job.",
        ].join(
          "\n"
        )
      );
    }

    /*
     * Job must be funded.
     */
    if (
      currentJob.status !==
      1
    ) {
      throw new Error(
        [
          `Job #${currentJob.id.toString()} is not FUNDED.`,

          "",

          `Current status: ${getStatusName(
            currentJob.status
          )}`,
        ].join(
          "\n"
        )
      );
    }

    /*
     * Job must not be expired.
     */
    if (
      currentJob.expiredAt <=
      BigInt(
        Math.floor(
          Date.now() /
            1000
        )
      )
    ) {
      throw new Error(
        "This job has expired."
      );
    }
  }

  /*
   * ========================================================
   * PREPARE DELIVERABLE
   * ========================================================
   */

  function prepareDeliverable() {
    try {
      setError(null);

      if (
        !deliverable.trim()
      ) {
        throw new Error(
          "Enter a deliverable first."
        );
      }

      const hash =
        keccak256(
          stringToBytes(
            deliverable
          )
        );

      setDeliverableHash(
        hash
      );

      setStatus(
        "✅ Deliverable hash prepared"
      );
    } catch (err) {
      setError(
        formatError(err)
      );
    }
  }

  /*
   * ========================================================
   * SIMULATE SUBMIT
   * ========================================================
   */

  async function simulateSubmit() {
    try {
      setError(null);

      if (
        !address
      ) {
        throw new Error(
          "Connect the provider wallet first."
        );
      }

      const currentJob =
        job;

      if (!currentJob) {
        throw new Error(
          "Load a job first."
        );
      }

      validateProviderJob(
        currentJob
      );

      if (
        !deliverable.trim()
      ) {
        throw new Error(
          "Enter a deliverable first."
        );
      }

      const hash =
        deliverableHash ??
        keccak256(
          stringToBytes(
            deliverable
          )
        );

      setDeliverableHash(
        hash
      );

      setStatus(
        "Simulating submit()..."
      );

      await publicClient.simulateContract(
        {
          address:
            ERC8183_ADDRESSES.commerce,

          abi:
            COMMERCE_ABI,

          functionName:
            "submit",

          args: [
            currentJob.id,

            hash,

            "0x",
          ],

          account:
            address,
        }
      );

      setStatus(
        "✅ submit() simulation passed"
      );
    } catch (err) {
      console.error(
        "Submit simulation failed:",
        err
      );

      setStatus(
        "❌ submit() simulation failed"
      );

      setError(
        formatError(err)
      );
    }
  }

  /*
   * ========================================================
   * SUBMIT DELIVERABLE
   * ========================================================
   */

  async function submitDeliverable() {
    try {
      setError(null);

      if (
        !provider ||
        !address
      ) {
        throw new Error(
          "Connect the provider wallet first."
        );
      }

      const currentJob =
        job;

      if (!currentJob) {
        throw new Error(
          "Load a job first."
        );
      }

      validateProviderJob(
        currentJob
      );

      if (
        !deliverable.trim()
      ) {
        throw new Error(
          "Enter a deliverable first."
        );
      }

      setLoading(true);

      /*
       * Generate deliverable hash.
       */
      const hash =
        deliverableHash ??
        keccak256(
          stringToBytes(
            deliverable
          )
        );

      setDeliverableHash(
        hash
      );

      /*
       * Simulate first.
       */
      setStatus(
        "Checking submit() before sending..."
      );

      await publicClient.simulateContract(
        {
          address:
            ERC8183_ADDRESSES.commerce,

          abi:
            COMMERCE_ABI,

          functionName:
            "submit",

          args: [
            currentJob.id,

            hash,

            "0x",
          ],

          account:
            address,
        }
      );

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
        "Simulation passed. Waiting for provider wallet confirmation..."
      );

      const txHash =
        await walletClient.writeContract(
          {
            address:
              ERC8183_ADDRESSES.commerce,

            abi:
              COMMERCE_ABI,

            functionName:
              "submit",

            args: [
              currentJob.id,

              hash,

              "0x",
            ],
          }
        );

      setTransactionHash(
        txHash
      );

      setStatus(
        "Submission transaction sent. Waiting for BSC..."
      );

      const receipt =
        await publicClient.waitForTransactionReceipt(
          {
            hash:
              txHash,
          }
        );

      if (
        receipt.status !==
        "success"
      ) {
        throw new Error(
          "The submit transaction failed."
        );
      }

      /*
       * Reload from chain.
       */
      await loadJob(
        currentJob.id.toString()
      );

      setStatus(
        `✅ Job #${currentJob.id.toString()} submitted successfully`
      );
    } catch (err) {
      console.error(
        "Submit failed:",
        err
      );

      setStatus(
        "Submission failed"
      );

      setError(
        formatError(err)
      );
    } finally {
      setLoading(false);
    }
  }

  /*
   * ========================================================
   * RENDER
   * ========================================================
   */

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
          Provider Agent Test
        </h1>

        <p
          style={
            styles.subtitle
          }
        >
          Test the provider side of ERC-8183:
          receive a FUNDED job and submit a
          deliverable.
        </p>

        {/* ============================================ */}
        {/* PROVIDER WALLET */}
        {/* ============================================ */}

        <div
          style={
            styles.panel
          }
        >
          <h3>
            Provider Wallet
          </h3>

          {!address ? (
            <button
              onClick={
                connectProvider
              }
              disabled={
                loading
              }
              style={
                styles.primaryButton
              }
            >
              Connect Provider Wallet
            </button>
          ) : (
            <>
              <div
                style={
                  styles.label
                }
              >
                Provider address
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

        {/* ============================================ */}
        {/* LOAD JOB */}
        {/* ============================================ */}

        {address && (
          <div
            style={
              styles.panel
            }
          >
            <h3>
              Load Funded Job
            </h3>

            <input
              value={
                jobIdInput
              }
              onChange={(
                event
              ) =>
                setJobIdInput(
                  event.target
                    .value
                )
              }
              placeholder="Example: 502"
              type="number"
              min="0"
              style={
                styles.input
              }
            />

            <button
              onClick={() =>
                void loadJob()
              }
              disabled={
                loading
              }
              style={
                styles.secondaryButton
              }
            >
              {loading
                ? "Loading..."
                : "Load Job"}
            </button>
          </div>
        )}

        {/* ============================================ */}
        {/* JOB DETAILS */}
        {/* ============================================ */}

        {job && (
          <div
            style={
              styles.panel
            }
          >
            <h3>
              Job #{job.id.toString()}
            </h3>

            <Info
              label="Status"
              value={
                getStatusName(
                  job.status
                )
              }
            />

            <Info
              label="Provider"
              value={
                job.provider
              }
            />

            <Info
              label="Client"
              value={
                job.client
              }
            />

            <Info
              label="Budget"
              value={
                job.budget.toString()
              }
            />

            <Info
              label="Expiry"
              value={
                formatTimestamp(
                  job.expiredAt
                )
              }
            />

            <div
              style={
                job.status ===
                  1 &&
                job.expiredAt >
                  BigInt(
                    Math.floor(
                      Date.now() /
                        1000
                    )
                  )
                  ? styles.good
                  : styles.warning
              }
            >
              {job.status ===
                1 &&
              job.expiredAt >
                BigInt(
                  Math.floor(
                    Date.now() /
                      1000
                  )
                )
                ? "✓ This job is FUNDED and can be processed by the provider."
                : `This job is ${getStatusName(
                    job.status
                  )} or expired.`}
            </div>

            <div
              style={
                styles.task
              }
            >
              <div
                style={
                  styles.label
                }
              >
                Task
              </div>

              {
                job.description
              }
            </div>
          </div>
        )}

        {/* ============================================ */}
        {/* DELIVERABLE */}
        {/* ============================================ */}

        {job &&
          address && (
            <div
              style={
                styles.panel
              }
            >
              <h3>
                Deliverable
              </h3>

              <p
                style={
                  styles.subtitleSmall
                }
              >
                For this first test, we're submitting
                a simple text result. Later this will
                come from the real AI agent.
              </p>

              <textarea
                value={
                  deliverable
                }
                onChange={(
                  event
                ) => {
                  setDeliverable(
                    event.target.value
                  );

                  setDeliverableHash(
                    null
                  );
                }}
                rows={9}
                disabled={
                  loading
                }
                style={
                  styles.textarea
                }
              />

              <button
                onClick={
                  prepareDeliverable
                }
                disabled={
                  loading
                }
                style={
                  styles.secondaryButton
                }
              >
                Prepare Deliverable Hash
              </button>

              {deliverableHash && (
                <div
                  style={
                    styles.good
                  }
                >
                  <strong>
                    Deliverable hash
                  </strong>

                  <code
                    style={
                      styles.code
                    }
                  >
                    {
                      deliverableHash
                    }
                  </code>
                </div>
              )}

              <button
                onClick={
                  simulateSubmit
                }
                disabled={
                  loading ||
                  !deliverable.trim()
                }
                style={
                  styles.secondaryButton
                }
              >
                Simulate submit()
              </button>

              <button
                onClick={
                  submitDeliverable
                }
                disabled={
                  loading ||
                  !deliverable.trim()
                }
                style={
                  styles.primaryButton
                }
              >
                {loading
                  ? "Working..."
                  : `Submit Job #${job.id.toString()}`}
              </button>
            </div>
          )}

        {/* ============================================ */}
        {/* TRANSACTION */}
        {/* ============================================ */}

        {transactionHash && (
          <div
            style={
              styles.panel
            }
          >
            <h3>
              Submission Transaction
            </h3>

            <div
              style={
                styles.good
              }
            >
              ✓ Submit transaction confirmed
            </div>

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
              View submission on BscScan ↗
            </a>
          </div>
        )}

        {/* ============================================ */}
        {/* ERROR */}
        {/* ============================================ */}

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
              {
                error
              }
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}

/*
 * ============================================================
 * INFO COMPONENT
 * ============================================================
 */

function Info({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div
      style={
        styles.info
      }
    >
      <div
        style={
          styles.label
        }
      >
        {label}
      </div>

      <div
        style={
          styles.infoValue
        }
      >
        {value}
      </div>
    </div>
  );
}

/*
 * ============================================================
 * STATUS
 * ============================================================
 */

function getStatusName(
  status: number
): string {
  const names: Record<
    number,
    string
  > = {
    0: "Open",
    1: "Funded",
    2: "Submitted",
    3: "Completed",
    4: "Rejected",
    5: "Expired",
  };

  return (
    names[status] ??
    `Unknown (${status})`
  );
}

/*
 * ============================================================
 * FORMAT TIMESTAMP
 * ============================================================
 */

function formatTimestamp(
  timestamp: bigint
): string {
  const milliseconds =
    Number(timestamp) *
    1000;

  if (
    !Number.isFinite(
      milliseconds
    )
  ) {
    return timestamp.toString();
  }

  return new Date(
    milliseconds
  ).toLocaleString();
}

/*
 * ============================================================
 * NORMALIZE CHAIN
 * ============================================================
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
    return value
      .toLowerCase()
      .startsWith("0x")
      ? parseInt(
          value,
          16
        )
      : Number(
          value
        );
  }

  throw new Error(
    `Unable to determine chain ID: ${String(
      value
    )}`
  );
}

/*
 * ============================================================
 * ERROR FORMATTER
 * ============================================================
 */

function formatError(
  error: unknown
): string {
  if (
    error instanceof Error
  ) {
    const extended =
      error as Error & {
        shortMessage?: string;
        details?: string;
        cause?: unknown;
      };

    if (
      extended.shortMessage
    ) {
      return extended.shortMessage;
    }

    if (
      extended.details
    ) {
      return extended.details;
    }

    if (
      extended.cause
    ) {
      return formatError(
        extended.cause
      );
    }

    return extended.message;
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

/*
 * ============================================================
 * BSC TESTNET
 * ============================================================
 */

function getBscTestnetChain() {
  return {
    id:
      BSC_TESTNET_CHAIN_ID,

    name:
      "BNB Smart Chain Testnet",

    nativeCurrency: {
      name:
        "tBNB",

      symbol:
        "tBNB",

      decimals:
        18,
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

    testnet:
      true,
  } as const;
}

/*
 * ============================================================
 * STYLES
 * ============================================================
 */

const styles: Record<
  string,
  React.CSSProperties
> = {
  page: {
    minHeight:
      "100vh",

    padding:
      "24px",

    background:
      "#0b0d0e",

    color:
      "#e8e6e1",

    fontFamily:
      "system-ui, sans-serif",
  },

  container: {
    maxWidth:
      "680px",

    margin:
      "0 auto",
  },

  panel: {
    marginTop:
      "20px",

    padding:
      "18px",

    borderRadius:
      "12px",

    background:
      "#151819",

    border:
      "1px solid #2c3032",
  },

  subtitle: {
    color:
      "#aaa",

    lineHeight:
      "1.6",
  },

  subtitleSmall: {
    color:
      "#999",

    fontSize:
      "13px",

    lineHeight:
      "1.5",
  },

  label: {
    display:
      "block",

    marginBottom:
      "7px",

    color:
      "#777",

    fontSize:
      "11px",

    textTransform:
      "uppercase",

    letterSpacing:
      "0.08em",
  },

  code: {
    display:
      "block",

    background:
      "#090b0c",

    padding:
      "10px",

    borderRadius:
      "8px",

    fontSize:
      "12px",

    wordBreak:
      "break-all",

    fontFamily:
      "monospace",
  },

  input: {
    width:
      "100%",

    boxSizing:
      "border-box",

    padding:
      "13px",

    borderRadius:
      "9px",

    border:
      "1px solid #34383a",

    background:
      "#090b0c",

    color:
      "#fff",

    fontSize:
      "16px",
  },

  textarea: {
    width:
      "100%",

    minHeight:
      "150px",

    boxSizing:
      "border-box",

    marginBottom:
      "16px",

    padding:
      "11px",

    borderRadius:
      "8px",

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

    lineHeight:
      "1.5",
  },

  primaryButton: {
    width:
      "100%",

    marginTop:
      "16px",

    padding:
      "13px 18px",

    border:
      "none",

    borderRadius:
      "9px",

    background:
      "#f0b90b",

    color:
      "#111",

    fontWeight:
      "800",

    cursor:
      "pointer",
  },

  secondaryButton: {
    width:
      "100%",

    marginTop:
      "12px",

    padding:
      "11px 16px",

    borderRadius:
      "9px",

    border:
      "1px solid #3a3e40",

    background:
      "#1b1e20",

    color:
      "#fff",

    fontWeight:
      "700",

    cursor:
      "pointer",
  },

  info: {
    marginTop:
      "10px",

    padding:
      "10px",

    borderRadius:
      "8px",

    background:
      "#0d1011",
  },

  infoValue: {
    fontSize:
      "13px",

    wordBreak:
      "break-all",
  },

  task: {
    marginTop:
      "16px",

    padding:
      "14px",

    borderRadius:
      "9px",

    background:
      "#0d1011",

    lineHeight:
      "1.6",
  },

  good: {
    marginTop:
      "14px",

    padding:
      "13px",

    borderRadius:
      "9px",

    background:
      "rgba(50,200,120,.08)",

    border:
      "1px solid rgba(50,200,120,.3)",

    color:
      "#7ee2a8",

    lineHeight:
      "1.5",
  },

  warning: {
    marginTop:
      "14px",

    padding:
      "13px",

    borderRadius:
      "9px",

    background:
      "rgba(240,185,11,.08)",

    border:
      "1px solid rgba(240,185,11,.25)",

    color:
      "#e5cf79",
  },

  error: {
    marginTop:
      "20px",

    padding:
      "16px",

    borderRadius:
      "10px",

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

    fontSize:
      "12px",

    lineHeight:
      "1.6",
  },

  link: {
    display:
      "block",

    marginTop:
      "10px",

    color:
      "#f0b90b",

    fontWeight:
      "700",

    textDecoration:
      "none",
  },
};
