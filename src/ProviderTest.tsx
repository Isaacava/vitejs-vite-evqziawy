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

type SimulationOutcome = {
  passed: boolean;
  message: string;
  hash: `0x${string}`;
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
   * RESTORE LAST JOB
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
        setJobIdInput(saved);
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
   * LOAD JOB FROM CHAIN
   * ========================================================
   */

  async function loadJob(
    overrideId?: string
  ): Promise<Job | null> {
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

      /*
       * Load policy.
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

        setRegisteredPolicy(
          policy.toLowerCase() ===
            zeroAddress
            ? null
            : policy
        );
      } catch (policyError) {
        console.warn(
          "Could not read job policy:",
          policyError
        );

        setRegisteredPolicy(
          null
        );
      }

      /*
       * Only prefill deliverable if we don't
       * already have a user-created one.
       */
      if (
        !deliverable.trim()
      ) {
        setDeliverable(
          `Provider test result for Job #${id.toString()}:\n\nThe provider successfully received and processed this funded ERC-8183 job.\n\nTask:\n${loadedJob.description}`
        );
      }

      /*
       * Keep the on-chain deliverable hash
       * if the job is already submitted.
       */
      if (
        loadedJob.status ===
          2 &&
        loadedJob.deliverable !==
          "0x0000000000000000000000000000000000000000000000000000000000000000"
      ) {
        setDeliverableHash(
          loadedJob.deliverable
        );
      }

      setStatus(
        `✅ Job #${id.toString()} loaded`
      );

      return loadedJob;
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

      return null;
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
   * FULL PROVIDER DIAGNOSTIC + SIMULATION
   * ========================================================
   */

  async function runDiagnostic(): Promise<SimulationOutcome | null> {
    try {
      setError(null);

      if (!address) {
        throw new Error(
          "Connect the provider wallet first."
        );
      }

      /*
       * Read the freshest job directly from BSC.
       */
      const currentJob =
        await readJobDirectly(
          jobIdInput
        );

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
       * Read registered policy.
       */
      let policy:
        | Address
        | null =
        registeredPolicy;

      try {
        policy =
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
      } catch {
        policy =
          null;
      }

      setRegisteredPolicy(
        policy
      );

      const currentTime =
        BigInt(
          Math.floor(
            Date.now() /
              1000
          )
        );

      const expired =
        currentJob.expiredAt <=
        currentTime;

      const providerMatches =
        currentJob.provider.toLowerCase() ===
        address.toLowerCase();

      const statusIsFunded =
        currentJob.status ===
        1;

      const zeroDeliverable =
        "0x0000000000000000000000000000000000000000000000000000000000000000";

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

      const preliminary: DiagnosticState =
        {
          jobId:
            currentJob.id.toString(),

          status:
            getStatusName(
              currentJob.status
            ),

          provider:
            currentJob.provider,

          connectedWallet:
            address,

          client:
            currentJob.client,

          evaluator:
            currentJob.evaluator,

          hook:
            currentJob.hook,

          policy:
            policy ??
            "Not available",

          expiry:
            formatTimestamp(
              currentJob.expiredAt
            ),

          expired,

          deliverable:
            hash ??
            currentJob.deliverable,

          providerMatches,

          statusIsFunded,

          simulation:
            "Not yet simulated",
        };

      setDiagnostic(
        preliminary
      );

      /*
       * If already submitted, there is no reason
       * to simulate submit again.
       */
      if (
        currentJob.status ===
        2
      ) {
        const submittedDiagnostic: DiagnosticState =
          {
            ...preliminary,

            simulation:
              "✅ Job is already SUBMITTED. submit() is no longer available.",
          };

        setDiagnostic(
          submittedDiagnostic
        );

        setStatus(
          "✅ Job is already SUBMITTED"
        );

        return {
          passed: false,

          message:
            submittedDiagnostic.simulation,

          hash:
            currentJob.deliverable,
        };
      }

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

      if (
        !providerMatches
      ) {
        throw new Error(
          [
            "Provider wallet mismatch.",

            "",

            `Job provider: ${currentJob.provider}`,

            `Connected wallet: ${address}`,
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
              currentJob.expiredAt
            )}`,
          ].join(
            "\n"
          )
        );
      }

      if (
        !hash ||
        hash ===
          zeroDeliverable
      ) {
        throw new Error(
          "A valid deliverable hash is required."
        );
      }

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
              currentJob.id,

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
          "✅ submit() simulation passed"
        );

        return {
          passed: true,

          message:
            "✅ submit() simulation passed",

          hash,
        };
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

                "Revert / error:",

                reason,
              ].join(
                "\n"
              ),
          };

        setDiagnostic(
          failedDiagnostic
        );

        setStatus(
          "❌ submit() simulation failed"
        );

        setError(
          reason
        );

        return {
          passed: false,

          message:
            reason,

          hash,
        };
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

      return null;
    } finally {
      setLoading(false);
    }
  }

  /*
   * ========================================================
   * ACTUAL SUBMIT
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

      if (
        !job
      ) {
        throw new Error(
          "Load a job first."
        );
      }

      /*
       * Never submit again if already submitted.
       */
      if (
        job.status ===
        2
      ) {
        setStatus(
          "✅ This job is already SUBMITTED."
        );

        return;
      }

      if (
        job.status !==
        1
      ) {
        throw new Error(
          `Job is ${getStatusName(
            job.status
          )}, not FUNDED.`
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

      /*
       * Generate current hash.
       */
      const hash =
        keccak256(
          stringToBytes(
            deliverable
          )
        );

      setDeliverableHash(
        hash
      );

      /*
       * Simulate and use the RETURNED result.
       *
       * This fixes the previous React-state race.
       */
      const simulation =
        await runDiagnostic();

      if (
        !simulation
      ) {
        throw new Error(
          "Could not complete the submit simulation."
        );
      }

      if (
        !simulation.passed
      ) {
        throw new Error(
          [
            "submit() simulation did not pass.",

            "",

            simulation.message,
          ].join(
            "\n"
          )
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
        "Simulation passed. Waiting for wallet confirmation..."
      );

      /*
       * Send transaction.
       */
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
              job.id,

              hash,

              "0x",
            ],
          }
        );

      setTransactionHash(
        txHash
      );

      setStatus(
        "Submission transaction sent. Waiting for BSC confirmation..."
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
          "The submit transaction was mined but failed."
        );
      }

      /*
       * Immediately refresh the actual blockchain state.
       */
      const refreshedJob =
        await readJobDirectly(
          job.id.toString()
        );

      if (
        !refreshedJob
      ) {
        throw new Error(
          "Submission succeeded, but the updated job could not be read."
        );
      }

      setJob(
        refreshedJob
      );

      if (
        refreshedJob.status ===
        2
      ) {
        setStatus(
          `✅ Job #${job.id.toString()} is now SUBMITTED`
        );

        setError(
          null
        );
      } else {
        setStatus(
          `Transaction confirmed, but job state is ${getStatusName(
            refreshedJob.status
          )}`
        );
      }
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

  /*
   * ========================================================
   * DIRECT JOB READER
   * ========================================================
   */

  async function readJobDirectly(
    idInput: string
  ): Promise<Job | null> {
    const rawId =
      idInput.trim();

    if (
      !rawId ||
      !/^\d+$/.test(rawId)
    ) {
      throw new Error(
        "Enter a valid numeric job ID."
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
          Provider-side ERC-8183 testing:
          receive work, submit a deliverable,
          then wait for evaluation and settlement.
        </p>

        {/* ================================================= */}
        {/* PROVIDER WALLET */}
        {/* ================================================= */}

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

        {/* ================================================= */}
        {/* LOAD JOB */}
        {/* ================================================= */}

        {address && (
          <div
            style={
              styles.panel
            }
          >
            <h3>
              Load Job
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
              placeholder="Example: 503"
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

        {/* ================================================= */}
        {/* JOB DETAILS */}
        {/* ================================================= */}

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
                getJobBannerStyle(
                  job
                )
              }
            >
              {getJobBannerText(
                job
              )}
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

            <button
              onClick={() =>
                void loadJob(
                  job.id.toString()
                )
              }
              disabled={
                loading
              }
              style={
                styles.secondaryButton
              }
            >
              Refresh Job From Blockchain
            </button>
          </div>
        )}

        {/* ================================================= */}
        {/* DIAGNOSTIC */}
        {/* ================================================= */}

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
                This reads the current on-chain state
                and tests submit() without sending a
                transaction.
              </p>

              <button
                onClick={() =>
                  void runDiagnostic()
                }
                disabled={
                  loading
                }
                style={
                  styles.secondaryButton
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

        {/* ================================================= */}
        {/* SUBMISSION SECTION */}
        {/* ================================================= */}

        {job &&
          address && (
            <div
              style={
                styles.panel
              }
            >
              <h3>
                Work Submission
              </h3>

              {job.status === 0 && (
                <div
                  style={
                    styles.warning
                  }
                >
                  Job is still OPEN. The provider cannot
                  submit until the client funds it.
                </div>
              )}

              {job.status === 1 && (
                <>
                  <p
                    style={
                      styles.subtitleSmall
                    }
                  >
                    This is the provider's deliverable.
                    Later this will come from the real
                    AI agent.
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
                      loading ||
                      !deliverable.trim()
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
                    onClick={() =>
                      void runDiagnostic()
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
                    {loading
                      ? "Working..."
                      : `Submit Job #${job.id.toString()}`}
                  </button>
                </>
              )}

              {job.status === 2 && (
                <div
                  style={
                    styles.submittedBanner
                  }
                >
                  <strong>
                    ✅ Work Submitted
                  </strong>

                  <p>
                    Job #{job.id.toString()} is now
                    SUBMITTED on-chain.
                  </p>

                  <p>
                    The provider should not submit again.
                    The next stage is evaluation and
                    settlement.
                  </p>
                </div>
              )}

              {job.status === 3 && (
                <div
                  style={
                    styles.completedBanner
                  }
                >
                  <strong>
                    🎉 Job Completed
                  </strong>

                  <p>
                    The evaluator has approved the work
                    and the escrow has been released.
                  </p>
                </div>
              )}

              {job.status === 4 && (
                <div
                  style={
                    styles.warning
                  }
                >
                  <strong>
                    Job Rejected
                  </strong>

                  <p>
                    The evaluator rejected the submitted
                    work.
                  </p>
                </div>
              )}

              {job.status === 5 && (
                <div
                  style={
                    styles.warning
                  }
                >
                  <strong>
                    Job Expired
                  </strong>

                  <p>
                    This job can no longer be submitted.
                  </p>
                </div>
              )}
            </div>
          )}

        {/* ================================================= */}
        {/* TRANSACTION */}
        {/* ================================================= */}

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

        {/* ================================================= */}
        {/* ERROR */}
        {/* ================================================= */}

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
 * BANNER HELPERS
 * ============================================================
 */

function getJobBannerText(
  job: Job
): string {
  if (
    isExpired(
      job.expiredAt
    ) &&
    job.status !==
      3 &&
    job.status !==
      4 &&
    job.status !==
      5
  ) {
    return "⏰ This job has expired.";
  }

  switch (
    job.status
  ) {
    case 0:
      return "Job is OPEN.";

    case 1:
      return "✓ Job is FUNDED and ready for the provider.";

    case 2:
      return "✅ Job is SUBMITTED. Waiting for evaluation/settlement.";

    case 3:
      return "🎉 Job is COMPLETED.";

    case 4:
      return "Job is REJECTED.";

    case 5:
      return "Job is EXPIRED.";

    default:
      return `Current state: ${getStatusName(
        job.status
      )}`;
  }
}

function getJobBannerStyle(
  job: Job
): React.CSSProperties {
  if (
    job.status ===
    2
  ) {
    return styles.submittedBanner;
  }

  if (
    job.status ===
    3
  ) {
    return styles.completedBanner;
  }

  if (
    isExpired(
      job.expiredAt
    )
  ) {
    return styles.warning;
  }

  if (
    job.status ===
    1
  ) {
    return styles.good;
  }

  return styles.warning;
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
 * ERROR EXTRACTION
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

  submittedBanner: {
    marginTop:
      "14px",

    padding:
      "14px",

    borderRadius:
      "9px",

    background:
      "rgba(90,160,255,.08)",

    border:
      "1px solid rgba(90,160,255,.3)",

    color:
      "#9fc9ff",

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
