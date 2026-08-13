import {
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  formatUnits,
  parseUnits,
  type Address,
  type EIP1193Provider,
} from "viem";

import { EthereumProvider } from "@walletconnect/ethereum-provider";

import {
  ERC8183_ADDRESSES,
  COMMERCE_ABI,
  ROUTER_ABI,
  ERC20_ABI,
  getWalletClient,
  publicClient,
} from "./lib/erc8183";

const WALLETCONNECT_PROJECT_ID =
  "1dbe8fd5e4974ae7c80d074c4082b5a0";

const BSC_TESTNET_CHAIN_ID = 97;

const MISSION_STORAGE_KEY =
  "bnb_agent_marketplace_missions";

const SUBJOB_STORAGE_KEY =
  "bnb_agent_marketplace_subjob";

type MissionStatus =
  | "Planning"
  | "Ready"
  | "In Progress"
  | "Completed";

type TaskStatus =
  | "Planned"
  | "Ready"
  | "In Progress"
  | "Completed";

type MissionTask = {
  id: string;
  title: string;
  role: string;
  description: string;
  budget: number;
  status: TaskStatus;
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
  status: MissionStatus;
  tasks: MissionTask[];
};

type Agent = {
  id: string;
  name: string;
  role: string;
};

type WalletStatus =
  | "Disconnected"
  | "Connecting"
  | "Connected";

type OnChainJob = {
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

type SavedSubJob = {
  missionId: string;
  taskId: string;
  jobId?: string;
};

const DEMO_AGENTS: Agent[] = [
  {
    id: "taskpilot",
    name: "TaskPilot",
    role: "Project Manager",
  },
  {
    id: "pixelcraft",
    name: "PixelCraft",
    role: "UI/UX Designer",
  },
  {
    id: "codeforge",
    name: "CodeForge",
    role: "Developer",
  },
  {
    id: "rankpilot",
    name: "RankPilot",
    role: "SEO Specialist",
  },
  {
    id: "verifyai",
    name: "VerifyAI",
    role: "QA Agent",
  },
];

export default function MissionSubJob() {
  const [missions, setMissions] =
    useState<Mission[]>(
      loadMissions()
    );

  const [
    selectedMissionId,
    setSelectedMissionId,
  ] = useState("");

  const [
    selectedTaskId,
    setSelectedTaskId,
  ] = useState("");

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
    tokenAddress,
    setTokenAddress,
  ] = useState<Address | null>(
    null
  );

  const [
    tokenSymbol,
    setTokenSymbol,
  ] = useState("U");

  const [
    tokenDecimals,
    setTokenDecimals,
  ] = useState(18);

  const [
    tokenBalance,
    setTokenBalance,
  ] = useState<bigint | null>(
    null
  );

  const [
    allowance,
    setAllowance,
  ] = useState<bigint | null>(
    null
  );

  const [
    job,
    setJob,
  ] = useState<OnChainJob | null>(
    null
  );

  const [
    jobId,
    setJobId,
  ] = useState<bigint | null>(
    null
  );

  const [
    statusMessage,
    setStatusMessage,
  ] = useState(
    "Select an assigned task."
  );

  const [
    errorMessage,
    setErrorMessage,
  ] = useState<string | null>(
    null
  );

  const [
    loading,
    setLoading,
  ] = useState(false);

  const [
    transactionHashes,
    setTransactionHashes,
  ] = useState<{
    create?: `0x${string}`;
    register?: `0x${string}`;
    budget?: `0x${string}`;
    approval?: `0x${string}`;
    fund?: `0x${string}`;
  }>({});

  const selectedMission =
    missions.find(
      (
        mission
      ) =>
        mission.id ===
        selectedMissionId
    ) ?? null;

  const assignedTasks =
    useMemo(
      () =>
        selectedMission
          ? selectedMission.tasks.filter(
              (
                task
              ) =>
                Boolean(
                  task.assignedAgentId
                )
            )
          : [],
      [
        selectedMission,
      ]
    );

  const selectedTask =
    selectedMission?.tasks.find(
      (
        task
      ) =>
        task.id ===
        selectedTaskId
    ) ?? null;

  const assignedAgent =
    selectedTask?.assignedAgentId
      ? DEMO_AGENTS.find(
          (
            agent
          ) =>
            agent.id ===
            selectedTask.assignedAgentId
        ) ?? null
      : null;

  useEffect(() => {
    if (
      missions.length ===
      0
    ) {
      return;
    }

    const saved =
      loadSavedSubJob();

    if (saved) {
      const savedMission =
        missions.find(
          (
            mission
          ) =>
            mission.id ===
            saved.missionId
        );

      if (savedMission) {
        const savedTask =
          savedMission.tasks.find(
            (
              task
            ) =>
              task.id ===
              saved.taskId
          );

        if (savedTask) {
          setSelectedMissionId(
            savedMission.id
          );

          setSelectedTaskId(
            savedTask.id
          );

          if (
            saved.jobId
          ) {
            setJobId(
              BigInt(
                saved.jobId
              )
            );
          }

          return;
        }
      }
    }

    const firstMission =
      missions.find(
        (
          mission
        ) =>
          mission.tasks.some(
            (
              task
            ) =>
              task.assignedAgentId
          )
      );

    if (firstMission) {
      setSelectedMissionId(
        firstMission.id
      );

      const firstTask =
        firstMission.tasks.find(
          (
            task
          ) =>
            task.assignedAgentId
        );

      if (firstTask) {
        setSelectedTaskId(
          firstTask.id
        );

        if (
          firstTask.chainJobId
        ) {
          setJobId(
            BigInt(
              firstTask.chainJobId
            )
          );
        }
      }
    }
  }, [
    missions,
  ]);

  useEffect(() => {
    if (
      selectedMissionId &&
      selectedTaskId
    ) {
      saveSubJob({
        missionId:
          selectedMissionId,
        taskId:
          selectedTaskId,
        jobId:
          jobId?.toString(),
      });
    }
  }, [
    selectedMissionId,
    selectedTaskId,
    jobId,
  ]);

  useEffect(() => {
    if (
      address &&
      selectedTask
    ) {
      void refreshTokenState(
        address
      );
    }
  }, [
    address,
    selectedTask?.id,
  ]);

  async function connectWallet() {
    try {
      setErrorMessage(null);
      setWalletStatus(
        "Connecting"
      );
      setStatusMessage(
        "Connecting provider wallet..."
      );

      const wallet =
        await EthereumProvider.init({
          projectId:
            WALLETCONNECT_PROJECT_ID,

          optionalChains: [
            BSC_TESTNET_CHAIN_ID,
          ],

          showQrModal:
            true,

          rpcMap: {
            [BSC_TESTNET_CHAIN_ID]:
              "https://data-seed-prebsc-1-s1.bnbchain.org:8545",
          },

          metadata: {
            name:
              "BNB Agent Marketplace",
            description:
              "ERC-8183 marketplace",
            url:
              window.location.origin,
            icons: [],
          },
        });

      await wallet.connect();

      const accounts =
        wallet.accounts as string[];

      if (
        accounts.length ===
        0
      ) {
        throw new Error(
          "Wallet returned no accounts."
        );
      }

      const walletProvider =
        wallet as unknown as EIP1193Provider;

      const chainIdRaw =
        await walletProvider.request({
          method:
            "eth_chainId",
        });

      const chainId =
        normalizeChainId(
          chainIdRaw
        );

      if (
        chainId !==
        BSC_TESTNET_CHAIN_ID
      ) {
        throw new Error(
          `Wrong network. Connected chain ID: ${chainId}. Please use BNB Smart Chain Testnet (97).`
        );
      }

      const walletAddress =
        accounts[0] as Address;

      setProvider(
        walletProvider
      );

      setAddress(
        walletAddress
      );

      setWalletStatus(
        "Connected"
      );

      setStatusMessage(
        "✅ Provider wallet connected."
      );

      await refreshTokenState(
        walletAddress
      );
    } catch (error) {
      console.error(
        error
      );

      setWalletStatus(
        "Disconnected"
      );

      setStatusMessage(
        "Wallet connection failed."
      );

      setErrorMessage(
        formatError(
          error
        )
      );
    }
  }

  async function refreshTokenState(
    walletAddress: Address
  ) {
    try {
      const token =
        (await publicClient.readContract(
          {
            address:
              ERC8183_ADDRESSES.commerce,
            abi:
              COMMERCE_ABI,
            functionName:
              "paymentToken",
          }
        )) as Address;

      const decimals =
        Number(
          await publicClient.readContract(
            {
              address:
                token,
              abi:
                ERC20_ABI,
              functionName:
                "decimals",
            }
          )
        );

      const symbol =
        (await publicClient.readContract(
          {
            address:
              token,
            abi:
              ERC20_ABI,
            functionName:
              "symbol",
          }
        )) as string;

      const balance =
        (await publicClient.readContract(
          {
            address:
              token,
            abi:
              ERC20_ABI,
            functionName:
              "balanceOf",
            args: [
              walletAddress,
            ],
          }
        )) as bigint;

      const currentAllowance =
        (await publicClient.readContract(
          {
            address:
              token,
            abi:
              ERC20_ABI,
            functionName:
              "allowance",
            args: [
              walletAddress,
              ERC8183_ADDRESSES.commerce,
            ],
          }
        )) as bigint;

      setTokenAddress(
        token
      );

      setTokenDecimals(
        decimals
      );

      setTokenSymbol(
        symbol
      );

      setTokenBalance(
        balance
      );

      setAllowance(
        currentAllowance
      );
    } catch (error) {
      console.error(
        "Token state error:",
        error
      );
    }
  }

  async function createSubJob() {
    if (
      !provider ||
      !address
    ) {
      setErrorMessage(
        "Connect the provider wallet first."
      );
      return;
    }

    if (
      !selectedMission ||
      !selectedTask ||
      !assignedAgent
    ) {
      setErrorMessage(
        "Select an assigned task first."
      );
      return;
    }

    try {
      setLoading(
        true
      );
      setErrorMessage(
        null
      );

      const walletClient =
        getWalletClient(
          provider,
          address
        );

      const expiry =
        BigInt(
          Math.floor(
            Date.now() /
              1000
          ) +
            60 *
              60
        );

      const description =
        [
          `Mission: ${selectedMission.title}`,
          `Mission ID: ${selectedMission.id}`,
          `Task: ${selectedTask.title}`,
          `Task ID: ${selectedTask.id}`,
          `Agent: ${assignedAgent.name}`,
          `Role: ${assignedAgent.role}`,
          "",
          selectedTask.description,
        ].join(
          "\n"
        );

      setStatusMessage(
        "Confirm createJob() in your wallet..."
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
              address,
              ERC8183_ADDRESSES.router,
              expiry,
              description,
              ERC8183_ADDRESSES.router,
            ],
          }
        );

      setTransactionHashes(
        (
          current
        ) => ({
          ...current,
          create:
            hash,
        })
      );

      setStatusMessage(
        "Waiting for createJob confirmation..."
      );

      await publicClient.waitForTransactionReceipt(
        {
          hash,
        }
      );

      const counter =
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
        counter
      );

      updateTaskChainJob(
        counter
      );

      await loadJob(
        counter
      );

      setStatusMessage(
        `✅ ERC-8183 Job #${counter.toString()} created.`
      );
    } catch (error) {
      console.error(
        error
      );

      setStatusMessage(
        "createJob() failed."
      );

      setErrorMessage(
        formatError(
          error
        )
      );
    } finally {
      setLoading(
        false
      );
    }
  }

  async function registerSubJob() {
    if (
      !provider ||
      !address ||
      jobId === null
    ) {
      setErrorMessage(
        "Create the sub-job first."
      );
      return;
    }

    try {
      setLoading(
        true
      );
      setErrorMessage(
        null
      );

      const whitelisted =
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
        !whitelisted
      ) {
        throw new Error(
          "The OptimisticPolicy is not whitelisted."
        );
      }

      const walletClient =
        getWalletClient(
          provider,
          address
        );

      setStatusMessage(
        "Confirm registerJob() in your wallet..."
      );

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

      setTransactionHashes(
        (
          current
        ) => ({
          ...current,
          register:
            hash,
        })
      );

      await publicClient.waitForTransactionReceipt(
        {
          hash,
        }
      );

      setStatusMessage(
        `✅ Job #${jobId.toString()} registered.`
      );

      await loadJob(
        jobId
      );
    } catch (error) {
      console.error(
        error
      );

      setStatusMessage(
        "registerJob() failed."
      );

      setErrorMessage(
        formatError(
          error
        )
      );
    } finally {
      setLoading(
        false
      );
    }
  }

  async function setSubJobBudget() {
    if (
      !provider ||
      !address ||
      jobId === null ||
      !selectedTask
    ) {
      setErrorMessage(
        "Select a task and create the job first."
      );
      return;
    }

    try {
      setLoading(
        true
      );
      setErrorMessage(
        null
      );

      const amount =
        parseUnits(
          String(
            selectedTask.budget
          ),
          tokenDecimals
        );

      if (
        tokenBalance !==
          null &&
        tokenBalance <
          amount
      ) {
        throw new Error(
          `Insufficient ${tokenSymbol}. Balance: ${formatUnits(
            tokenBalance,
            tokenDecimals
          )} ${tokenSymbol}.`
        );
      }

      const walletClient =
        getWalletClient(
          provider,
          address
        );

      setStatusMessage(
        `Confirm setBudget() for ${selectedTask.budget} ${tokenSymbol}...`
      );

      const hash =
        await walletClient.writeContract(
          {
            address:
              ERC8183_ADDRESSES.commerce,

            abi:
              COMMERCE_ABI,

            functionName:
              "setBudget",

            args: [
              jobId,
              amount,
              "0x",
            ],
          }
        );

      setTransactionHashes(
        (
          current
        ) => ({
          ...current,
          budget:
            hash,
        })
      );

      await publicClient.waitForTransactionReceipt(
        {
          hash,
        }
      );

      await loadJob(
        jobId
      );

      setStatusMessage(
        `✅ Budget set to ${selectedTask.budget} ${tokenSymbol}.`
      );
    } catch (error) {
      console.error(
        error
      );

      setStatusMessage(
        "setBudget() failed."
      );

      setErrorMessage(
        formatError(
          error
        )
      );
    } finally {
      setLoading(
        false
      );
    }
  }

  async function approveSubJob() {
    if (
      !provider ||
      !address ||
      !tokenAddress ||
      !selectedTask
    ) {
      setErrorMessage(
        "Connect the wallet and select a task."
      );
      return;
    }

    try {
      setLoading(
        true
      );
      setErrorMessage(
        null
      );

      const amount =
        parseUnits(
          String(
            selectedTask.budget
          ),
          tokenDecimals
        );

      const walletClient =
        getWalletClient(
          provider,
          address
        );

      setStatusMessage(
        `Confirm approval of ${selectedTask.budget} ${tokenSymbol}...`
      );

      const hash =
        await walletClient.writeContract(
          {
            address:
              tokenAddress,

            abi:
              ERC20_ABI,

            functionName:
              "approve",

            args: [
              ERC8183_ADDRESSES.commerce,
              amount,
            ],
          }
        );

      setTransactionHashes(
        (
          current
        ) => ({
          ...current,
          approval:
            hash,
        })
      );

      await publicClient.waitForTransactionReceipt(
        {
          hash,
        }
      );

      await refreshTokenState(
        address
      );

      setStatusMessage(
        `✅ ${selectedTask.budget} ${tokenSymbol} approved.`
      );
    } catch (error) {
      console.error(
        error
      );

      setStatusMessage(
        "Token approval failed."
      );

      setErrorMessage(
        formatError(
          error
        )
      );
    } finally {
      setLoading(
        false
      );
    }
  }

  async function fundSubJob() {
    if (
      !provider ||
      !address ||
      jobId === null ||
      !selectedTask
    ) {
      setErrorMessage(
        "Prepare the sub-job first."
      );
      return;
    }

    try {
      setLoading(
        true
      );
      setErrorMessage(
        null
      );

      const amount =
        parseUnits(
          String(
            selectedTask.budget
          ),
          tokenDecimals
        );

      const currentJob =
        await loadJob(
          jobId
        );

      if (
        currentJob.status !==
        0
      ) {
        throw new Error(
          `Job #${jobId.toString()} is ${getJobStatus(
            currentJob.status
          )}, not Open.`
        );
      }

      if (
        currentJob.budget !==
        amount
      ) {
        throw new Error(
          `On-chain budget is ${formatUnits(
            currentJob.budget,
            tokenDecimals
          )} ${tokenSymbol}, expected ${
            selectedTask.budget
          } ${tokenSymbol}.`
        );
      }

      const currentAllowance =
        allowance ??
        0n;

      if (
        currentAllowance <
        amount
      ) {
        throw new Error(
          `Allowance is ${formatUnits(
            currentAllowance,
            tokenDecimals
          )} ${tokenSymbol}. Approve the budget first.`
        );
      }

      setStatusMessage(
        "Simulating fund()..."
      );

      await publicClient.simulateContract(
        {
          address:
            ERC8183_ADDRESSES.commerce,

          abi:
            COMMERCE_ABI,

          functionName:
            "fund",

          args: [
            jobId,
            amount,
            "0x",
          ],

          account:
            address,
        }
      );

      const walletClient =
        getWalletClient(
          provider,
          address
        );

      setStatusMessage(
        `Confirm funding of ${selectedTask.budget} ${tokenSymbol}...`
      );

      const hash =
        await walletClient.writeContract(
          {
            address:
              ERC8183_ADDRESSES.commerce,

            abi:
              COMMERCE_ABI,

            functionName:
              "fund",

            args: [
              jobId,
              amount,
              "0x",
            ],
          }
        );

      setTransactionHashes(
        (
          current
        ) => ({
          ...current,
          fund:
            hash,
        })
      );

      await publicClient.waitForTransactionReceipt(
        {
          hash,
        }
      );

      const refreshed =
        await loadJob(
          jobId
        );

      await refreshTokenState(
        address
      );

      setStatusMessage(
        `🎉 Job #${jobId.toString()} is ${getJobStatus(
          refreshed.status
        )}.`
      );
    } catch (error) {
      console.error(
        error
      );

      setStatusMessage(
        "fund() failed."
      );

      setErrorMessage(
        formatError(
          error
        )
      );
    } finally {
      setLoading(
        false
      );
    }
  }

  async function loadJob(
    id: bigint
  ): Promise<OnChainJob> {
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
      )) as OnChainJob;

    setJob(
      result
    );

    updateTaskChainStatus(
      result
    );

    return result;
  }

  function updateTaskChainJob(
    id: bigint
  ) {
    if (
      !selectedMission
    ) {
      return;
    }

    const updated =
      missions.map(
        (
          mission
        ): Mission => {
          if (
            mission.id !==
            selectedMission.id
          ) {
            return mission;
          }

          return {
            ...mission,

            tasks:
              mission.tasks.map(
                (
                  task
                ): MissionTask =>
                  task.id ===
                  selectedTaskId
                    ? {
                        ...task,
                        chainJobId:
                          id.toString(),
                        chainJobStatus:
                          0,
                      }
                    : task
              ),
          };
        }
      );

    setMissions(
      updated
    );

    saveMissions(
      updated
    );
  }

  function updateTaskChainStatus(
    onChainJob: OnChainJob
  ) {
    if (
      !selectedMission
    ) {
      return;
    }

    const updated =
      missions.map(
        (
          mission
        ): Mission => {
          if (
            mission.id !==
            selectedMission.id
          ) {
            return mission;
          }

          return {
            ...mission,

            tasks:
              mission.tasks.map(
                (
                  task
                ): MissionTask =>
                  task.id ===
                  selectedTaskId
                    ? {
                        ...task,
                        chainJobId:
                          onChainJob.id.toString(),
                        chainJobStatus:
                          onChainJob.status,
                      }
                    : task
              ),
          };
        }
      );

    setMissions(
      updated
    );

    saveMissions(
      updated
    );
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
              MARKETPLACE → ERC-8183
            </div>

            <h1
              style={
                styles.title
              }
            >
              Create Mission Sub-job
            </h1>

            <p
              style={
                styles.subtitle
              }
            >
              Turn an assigned marketplace task into a
              real on-chain ERC-8183 job.
            </p>
          </div>

          <span
            style={
              styles.badge
            }
          >
            BSC TESTNET
          </span>
        </header>

        <section
          style={
            styles.notice
          }
        >
          <strong>
            🧪 Test provider mode
          </strong>

          <p>
            The connected wallet acts as the provider for
            this first integration. We are deliberately not
            sending funds to the placeholder demo wallets.
          </p>
        </section>

        <section
          style={
            styles.card
          }
        >
          <h2>
            1. Select assigned task
          </h2>

          <select
            value={
              selectedMissionId
            }
            onChange={(
              event
            ) => {
              const next =
                event.target
                  .value;

              setSelectedMissionId(
                next
              );

              setSelectedTaskId(
                ""
              );

              setJob(
                null
              );

              setJobId(
                null
              );
            }}
            style={
              styles.select
            }
          >
            <option value="">
              Select mission
            </option>

            {missions.map(
              (
                mission
              ) => (
                <option
                  key={
                    mission.id
                  }
                  value={
                    mission.id
                  }
                >
                  {
                    mission.title
                  }
                </option>
              )
            )}
          </select>

          <select
            value={
              selectedTaskId
            }
            onChange={(
              event
            ) => {
              setSelectedTaskId(
                event.target
                  .value
              );

              setJob(
                null
              );

              setJobId(
                null
              );
            }}
            disabled={
              !selectedMission
            }
            style={
              styles.select
            }
          >
            <option value="">
              Select assigned task
            </option>

            {assignedTasks.map(
              (
                task
              ) => (
                <option
                  key={
                    task.id
                  }
                  value={
                    task.id
                  }
                >
                  {
                    task.title
                  }{" "}
                  —{" "}
                  {
                    task.budget
                  }{" "}
                  U
                </option>
              )
            )}
          </select>
        </section>

        {selectedTask && (
          <section
            style={
              styles.card
            }
          >
            <h2>
              2. Task details
            </h2>

            <div
              style={
                styles.grid
              }
            >
              <Info
                label="Task"
                value={
                  selectedTask.title
                }
              />

              <Info
                label="Agent"
                value={
                  assignedAgent?.name ??
                  "Unknown"
                }
              />

              <Info
                label="Role"
                value={
                  assignedAgent?.role ??
                  selectedTask.role
                }
              />

              <Info
                label="Budget"
                value={`${selectedTask.budget} U`}
              />
            </div>

            <div
              style={
                styles.description
              }
            >
              {
                selectedTask.description
              }
            </div>

            {selectedTask.chainJobId && (
              <div
                style={
                  styles.success
                }
              >
                Existing on-chain job: #
                {
                  selectedTask.chainJobId
                }
              </div>
            )}
          </section>
        )}

        <section
          style={
            styles.card
          }
        >
          <div
            style={
              styles.row
            }
          >
            <h2>
              3. Provider wallet
            </h2>

            <span
              style={
                getWalletStatusStyle(
                  walletStatus
                )
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
                styles.success
              }
            >
              <strong>
                ✅ Connected
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
              {walletStatus ===
              "Connecting"
                ? "Connecting..."
                : "Connect test provider wallet"}
            </button>
          )}

          {tokenBalance !==
            null && (
            <div
              style={
                styles.balance
              }
            >
              <span>
                {
                  tokenSymbol
                } balance
              </span>

              <strong>
                {
                  formatUnits(
                    tokenBalance,
                    tokenDecimals
                  )
                }{" "}
                {
                  tokenSymbol
                }
              </strong>
            </div>
          )}
        </section>

        {selectedTask &&
          address && (
          <section
            style={
              styles.card
            }
          >
            <h2>
              4. ERC-8183 lifecycle
            </h2>

            <div
              style={
                styles.steps
              }
            >
              <Step
                text="Create"
                complete={
                  jobId !==
                  null
                }
              />

              <Step
                text="Register"
                complete={
                  transactionHashes.register !==
                  undefined
                }
              />

              <Step
                text="Budget"
                complete={
                  Boolean(
                    job &&
                    job.budget >
                      0n
                  )
                }
              />

              <Step
                text="Approve"
                complete={
                  Boolean(
                    allowance !==
                      null &&
                    allowance >=
                      parseUnits(
                        String(
                          selectedTask.budget
                        ),
                        tokenDecimals
                      )
                  )
                }
              />

              <Step
                text="Fund"
                complete={
                  job?.status ===
                  1
                }
              />
            </div>

            <button
              onClick={
                createSubJob
              }
              disabled={
                loading ||
                jobId !==
                  null
              }
              style={
                jobId ===
                null
                  ? styles.primaryButton
                  : styles.disabledButton
              }
            >
              {jobId ===
              null
                ? "Create ERC-8183 sub-job"
                : `Job #${jobId.toString()} created`}
            </button>

            <button
              onClick={
                registerSubJob
              }
              disabled={
                loading ||
                jobId ===
                  null
              }
              style={
                styles.secondaryButton
              }
            >
              Register Optimistic Policy
            </button>

            <button
              onClick={
                setSubJobBudget
              }
              disabled={
                loading ||
                jobId ===
                  null
              }
              style={
                styles.secondaryButton
              }
            >
              Set task budget
            </button>

            <button
              onClick={
                approveSubJob
              }
              disabled={
                loading ||
                jobId ===
                  null
              }
              style={
                styles.secondaryButton
              }
            >
              Approve{" "}
              {
                selectedTask.budget
              }{" "}
              {
                tokenSymbol
              }
            </button>

            <button
              onClick={
                fundSubJob
              }
              disabled={
                loading ||
                jobId ===
                  null
              }
              style={
                styles.primaryButton
              }
            >
              Fund sub-job
            </button>
          </section>
        )}

        {job && (
          <section
            style={
              styles.card
            }
          >
            <h2>
              On-chain job
            </h2>

            <div
              style={
                styles.grid
              }
            >
              <Info
                label="Job ID"
                value={
                  job.id.toString()
                }
              />

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
                label="Budget"
                value={`${formatUnits(
                  job.budget,
                  tokenDecimals
                )} ${tokenSymbol}`}
              />
            </div>

            <code
              style={
                styles.code
              }
            >
              {
                job.description
              }
            </code>
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
              statusMessage
            }
          </p>
        </section>

        {errorMessage && (
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
                errorMessage
              }
            </pre>
          </section>
        )}

        {Object.keys(
          transactionHashes
        ).length >
          0 && (
          <section
            style={
              styles.card
            }
          >
            <h2>
              Transactions
            </h2>

            {Object.entries(
              transactionHashes
            ).map(
              ([
                label,
                hash,
              ]) => (
                <div
                  key={
                    label
                  }
                  style={
                    styles.txRow
                  }
                >
                  <span>
                    {
                      capitalize(
                        label
                      )
                    }
                  </span>

                  <a
                    href={`https://testnet.bscscan.com/tx/${hash}`}
                    target="_blank"
                    rel="noreferrer"
                    style={
                      styles.link
                    }
                  >
                    View transaction ↗
                  </a>
                </div>
              )
            )}
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
      <span>
        {
          label
        }
      </span>

      <strong>
        {
          value
        }
      </strong>
    </div>
  );
}

function Step({
  text,
  complete,
}: {
  text: string;
  complete: boolean;
}) {
  return (
    <div
      style={
        complete
          ? styles.stepComplete
          : styles.step
      }
    >
      <span>
        {
          complete
            ? "✓"
            : "○"
        }
      </span>

      <span>
        {
          text
        }
      </span>
    </div>
  );
}

function getJobStatus(
  status: number
): string {
  const map: Record<
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
    map[status] ??
    `Unknown (${status})`
  );
}

function getWalletStatusStyle(
  status: WalletStatus
): React.CSSProperties {
  if (
    status ===
    "Connected"
  ) {
    return styles.connected;
  }

  if (
    status ===
    "Connecting"
  ) {
    return styles.connecting;
  }

  return styles.disconnected;
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
    "Unable to determine wallet chain ID."
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

function capitalize(
  value: string
): string {
  return (
    value.charAt(0).toUpperCase() +
    value.slice(1)
  );
}

function createId(): string {
  return `${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
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
      ? parsed
      : [];
  } catch {
    return [];
  }
}

function saveMissions(
  missions: Mission[]
) {
  try {
    window.localStorage.setItem(
      MISSION_STORAGE_KEY,
      JSON.stringify(
        missions
      )
    );
  } catch {
    // Ignore localStorage errors.
  }
}

function saveSubJob(
  value: SavedSubJob
) {
  try {
    window.localStorage.setItem(
      SUBJOB_STORAGE_KEY,
      JSON.stringify(
        value
      )
    );
  } catch {
    // Ignore localStorage errors.
  }
}

function loadSavedSubJob():
  | SavedSubJob
  | null {
  try {
    const raw =
      window.localStorage.getItem(
        SUBJOB_STORAGE_KEY
      );

    if (!raw) {
      return null;
    }

    const parsed =
      JSON.parse(
        raw
      ) as Partial<SavedSubJob>;

    if (
      typeof parsed.missionId !==
        "string" ||
      typeof parsed.taskId !==
        "string"
    ) {
      return null;
    }

    return {
      missionId:
        parsed.missionId,
      taskId:
        parsed.taskId,
      jobId:
        typeof parsed.jobId ===
        "string"
          ? parsed.jobId
          : undefined,
    };
  } catch {
    return null;
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
      "860px",
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
      "18px",
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
    color:
      "#929aa1",
    lineHeight:
      1.6,
    fontSize:
      "14px",
  },

  badge: {
    padding:
      "8px 10px",
    borderRadius:
      "999px",
    background:
      "#1b1810",
    color:
      "#f0b90b",
    fontWeight:
      900,
    fontSize:
      "10px",
    whiteSpace:
      "nowrap",
  },

  notice: {
    marginBottom:
      "14px",
    padding:
      "14px",
    border:
      "1px solid #463a20",
    borderRadius:
      "12px",
    background:
      "#171511",
    color:
      "#c5b774",
    fontSize:
      "12px",
    lineHeight:
      1.55,
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

  grid: {
    display:
      "grid",
    gridTemplateColumns:
      "repeat(auto-fit, minmax(150px, 1fr))",
    gap:
      "8px",
    marginTop:
      "14px",
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
    minWidth:
      0,
  },

  infoSpan: {
    color:
      "#737c83",
    fontSize:
      "10px",
  },

  infoStrong: {
    display:
      "block",
    marginTop:
      "4px",
    fontSize:
      "12px",
    wordBreak:
      "break-word",
  },

  select: {
    display:
      "block",
    width:
      "100%",
    boxSizing:
      "border-box",
    marginTop:
      "9px",
    padding:
      "12px",
    border:
      "1px solid #343a3f",
    borderRadius:
      "9px",
    background:
      "#0c1012",
    color:
      "#fff",
    outline:
      "none",
  },

  description: {
    marginTop:
      "14px",
    padding:
      "12px",
    borderRadius:
      "9px",
    background:
      "#0c1012",
    color:
      "#aeb5ba",
    fontSize:
      "12px",
    lineHeight:
      1.55,
  },

  success: {
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
      "#80d3a5",
    fontSize:
      "12px",
  },

  row: {
    display:
      "flex",
    justifyContent:
      "space-between",
    alignItems:
      "center",
    gap:
      "10px",
  },

  connected: {
    color:
      "#7fd3a5",
    fontSize:
      "12px",
    fontWeight:
      800,
  },

  connecting: {
    color:
      "#f0b90b",
    fontSize:
      "12px",
    fontWeight:
      800,
  },

  disconnected: {
    color:
      "#9ca4aa",
    fontSize:
      "12px",
    fontWeight:
      800,
  },

  balance: {
    display:
      "flex",
    justifyContent:
      "space-between",
    marginTop:
      "12px",
    padding:
      "11px",
    borderRadius:
      "9px",
    background:
      "#0c1012",
    color:
      "#929aa1",
    fontSize:
      "12px",
  },

  code: {
    display:
      "block",
    marginTop:
      "9px",
    padding:
      "10px",
    borderRadius:
      "8px",
    background:
      "#080a0c",
    color:
      "#8f979d",
    fontSize:
      "11px",
    wordBreak:
      "break-all",
    whiteSpace:
      "pre-wrap",
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
    width:
      "100%",
    marginTop:
      "9px",
    padding:
      "12px",
    border:
      "1px solid #343a3f",
    borderRadius:
      "10px",
    background:
      "#171b1e",
    color:
      "#fff",
    fontWeight:
      800,
    cursor:
      "pointer",
  },

  disabledButton: {
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
      "#292e32",
    color:
      "#626a70",
    cursor:
      "not-allowed",
  },

  steps: {
    display:
      "flex",
    flexWrap:
      "wrap",
    gap:
      "8px",
    marginTop:
      "14px",
  },

  step: {
    display:
      "flex",
    alignItems:
      "center",
    gap:
      "6px",
    padding:
      "8px 10px",
    border:
      "1px solid #2b3237",
    borderRadius:
      "8px",
    background:
      "#0d1012",
    color:
      "#727b82",
    fontSize:
      "11px",
  },

  stepComplete: {
    display:
      "flex",
    alignItems:
      "center",
    gap:
      "6px",
    padding:
      "8px 10px",
    border:
      "1px solid #284737",
    borderRadius:
      "8px",
    background:
      "#101916",
    color:
      "#7fd3a5",
    fontSize:
      "11px",
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

  txRow: {
    display:
      "flex",
    justifyContent:
      "space-between",
    alignItems:
      "center",
    gap:
      "10px",
    padding:
      "10px 0",
    borderBottom:
      "1px solid #252b30",
    fontSize:
      "12px",
  },

  link: {
    color:
      "#f0b90b",
    textDecoration:
      "none",
    fontWeight:
      800,
  },
};  "#f0b90b",
    color:
      "#111",
    fontWeight:
      900,
    cursor:
      "pointer",
  },

  secondaryButtonFull: {
    width:
      "100%",
    marginTop:
      "9px",
    padding:
      "12px",
    border:
      "1px solid #343a3f",
    borderRadius:
      "10px",
    background:
      "#171b1e",
    color:
      "#fff",
    fontWeight:
      800,
    cursor:
      "pointer",
  },

  disabledButton: {
    width:
      "100%",
    marginTop:
      "12px",
    padding:
      "12px",
    border:
      "none",
    borderRadius:
      "10px",
    background:
      "#292e32",
    color:
      "#626a70",
    cursor:
      "not-allowed",
  },

  stepFlow: {
    display:
      "flex",
    flexWrap:
      "wrap",
    gap:
      "8px",
    marginTop:
      "14px",
  },

  step: {
    display:
      "flex",
    alignItems:
      "center",
    gap:
      "6px",
    padding:
      "8px",
    border:
      "1px solid #2b3237",
    borderRadius:
      "8px",
    background:
      "#0d1012",
    color:
      "#6f787f",
    fontSize:
      "11px",
  },

  stepActive: {
    display:
      "flex",
    alignItems:
      "center",
    gap:
      "6px",
    padding:
      "8px",
    border:
      "1px solid #284737",
    borderRadius:
      "8px",
    background:
      "#101916",
    color:
      "#7fd3a5",
    fontSize:
      "11px",
  },

  statusBox: {
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

  errorBox: {
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

  errorText: {
    whiteSpace:
      "pre-wrap",
    overflowWrap:
      "anywhere",
    fontSize:
      "11px",
  },

  transaction: {
    display:
      "flex",
    justifyContent:
      "space-between",
    gap:
      "10px",
    padding:
      "10px 0",
    borderBottom:
      "1px solid #252b30",
    fontSize:
      "12px",
  },

  link: {
    color:
      "#f0b90b",
    fontWeight:
      800,
    textDecoration:
      "none",
  },
};olid #284737",
    borderRadius:
      "10px",
    background:
      "#101916",
    color:
      "#80d3a5",
    fontSize:
      "12px",
  },

  balanceBox: {
    display:
      "flex",
    justifyContent:
      "space-between",
    gap:
      "12px",
    marginTop:
      "12px",
    padding:
      "11px",
    borderRadius:
      "9px",
    background:
      "#0c1012",
    color:
      "#929aa1",
    fontSize:
      "12px",
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

  secondaryButtonFull: {
    width:
      "100%",
    marginTop:
      "9px",
    padding:
      "12px",
    border:
      "1px solid #343a3f",
    borderRadius:
      "10px",
    background:
      "#171b1e",
    color:
      "#fff",
    fontWeight:
      800,
    cursor:
      "pointer",
  },

  disabledButton: {
    width:
      "100%",
    marginTop:
      "12px",
    padding:
      "12px",
    border:
      "none",
    borderRadius:
      "10px",
    background:
      "#292e32",
    color:
      "#626a70",
    cursor:
      "not-allowed",
  },

  flow: {
    display:
      "flex",
    flexWrap:
      "wrap",
    gap:
      "8px",
    marginTop:
      "14px",
  },

  flowActive: {
    display:
      "flex",
    alignItems:
      "center",
    gap:
      "6px",
    padding:
      "8px",
    borderRadius:
      "8px",
    background:
      "#101916",
    color:
      "#7fd3a5",
    fontSize:
      "11px",
    border:
      "1px solid #284737",
  },

  statusBox: {
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

  errorBox: {
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

  errorText: {
    whiteSpace:
      "pre-wrap",
    overflowWrap:
      "anywhere",
    fontSize:
      "11px",
  },

  transaction: {
    display:
      "flex",
    justifyContent:
      "space-between",
    gap:
      "10px",
    padding:
      "10px 0",
    borderBottom:
      "1px solid #252b30",
    fontSize:
      "12px",
  },

  link: {
    color:
      "#f0b90b",
    fontWeight:
      800,
    textDecoration:
      "none",
  },
};