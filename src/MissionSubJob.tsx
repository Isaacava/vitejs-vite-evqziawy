import {
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  createWalletClient,
  custom,
  formatUnits,
  parseUnits,
  type Address,
  type EIP1193Provider,
} from "viem";

import {
  EthereumProvider,
} from "@walletconnect/ethereum-provider";

import {
  ERC8183_ADDRESSES,
  COMMERCE_ABI,
  ROUTER_ABI,
  ERC20_ABI,
  publicClient,
} from "./lib/erc8183";

const WALLETCONNECT_PROJECT_ID =
  "1dbe8fd5e4974ae7c80d074c4082b5a0";

const BSC_TESTNET_CHAIN_ID = 97;

const MISSION_STORAGE_KEY =
  "bnb_agent_marketplace_missions";

const SAVED_SUBJOB_KEY =
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
  const [
    missions,
    setMissions,
  ] = useState<Mission[]>(
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
    createHash,
    setCreateHash,
  ] = useState<`0x${string}` | null>(
    null
  );

  const [
    registerHash,
    setRegisterHash,
  ] = useState<`0x${string}` | null>(
    null
  );

  const [
    budgetHash,
    setBudgetHash,
  ] = useState<`0x${string}` | null>(
    null
  );

  const [
    approvalHash,
    setApprovalHash,
  ] = useState<`0x${string}` | null>(
    null
  );

  const [
    fundHash,
    setFundHash,
  ] = useState<`0x${string}` | null>(
    null
  );

  const [
    status,
    setStatus,
  ] = useState(
    "Select an assigned mission task."
  );

  const [
    error,
    setError,
  ] = useState<string | null>(
    null
  );

  const [
    loading,
    setLoading,
  ] = useState(false);

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
    selectedTask
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

    const mission =
      missions.find(
        (
          item
        ) =>
          item.id ===
          saved?.missionId
      );

    if (mission) {
      setSelectedMissionId(
        mission.id
      );

      const savedTask =
        mission.tasks.find(
          (
            task
          ) =>
            task.id ===
            saved?.taskId
        );

      if (
        savedTask &&
        savedTask.assignedAgentId
      ) {
        setSelectedTaskId(
          savedTask.id
        );

        if (
          savedTask.chainJobId
        ) {
          setJobId(
            BigInt(
              savedTask.chainJobId
            )
          );
        }
      }
    } else {
      const firstMission =
        missions.find(
          (
            item
          ) =>
            item.tasks.some(
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
        }
      }
    }
  }, [missions]);

  useEffect(() => {
    if (
      selectedMissionId &&
      selectedTaskId
    ) {
      saveSubJobSelection(
        selectedMissionId,
        selectedTaskId
      );
    }
  }, [
    selectedMissionId,
    selectedTaskId,
  ]);

  async function connectWallet() {
    try {
      setError(null);
      setWalletStatus(
        "Connecting"
      );

      setStatus(
        "Connecting test provider wallet..."
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
              "ERC-8183 Marketplace Sub-job",

            url:
              window.location.origin,

            icons: [],
          },
        });

      await wallet.connect();

      const accounts =
        wallet.accounts as string[];

      if (
        !accounts ||
        accounts.length ===
          0
      ) {
        throw new Error(
          "No wallet account returned."
        );
      }

      const walletProvider =
        wallet as unknown as EIP1193Provider;

      const rawChainId =
        await walletProvider.request(
          {
            method:
              "eth_chainId",
          }
        );

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

      setStatus(
        "✅ Test provider wallet connected"
      );

      await loadTokenState(
        walletAddress
      );
    } catch (err) {
      console.error(
        "Sub-job wallet connection failed:",
        err
      );

      setWalletStatus(
        "Disconnected"
      );

      setStatus(
        "Wallet connection failed"
      );

      setError(
        formatError(
          err
        )
      );
    }
  }

  async function loadTokenState(
    walletAddress: Address
  ) {
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
  }

  async function createSubJob() {
    if (
      !provider ||
      !address
    ) {
      setError(
        "Connect the test provider wallet first."
      );
      return;
    }

    if (
      !selectedMission ||
      !selectedTask ||
      !assignedAgent
    ) {
      setError(
        "Select an assigned mission task first."
      );
      return;
    }

    try {
      setLoading(
        true
      );

      setError(null);

      setStatus(
        "Preparing ERC-8183 sub-job..."
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

      const providerAddress =
        address;

      const evaluator =
        ERC8183_ADDRESSES.router;

      const hook =
        ERC8183_ADDRESSES.router;

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
          `[MISSION:${selectedMission.id}]`,
          `[TASK:${selectedTask.id}]`,
          `Agent: ${assignedAgent.name}`,
          `Role: ${assignedAgent.role}`,
          "",
          selectedTask.description,
        ].join(
          "\n"
        );

      setStatus(
        "Waiting for wallet confirmation to create the sub-job..."
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
              providerAddress,
              evaluator,
              expiry,
              description,
              hook,
            ],
          }
        );

      setCreateHash(
        hash
      );

      setStatus(
        "Create transaction submitted..."
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
          "createJob transaction failed."
        );
      }

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

      updateMissionTaskChainJob(
        latestJobId
      );

      await refreshJob(
        latestJobId
      );

      setStatus(
        `✅ ERC-8183 sub-job #${latestJobId.toString()} created.`
      );
    } catch (err) {
      console.error(
        "Sub-job creation failed:",
        err
      );

      setStatus(
        "Sub-job creation failed"
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

  async function registerSubJob() {
    if (
      !provider ||
      !address ||
      jobId === null
    ) {
      setError(
        "Connect the wallet and create a sub-job first."
      );
      return;
    }

    try {
      setLoading(
        true
      );

      setError(null);

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
          "OptimisticPolicy is not whitelisted."
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
        "Waiting for wallet confirmation to register the sub-job..."
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

      setRegisterHash(
        hash
      );

      await waitForSuccess(
        hash
      );

      setStatus(
        `✅ Sub-job #${jobId.toString()} registered.`
      );

      await refreshJob(
        jobId
      );
    } catch (err) {
      console.error(
        "Register sub-job failed:",
        err
      );

      setStatus(
        "Sub-job registration failed"
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

  async function setSubJobBudget() {
    if (
      !provider ||
      !address ||
      jobId === null ||
      !selectedTask
    ) {
      setError(
        "Connect the wallet, create the sub-job, and select a task."
      );
      return;
    }

    try {
      setLoading(
        true
      );

      setError(null);

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
          )} ${tokenSymbol}; required: ${selectedTask.budget} ${tokenSymbol}.`
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
        `Waiting for wallet confirmation to set ${selectedTask.budget} ${tokenSymbol}...`
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

      setBudgetHash(
        hash
      );

      await waitForSuccess(
        hash
      );

      setStatus(
        `✅ Sub-job #${jobId.toString()} budget set to ${selectedTask.budget} ${tokenSymbol}.`
      );

      await refreshJob(
        jobId
      );

      await loadTokenState(
        address
      );
    } catch (err) {
      console.error(
        "Set sub-job budget failed:",
        err
      );

      setStatus(
        "Setting sub-job budget failed"
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

  async function approveSubJob() {
    if (
      !provider ||
      !address ||
      jobId === null ||
      !selectedTask ||
      !tokenAddress
    ) {
      setError(
        "Connect the wallet and prepare the sub-job first."
      );
      return;
    }

    try {
      setLoading(
        true
      );

      setError(null);

      const amount =
        parseUnits(
          String(
            selectedTask.budget
          ),
          tokenDecimals
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

      setStatus(
        `Waiting for approval of ${selectedTask.budget} ${tokenSymbol}...`
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

      setApprovalHash(
        hash
      );

      await waitForSuccess(
        hash
      );

      setStatus(
        `✅ ${tokenSymbol} allowance approved for the marketplace.`
      );

      await loadTokenState(
        address
      );
    } catch (err) {
      console.error(
        "Approval failed:",
        err
      );

      setStatus(
        "Token approval failed"
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

  async function fundSubJob() {
    if (
      !provider ||
      !address ||
      jobId === null ||
      !selectedTask
    ) {
      setError(
        "Prepare the sub-job first."
      );
      return;
    }

    try {
      setLoading(
        true
      );

      setError(null);

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
          `Insufficient ${tokenSymbol}.`
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
          `Allowance is only ${formatUnits(
            currentAllowance,
            tokenDecimals
          )} ${tokenSymbol}. Approve the sub-job budget first.`
        );
      }

      const currentJob =
        await readJob(
          jobId
        );

      if (
        currentJob.status !==
        0
      ) {
        throw new Error(
          `Job #${jobId.toString()} is not Open. Current status: ${getStatusName(
            currentJob.status
          )}.`
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
          )} ${tokenSymbol}, but task budget is ${
            selectedTask.budget
          } ${tokenSymbol}.`
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

      setStatus(
        `Waiting for wallet confirmation to fund ${selectedTask.budget} ${tokenSymbol}...`
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

      setFundHash(
        hash
      );

      await waitForSuccess(
        hash
      );

      const refreshed =
        await readJob(
          jobId
        );

      setJob(
        refreshed
      );

      updateMissionTaskChainStatus(
        refreshed
      );

      await loadTokenState(
        address
      );

      setStatus(
        `🎉 Sub-job #${jobId.toString()} is now FUNDED.`
      );
    } catch (err) {
      console.error(
        "Funding failed:",
        err
      );

      setStatus(
        "Sub-job funding failed"
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

  async function refreshJob(
    id: bigint
  ) {
    const loaded =
      await readJob(
        id
      );

    setJob(
      loaded
    );

    updateMissionTaskChainStatus(
      loaded
    );

    if (
      address
    ) {
      await loadTokenState(
        address
      );
    }
  }

  async function readJob(
    id: bigint
  ): Promise<OnChainJob> {
    return (await publicClient.readContract(
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
  }

  function updateMissionTaskChainJob(
    id: bigint
  ) {
    if (!selectedMission) {
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

  function updateMissionTaskChainStatus(
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
        <div
          style={
            styles.hero
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
              Turn an assigned marketplace task into
              an on-chain ERC-8183 job.
            </p>
          </div>

          <div
            style={
              styles.testBadge
            }
          >
            BSC TESTNET
          </div>
        </div>

        <div
          style={
            styles.testNotice
          }
        >
          <strong>
            🧪 Test provider mode
          </strong>

          <p>
            For this first integration, the connected
            wallet acts as the provider wallet.
          </p>

          <p>
            We will replace this with the agent's real
            registered wallet after the sub-job lifecycle
            is proven.
          </p>
        </div>

        <div
          style={
            styles.panel
          }
        >
          <h2
            style={
              styles.panelTitle
            }
          >
            1. Select Assigned Task
          </h2>

          <p
            style={
              styles.panelSubtitle
            }
          >
            Only tasks that already have an assigned agent
            are shown.
          </p>

          <select
            value={
              selectedMissionId
            }
            onChange={(
              event
            ) => {
              setSelectedMissionId(
                event.target
                  .value
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
                item
              ) => (
                <option
                  key={
                    item.id
                  }
                  value={
                    item.id
                  }
                >
                  {
                    item.title
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
        </div>

        {selectedTask && (
          <div
            style={
              styles.panel
            }
          >
            <h2
              style={
                styles.panelTitle
              }
            >
              2. Task Details
            </h2>

            <div
              style={
                styles.infoGrid
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
                  styles.goodBox
                }
              >
                <strong>
                  Existing ERC-8183 Job
                </strong>

                <p>
                  Job #
                  {
                    selectedTask.chainJobId
                  }
                </p>
              </div>
            )}
          </div>
        )}

        <div
          style={
            styles.panel
          }
        >
          <h2
            style={
              styles.panelTitle
            }
          >
            3. Provider Wallet
          </h2>

          <div
            style={
              styles.walletStatusRow
            }
          >
            <span>
              Wallet status
            </span>

            <strong
              style={
                walletStatus ===
                "Connected"
                  ? styles.connectedText
                  : walletStatus ===
                    "Connecting"
                  ? styles.connectingText
                  : styles.disconnectedText
              }
            >
              {
                walletStatus
              }
            </strong>
          </div>

          {address ? (
            <div
              style={
                styles.goodBox
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

              <p>
                This wallet will act as the test
                provider for the ERC-8183 sub-job.
              </p>
            </div>
          ) : (
            <button
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
                : "Connect Test Provider Wallet"}
            </button>
          )}

          {tokenBalance !==
            null && (
            <div
              style={
                styles.balanceBox
              }
            >
              <span>
                Payment token balance
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
        </div>

        {selectedTask &&
          address && (
          <div
            style={
              styles.panel
            }
          >
            <h2
              style={
                styles.panelTitle
              }
            >
              4. ERC-8183 Sub-job
            </h2>

            <div
              style={
                styles.stepFlow
              }
            >
              <Step
                label="Create"
                active={
                  jobId !==
                  null
                }
              />

              <Step
                label="Register"
                active={
                  registerHash !==
                  null
                }
              />

              <Step
                label="Budget"
                active={
                  job?.budget !==
                    undefined &&
                  job.budget >
                    0n
                }
              />

              <Step
                label="Approve"
                active={
                  allowance !==
                    null &&
                  allowance >=
                    parseUnits(
                      String(
                        selectedTask.budget
                      ),
                      tokenDecimals
                    )
                }
              />

              <Step
                label="Fund"
                active={
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
                ? "Create ERC-8183 Sub-job"
                : `Job #${jobId.toString()} Created`}
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
                styles.secondaryButtonFull
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
                styles.secondaryButtonFull
              }
            >
              Set Task Budget
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
                styles.secondaryButtonFull
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
              Fund Sub-job
            </button>
          </div>
        )}

        {job && (
          <div
            style={
              styles.panel
            }
          >
            <h2
              style={
                styles.panelTitle
              }
            >
              On-chain Job
            </h2>

            <div
              style={
                styles.infoGrid
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
                label="Budget"
                value={`${formatUnits(
                  job.budget,
                  tokenDecimals
                )} ${tokenSymbol}`}
              />

              <Info
                label="Evaluator"
                value={
                  job.evaluator
                }
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
          </div>
        )}

        <div
          style={
            styles.statusBox
          }
        >
          <strong>
            Status
          </strong>

          <p>
            {
              status
            }
          </p>
        </div>

        {error && (
          <div
            style={
              styles.errorBox
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

        {(createHash ||
          registerHash ||
          budgetHash ||
          approvalHash ||
          fundHash) && (
          <div
            style={
              styles.panel
            }
          >
            <h2
              style={
                styles.panelTitle
              }
            >
              Transactions
            </h2>

            <Transaction
              label="Create"
              hash={
                createHash
              }
            />

            <Transaction
              label="Register"
              hash={
                registerHash
              }
            />

            <Transaction
              label="Budget"
              hash={
                budgetHash
              }
            />

            <Transaction
              label="Approval"
              hash={
                approvalHash
              }
            />

            <Transaction
              label="Fund"
              hash={
                fundHash
              }
            />
          </div>
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
        styles.infoCard
      }
    >
      <span
        style={
          styles.infoLabel
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

function Step({
  label,
  active,
}: {
  label: string;
  active: boolean;
}) {
  return (
    <div
      style={
        active
          ? styles.stepActive
          : styles.step
      }
    >
      <span>
        {
          active
            ? "✓"
            : "○"
        }
      </span>

      <span>
        {
          label
        }
      </span>
    </div>
  );
}

function Transaction({
  label,
  hash,
}: {
  label: string;
  hash: `0x${string}` | null;
}) {
  if (!hash) {
    return null;
  }

  return (
    <div
      style={
        styles.transaction
      }
    >
      <span>
        {
          label
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
  );
}

async function waitForSuccess(
  hash: `0x${string}`
) {
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
      "Transaction was mined but failed."
    );
  }

  return receipt;
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
      .startsWith(
        "0x"
      )
      ? parseInt(
          value,
          16
        )
      : Number(
          value
        );
  }

  throw new Error(
    "Unable to determine chain ID."
  );
}

function getStatusName(
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
    // Ignore storage failure.
  }
}

function saveSubJobSelection(
  missionId: string,
  taskId: string
) {
  try {
    window.localStorage.setItem(
      SAVED_SUBJOB_KEY,
      JSON.stringify({
        missionId,
        taskId,
      })
    );
  } catch {
    // Ignore storage failure.
  }
}

function loadSavedSubJob(): {
  missionId?: string;
  taskId?: string;
} {
  try {
    const raw =
      window.localStorage.getItem(
        SAVED_SUBJOB_KEY
      );

    if (!raw) {
      return {};
    }

    const parsed =
      JSON.parse(
        raw
      );

    return parsed &&
      typeof parsed ===
        "object"
      ? parsed
      : {};
  } catch {
    return {};
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
      "26px 16px 60px",
    background:
      "#090b0d",
    color:
      "#f1f2ef",
    fontFamily:
      "Inter, system-ui, sans-serif",
  },

  container: {
    maxWidth:
      "850px",
    margin:
      "0 auto",
  },

  hero: {
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
  },

  testBadge: {
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
  },

  testNotice: {
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
      1.6,
  },

  panel: {
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

  panelTitle: {
    margin:
      0,
    fontSize:
      "19px",
  },

  panelSubtitle: {
    margin:
      "5px 0 14px",
    color:
      "#7f878e",
    fontSize:
      "12px",
  },

  select: {
    width:
      "100%",
    boxSizing:
      "border-box",
    padding:
      "12px",
    marginTop:
      "9px",
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

  infoGrid: {
    display:
      "grid",
    gridTemplateColumns:
      "repeat(auto-fit, minmax(150px, 1fr))",
    gap:
      "8px",
    marginTop:
      "14px",
  },

  infoCard: {
    padding:
      "11px",
    border:
      "1px solid #272d32",
    borderRadius:
      "9px",
    background:
      "#0d1012",
  },

  infoLabel: {
    display:
      "block",
    color:
      "#737c83",
    fontSize:
      "10px",
    textTransform:
      "uppercase",
  },

  infoValue: {
    display:
      "block",
    marginTop:
      "4px",
    fontSize:
      "12px",
    wordBreak:
      "break-all",
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

  code: {
    display:
      "block",
    marginTop:
      "12px",
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

  goodBox: {
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

  walletStatusRow: {
    display:
      "flex",
    justifyContent:
      "space-between",
    alignItems:
      "center",
    padding:
      "10px 0",
    borderBottom:
      "1px solid #252b30",
    color:
      "#878f96",
    fontSize:
      "12px",
  },

  connectedText: {
    color:
      "#7fd3a5",
  },

  connectingText: {
    color:
      "#f0b90b",
  },

  disconnectedText: {
    color:
      "#9ca4aa",
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