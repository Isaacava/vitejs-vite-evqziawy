import {
  useEffect,
  useState,
} from "react";

import {
  createWalletClient,
  custom,
  type Address,
  type EIP1193Provider,
} from "viem";

import {
  EthereumProvider,
} from "@walletconnect/ethereum-provider";

import {
  COMMERCE_ABI,
  ERC8183_ADDRESSES,
  ROUTER_ABI,
  publicClient,
} from "./lib/erc8183";

const WALLETCONNECT_PROJECT_ID =
  "1dbe8fd5e4974ae7c80d074c4082b5a0";

const BSC_TESTNET_CHAIN_ID = 97;

const SAVED_SETTLEMENT_JOB_KEY =
  "bnb_agent_marketplace_settlement_job";

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

type SettlementResult = {
  passed: boolean;
  message: string;
};

export default function SettlementTest() {
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

  const [policy, setPolicy] =
    useState<Address | null>(
      null
    );

  const [simulation, setSimulation] =
    useState<SettlementResult | null>(
      null
    );

  const [transactionHash, setTransactionHash] =
    useState<`0x${string}` | null>(
      null
    );

  const [status, setStatus] =
    useState(
      "Settlement wallet not connected"
    );

  const [error, setError] =
    useState<string | null>(
      null
    );

  const [loading, setLoading] =
    useState(false);

  /*
   * =========================================================
   * RESTORE SAVED JOB
   * =========================================================
   */

  useEffect(() => {
    try {
      const saved =
        window.localStorage.getItem(
          SAVED_SETTLEMENT_JOB_KEY
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
        "Could not restore settlement job:",
        err
      );
    }
  }, []);

  /*
   * =========================================================
   * CONNECT WALLET
   * =========================================================
   */

  async function connectWallet() {
    try {
      setError(null);

      setStatus(
        "Connecting settlement wallet..."
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
              "BNB Agent Marketplace Settlement",

            description:
              "ERC-8183 Settlement Test",

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
          "No wallet account returned."
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

      setProvider(
        walletProvider
      );

      setAddress(
        accounts[0] as Address
      );

      setStatus(
        "✅ Settlement wallet connected"
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
        "Settlement wallet connection failed:",
        err
      );

      setStatus(
        "Wallet connection failed"
      );

      setError(
        formatError(err)
      );
    }
  }

  /*
   * =========================================================
   * LOAD JOB
   * =========================================================
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

      const loaded: Job = {
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

      setJob(
        loaded
      );

      try {
        window.localStorage.setItem(
          SAVED_SETTLEMENT_JOB_KEY,
          id.toString()
        );
      } catch (err) {
        console.warn(
          "Could not save settlement job:",
          err
        );
      }

      setJobIdInput(
        id.toString()
      );

      /*
       * Read policy bound to this job.
       */
      try {
        const policyAddress =
          (await publicClient.readContract(
            {
              address:
                ERC8183_ADDRESSES.router,

              abi:
                ROUTER_ABI,

              functionName:
                "jobPolicy",

              args: [
                id,
              ],
            }
          )) as Address;

        setPolicy(
          policyAddress
        );
      } catch {
        setPolicy(
          null
        );
      }

      setSimulation(
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
        "Load settlement job failed:",
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
   * =========================================================
   * SIMULATE SETTLEMENT
   * =========================================================
   */

  async function simulateSettlement(): Promise<SettlementResult | null> {
    try {
      setError(null);

      if (
        !address
      ) {
        throw new Error(
          "Connect a wallet first."
        );
      }

      const currentJob =
        job;

      if (!currentJob) {
        throw new Error(
          "Load a job first."
        );
      }

      /*
       * Settlement is only meaningful once
       * the provider has submitted.
       */
      if (
        currentJob.status !==
        2
      ) {
        throw new Error(
          [
            "This job is not SUBMITTED.",

            "",

            `Current state: ${getStatusName(
              currentJob.status
            )}`,

            "",

            "Settlement is tested after provider submission.",
          ].join(
            "\n"
          )
        );
      }

      if (
        !policy
      ) {
        throw new Error(
          "No policy is registered for this job."
        );
      }

      setLoading(
        true
      );

      setStatus(
        "Simulating router.settle()..."
      );

      await publicClient.simulateContract(
        {
          address:
            ERC8183_ADDRESSES.router,

          abi:
            ROUTER_ABI,

          functionName:
            "settle",

          args: [
            currentJob.id,

            "0x",
          ],

          account:
            address,
        }
      );

      const result: SettlementResult =
        {
          passed: true,

          message:
            [
              "✅ router.settle() simulation passed.",

              "",

              `Job #${currentJob.id.toString()} is SUBMITTED.`,

              `Policy: ${policy}`,

              "",

              "The policy currently allows settlement.",
            ].join(
              "\n"
            ),
        };

      setSimulation(
        result
      );

      setStatus(
        "✅ Settlement simulation passed"
      );

      return result;
    } catch (err) {
      const reason =
        formatError(
          err
        );

      const result: SettlementResult =
        {
          passed: false,

          message:
            [
              "❌ router.settle() simulation failed.",

              "",

              "Reason:",

              reason,
            ].join(
              "\n"
            ),
        };

      setSimulation(
        result
      );

      setStatus(
        "⏳ Settlement is not currently available"
      );

      return result;
    } finally {
      setLoading(
        false
      );
    }
  }

  /*
   * =========================================================
   * ACTUAL SETTLEMENT
   * =========================================================
   */

  async function settleJob() {
    try {
      setError(null);

      if (
        !provider ||
        !address
      ) {
        throw new Error(
          "Connect a settlement wallet first."
        );
      }

      const currentJob =
        job;

      if (!currentJob) {
        throw new Error(
          "Load a job first."
        );
      }

      if (
        currentJob.status ===
        3
      ) {
        setStatus(
          "✅ Job is already COMPLETED"
        );

        return;
      }

      if (
        currentJob.status !==
        2
      ) {
        throw new Error(
          `Job must be SUBMITTED before settlement. Current state: ${getStatusName(
            currentJob.status
          )}`
        );
      }

      setLoading(
        true
      );

      /*
       * Simulate immediately before sending.
       */
      const simulationResult =
        await simulateSettlement();

      if (
        !simulationResult ||
        !simulationResult.passed
      ) {
        throw new Error(
          simulationResult?.message ??
            "Settlement simulation did not pass."
        );
      }

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
        "Settlement simulation passed. Waiting for wallet confirmation..."
      );

      const txHash =
        await walletClient.writeContract(
          {
            address:
              ERC8183_ADDRESSES.router,

            abi:
              ROUTER_ABI,

            functionName:
              "settle",

            args: [
              currentJob.id,

              "0x",
            ],
          }
        );

      setTransactionHash(
        txHash
      );

      setStatus(
        "Settlement transaction submitted. Waiting for BSC..."
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
          "Settlement transaction was mined but failed."
        );
      }

      /*
       * Read the state again.
       */
      const refreshed =
        await readJob(
          currentJob.id.toString()
        );

      setJob(
        refreshed
      );

      if (
        refreshed.status ===
        3
      ) {
        setStatus(
          `🎉 Job #${refreshed.id.toString()} is now COMPLETED`
        );

        setSimulation(
          {
            passed:
              true,

            message:
              [
                "✅ Settlement confirmed.",

                "",

                `Job #${refreshed.id.toString()} is COMPLETED.`,

                "",

                "The settlement flow has completed on-chain.",
              ].join(
                "\n"
              ),
          }
        );

        return;
      }

      setStatus(
        `Settlement confirmed, but current job state is ${getStatusName(
          refreshed.status
        )}`
      );
    } catch (err) {
      console.error(
        "Settlement failed:",
        err
      );

      setStatus(
        "Settlement failed"
      );

      setError(
        formatError(err)
      );
    } finally {
      setLoading(
        false
      );
    }
  }

  /*
   * =========================================================
   * DIRECT JOB READER
   * =========================================================
   */

  async function readJob(
    idInput: string
  ): Promise<Job> {
    const rawId =
      idInput.trim();

    if (
      !rawId ||
      !/^\d+$/.test(rawId)
    ) {
      throw new Error(
        "Enter a valid job ID."
      );
    }

    const id =
      BigInt(rawId);

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

    return {
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
          ERC-8183 Settlement Test
        </h1>

        <p
          style={
            styles.subtitle
          }
        >
          Test the final settlement step after
          provider submission.
        </p>

        {/* WALLET */}

        <div
          style={
            styles.panel
          }
        >
          <h3>
            Settlement Wallet
          </h3>

          {!address ? (
            <button
              onClick={
                connectWallet
              }
              disabled={
                loading
              }
              style={
                styles.primaryButton
              }
            >
              Connect Wallet
            </button>
          ) : (
            <>
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

              <p>
                Status:{" "}
                <strong>
                  {status}
                </strong>
              </p>
            </>
          )}
        </div>

        {/* LOAD JOB */}

        {address && (
          <div
            style={
              styles.panel
            }
          >
            <h3>
              Submitted Job
            </h3>

            <input
              value={
                jobIdInput
              }
              onChange={(
                event
              ) =>
                setJobIdInput(
                  event.target.value
                )
              }
              placeholder="Example: 512"
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

        {/* JOB */}

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
              label="Client"
              value={
                job.client
              }
            />

            <Info
              label="Provider"
              value={
                job.provider
              }
            />

            <Info
              label="Evaluator"
              value={
                job.evaluator
              }
            />

            <Info
              label="Budget"
              value={
                job.budget.toString()
              }
            />

            <Info
              label="Submitted at"
              value={
                job.submittedAt.toString()
              }
            />

            <Info
              label="Policy"
              value={
                policy ??
                "Not found"
              }
            />

            <div
              style={
                job.status ===
                2
                  ? styles.good
                  : job.status ===
                    3
                  ? styles.completedBanner
                  : styles.warning
              }
            >
              {job.status ===
              2
                ? "✅ Job is SUBMITTED and ready for policy settlement when the verdict is available."
                : job.status ===
                  3
                ? "🎉 Job is already COMPLETED."
                : `Current job state: ${getStatusName(
                    job.status
                  )}`}
            </div>
          </div>
        )}

        {/* SETTLEMENT */}

        {job && (
          <div
            style={
              styles.panel
            }
          >
            <h3>
              Settlement
            </h3>

            <div
              style={
                styles.stepBox
              }
            >
              <strong>
                What happens here
              </strong>

              <p>
                1. Read Job state
              </p>

              <p>
                2. Check registered policy
              </p>

              <p>
                3. Simulate router.settle()
              </p>

              <p>
                4. If policy allows settlement, ask
                wallet to sign
              </p>

              <p>
                5. Verify the job becomes COMPLETED
              </p>
            </div>

            <button
              onClick={() =>
                void simulateSettlement()
              }
              disabled={
                loading ||
                job.status ===
                  3
              }
              style={
                styles.secondaryButton
              }
            >
              {loading
                ? "Checking..."
                : "Simulate Settlement"}
            </button>

            {simulation && (
              <div
                style={
                  simulation.passed
                    ? styles.good
                    : styles.warning
                }
              >
                <pre
                  style={
                    styles.pre
                  }
                >
                  {
                    simulation.message
                  }
                </pre>
              </div>
            )}

            {job.status ===
            2 ? (
              <button
                onClick={
                  settleJob
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
                  : `Settle Job #${job.id.toString()}`}
              </button>
            ) : job.status ===
              3 ? (
              <div
                style={
                  styles.completedBanner
                }
              >
                <strong>
                  ✅ Settlement completed
                </strong>

                <p>
                  Job #{job.id.toString()} is COMPLETED
                  on-chain.
                </p>
              </div>
            ) : (
              <div
                style={
                  styles.warning
                }
              >
                Settlement is only available for a
                SUBMITTED job.
              </div>
            )}
          </div>
        )}

        {/* TRANSACTION */}

        {transactionHash && (
          <div
            style={
              styles.panel
            }
          >
            <h3>
              Settlement Transaction
            </h3>

            <code
              style={
                styles.code
              }
            >
              {transactionHash}
            </code>

            <a
              href={`https://testnet.bscscan.com/tx/${transactionHash}`}
              target="_blank"
              rel="noreferrer"
              style={
                styles.link
              }
            >
              View settlement on BscScan ↗
            </a>
          </div>
        )}

        {/* ERROR */}

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
 * ============================================================
 * INFO
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
 * CHAIN
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
      .trim()
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
 * ERROR
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

    whiteSpace:
      "pre-wrap",
  },

  stepBox: {
    marginTop:
      "12px",

    padding:
      "14px",

    borderRadius:
      "10px",

    background:
      "#0d1011",

    border:
      "1px solid #282c2e",

    color:
      "#bbb",

    lineHeight:
      "1.5",
  },

  pre: {
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

    margin:
      "0",
  },

  good: {
    marginTop:
      "14px",

    padding:
      "14px",

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

  completedBanner: {
    marginTop:
      "14px",

    padding:
      "14px",

    borderRadius:
      "9px",

    background:
      "rgba(50,200,120,.12)",

    border:
      "1px solid rgba(50,200,120,.35)",

    color:
      "#7ee2a8",

    lineHeight:
      "1.5",
  },

  warning: {
    marginTop:
      "14px",

    padding:
      "14px",

    borderRadius:
      "9px",

    background:
      "rgba(240,185,11,.08)",

    border:
      "1px solid rgba(240,185,11,.25)",

    color:
      "#e5cf79",

    lineHeight:
      "1.5",
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
