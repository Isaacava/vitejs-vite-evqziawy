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
  type Hex,
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

type DiagnosticState = {
  jobId: string;
  status: string;
  provider: string;
  connectedWallet: string;
  client: string;
  evaluator: string;
  hook: string;
  policy: string;
  expiry: string;
  expired: boolean;
  deliverable: string;
  providerMatches: boolean;
  statusIsFunded: boolean;
  simulation: string;
};

export default function ProviderTest() {
  const [provider, setProvider] =
    useState<EIP1193Provider | null>(null);

  const [address, setAddress] =
    useState<Address | null>(null);

  const [jobIdInput, setJobIdInput] =
    useState("");

  const [job, setJob] =
    useState<Job | null>(null);

  const [registeredPolicy, setRegisteredPolicy] =
    useState<Address | null>(null);

  const [deliverable, setDeliverable] =
    useState("");

  const [deliverableHash, setDeliverableHash] =
    useState<`0x${string}` | null>(null);

  const [transactionHash, setTransactionHash] =
    useState<`0x${string}` | null>(null);

  const [status, setStatus] =
    useState(
      "Provider wallet not connected"
    );

  const [error, setError] =
    useState<string | null>(null);

  const [loading, setLoading] =
    useState(false);

  const [diagnostic, setDiagnostic] =
    useState<DiagnosticState | null>(
      null
    );

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
        "Could not restore provider job:",
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
              "ERC-8183 Provider Diagnostic",

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

      setJob(
        loadedJob
      );

      try {
        window.localStorage.setItem(
          SAVED_PROVIDER_JOB_KEY,
          id.toString()
        );
      } catch (err) {
        console.warn(
          "Could not save provider job:",
          err
        );
      }

      setJobIdInput(
        id.toString()
      );

      setRegisteredPolicy(
        null
      );

      /*
       * Read the policy registered for this job.
       */
      try {
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
                id,
              ],
            }
          )) as Address;

        const zeroAddress =
          "0x0000000000000000000000000000000000000000";

        if (
          policy.toLowerCase() !==
          zeroAddress
        ) {
          setRegisteredPolicy(
            policy
          );
        }
      } catch (policyError) {
        console.warn(
          "Could not read job policy:",
          policyError
        );
      }

      setDeliverable(
        `Provider test result for Job #${id.toString()}:\n\nThe provider successfully received and processed this funded ERC-8183 job.\n\nTask:\n${loadedJob.description}`
      );

      setDeliverableHash(
        null
      );

      setTransactionHash(
        null
      );

      setDiagnostic(
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

      setDiagnostic(
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
   * RUN FULL DIAGNOSTIC
   * ========================================================
   */

  async function runDiagnostic() {
    try {
      setError(null);

      if (!address) {
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

      setLoading(true);

      setStatus(
        `Running full diagnostic for Job #${currentJob.id.toString()}...`
      );

      /*
       * Refresh the job directly from chain.
       */
      const chainJob =
        (await publicClient.readContract(
          {
            address:
              ERC8183_ADDRESSES.commerce,

            abi:
              COMMERCE_ABI,

            functionName:
              "getJob",

            args: [
              currentJob.id,
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

      /*
       * Refresh policy.
       */
      let policy =
        registeredPolicy;

      try {
        const policyResult =
          (await publicClient.readContract(
            {
              address:
                ERC8183_ADDRESSES.router,

              abi:
                ROUTER_ABI,

              functionName:
                "jobPolicy",

              args: [
                currentJob.id,
              ],
            }
          )) as Address;

        policy =
          policyResult;
      } catch {
        policy =
          null;
      }

      const currentTime =
        BigInt(
          Math.floor(
            Date.now() /
              1000
          )
        );

      const expired =
        chainJob.expiredAt <=
        currentTime;

      const providerMatches =
        chainJob.provider.toLowerCase() ===
        address.toLowerCase();

      const statusIsFunded =
        Number(
          chainJob.status
        ) === 1;

      /*
       * Prepare deliverable hash.
       */
      let hash =
        deliverableHash;

      if (
        !hash &&
        deliverable.trim()
      ) {
        hash =
          keccak256(
            stringToBytes(
              deliverable
            )
          );

        setDeliverableHash(
          hash
        );
      }

      /*
       * Build diagnostic before simulation.
       */
      const preliminary: DiagnosticState =
        {
          jobId:
            chainJob.id.toString(),

          status:
            getStatusName(
              Number(
                chainJob.status
              )
            ),

          provider:
            chainJob.provider,

          connectedWallet:
            address,

          client:
            chainJob.client,

          evaluator:
            chainJob.evaluator,

          hook:
            chainJob.hook,

          policy:
            policy ??
            "Not available",

          expiry:
            formatTimestamp(
              chainJob.expiredAt
            ),

          expired,

          deliverable:
            hash ??
            chainJob.deliverable,

          providerMatches,

          statusIsFunded,

          simulation:
            "Not yet simulated",
        };

      setDiagnostic(
        preliminary
      );

      /*
       * Stop before simulation if basic state
       * is already invalid.
       */
      if (
        !providerMatches
      ) {
        throw new Error(
          [
            "Provider wallet mismatch.",

            "",

            `Job provider: ${chainJob.provider}`,

            `Connected wallet: ${address}`,
          ].join(
            "\n"
          )
        );
      }

      if (
        !statusIsFunded
      ) {
        throw new Error(
          [
            "Job is not FUNDED.",

            "",

            `Current state: ${getStatusName(
              Number(
                chainJob.status
              )
            )}`,
          ].join(
            "\n"
          )
        );
      }

      if (
        expired
      ) {
        throw new Error(
          [
            "Job has expired.",

            "",

            `Expiry: ${formatTimestamp(
              chainJob.expiredAt
            )}`,
          ].join(
            "\n"
          )
        );
      }

      if (
        !hash
      ) {
        throw new Error(
          "No deliverable hash could be generated."
        );
      }

      /*
       * Simulate submit().
       */
      setStatus(
        "Basic checks passed. Simulating submit()..."
      );

      try {
        await publicClient.simulateContract(
          {
            address:
              ERC8183_ADDRESSES.commerce,

            abi:
              COMMERCE_ABI,

            functionName:
              "submit",

            args: [
              chainJob.id,

              hash,

              "0x",
            ],

            account:
              address,
          }
        );

        const successDiagnostic: DiagnosticState =
          {
            ...preliminary,

            deliverable:
              hash,

            simulation:
              "✅ submit() simulation passed",
          };

        setDiagnostic(
          successDiagnostic
        );

        setStatus(
          "✅ Full diagnostic passed"
        );
      } catch (simulationError) {
        const reason =
          extractDetailedError(
            simulationError
          );

        const failedDiagnostic: DiagnosticState =
          {
            ...preliminary,

            deliverable:
              hash,

            simulation:
              [
                "❌ submit() simulation failed",

                "",

                "Error:",
                reason,
              ].join(
                "\n"
              ),
          };

        setDiagnostic(
          failedDiagnostic
        );

        setStatus(
          "❌ Full diagnostic completed — submit() still reverts"
        );
      }
    } catch (err) {
      console.error(
        "Diagnostic failed:",
        err
      );

      setStatus(
        "Diagnostic failed"
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
   * SUBMIT
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

      if (
        !deliverable.trim()
      ) {
        throw new Error(
          "Enter a deliverable first."
        );
      }

      setLoading(
        true
      );

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
       * Always refresh diagnostic state
       * immediately before sending.
       */
      await runDiagnostic();

      /*
       * We intentionally require the user
       * to run the diagnostic first and only
       * allow a transaction when it passes.
       */
      const freshDiagnostic =
        diagnostic;

      if (
        !freshDiagnostic
      ) {
        throw new Error(
          "Run the full provider diagnostic first."
        );
      }

      if (
        !freshDiagnostic.simulation.includes(
          "passed"
        )
      ) {
        throw new Error(
          [
            "submit() simulation did not pass.",

            "",

            freshDiagnostic.simulation,
          ].join(
            "\n"
          )
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
        "Simulation passed. Waiting for wallet confirmation..."
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
      setLoading(
        false
      );
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
          Provider Agent Test
        </h1>

        <p
          style={
            styles.subtitle
          }
        >
          Diagnose and test the provider side of
          ERC-8183.
        </p>

        {/* WALLET */}

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

        {/* LOAD JOB */}

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
                  event.target.value
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
              {
                loading
                  ? "Loading..."
                  : "Load Job"
              }
            </button>
          </div>
        )}

        {/* JOB DETAILS */}

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
              label="Evaluator"
              value={
                job.evaluator
              }
            />

            <Info
              label="Hook"
              value={
                job.hook
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
                !isExpired(
                  job.expiredAt
                )
                  ? styles.good
                  : styles.warning
              }
            >
              {job.status ===
                1 &&
              !isExpired(
                job.expiredAt
              )
                ? "✓ Job is FUNDED and not expired."
                : `Current state: ${getStatusName(
                    job.status
                  )}`}
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

        {/* DIAGNOSTIC */}

        {job &&
          address && (
            <div
              style={
                styles.panel
              }
            >
              <h3>
                Provider Diagnostic
              </h3>

              <p
                style={
                  styles.subtitleSmall
                }
              >
                This checks the complete on-chain state
                before we send a submit transaction.
              </p>

              <button
                onClick={() =>
                  void runDiagnostic()
                }
                disabled={
                  loading
                }
                style={
                  styles.primaryButton
                }
              >
                {loading
                  ? "Running..."
                  : "Run Full Diagnostic"}
              </button>

              {diagnostic && (
                <div
                  style={
                    styles.diagnosticBox
                  }
                >
                  <Info
                    label="Job"
                    value={
                      diagnostic.jobId
                    }
                  />

                  <Info
                    label="Status"
                    value={
                      diagnostic.status
                    }
                  />

                  <Info
                    label="Job provider"
                    value={
                      diagnostic.provider
                    }
                  />

                  <Info
                    label="Connected wallet"
                    value={
                      diagnostic.connectedWallet
                    }
                  />

                  <Info
                    label="Provider match"
                    value={
                      diagnostic.providerMatches
                        ? "YES"
                        : "NO"
                    }
                  />

                  <Info
                    label="Client"
                    value={
                      diagnostic.client
                    }
                  />

                  <Info
                    label="Evaluator"
                    value={
                      diagnostic.evaluator
                    }
                  />

                  <Info
                    label="Hook"
                    value={
                      diagnostic.hook
                    }
                  />

                  <Info
                    label="Registered policy"
                    value={
                      diagnostic.policy
                    }
                  />

                  <Info
                    label="Expiry"
                    value={
                      diagnostic.expiry
                    }
                  />

                  <Info
                    label="Expired"
                    value={
                      diagnostic.expired
                        ? "YES"
                        : "NO"
                    }
                  />

                  <Info
                    label="Deliverable"
                    value={
                      diagnostic.deliverable
                    }
                  />

                  <div
                    style={
                      diagnostic.simulation.includes(
                        "passed"
                      )
                        ? styles.good
                        : styles.warning
                    }
                  >
                    <div
                      style={
                        styles.label
                      }
                    >
                      submit() result
                    </div>

                    <pre
                      style={
                        styles.pre
                      }
                    >
                      {
                        diagnostic.simulation
                      }
                    </pre>
                  </div>
                </div>
              )}
            </div>
          )}

        {/* DELIVERABLE */}

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

                  setDiagnostic(
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
                  runDiagnostic
                }
                disabled={
                  loading ||
                  !deliverable.trim()
                }
                style={
                  styles.secondaryButton
                }
              >
                Run Diagnostic + Simulate submit()
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
                {
                  loading
                    ? "Working..."
                    : `Submit Job #${job.id.toString()}`
                }
              </button>
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
              Submission Transaction
            </h3>

            <div
              style={
                styles.good
              }
            >
              ✓ Submission transaction confirmed
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
 * EXPIRY
 * ============================================================
 */

function isExpired(
  timestamp: bigint
): boolean {
  return (
    timestamp <=
    BigInt(
      Math.floor(
        Date.now() /
          1000
      )
    )
  );
}

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
 * ERROR DECODER
 * ============================================================
 */

function extractDetailedError(
  error: unknown
): string {
  const pieces: string[] = [];

  function collect(
    value: unknown,
    depth = 0
  ) {
    if (
      depth > 6 ||
      value === null ||
      value === undefined
    ) {
      return;
    }

    if (
      typeof value ===
      "string"
    ) {
      if (
        value.trim()
      ) {
        pieces.push(
          value.trim()
        );
      }

      return;
    }

    if (
      typeof value ===
      "object"
    ) {
      const obj =
        value as Record<
          string,
          unknown
        >;

      const preferredKeys = [
        "shortMessage",
        "details",
        "reason",
        "message",
        "data",
      ];

      for (
        const key of preferredKeys
      ) {
        if (
          obj[key] !==
          undefined
        ) {
          if (
            typeof obj[key] ===
            "string"
          ) {
            pieces.push(
              `${key}: ${obj[key]}`
            );
          } else {
            collect(
              obj[key],
              depth + 1
            );
          }
        }
      }

      if (
        obj.cause
      ) {
        collect(
          obj.cause,
          depth + 1
        );
      }

      if (
        obj.metaMessages
      ) {
        collect(
          obj.metaMessages,
          depth + 1
        );
      }

      if (
        obj.contracts
      ) {
        collect(
          obj.contracts,
          depth + 1
        );
      }
    }
  }

  collect(
    error
  );

  const unique =
    Array.from(
      new Set(
        pieces
      )
    );

  if (
    unique.length >
    0
  ) {
    return unique.join(
      "\n"
    );
  }

  /*
   * Last-resort JSON representation.
   */
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

function formatError(
  error: unknown
): string {
  return extractDetailedError(
    error
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
      "700px",

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

    marginBottom:
      "12px",
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

  diagnosticBox: {
    marginTop:
      "14px",

    padding:
      "12px",

    borderRadius:
      "10px",

    background:
      "#0d1011",

    border:
      "1px solid #282c2e",
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

    color:
      "#ddd",
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
