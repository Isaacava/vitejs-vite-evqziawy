import {
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
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

const SUBJOB_UPDATED_EVENT =
  "agent-marketplace-subjob-updated";

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

  const [selectedMissionId, setSelectedMissionId] =
    useState("");

  const [selectedTaskId, setSelectedTaskId] =
    useState("");

  const [provider, setProvider] =
    useState<EIP1193Provider | null>(
      null
    );

  const [address, setAddress] =
    useState<Address | null>(
      null
    );

  const [walletStatus, setWalletStatus] =
    useState<WalletStatus>(
      "Disconnected"
    );

  const [tokenAddress, setTokenAddress] =
    useState<Address | null>(
      null
    );

  const [tokenSymbol, setTokenSymbol] =
    useState("U");

  const [tokenDecimals, setTokenDecimals] =
    useState(18);

  const [tokenBalance, setTokenBalance] =
    useState<bigint | null>(
      null
    );

  const [allowance, setAllowance] =
    useState<bigint | null>(
      null
    );

  const [job, setJob] =
    useState<OnChainJob | null>(
      null
    );

  const [jobId, setJobId] =
    useState<bigint | null>(
      null
    );

  const [statusMessage, setStatusMessage] =
    useState(
      "Select a mission."
    );

  const [errorMessage, setErrorMessage] =
    useState<string | null>(
      null
    );

  const [loading, setLoading] =
    useState(false);

  const [refreshing, setRefreshing] =
    useState(false);

  const [transactionHashes, setTransactionHashes] =
    useState<{
      create?: `0x${string}`;
      register?: `0x${string}`;
      budget?: `0x${string}`;
      approval?: `0x${string}`;
      fund?: `0x${string}`;
    }>({});

  const selectedMission =
    missions.find(
      (mission) =>
        mission.id ===
        selectedMissionId
    ) ?? null;

  const assignedTasks =
    useMemo(
      () =>
        selectedMission
          ? selectedMission.tasks.filter(
              (task) =>
                Boolean(
                  task.assignedAgentId
                )
            )
          : [],
      [selectedMission]
    );

  const selectedTask =
    selectedMission?.tasks.find(
      (task) =>
        task.id ===
        selectedTaskId
    ) ?? null;

  const assignedAgent =
    selectedTask?.assignedAgentId
      ? DEMO_AGENTS.find(
          (agent) =>
            agent.id ===
            selectedTask.assignedAgentId
        ) ?? null
      : null;

  /*
   * ------------------------------------------------------------
   * INITIALIZATION
   * ------------------------------------------------------------
   */

  useEffect(() => {
    const saved =
      loadSavedSubJob();

    if (
      saved
    ) {
      const savedMission =
        missions.find(
          (mission) =>
            mission.id ===
            saved.missionId
        );

      if (
        savedMission
      ) {
        setSelectedMissionId(
          savedMission.id
        );

        const savedTask =
          savedMission.tasks.find(
            (task) =>
              task.id ===
              saved.taskId
          );

        if (
          savedTask
        ) {
          setSelectedTaskId(
            savedTask.id
          );
        } else {
          const firstAssigned =
            savedMission.tasks.find(
              (task) =>
                Boolean(
                  task.assignedAgentId
                )
            );

          setSelectedTaskId(
            firstAssigned?.id ??
              ""
          );
        }

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

    if (
      missions.length >
      0
    ) {
      const firstMission =
        missions[0];

      setSelectedMissionId(
        firstMission.id
      );

      const firstAssigned =
        firstMission.tasks.find(
          (task) =>
            Boolean(
              task.assignedAgentId
            )
        );

      setSelectedTaskId(
        firstAssigned?.id ??
          ""
      );
    }
  }, []);

  /*
   * ------------------------------------------------------------
   * SAVE SELECTION
   * ------------------------------------------------------------
   */

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

  /*
   * ------------------------------------------------------------
   * TOKEN STATE
   * ------------------------------------------------------------
   */

  useEffect(() => {
    if (
      address
    ) {
      void refreshTokenState(
        address
      );
    }
  }, [
    address,
  ]);

  /*
   * ------------------------------------------------------------
   * MANUAL MISSION REFRESH
   * ------------------------------------------------------------
   */

  function refreshMissions() {
    setRefreshing(
      true
    );

    const latest =
      loadMissions();

    setMissions(
      latest
    );

    /*
     * Keep the user's selected mission if it still exists.
     * This is deliberately NOT an effect watching selection.
     */
    const currentMission =
      latest.find(
        (mission) =>
          mission.id ===
          selectedMissionId
      );

    if (
      currentMission
    ) {
      const currentTask =
        currentMission.tasks.find(
          (task) =>
            task.id ===
            selectedTaskId
        );

      if (
        currentTask
      ) {
        setSelectedTaskId(
          currentTask.id
        );
      } else {
        const firstAssigned =
          currentMission.tasks.find(
            (task) =>
              Boolean(
                task.assignedAgentId
              )
          );

        setSelectedTaskId(
          firstAssigned?.id ??
            ""
        );
      }
    } else if (
      latest.length >
      0
    ) {
      const firstMission =
        latest[0];

      setSelectedMissionId(
        firstMission.id
      );

      const firstAssigned =
        firstMission.tasks.find(
          (task) =>
            Boolean(
              task.assignedAgentId
            )
        );

      setSelectedTaskId(
        firstAssigned?.id ??
          ""
      );
    } else {
      setSelectedMissionId(
        ""
      );

      setSelectedTaskId(
        ""
      );
    }

    setRefreshing(
      false
    );

    setStatusMessage(
      latest.length >
        0
        ? "✅ Missions refreshed."
        : "No missions found."
    );
  }

  /*
   * ------------------------------------------------------------
   * MISSION SELECTION
   * ------------------------------------------------------------
   */

  function handleMissionChange(
    missionId: string
  ) {
    setSelectedMissionId(
      missionId
    );

    const mission =
      missions.find(
        (item) =>
          item.id ===
          missionId
      );

    const firstAssigned =
      mission?.tasks.find(
        (task) =>
          Boolean(
            task.assignedAgentId
          )
      );

    setSelectedTaskId(
      firstAssigned?.id ??
        ""
    );

    setJob(
      null
    );

    setJobId(
      firstAssigned?.chainJobId
        ? BigInt(
            firstAssigned.chainJobId
          )
        : null
    );

    setTransactionHashes(
      {}
    );

    setErrorMessage(
      null
    );

    setStatusMessage(
      mission
        ? firstAssigned
          ? "✅ Assigned task selected."
          : "Mission selected. No agent assigned yet."
        : "Select a mission."
    );
  }

  /*
   * ------------------------------------------------------------
   * TASK SELECTION
   * ------------------------------------------------------------
   */

  function handleTaskChange(
    taskId: string
  ) {
    setSelectedTaskId(
      taskId
    );

    const task =
      selectedMission?.tasks.find(
        (item) =>
          item.id ===
          taskId
      );

    setJob(
      null
    );

    setJobId(
      task?.chainJobId
        ? BigInt(
            task.chainJobId
          )
        : null
    );

    setTransactionHashes(
      {}
    );

    setErrorMessage(
      null
    );

    setStatusMessage(
      task
        ? "✅ Task selected."
        : "Select a task."
    );
  }

  /*
   * ------------------------------------------------------------
   * WALLET
   * ------------------------------------------------------------
   */

  async function connectWallet() {
    try {
      setErrorMessage(
        null
      );

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
          `Wrong network. Connected chain ID: ${chainId}. BSC Testnet requires 97.`
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
    } catch (
      error
    ) {
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

  /*
   * ------------------------------------------------------------
   * TOKEN STATE
   * ------------------------------------------------------------
   */

  async function refreshTokenState(
    walletAddress: Address
  ) {
    try {
      const paymentToken =
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
                paymentToken,

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
              paymentToken,

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
              paymentToken,

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
              paymentToken,

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
        paymentToken
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
    } catch (
      error
    ) {
      console.error(
        "Token state error:",
        error
      );
    }
  }

  /*
   * ------------------------------------------------------------
   * CREATE ERC-8183 JOB
   * ------------------------------------------------------------
   */

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
        "Select a task that has an assigned agent."
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
        (current) => ({
          ...current,

          create:
            hash,
        })
      );

      setStatusMessage(
        "Waiting for createJob confirmation..."
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
          "createJob transaction failed."
        );
      }

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

      saveSubJob({
        missionId:
          selectedMission.id,
        taskId:
          selectedTask.id,
        jobId:
          counter.toString(),
      });

      await loadJob(
        counter
      );

      setStatusMessage(
        `✅ ERC-8183 Job #${counter.toString()} created.`
      );
    } catch (
      error
    ) {
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

  /*
   * ------------------------------------------------------------
   * REGISTER
   * ------------------------------------------------------------
   */

  async function registerSubJob() {
    if (
      !provider ||
      !address ||
      jobId ===
        null
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
        (current) => ({
          ...current,

          register:
            hash,
        })
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
          "registerJob transaction failed."
        );
      }

      await loadJob(
        jobId
      );

      setStatusMessage(
        `✅ Job #${jobId.toString()} registered.`
      );
    } catch (
      error
    ) {
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

  /*
   * ------------------------------------------------------------
   * SET BUDGET
   * ------------------------------------------------------------
   */

  async function setSubJobBudget() {
    if (
      !provider ||
      !address ||
      jobId ===
        null ||
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
        (current) => ({
          ...current,

          budget:
            hash,
        })
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
          "setBudget transaction failed."
        );
      }

      await loadJob(
        jobId
      );

      setStatusMessage(
        `✅ Budget set to ${selectedTask.budget} ${tokenSymbol}.`
      );
    } catch (
      error
    ) {
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

  /*
   * ------------------------------------------------------------
   * APPROVE
   * ------------------------------------------------------------
   */

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
        (current) => ({
          ...current,

          approval:
            hash,
        })
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
          "Approval transaction failed."
        );
      }

      await refreshTokenState(
        address
      );

      setStatusMessage(
        `✅ ${selectedTask.budget} ${tokenSymbol} approved.`
      );
    } catch (
      error
    ) {
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

  /*
   * ------------------------------------------------------------
   * FUND
   * ------------------------------------------------------------
   */

  async function fundSubJob() {
    if (
      !provider ||
      !address ||
      jobId ===
        null ||
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
          )} ${tokenSymbol}; expected ${selectedTask.budget} ${tokenSymbol}.`
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

      await publicClient.simulateContract({
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
      });

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
        (current) => ({
          ...current,

          fund:
            hash,
        })
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
          "Fund transaction failed."
        );
      }

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
    } catch (
      error
    ) {
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

  /*
   * ------------------------------------------------------------
   * ON-CHAIN JOB READ
   * ------------------------------------------------------------
   */

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

  /*
   * ------------------------------------------------------------
   * SAVE CHAIN JOB ID
   * ------------------------------------------------------------
   */

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

  /*
   * ------------------------------------------------------------
   * UPDATE CHAIN STATUS
   * ------------------------------------------------------------
   */

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

  /*
   * ------------------------------------------------------------
   * RENDER
   * ------------------------------------------------------------
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
              real ERC-8183 job.
            </p>
          </div>

          <div
            style={
              styles.badge
            }
          >
            BSC TESTNET
          </div>
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
            this first integration. We are not sending
            funds to placeholder demo wallets.
          </p>
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
                1. Select assigned task
              </h2>

              <p
                style={
                  styles.muted
                }
              >
                Select a mission first, then select one of
                its assigned tasks.
              </p>
            </div>

            <button
              type="button"
              onClick={
                refreshMissions
              }
              disabled={
                refreshing
              }
              style={
                styles.refreshButton
              }
            >
              {refreshing
                ? "Refreshing..."
                : "↻ Refresh Missions"}
            </button>
          </div>

          <div
            style={
              styles.summary
            }
          >
            <div>
              <span>
                Missions
              </span>

              <strong>
                {
                  missions.length
                }
              </strong>
            </div>

            <div>
              <span>
                Assigned tasks
              </span>

              <strong>
                {
                  missions.reduce(
                    (
                      total,
                      mission
                    ) =>
                      total +
                      mission.tasks.filter(
                        (task) =>
                          Boolean(
                            task.assignedAgentId
                          )
                      ).length,
                    0
                  )
                }
              </strong>
            </div>
          </div>

          <label
            style={
              styles.label
            }
          >
            Mission
          </label>

          <select
            value={
              selectedMissionId
            }
            onChange={(
              event
            ) =>
              handleMissionChange(
                event.target
                  .value
              )
            }
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
                  }{" "}
                  —{" "}
                  {
                    mission.budget
                  }{" "}
                  U
                </option>
              )
            )}
          </select>

          <label
            style={
              styles.label
            }
          >
            Assigned Task
          </label>

          <select
            value={
              selectedTaskId
            }
            onChange={(
              event
            ) =>
              handleTaskChange(
                event.target
                  .value
              )
            }
            disabled={
              !selectedMission ||
              assignedTasks.length ===
                0
            }
            style={
              styles.select
            }
          >
            <option value="">
              {assignedTasks.length >
              0
                ? "Select assigned task"
                : "No assigned tasks"}
            </option>

            {assignedTasks.map(
              (
                task
              ) => {
                const agent =
                  DEMO_AGENTS.find(
                    (
                      item
                    ) =>
                      item.id ===
                      task.assignedAgentId
                  );

                return (
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
                      agent?.name ??
                      task.role
                    }{" "}
                    —{" "}
                    {
                      task.budget
                    }{" "}
                    U
                  </option>
                );
              }
            )}
          </select>

          {missions.length ===
            0 && (
            <div
              style={
                styles.emptyState
              }
            >
              <strong>
                No missions found.
              </strong>

              <span>
                Create a mission in Marketplace first.
              </span>
            </div>
          )}

          {selectedMission &&
            assignedTasks.length ===
              0 && (
            <div
              style={
                styles.emptyState
              }
            >
              <strong>
                No agent assigned yet.
              </strong>

              <span>
                Go to Agents and assign a provider to one
                of this mission's tasks.
              </span>
            </div>
          )}
        </section>

        {selectedTask && (
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
              <h2
                style={
                  styles.sectionTitle
                }
              >
                2. Task details
              </h2>

              <span
                style={
                  styles.readyBadge
                }
              >
                READY
              </span>
            </div>

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
          </section>
        )}

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
            <h2
              style={
                styles.sectionTitle
              }
            >
              3. Provider wallet
            </h2>

            <span
              style={
                walletStatus ===
                "Connected"
                  ? styles.walletConnected
                  : walletStatus ===
                    "Connecting"
                  ? styles.walletConnecting
                  : styles.walletDisconnected
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
              type="button"
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
            <h2
              style={
                styles.sectionTitle
              }
            >
              4. ERC-8183 lifecycle
            </h2>

            <div
              style={
                styles.steps
              }
            >
              <Step
                label="Create"
                complete={
                  jobId !==
                  null
                }
              />

              <Step
                label="Register"
                complete={
                  Boolean(
                    transactionHashes.register
                  )
                }
              />

              <Step
                label="Budget"
                complete={
                  Boolean(
                    job &&
                    job.budget >
                      0n
                  )
                }
              />

              <Step
                label="Approve"
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
                label="Fund"
                complete={
                  job?.status ===
                  1
                }
              />
            </div>

            <button
              type="button"
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
              type="button"
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
              type="button"
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
              type="button"
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
              type="button"
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
            <h2
              style={
                styles.sectionTitle
              }
            >
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
            <h2
              style={
                styles.sectionTitle
              }
            >
              Transactions
            </h2>

            {Object.entries(
              transactionHashes
            ).map(
              (
                [
                  label,
                  hash,
                ]
              ) => (
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

/*
 * ============================================================
 * SMALL COMPONENTS / HELPERS
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
  complete,
}: {
  label: string;
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
          label
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
    value.charAt(
      0
    ).toUpperCase() +
    value.slice(
      1
    )
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

    window.dispatchEvent(
      new Event(
        SUBJOB_UPDATED_EVENT
      )
    );
  } catch {
    // Ignore storage errors.
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

    window.dispatchEvent(
      new Event(
        SUBJOB_UPDATED_EVENT
      )
    );
  } catch {
    // Ignore storage errors.
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
  CSSProperties
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
      "Inter, system-ui, sans-serif",
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
      0,
    fontSize:
      "19px",
  },

  muted: {
    margin:
      "5px 0 12px",
    color:
      "#7f878e",
    fontSize:
      "12px",
  },

  refreshButton: {
    flexShrink:
      0,
    padding:
      "9px 11px",
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

  summary: {
    display:
      "grid",
    gridTemplateColumns:
      "1fr 1fr",
    gap:
      "8px",
    marginTop:
      "14px",
  },

  summaryBox: {
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
    marginTop:
      "10px",
    marginBottom:
      "6px",
    color:
      "#757e85",
    fontSize:
      "10px",
    fontWeight:
      800,
    textTransform:
      "uppercase",
    letterSpacing:
      "0.05em",
  },

  select: {
    display:
      "block",
    width:
      "100%",
    boxSizing:
      "border-box",
    marginTop:
      "7px",
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

  emptyState: {
    display:
      "grid",
    gap:
      "5px",
    marginTop:
      "12px",
    padding:
      "13px",
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
    lineHeight:
      1.5,
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
      "break-word",
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
    display:
      "grid",
    gap:
      "4px",
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

  readyBadge: {
    padding:
      "6px 8px",
    borderRadius:
      "999px",
    background:
      "#101916",
    color:
      "#7fd3a5",
    fontSize:
      "10px",
    fontWeight:
      900,
  },

  walletConnected: {
    color:
      "#7fd3a5",
    fontSize:
      "12px",
    fontWeight:
      800,
  },

  walletConnecting: {
    color:
      "#f0b90b",
    fontSize:
      "12px",
    fontWeight:
      800,
  },

  walletDisconnected: {
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
      "7px",
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
};
