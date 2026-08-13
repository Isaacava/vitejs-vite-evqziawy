import {
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  keccak256,
  stringToBytes,
  type Address,
  type EIP1193Provider,
} from "viem";

import {
  ERC8183_ADDRESSES,
  COMMERCE_ABI,
  getWalletClient,
  publicClient,
} from "./lib/erc8183";

const MISSION_STORAGE_KEY =
  "bnb_agent_marketplace_missions";

const WORKSPACE_SUBMISSIONS_KEY =
  "bnb_agent_workspace_submissions";

type MissionTask = {
  id: string;
  title: string;
  role: string;
  description: string;
  budget: number;
  status:
    | "Planned"
    | "Ready"
    | "In Progress"
    | "Completed";
  assignedAgentId?: string;
  chainJobId?: string;
  chainJobStatus?: number;
};

type Mission = {
  id: string;
  title: string;
  goal: string;
  category: string;
  budget: number;
  createdAt: string;
  status:
    | "Planning"
    | "Ready"
    | "In Progress"
    | "Completed";
  tasks: MissionTask[];
};

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

type SavedSubmission = {
  jobId: string;
  deliverableText: string;
  deliverableHash: `0x${string}`;
  submittedAt?: string;
  transactionHash?: `0x${string}`;
};

type WalletStatus =
  | "Disconnected"
  | "Connecting"
  | "Connected";

export default function AgentWorkspace() {
  const [
    provider,
    setProvider,
  ] = useState<EIP1193Provider | null>(
    null
  );

  const [
    address,
    setAddress,
  ] = useState<Address | null>(
    null
  );

  const [
    walletStatus,
    setWalletStatus,
  ] = useState<WalletStatus>(
    "Disconnected"
  );

  const [
    missions,
    setMissions,
  ] = useState<Mission[]>(
    loadMissions()
  );

  const [
    selectedJobId,
    setSelectedJobId,
  ] = useState("");

  const [
    job,
    setJob,
  ] = useState<Job | null>(
    null
  );

  const [
    deliverable,
    setDeliverable,
  ] = useState("");

  const [
    submission,
    setSubmission,
  ] = useState<SavedSubmission | null>(
    null
  );

  const [
    loading,
    setLoading,
  ] = useState(false);

  const [
    loadingJob,
    setLoadingJob,
  ] = useState(false);

  const [
    message,
    setMessage,
  ] = useState(
    "Connect the provider wallet to begin."
  );

  const [
    error,
    setError,
  ] = useState<string | null>(
    null
  );

  const [
    transactionHash,
    setTransactionHash,
  ] = useState<
    `0x${string}` | null
  >(null);

  const availableJobs =
    useMemo(() => {
      const jobs: {
        jobId: string;
        mission: Mission;
        task: MissionTask;
      }[] = [];

      for (
        const mission of missions
      ) {
        for (
          const task of mission.tasks
        ) {
          if (
            task.chainJobId
          ) {
            jobs.push({
              jobId:
                task.chainJobId,
              mission,
              task,
            });
          }
        }
      }

      return jobs;
    }, [missions]);

  const selectedAssignment =
    availableJobs.find(
      (item) =>
        item.jobId ===
        selectedJobId
    ) ?? null;

  useEffect(() => {
    if (
      availableJobs.length ===
      0
    ) {
      return;
    }

    if (
      selectedJobId &&
      availableJobs.some(
        (item) =>
          item.jobId ===
          selectedJobId
      )
    ) {
      return;
    }

    setSelectedJobId(
      availableJobs[0].jobId
    );
  }, [
    availableJobs,
    selectedJobId,
  ]);

  useEffect(() => {
    if (
      selectedJobId
    ) {
      void loadSelectedJob(
        selectedJobId
      );
    }
  }, [
    selectedJobId,
  ]);

  useEffect(() => {
    if (
      selectedJobId
    ) {
      const saved =
        loadSubmission(
          selectedJobId
        );

      setSubmission(
        saved
      );

      setDeliverable(
        saved?.deliverableText ??
          ""
      );

      setTransactionHash(
        saved?.transactionHash ??
          null
      );
    } else {
      setSubmission(
        null
      );

      setDeliverable(
        ""
      );

      setTransactionHash(
        null
      );
    }
  }, [
    selectedJobId,
  ]);

  function refreshWorkspace() {
    const latest =
      loadMissions();

    setMissions(
      latest
    );

    setMessage(
      "✅ Workspace refreshed."
    );

    setError(
      null
    );
  }

  async function connectWallet() {
    try {
      setWalletStatus(
        "Connecting"
      );

      setError(
        null
      );

      setMessage(
        "Connecting provider wallet..."
      );

      const ethereum =
        window.ethereum as
          | EIP1193Provider
          | undefined;

      if (
        !ethereum
      ) {
        throw new Error(
          "No browser wallet provider was found."
        );
      }

      const accounts =
        (await ethereum.request({
          method:
            "eth_requestAccounts",
        })) as string[];

      if (
        accounts.length ===
        0
      ) {
        throw new Error(
          "Wallet returned no accounts."
        );
      }

      const chainId =
        (await ethereum.request({
          method:
            "eth_chainId",
        })) as string;

      const numericChainId =
        chainId.startsWith(
          "0x"
        )
          ? parseInt(
              chainId,
              16
            )
          : Number(
              chainId
            );

      if (
        numericChainId !==
        97
      ) {
        throw new Error(
          `Wrong network. Connected chain ID ${numericChainId}. Use BSC Testnet (97).`
        );
      }

      const walletAddress =
        accounts[0] as Address;

      setProvider(
        ethereum
      );

      setAddress(
        walletAddress
      );

      setWalletStatus(
        "Connected"
      );

      setMessage(
        "✅ Provider wallet connected."
      );
    } catch (
      err
    ) {
      setWalletStatus(
        "Disconnected"
      );

      setMessage(
        "Wallet connection failed."
      );

      setError(
        formatError(
          err
        )
      );
    }
  }

  async function loadSelectedJob(
    rawJobId: string
  ) {
    if (
      !rawJobId.trim()
    ) {
      return;
    }

    try {
      setLoadingJob(
        true
      );

      setError(
        null
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
              BigInt(
                rawJobId
              ),
            ],
          }
        )) as Job;

      setJob(
        result
      );
    } catch (
      err
    ) {
      setJob(
        null
      );

      setError(
        formatError(
          err
        )
      );
    } finally {
      setLoadingJob(
        false
      );
    }
  }

  async function submitDeliverable() {
    if (
      !provider ||
      !address
    ) {
      setError(
        "Connect the provider wallet first."
      );

      return;
    }

    if (
      !job
    ) {
      setError(
        "Load a job first."
      );

      return;
    }

    if (
      job.status !==
      1
    ) {
      setError(
        `Job #${job.id.toString()} is ${getJobStatus(
          job.status
        )}. Only funded jobs can be submitted.`
      );

      return;
    }

    if (
      job.provider.toLowerCase() !==
      address.toLowerCase()
    ) {
      setError(
        "Connected wallet is not the provider assigned to this job."
      );

      return;
    }

    const text =
      deliverable.trim();

    if (
      !text
    ) {
      setError(
        "Enter the deliverable before submitting."
      );

      return;
    }

    try {
      setLoading(
        true
      );

      setError(
        null
      );

      setMessage(
        "Hashing deliverable..."
      );

      const deliverableHash =
        keccak256(
          stringToBytes(
            text
          )
        );

      const walletClient =
        getWalletClient(
          provider,
          address
        );

      setMessage(
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
            job.id,
            deliverableHash,
            "0x",
          ],

          account:
            address,
        }
      );

      setMessage(
        "Confirm submit() in your wallet..."
      );

      const hash =
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
              deliverableHash,
              "0x",
            ],
          }
        );

      setTransactionHash(
        hash
      );

      setMessage(
        "Waiting for submission confirmation..."
      );

      const receipt =
        await publicClient.waitForTransactionReceipt({
          hash,
        });

      if (
        receipt.status !==
        "success"
      ) {
        throw new Error(
          "submit() transaction failed."
        );
      }

      const saved: SavedSubmission =
        {
          jobId:
            job.id.toString(),

          deliverableText:
            text,

          deliverableHash,

          submittedAt:
            new Date().toISOString(),

          transactionHash:
            hash,
        };

      saveSubmission(
        saved
      );

      setSubmission(
        saved
      );

      await loadSelectedJob(
        job.id.toString()
      );

      setMessage(
        `✅ Job #${job.id.toString()} submitted successfully.`
      );
    } catch (
      err
    ) {
      setMessage(
        "Submission failed."
      );

      setError(
        formatError(
          err
        )
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
        <header
          style={
            styles.header
          }
        >
          <div>
            <div
              style={
                styles.eyebrow
              }
            >
              AGENT WORKSPACE → ERC-8183
            </div>

            <h1
              style={
                styles.title
              }
            >
              Agent Workspace
            </h1>

            <p
              style={
                styles.subtitle
              }
            >
              Receive funded jobs, complete the task, prepare
              a deliverable, and submit the result on-chain.
            </p>
          </div>

          <button
            type="button"
            onClick={
              refreshWorkspace
            }
            style={
              styles.secondaryButton
            }
          >
            ↻ Refresh
          </button>
        </header>

        <section
          style={
            styles.card
          }
        >
          <div
            style={
              styles.sectionHeader
            }
          >
            <div>
              <h2
                style={
                  styles.sectionTitle
                }
              >
                Provider wallet
              </h2>
            </div>

            <span
              style={
                walletStatus ===
                "Connected"
                  ? styles.goodStatus
                  : styles.mutedStatus
              }
            >
              {
                walletStatus
              }
            </span>
          </div>

          {address ? (
            <div
              style={
                styles.walletBox
              }
            >
              <strong>
                Connected provider
              </strong>

              <code
                style={
                  styles.code
                }
              >
                {
                  address
                }
              </code>
            </div>
          ) : (
            <button
              type="button"
              onClick={
                connectWallet
              }
              disabled={
                loading ||
                walletStatus ===
                  "Connecting"
              }
              style={
                styles.primaryButton
              }
            >
              {walletStatus ===
              "Connecting"
                ? "Connecting..."
                : "Connect Provider Wallet"}
            </button>
          )}
        </section>

        <section
          style={
            styles.card
          }
        >
          <div
            style={
              styles.sectionHeader
            }
          >
            <div>
              <h2
                style={
                  styles.sectionTitle
                }
              >
                Assigned jobs
              </h2>

              <p
                style={
                  styles.muted
                }
              >
                Funded ERC-8183 jobs connected to your marketplace
                tasks.
              </p>
            </div>

            <span
              style={
                styles.countBadge
              }
            >
              {
                availableJobs.length
              }
            </span>
          </div>

          {availableJobs.length ===
          0 ? (
            <div
              style={
                styles.empty
              }
            >
              <strong>
                No on-chain jobs found.
              </strong>

              <span>
                Create and fund an ERC-8183 sub-job from the
                Sub-job page first.
              </span>
            </div>
          ) : (
            <div
              style={
                styles.jobList
              }
            >
              {availableJobs.map(
                (
                  item
                ) => (
                  <button
                    type="button"
                    key={
                      `${item.mission.id}-${item.task.id}-${item.jobId}`
                    }
                    onClick={() => {
                      setSelectedJobId(
                        item.jobId
                      );

                      setMessage(
                        `Loading Job #${item.jobId}...`
                      );
                    }}
                    style={
                      selectedJobId ===
                      item.jobId
                        ? {
                            ...styles.jobCard,
                            ...styles.jobCardActive,
                          }
                        : styles.jobCard
                    }
                  >
                    <div
                      style={
                        styles.jobTop
                      }
                    >
                      <strong>
                        Job #
                        {
                          item.jobId
                        }
                      </strong>

                      <span
                        style={
                          styles.jobStatus
                        }
                      >
                        On-chain
                      </span>
                    </div>

                    <div
                      style={
                        styles.jobMission
                      }
                    >
                      {
                        item.mission.title
                      }
                    </div>

                    <div
                      style={
                        styles.jobTask
                      }
                    >
                      {
                        item.task.title
                      }
                    </div>

                    <div
                      style={
                        styles.jobMeta
                      }
                    >
                      {
                        item.task.budget
                      }{" "}
                      U ·{" "}
                      {
                        item.task.role
                      }
                    </div>
                  </button>
                )
              )}
            </div>
          )}
        </section>

        {selectedJobId && (
          <section
            style={
              styles.card
            }
          >
            <div
              style={
                styles.sectionHeader
              }
            >
              <div>
                <div
                  style={
                    styles.eyebrow
                  }
                >
                  ACTIVE JOB
                </div>

                <h2
                  style={
                    styles.sectionTitle
                  }
                >
                  Job #
                  {
                    selectedJobId
                  }
                </h2>
              </div>

              {loadingJob && (
                <span
                  style={
                    styles.mutedStatus
                  }
                >
                  Loading...
                </span>
              )}
            </div>

            {selectedAssignment && (
              <div
                style={
                  styles.assignmentBox
                }
              >
                <Info
                  label="Mission"
                  value={
                    selectedAssignment
                      .mission
                      .title
                  }
                />

                <Info
                  label="Task"
                  value={
                    selectedAssignment
                      .task
                      .title
                  }
                />

                <Info
                  label="Role"
                  value={
                    selectedAssignment
                      .task
                      .role
                  }
                />

                <Info
                  label="Budget"
                  value={`${selectedAssignment.task.budget} U`}
                />
              </div>
            )}

            {job && (
              <div
                style={
                  styles.chainGrid
                }
              >
                <Info
                  label="Status"
                  value={
                    getJobStatus(
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
              </div>
            )}

            {job && (
              <div
                style={
                  styles.taskBox
                }
              >
                <div
                  style={
                    styles.label
                  }
                >
                  On-chain task description
                </div>

                <p
                  style={
                    styles.description
                  }
                >
                  {
                    job.description
                  }
                </p>
              </div>
            )}
          </section>
        )}

        {job &&
          job.status ===
            1 && (
          <section
            style={
              styles.card
            }
          >
            <div
              style={
                styles.eyebrow
              }
            >
              DELIVERABLE
            </div>

            <h2
              style={
                styles.sectionTitle
              }
            >
              Submit completed work
            </h2>

            <p
              style={
                styles.muted
              }
            >
              Paste the final result, repository URL, deployment
              URL, or delivery reference. The platform stores
              the text locally and commits its hash on-chain.
            </p>

            <textarea
              value={
                deliverable
              }
              onChange={(
                event
              ) =>
                setDeliverable(
                  event.target.value
                )
              }
              placeholder="Example: https://github.com/... or a project delivery summary..."
              rows={
                8
              }
              style={
                styles.textarea
              }
            />

            <div
              style={
                styles.hashPreview
              }
            >
              <span>
                Deliverable hash
              </span>

              <code>
                {deliverable.trim()
                  ? keccak256(
                      stringToBytes(
                        deliverable.trim()
                      )
                    )
                  : "—"}
              </code>
            </div>

            <button
              type="button"
              onClick={
                submitDeliverable
              }
              disabled={
                loading ||
                !address ||
                !deliverable.trim()
              }
              style={
                styles.primaryButton
              }
            >
              {loading
                ? "Submitting..."
                : "Submit Deliverable"}
            </button>
          </section>
        )}

        {job &&
          job.status !==
            1 && (
          <section
            style={
              styles.card
            }
          >
            <div
              style={
                styles.infoBanner
              }
            >
              <strong>
                Job status:
              </strong>{" "}
              {
                getJobStatus(
                  job.status
                )
              }

              {job.status ===
                2 && (
                <span>
                  {" "}
                  The deliverable has already been submitted.
                </span>
              )}
            </div>
          </section>
        )}

        {submission && (
          <section
            style={
              styles.card
            }
          >
            <div
              style={
                styles.eyebrow
              }
            >
              SUBMISSION RECORD
            </div>

            <h2
              style={
                styles.sectionTitle
              }
            >
              Deliverable submitted
            </h2>

            <div
              style={
                styles.submissionBox
              }
            >
              <Info
                label="Job"
                value={
                  submission.jobId
                }
              />

              <Info
                label="Submitted"
                value={
                  submission.submittedAt ??
                  "Pending"
                }
              />
            </div>

            <div
              style={
                styles.hashBox
              }
            >
              <span>
                On-chain deliverable hash
              </span>

              <code>
                {
                  submission.deliverableHash
                }
              </code>
            </div>

            {submission.transactionHash && (
              <a
                href={`https://testnet.bscscan.com/tx/${submission.transactionHash}`}
                target="_blank"
                rel="noreferrer"
                style={
                  styles.link
                }
              >
                View submission transaction ↗
              </a>
            )}
          </section>
        )}

        <section
          style={
            styles.statusCard
          }
        >
          <strong>
            Status
          </strong>

          <p>
            {
              message
            }
          </p>
        </section>

        {error && (
          <section
            style={
              styles.errorCard
            }
          >
            <strong>
              Error
            </strong>

            <pre
              style={
                styles.error
              }
            >
              {
                error
              }
            </pre>
          </section>
        )}
      </div>
    </div>
  );
}

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
      <span
        style={
          styles.label
        }
      >
        {
          label
        }
      </span>

      <strong
        style={
          styles.infoValue
        }
      >
        {
          value
        }
      </strong>
    </div>
  );
}

function getJobStatus(
  status: number
): string {
  const statuses: Record<
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
    statuses[status] ??
    `Unknown (${status})`
  );
}

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

  return String(
    error
  );
}

function loadMissions(): Mission[] {
  try {
    const raw =
      window.localStorage.getItem(
        MISSION_STORAGE_KEY
      );

    if (!raw) {
      return [];
    }

    const parsed =
      JSON.parse(
        raw
      );

    return Array.isArray(
      parsed
    )
      ? (parsed as Mission[])
      : [];
  } catch {
    return [];
  }
}

function loadSubmission(
  jobId: string
): SavedSubmission | null {
  try {
    const raw =
      window.localStorage.getItem(
        WORKSPACE_SUBMISSIONS_KEY
      );

    if (!raw) {
      return null;
    }

    const parsed =
      JSON.parse(
        raw
      ) as Record<
        string,
        SavedSubmission
      >;

    return (
      parsed[jobId] ??
      null
    );
  } catch {
    return null;
  }
}

function saveSubmission(
  submission: SavedSubmission
) {
  try {
    const raw =
      window.localStorage.getItem(
        WORKSPACE_SUBMISSIONS_KEY
      );

    const current =
      raw
        ? (JSON.parse(
            raw
          ) as Record<
            string,
            SavedSubmission
          >)
        : {};

    current[
      submission.jobId
    ] =
      submission;

    window.localStorage.setItem(
      WORKSPACE_SUBMISSIONS_KEY,
      JSON.stringify(
        current
      )
    );
  } catch {
    // Ignore local storage errors.
  }
}

const styles: Record<
  string,
  React.CSSProperties
> = {
  page: {
    minHeight:
      "100vh",
    padding:
      "24px 16px 60px",
    background:
      "#090b0d",
    color:
      "#f1f2ef",
    fontFamily:
      "Inter, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  },

  container: {
    maxWidth:
      "980px",
    margin:
      "0 auto",
  },

  header: {
    display:
      "flex",
    justifyContent:
      "space-between",
    alignItems:
      "flex-start",
    gap:
      "16px",
    marginBottom:
      "16px",
  },

  eyebrow: {
    fontSize:
      "10px",
    fontWeight:
      900,
    letterSpacing:
      "0.13em",
    color:
      "#7f878e",
  },

  title: {
    margin:
      "7px 0",
    fontSize:
      "30px",
    letterSpacing:
      "-0.03em",
  },

  subtitle: {
    margin:
      0,
    maxWidth:
      "720px",
    color:
      "#929aa1",
    lineHeight:
      1.6,
    fontSize:
      "14px",
  },

  card: {
    marginBottom:
      "14px",
    padding:
      "18px",
    border:
      "1px solid #252b30",
    borderRadius:
      "14px",
    background:
      "#111518",
  },

  sectionHeader: {
    display:
      "flex",
    justifyContent:
      "space-between",
    alignItems:
      "flex-start",
    gap:
      "12px",
  },

  sectionTitle: {
    margin:
      "5px 0",
    fontSize:
      "19px",
  },

  muted: {
    margin:
      "4px 0 10px",
    color:
      "#7d868d",
    fontSize:
      "12px",
    lineHeight:
      1.5,
  },

  mutedStatus: {
    color:
      "#838c92",
    fontSize:
      "12px",
    fontWeight:
      800,
  },

  goodStatus: {
    color:
      "#7fd3a5",
    fontSize:
      "12px",
    fontWeight:
      800,
  },

  primaryButton: {
    width:
      "100%",
    marginTop:
      "12px",
    padding:
      "13px",
    border:
      "none",
    borderRadius:
      "10px",
    background:
      "#f0b90b",
    color:
      "#111",
    fontWeight:
      900,
    cursor:
      "pointer",
  },

  secondaryButton: {
    padding:
      "9px 12px",
    border:
      "1px solid #343a3f",
    borderRadius:
      "9px",
    background:
      "#171b1e",
    color:
      "#fff",
    fontWeight:
      800,
    cursor:
      "pointer",
  },

  walletBox: {
    marginTop:
      "12px",
    padding:
      "12px",
    border:
      "1px solid #284737",
    borderRadius:
      "10px",
    background:
      "#101916",
    color:
      "#7fd3a5",
    fontSize:
      "12px",
  },

  code: {
    display:
      "block",
    marginTop:
      "7px",
    padding:
      "9px",
    borderRadius:
      "8px",
    background:
      "#080a0c",
    color:
      "#a6adb2",
    fontSize:
      "11px",
    wordBreak:
      "break-all",
  },

  countBadge: {
    minWidth:
      "28px",
    padding:
      "5px 8px",
    borderRadius:
      "999px",
    textAlign:
      "center",
    background:
      "#1b1810",
    color:
      "#f0b90b",
    fontSize:
      "11px",
    fontWeight:
      900,
  },

  jobList: {
    display:
      "grid",
    gridTemplateColumns:
      "repeat(auto-fit, minmax(230px, 1fr))",
    gap:
      "9px",
    marginTop:
      "12px",
  },

  jobCard: {
    width:
      "100%",
    padding:
      "13px",
    border:
      "1px solid #2a3034",
    borderRadius:
      "11px",
    background:
      "#0d1012",
    color:
      "#fff",
    textAlign:
      "left",
    cursor:
      "pointer",
  },

  jobCardActive: {
    border:
      "1px solid #f0b90b",
    background:
      "#161511",
  },

  jobTop: {
    display:
      "flex",
    justifyContent:
      "space-between",
    gap:
      "8px",
  },

  jobStatus: {
    color:
      "#7fd3a5",
    fontSize:
      "10px",
    fontWeight:
      900,
  },

  jobMission: {
    marginTop:
      "10px",
    fontSize:
      "13px",
    fontWeight:
      800,
  },

  jobTask: {
    marginTop:
      "4px",
    color:
      "#c2c8cc",
    fontSize:
      "12px",
  },

  jobMeta: {
    marginTop:
      "8px",
    color:
      "#7e878e",
    fontSize:
      "10px",
  },

  assignmentBox: {
    display:
      "grid",
    gridTemplateColumns:
      "repeat(auto-fit, minmax(170px, 1fr))",
    gap:
      "8px",
    marginTop:
      "14px",
  },

  chainGrid: {
    display:
      "grid",
    gridTemplateColumns:
      "repeat(auto-fit, minmax(170px, 1fr))",
    gap:
      "8px",
    marginTop:
      "8px",
  },

  info: {
    padding:
      "11px",
    border:
      "1px solid #272d32",
    borderRadius:
      "9px",
    background:
      "#0d1012",
  },

  label: {
    display:
      "block",
    color:
      "#737c83",
    fontSize:
      "10px",
    textTransform:
      "uppercase",
    letterSpacing:
      "0.05em",
  },

  infoValue: {
    display:
      "block",
    marginTop:
      "4px",
    fontSize:
      "12px",
    wordBreak:
      "break-word",
  },

  taskBox: {
    marginTop:
      "14px",
  },

  description: {
    margin:
      "6px 0 0",
    padding:
      "12px",
    border:
      "1px solid #252b30",
    borderRadius:
      "9px",
    background:
      "#0c1012",
    color:
      "#adb5bb",
    fontSize:
      "12px",
    lineHeight:
      1.6,
    whiteSpace:
      "pre-wrap",
  },

  textarea: {
    width:
      "100%",
    minHeight:
      "170px",
    boxSizing:
      "border-box",
    resize:
      "vertical",
    marginTop:
      "10px",
    padding:
      "12px",
    border:
      "1px solid #343a3f",
    borderRadius:
      "10px",
    background:
      "#0b0f11",
    color:
      "#fff",
    outline:
      "none",
    fontFamily:
      "inherit",
    fontSize:
      "13px",
    lineHeight:
      1.55,
  },

  hashPreview: {
    display:
      "grid",
    gap:
      "6px",
    marginTop:
      "10px",
    padding:
      "11px",
    borderRadius:
      "9px",
    background:
      "#0d1012",
    border:
      "1px solid #272d32",
    color:
      "#7d868d",
    fontSize:
      "10px",
  },

  hashBox: {
    display:
      "grid",
    gap:
      "6px",
    marginTop:
      "12px",
    padding:
      "11px",
    borderRadius:
      "9px",
    background:
      "#0d1012",
    border:
      "1px solid #272d32",
    color:
      "#7d868d",
    fontSize:
      "10px",
  },

  submissionBox: {
    display:
      "grid",
    gridTemplateColumns:
      "repeat(auto-fit, minmax(170px, 1fr))",
    gap:
      "8px",
    marginTop:
      "12px",
  },

  link: {
    display:
      "inline-block",
    marginTop:
      "12px",
    color:
      "#f0b90b",
    textDecoration:
      "none",
    fontWeight:
      800,
    fontSize:
      "12px",
  },

  empty: {
    display:
      "grid",
    gap:
      "5px",
    marginTop:
      "12px",
    padding:
      "14px",
    border:
      "1px solid #43361f",
    borderRadius:
      "10px",
    background:
      "#171511",
    color:
      "#c8b76f",
    fontSize:
      "12px",
  },

  infoBanner: {
    padding:
      "12px",
    border:
      "1px solid #43361f",
    borderRadius:
      "10px",
    background:
      "#171511",
    color:
      "#c8b76f",
    fontSize:
      "12px",
  },

  statusCard: {
    marginBottom:
      "12px",
    padding:
      "13px",
    border:
      "1px solid #2f363b",
    borderRadius:
      "10px",
    background:
      "#13181b",
    color:
      "#b7bec4",
    fontSize:
      "12px",
  },

  errorCard: {
    marginBottom:
      "12px",
    padding:
      "13px",
    border:
      "1px solid #562e2e",
    borderRadius:
      "10px",
    background:
      "#211414",
    color:
      "#ffaaaa",
  },

  error: {
    margin:
      "8px 0 0",
    whiteSpace:
      "pre-wrap",
    overflowWrap:
      "anywhere",
    fontSize:
      "11px",
  },
};