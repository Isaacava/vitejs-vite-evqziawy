import {
  useEffect,
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

import { EthereumProvider } from "@walletconnect/ethereum-provider";

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

const SAVED_JOB_KEY =
  "bnb_agent_marketplace_test_job_id";

/*
 * BNB Agent SDK happy-path examples use
 * an expiry around 65 minutes.
 *
 * We use the same value for our fresh
 * test jobs instead of the old 1-hour value.
 */
const TEST_JOB_EXPIRY_SECONDS =
  65 * 60;

type WalletState =
  | "disconnected"
  | "connecting"
  | "connected";

type LoadedJob = {
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

type SimulationResult = {
  ok: boolean;
  message: string;
};

export default function Erc8183Test() {
  const [walletState, setWalletState] =
    useState<WalletState>("disconnected");

  const [provider, setProvider] =
    useState<EIP1193Provider | null>(null);

  const [address, setAddress] =
    useState<Address | null>(null);

  const [status, setStatus] =
    useState("Not connected");

  const [jobId, setJobId] =
    useState<bigint | null>(null);

  const [jobIdInput, setJobIdInput] =
    useState("");

  const [loadedJob, setLoadedJob] =
    useState<LoadedJob | null>(null);

  const [description, setDescription] =
    useState(
      "Test ERC-8183 job from our BSC agent marketplace."
    );

  const [transactionHash, setTransactionHash] =
    useState<`0x${string}` | null>(null);

  const [
    registerTransactionHash,
    setRegisterTransactionHash,
  ] = useState<`0x${string}` | null>(null);

  const [
    budgetTransactionHash,
    setBudgetTransactionHash,
  ] = useState<`0x${string}` | null>(null);

  const [
    approvalTransactionHash,
    setApprovalTransactionHash,
  ] = useState<`0x${string}` | null>(null);

  const [
    fundTransactionHash,
    setFundTransactionHash,
  ] = useState<`0x${string}` | null>(null);

  const [
    registeredPolicy,
    setRegisteredPolicy,
  ] = useState<Address | null>(null);

  const [paymentToken, setPaymentToken] =
    useState<Address | null>(null);

  const [tokenSymbol, setTokenSymbol] =
    useState("—");

  const [tokenDecimals, setTokenDecimals] =
    useState<number | null>(null);

  const [tokenBalance, setTokenBalance] =
    useState("—");

  const [budget, setBudget] =
    useState("1");

  const [budgetRaw, setBudgetRaw] =
    useState<bigint | null>(null);

  const [allowanceRaw, setAllowanceRaw] =
    useState<bigint | null>(null);

  const [loading, setLoading] =
    useState(false);

  const [isSimulating, setIsSimulating] =
    useState(false);

  const [error, setError] =
    useState<string | null>(null);

  const [
    simulation,
    setSimulation,
  ] = useState<SimulationResult | null>(
    null
  );

  /*
   * =========================================================
   * RESTORE LAST JOB ID
   * =========================================================
   */

  useEffect(() => {
    try {
      const savedJobId =
        window.localStorage.getItem(
          SAVED_JOB_KEY
        );

      if (
        savedJobId &&
        /^\d+$/.test(savedJobId)
      ) {
        setJobIdInput(
          savedJobId
        );
      }
    } catch (err) {
      console.warn(
        "Could not restore saved job ID:",
        err
      );
    }
  }, []);

  /*
   * =========================================================
   * SAVE JOB ID
   * =========================================================
   */

  function saveJobId(
    id: bigint
  ) {
    setJobId(id);

    setJobIdInput(
      id.toString()
    );

    try {
      window.localStorage.setItem(
        SAVED_JOB_KEY,
        id.toString()
      );
    } catch (err) {
      console.warn(
        "Could not save job ID:",
        err
      );
    }
  }

  /*
   * =========================================================
   * CONNECT WALLET
   * =========================================================
   */

  async function connect() {
    try {
      setError(null);

      setStatus(
        "Connecting..."
      );

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
   * =========================================================
   * LOAD EXISTING JOB
   * =========================================================
   */

  async function loadExistingJob(
    idOverride?: string
  ) {
    try {
      setError(null);

      const rawId =
        idOverride?.trim() ||
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
        `Loading Job #${id.toString()} from BSC...`
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

      const job: LoadedJob = {
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

      saveJobId(id);

      setLoadedJob(
        job
      );

      setDescription(
        job.description
      );

      setBudgetRaw(
        job.budget > 0n
          ? job.budget
          : null
      );

      setSimulation(null);

      /*
       * Read registered policy.
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
        } else {
          setRegisteredPolicy(
            null
          );
        }
      } catch {
        setRegisteredPolicy(
          null
        );
      }

      setStatus(
        `✅ Job #${id.toString()} loaded from BSC`
      );
    } catch (err) {
      console.error(
        "Load job failed:",
        err
      );

      setLoadedJob(
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
   * AUTO LOAD SAVED JOB
   * =========================================================
   */

  useEffect(() => {
    if (
      walletState !==
        "connected" ||
      !jobIdInput
    ) {
      return;
    }

    void loadExistingJob(
      jobIdInput
    );

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    walletState,
  ]);

  /*
   * =========================================================
   * LOAD PAYMENT TOKEN
   * =========================================================
   */

  async function loadPaymentToken() {
    if (!address) {
      throw new Error(
        "Connect your wallet first."
      );
    }

    const tokenAddress =
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
      (await publicClient.readContract(
        {
          address:
            tokenAddress,

          abi:
            ERC20_ABI,

          functionName:
            "decimals",
        }
      )) as number;

    const symbol =
      (await publicClient.readContract(
        {
          address:
            tokenAddress,

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
            tokenAddress,

          abi:
            ERC20_ABI,

          functionName:
            "balanceOf",

          args: [
            address,
          ],
        }
      )) as bigint;

    const allowance =
      (await publicClient.readContract(
        {
          address:
            tokenAddress,

          abi:
            ERC20_ABI,

          functionName:
            "allowance",

          args: [
            address,
            ERC8183_ADDRESSES.commerce,
          ],
        }
      )) as bigint;

    const decimalsNumber =
      Number(
        decimals
      );

    setPaymentToken(
      tokenAddress
    );

    setTokenDecimals(
      decimalsNumber
    );

    setTokenSymbol(
      symbol
    );

    setTokenBalance(
      formatUnits(
        balance,
        decimalsNumber
      )
    );

    setAllowanceRaw(
      allowance
    );

    return {
      tokenAddress,
      decimals:
        decimalsNumber,
      symbol,
      balance,
      allowance,
    };
  }

  /*
   * =========================================================
   * CREATE JOB
   * =========================================================
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

      setLoadedJob(
        null
      );

      setTransactionHash(
        null
      );

      setRegisterTransactionHash(
        null
      );

      setBudgetTransactionHash(
        null
      );

      setApprovalTransactionHash(
        null
      );

      setFundTransactionHash(
        null
      );

      setRegisteredPolicy(
        null
      );

      setBudgetRaw(
        null
      );

      setAllowanceRaw(
        null
      );

      setSimulation(
        null
      );

      setStatus(
        "Preparing new test job..."
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

      /*
       * 65-minute expiry.
       */
      const expiry =
        BigInt(
          Math.floor(
            Date.now() /
              1000
          ) +
            TEST_JOB_EXPIRY_SECONDS
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
              address,

              ERC8183_ADDRESSES.router,

              expiry,

              description,

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
          "The createJob transaction failed."
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

      saveJobId(
        latestJobId
      );

      await loadExistingJob(
        latestJobId.toString()
      );

      setStatus(
        `✅ Job #${latestJobId.toString()} created with a 65-minute expiry`
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
   * =========================================================
   * REGISTER JOB
   * =========================================================
   */

  async function registerJob() {
    if (
      !provider ||
      !address ||
      jobId === null
    ) {
      setError(
        "Connect your wallet and load a job first."
      );

      return;
    }

    if (
      loadedJob &&
      isJobExpired(
        loadedJob.expiredAt
      )
    ) {
      setError(
        "This job has expired. Create a new test job."
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
        `Checking Job #${jobId.toString()}...`
      );

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
          "OptimisticPolicy is not whitelisted by the EvaluatorRouter."
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
        "Waiting for wallet confirmation..."
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

      setRegisterTransactionHash(
        hash
      );

      setStatus(
        "Registration submitted..."
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
          "Registration transaction failed."
        );
      }

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
            "Policy verification failed.",
            "",
            `Expected: ${ERC8183_ADDRESSES.policy}`,
            `Returned: ${policy}`,
          ].join(
            "\n"
          )
        );
      }

      setRegisteredPolicy(
        policy
      );

      setStatus(
        `✅ Job #${jobId.toString()} registered`
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

  /*
   * =========================================================
   * SET BUDGET
   * =========================================================
   */

  async function setJobBudget() {
    if (
      !provider ||
      !address ||
      jobId === null
    ) {
      setError(
        "Connect your wallet and load a job first."
      );

      return;
    }

    if (
      !registeredPolicy
    ) {
      setError(
        "Register the job first."
      );

      return;
    }

    if (
      loadedJob &&
      isJobExpired(
        loadedJob.expiredAt
      )
    ) {
      setError(
        "This job has expired. Create a new test job."
      );

      return;
    }

    try {
      setError(null);

      setLoading(true);

      setBudgetTransactionHash(
        null
      );

      const token =
        await loadPaymentToken();

      const trimmed =
        budget.trim();

      if (!trimmed) {
        throw new Error(
          "Enter a budget amount."
        );
      }

      const amount =
        parseUnits(
          trimmed,
          token.decimals
        );

      if (
        amount <= 0n
      ) {
        throw new Error(
          "Budget must be greater than zero."
        );
      }

      if (
        token.balance <
        amount
      ) {
        throw new Error(
          [
            `Insufficient ${token.symbol}.`,
            "",
            `Wallet balance: ${formatUnits(
              token.balance,
              token.decimals
            )} ${token.symbol}`,
            `Required: ${trimmed} ${token.symbol}`,
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
        `Waiting for wallet confirmation to set ${trimmed} ${token.symbol}...`
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

      setBudgetTransactionHash(
        hash
      );

      setStatus(
        "Budget transaction submitted..."
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
          "setBudget transaction failed."
        );
      }

      await loadExistingJob(
        jobId.toString()
      );

      setStatus(
        `✅ Job #${jobId.toString()} budget set`
      );
    } catch (err) {
      console.error(
        "setBudget failed:",
        err
      );

      setStatus(
        "Setting budget failed"
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
   * SIMULATE FUND
   * =========================================================
   */

  async function simulateFund(): Promise<SimulationResult> {
    if (
      !address ||
      jobId === null
    ) {
      const result = {
        ok: false,

        message:
          "Connect your wallet and load a job first.",
      };

      setSimulation(
        result
      );

      return result;
    }

    if (
      budgetRaw === null
    ) {
      const result = {
        ok: false,

        message:
          "The job does not have a budget yet.",
      };

      setSimulation(
        result
      );

      return result;
    }

    setIsSimulating(
      true
    );

    setSimulation(
      null
    );

    setError(
      null
    );

    try {
      setStatus(
        "Checking job state before simulation..."
      );

      const job =
        (await publicClient.readContract(
          {
            address:
              ERC8183_ADDRESSES.commerce,

            abi:
              COMMERCE_ABI,

            functionName:
              "getJob",

            args: [
              jobId,
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

      const token =
        await loadPaymentToken();

      const expired =
        isJobExpired(
          job.expiredAt
        );

      if (
        expired
      ) {
        throw new Error(
          [
            `Job #${jobId.toString()} has expired.`,

            "",

            `Expiry: ${formatTimestamp(
              job.expiredAt
            )}`,

            `Current time: ${new Date().toLocaleString()}`,

            "",

            "Create a new test job instead of trying to fund this one.",
          ].join(
            "\n"
          )
        );
      }

      if (
        Number(
          job.status
        ) !== 0
      ) {
        throw new Error(
          [
            `Job #${jobId.toString()} is not Open.`,

            "",

            `Current status: ${getStatusName(
              Number(
                job.status
              )
            )}`,
          ].join(
            "\n"
          )
        );
      }

      if (
        job.budget !==
        budgetRaw
      ) {
        throw new Error(
          [
            "The on-chain budget does not match the UI.",

            "",

            `On-chain: ${formatUnits(
              job.budget,
              token.decimals
            )} ${token.symbol}`,

            `UI: ${formatUnits(
              budgetRaw,
              token.decimals
            )} ${token.symbol}`,
          ].join(
            "\n"
          )
        );
      }

      if (
        token.balance <
        budgetRaw
      ) {
        throw new Error(
          [
            `Insufficient ${token.symbol} balance.`,

            "",

            `Balance: ${formatUnits(
              token.balance,
              token.decimals
            )} ${token.symbol}`,

            `Required: ${formatUnits(
              budgetRaw,
              token.decimals
            )} ${token.symbol}`,
          ].join(
            "\n"
          )
        );
      }

      if (
        token.allowance <
        budgetRaw
      ) {
        throw new Error(
          [
            `Insufficient ${token.symbol} allowance.`,

            "",

            `Allowance: ${formatUnits(
              token.allowance,
              token.decimals
            )} ${token.symbol}`,

            `Required: ${formatUnits(
              budgetRaw,
              token.decimals
            )} ${token.symbol}`,

            "",

            "Run the approval/funding flow after loading the current job.",
          ].join(
            "\n"
          )
        );
      }

      setStatus(
        "Simulating fund() against current BSC state..."
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

            budgetRaw,

            "0x",
          ],

          account:
            address,
        }
      );

      const result: SimulationResult =
        {
          ok: true,

          message:
            [
              `✓ Job #${jobId.toString()} is Open`,

              `✓ Expiry: ${formatTimestamp(
                job.expiredAt
              )}`,

              "✓ Job is not expired",

              `✓ Budget: ${formatUnits(
                budgetRaw,
                token.decimals
              )} ${token.symbol}`,

              `✓ Balance: ${formatUnits(
                token.balance,
                token.decimals
              )} ${token.symbol}`,

              `✓ Allowance: ${formatUnits(
                token.allowance,
                token.decimals
              )} ${token.symbol}`,

              "✓ fund() simulation passed",

              "",

              "The blockchain currently accepts the fund call.",
            ].join(
              "\n"
            ),
        };

      setSimulation(
        result
      );

      setStatus(
        "✅ fund() simulation passed"
      );

      return result;
    } catch (err) {
      const reason =
        extractRevertReason(
          err
        );

      const result: SimulationResult =
        {
          ok: false,

          message:
            [
              "fund() simulation failed.",

              "",

              "Revert / error reason:",

              reason,
            ].join(
              "\n"
            ),
        };

      setSimulation(
        result
      );

      setStatus(
        "❌ fund() simulation failed"
      );

      return result;
    } finally {
      setIsSimulating(
        false
      );
    }
  }

  /*
   * =========================================================
   * FUND JOB
   * =========================================================
   */

  async function fundJob() {
    if (
      !provider ||
      !address ||
      jobId === null
    ) {
      setError(
        "Connect your wallet and load a job first."
      );

      return;
    }

    if (
      budgetRaw === null
    ) {
      setError(
        "Set the job budget first."
      );

      return;
    }

    if (
      loadedJob &&
      isJobExpired(
        loadedJob.expiredAt
      )
    ) {
      setError(
        "This job is expired. Create a fresh test job."
      );

      return;
    }

    try {
      setError(null);

      setLoading(true);

      setApprovalTransactionHash(
        null
      );

      setFundTransactionHash(
        null
      );

      setSimulation(
        null
      );

      setStatus(
        "Checking U balance and allowance..."
      );

      const token =
        await loadPaymentToken();

      if (
        token.balance <
        budgetRaw
      ) {
        throw new Error(
          [
            `Insufficient ${token.symbol}.`,

            "",

            `Balance: ${formatUnits(
              token.balance,
              token.decimals
            )} ${token.symbol}`,

            `Required: ${formatUnits(
              budgetRaw,
              token.decimals
            )} ${token.symbol}`,
          ].join(
            "\n"
          )
        );
      }

      /*
       * APPROVAL
       */
      if (
        token.allowance <
        budgetRaw
      ) {
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
          `Waiting for wallet confirmation to approve ${formatUnits(
            budgetRaw,
            token.decimals
          )} ${token.symbol}...`
        );

        const approvalHash =
          await walletClient.writeContract(
            {
              address:
                token.tokenAddress,

              abi:
                ERC20_ABI,

              functionName:
                "approve",

              args: [
                ERC8183_ADDRESSES.commerce,

                budgetRaw,
              ],
            }
          );

        setApprovalTransactionHash(
          approvalHash
        );

        setStatus(
          "Approval submitted. Waiting for BSC..."
        );

        const approvalReceipt =
          await publicClient.waitForTransactionReceipt(
            {
              hash:
                approvalHash,
            }
          );

        if (
          approvalReceipt.status !==
          "success"
        ) {
          throw new Error(
            "U approval transaction failed."
          );
        }

        const newAllowance =
          (await publicClient.readContract(
            {
              address:
                token.tokenAddress,

              abi:
                ERC20_ABI,

              functionName:
                "allowance",

              args: [
                address,
                ERC8183_ADDRESSES.commerce,
              ],
            }
          )) as bigint;

        setAllowanceRaw(
          newAllowance
        );

        if (
          newAllowance <
          budgetRaw
        ) {
          throw new Error(
            [
              "Approval succeeded, but allowance is still insufficient.",

              "",

              `Allowance: ${formatUnits(
                newAllowance,
                token.decimals
              )} ${token.symbol}`,

              `Required: ${formatUnits(
                budgetRaw,
                token.decimals
              )} ${token.symbol}`,
            ].join(
              "\n"
            )
          );
        }
      }

      /*
       * SIMULATE
       */
      const simulationResult =
        await simulateFund();

      if (
        !simulationResult.ok
      ) {
        throw new Error(
          simulationResult.message
        );
      }

      /*
       * ACTUAL FUND
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
        `Simulation passed. Waiting for wallet confirmation to fund Job #${jobId.toString()}...`
      );

      const fundHash =
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

              budgetRaw,

              "0x",
            ],
          }
        );

      setFundTransactionHash(
        fundHash
      );

      setStatus(
        "Funding transaction submitted. Waiting for BSC..."
      );

      const fundReceipt =
        await publicClient.waitForTransactionReceipt(
          {
            hash:
              fundHash,
          }
        );

      if (
        fundReceipt.status !==
        "success"
      ) {
        throw new Error(
          "Fund transaction was mined but failed."
        );
      }

      setStatus(
        "Funding confirmed. Verifying Job state..."
      );

      const finalJob =
        (await publicClient.readContract(
          {
            address:
              ERC8183_ADDRESSES.commerce,

            abi:
              COMMERCE_ABI,

            functionName:
              "getJob",

            args: [
              jobId,
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

      const finalLoadedJob: LoadedJob =
        {
          id:
            finalJob.id,

          client:
            finalJob.client,

          provider:
            finalJob.provider,

          evaluator:
            finalJob.evaluator,

          description:
            finalJob.description,

          budget:
            finalJob.budget,

          expiredAt:
            finalJob.expiredAt,

          status:
            Number(
              finalJob.status
            ),

          hook:
            finalJob.hook,

          submittedAt:
            finalJob.submittedAt,

          deliverable:
            finalJob.deliverable,
        };

      setLoadedJob(
        finalLoadedJob
      );

      if (
        Number(
          finalJob.status
        ) !== 1
      ) {
        throw new Error(
          [
            "Funding succeeded, but the job did not enter FUNDED state.",

            "",

            `Current state: ${getStatusName(
              Number(
                finalJob.status
              )
            )}`,
          ].join(
            "\n"
          )
        );
      }

      setStatus(
        `🎉 Job #${jobId.toString()} is FUNDED`
      );
    } catch (err) {
      console.error(
        "fundJob failed:",
        err
      );

      setStatus(
        "Funding failed"
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
   * UI
   * =========================================================
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
          ERC-8183 Test
        </h1>

        <p
          style={
            styles.subtitle
          }
        >
          Testing the official BNB Agent Commerce
          layer on BSC Testnet.
        </p>

        {/* WALLET */}
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

        {/* LOAD EXISTING JOB */}
        {address && (
          <div
            style={
              styles.panel
            }
          >
            <h3>
              Continue Existing Job
            </h3>

            <p
              style={
                styles.subtitleSmall
              }
            >
              You can continue an existing job such
              as #500 without creating another one.
            </p>

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
              placeholder="Example: 500"
              type="number"
              min="0"
              style={
                styles.input
              }
            />

            <button
              onClick={() =>
                void loadExistingJob()
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

        {/* LOADED JOB */}
        {loadedJob && (
          <div
            style={
              styles.panel
            }
          >
            <h3>
              Job #{loadedJob.id.toString()}
            </h3>

            <div
              style={
                styles.infoGrid
              }
            >
              <Info
                label="Client"
                value={
                  loadedJob.client
                }
              />

              <Info
                label="Provider"
                value={
                  loadedJob.provider
                }
              />

              <Info
                label="Evaluator"
                value={
                  loadedJob.evaluator
                }
              />

              <Info
                label="Status"
                value={
                  getStatusName(
                    loadedJob.status
                  )
                }
              />

              <Info
                label="Budget"
                value={
                  tokenDecimals !==
                  null
                    ? `${formatUnits(
                        loadedJob.budget,
                        tokenDecimals
                      )} ${tokenSymbol}`
                    : loadedJob.budget.toString()
                }
              />

              <Info
                label="Expiry"
                value={
                  formatTimestamp(
                    loadedJob.expiredAt
                  )
                }
              />

              <Info
                label="Expiry state"
                value={
                  isJobExpired(
                    loadedJob.expiredAt
                  )
                    ? "EXPIRED"
                    : "NOT EXPIRED"
                }
              />
            </div>

            <div
              style={
                isJobExpired(
                  loadedJob.expiredAt
                )
                  ? styles.expiredBanner
                  : loadedJob.status === 1
                  ? styles.fundedBanner
                  : styles.statusBanner
              }
            >
              {isJobExpired(
                loadedJob.expiredAt
              )
                ? "⏰ This job has expired."
                : loadedJob.status === 1
                ? "🎉 FUNDED — escrow contains the job budget."
                : `Current state: ${getStatusName(
                    loadedJob.status
                  )}`}
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
                Description
              </div>

              <div
                style={
                  styles.description
                }
              >
                {
                  loadedJob.description
                }
              </div>
            </div>
          </div>
        )}

        {/* CREATE NEW JOB */}
        {address && (
          <div
            style={
              styles.panel
            }
          >
            <h3>
              Create New Test Job
            </h3>

            <p
              style={
                styles.subtitleSmall
              }
            >
              New test jobs use a 65-minute expiry.
            </p>

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
                  event.target.value
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
                : "Create New ERC-8183 Job"}
            </button>

            {transactionHash && (
              <div
                style={
                  styles.transactionBox
                }
              >
                <strong>
                  createJob transaction
                </strong>

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
                  View on BscScan ↗
                </a>
              </div>
            )}
          </div>
        )}

        {/* REGISTER */}
        {loadedJob &&
          address && (
            <div
              style={
                styles.panel
              }
            >
              <h3>
                Register Job
              </h3>

              {isJobExpired(
                loadedJob.expiredAt
              ) ? (
                <div
                  style={
                    styles.expiredBanner
                  }
                >
                  This job is expired. Create a
                  fresh test job.
                </div>
              ) : registeredPolicy ? (
                <div
                  style={
                    styles.verified
                  }
                >
                  <strong>
                    ✓ Job is registered
                  </strong>

                  <p>
                    Policy:
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
              ) : (
                <button
                  onClick={
                    registerJob
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
                    : `Register Job #${loadedJob.id.toString()}`}
                </button>
              )}

              {registerTransactionHash && (
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
              )}
            </div>
          )}

        {/* PAYMENT TOKEN */}
        {loadedJob &&
          registeredPolicy &&
          address && (
            <div
              style={
                styles.panel
              }
            >
              <h3>
                Payment Token
              </h3>

              <button
                onClick={async () => {
                  try {
                    setError(
                      null
                    );

                    setStatus(
                      "Reading U token..."
                    );

                    await loadPaymentToken();

                    setStatus(
                      "✅ Payment token loaded"
                    );
                  } catch (
                    err
                  ) {
                    setError(
                      formatError(
                        err
                      )
                    );
                  }
                }}
                disabled={
                  loading
                }
                style={
                  styles.secondaryButton
                }
              >
                Check Payment Token
              </button>

              {paymentToken && (
                <div
                  style={
                    styles.tokenInfo
                  }
                >
                  <Info
                    label="Symbol"
                    value={
                      tokenSymbol
                    }
                  />

                  <Info
                    label="Decimals"
                    value={
                      String(
                        tokenDecimals
                      )
                    }
                  />

                  <Info
                    label="Wallet balance"
                    value={`${tokenBalance} ${tokenSymbol}`}
                  />

                  <Info
                    label="Allowance"
                    value={
                      tokenDecimals !==
                        null &&
                      allowanceRaw !==
                        null
                        ? `${formatUnits(
                            allowanceRaw,
                            tokenDecimals
                          )} ${tokenSymbol}`
                        : "Unknown"
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
                      Payment token address
                    </div>

                    <code
                      style={
                        styles.code
                      }
                    >
                      {
                        paymentToken
                      }
                    </code>
                  </div>
                </div>
              )}
            </div>
          )}

        {/* BUDGET */}
        {loadedJob &&
          registeredPolicy &&
          address && (
            <div
              style={
                styles.panel
              }
            >
              <h3>
                Set Budget
              </h3>

              {isJobExpired(
                loadedJob.expiredAt
              ) ? (
                <div
                  style={
                    styles.expiredBanner
                  }
                >
                  This job has expired, so its budget
                  cannot be used for the funding test.
                </div>
              ) : budgetRaw !==
                null ? (
                <div
                  style={
                    styles.verified
                  }
                >
                  <strong>
                    ✓ Budget already set
                  </strong>

                  {tokenDecimals !==
                    null && (
                    <p>
                      Amount:{" "}
                      {formatUnits(
                        budgetRaw,
                        tokenDecimals
                      )}{" "}
                      {tokenSymbol}
                    </p>
                  )}
                </div>
              ) : (
                <>
                  <label
                    style={
                      styles.label
                    }
                  >
                    Budget amount
                  </label>

                  <input
                    value={
                      budget
                    }
                    onChange={(
                      event
                    ) =>
                      setBudget(
                        event.target.value
                      )
                    }
                    type="number"
                    min="0"
                    step="any"
                    disabled={
                      loading
                    }
                    style={
                      styles.input
                    }
                  />

                  <button
                    onClick={
                      setJobBudget
                    }
                    disabled={
                      loading ||
                      !paymentToken
                    }
                    style={
                      styles.primaryButton
                    }
                  >
                    {loading
                      ? "Working..."
                      : paymentToken
                      ? "Set Job Budget"
                      : "Check Payment Token First"}
                  </button>
                </>
              )}

              {budgetTransactionHash && (
                <a
                  href={`https://testnet.bscscan.com/tx/${budgetTransactionHash}`}
                  target="_blank"
                  rel="noreferrer"
                  style={
                    styles.link
                  }
                >
                  View setBudget transaction ↗
                </a>
              )}
            </div>
          )}

        {/* FUND */}
        {loadedJob &&
          registeredPolicy &&
          budgetRaw !==
            null &&
          address && (
            <div
              style={
                styles.panel
              }
            >
              <h3>
                Fund Job
              </h3>

              {isJobExpired(
                loadedJob.expiredAt
              ) ? (
                <div
                  style={
                    styles.expiredBanner
                  }
                >
                  This job has expired. Create a fresh
                  test job before funding.
                </div>
              ) : loadedJob.status ===
                1 ? (
                <div
                  style={
                    styles.fundedBanner
                  }
                >
                  <strong>
                    ✓ Job is already FUNDED
                  </strong>
                </div>
              ) : (
                <>
                  <div
                    style={
                      styles.stepBox
                    }
                  >
                    <strong>
                      Funding test
                    </strong>

                    <p>
                      1. Check U balance
                    </p>

                    <p>
                      2. Check U allowance
                    </p>

                    <p>
                      3. Approve U if needed
                    </p>

                    <p>
                      4. Simulate fund()
                    </p>

                    <p>
                      5. Send the transaction only
                      if simulation passes
                    </p>
                  </div>

                  <button
                    onClick={() =>
                      void simulateFund()
                    }
                    disabled={
                      loading ||
                      isSimulating
                    }
                    style={
                      styles.secondaryButton
                    }
                  >
                    {isSimulating
                      ? "Simulating..."
                      : "Simulate Fund Transaction"}
                  </button>

                  {simulation && (
                    <div
                      style={
                        simulation.ok
                          ? styles.simulationGood
                          : styles.simulationBad
                      }
                    >
                      <strong>
                        {simulation.ok
                          ? "✅ Simulation Passed"
                          : "❌ Simulation Failed"}
                      </strong>

                      <pre
                        style={
                          styles.simulationText
                        }
                      >
                        {
                          simulation.message
                        }
                      </pre>
                    </div>
                  )}

                  <button
                    onClick={
                      fundJob
                    }
                    disabled={
                      loading ||
                      isSimulating
                    }
                    style={
                      styles.primaryButton
                    }
                  >
                    {loading
                      ? "Working..."
                      : `Approve + Fund Job #${loadedJob.id.toString()}`}
                  </button>
                </>
              )}

              {approvalTransactionHash && (
                <div
                  style={
                    styles.transactionBox
                  }
                >
                  <strong>
                    Approval transaction
                  </strong>

                  <code
                    style={
                      styles.code
                    }
                  >
                    {
                      approvalTransactionHash
                    }
                  </code>

                  <a
                    href={`https://testnet.bscscan.com/tx/${approvalTransactionHash}`}
                    target="_blank"
                    rel="noreferrer"
                    style={
                      styles.link
                    }
                  >
                    View approval on BscScan ↗
                  </a>
                </div>
              )}

              {fundTransactionHash && (
                <div
                  style={
                    styles.transactionBox
                  }
                >
                  <strong>
                    Funding transaction
                  </strong>

                  <code
                    style={
                      styles.code
                    }
                  >
                    {
                      fundTransactionHash
                    }
                  </code>

                  <a
                    href={`https://testnet.bscscan.com/tx/${fundTransactionHash}`}
                    target="_blank"
                    rel="noreferrer"
                    style={
                      styles.link
                    }
                  >
                    View funding on BscScan ↗
                  </a>
                </div>
              )}
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
 * =========================================================
 * INFO COMPONENT
 * =========================================================
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
        styles.infoItem
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
 * =========================================================
 * JOB STATUS
 * =========================================================
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
 * =========================================================
 * EXPIRY HELPERS
 * =========================================================
 */

function isJobExpired(
  expiredAt: bigint
): boolean {
  return (
    expiredAt <=
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
 * =========================================================
 * ERROR EXTRACTION
 * =========================================================
 */

function extractRevertReason(
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
      const nested =
        extractRevertReason(
          extended.cause
        );

      if (
        nested !==
        "No detailed revert reason was returned."
      ) {
        return nested;
      }
    }

    return extended.message;
  }

  if (
    typeof error ===
    "string"
  ) {
    return error;
  }

  if (
    error &&
    typeof error ===
      "object"
  ) {
    const objectError =
      error as Record<
        string,
        unknown
      >;

    const candidates = [
      objectError.shortMessage,
      objectError.details,
      objectError.reason,
      objectError.message,
    ];

    for (
      const candidate of candidates
    ) {
      if (
        typeof candidate ===
        "string"
      ) {
        return candidate;
      }
    }

    if (
      objectError.cause
    ) {
      return extractRevertReason(
        objectError.cause
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

  return "No detailed revert reason was returned.";
}

function formatError(
  error: unknown
): string {
  return extractRevertReason(
    error
  );
}

/*
 * =========================================================
 * CHAIN
 * =========================================================
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

/*
 * =========================================================
 * STYLES
 * =========================================================
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
      "110px",

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

  infoGrid: {
    display:
      "grid",

    gap:
      "12px",
  },

  infoItem: {
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

    color:
      "#e8e6e1",
  },

  addressBlock: {
    marginTop:
      "14px",
  },

  description: {
    padding:
      "12px",

    borderRadius:
      "8px",

    background:
      "#0d1011",

    color:
      "#ddd",

    lineHeight:
      "1.6",
  },

  tokenInfo: {
    marginTop:
      "14px",

    padding:
      "14px",

    borderRadius:
      "10px",

    background:
      "#0d1011",

    border:
      "1px solid #282c2e",
  },

  statusBanner: {
    marginTop:
      "14px",

    padding:
      "12px",

    borderRadius:
      "9px",

    background:
      "rgba(240,185,11,.08)",

    border:
      "1px solid rgba(240,185,11,.2)",

    color:
      "#e2c96c",

    fontSize:
      "13px",
  },

  fundedBanner: {
    marginTop:
      "14px",

    padding:
      "14px",

    borderRadius:
      "9px",

    background:
      "rgba(50,200,120,.10)",

    border:
      "1px solid rgba(50,200,120,.3)",

    color:
      "#7ee2a8",

    fontSize:
      "13px",

    lineHeight:
      "1.5",
  },

  expiredBanner: {
    marginTop:
      "14px",

    padding:
      "14px",

    borderRadius:
      "9px",

    background:
      "rgba(255,90,90,.08)",

    border:
      "1px solid rgba(255,90,90,.28)",

    color:
      "#ffaaaa",

    fontSize:
      "13px",

    lineHeight:
      "1.5",
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

    fontSize:
      "13px",

    lineHeight:
      "1.5",
  },

  simulationGood: {
    marginTop:
      "14px",

    padding:
      "14px",

    borderRadius:
      "10px",

    background:
      "rgba(50,200,120,.08)",

    border:
      "1px solid rgba(50,200,120,.3)",

    color:
      "#7ee2a8",
  },

  simulationBad: {
    marginTop:
      "14px",

    padding:
      "14px",

    borderRadius:
      "10px",

    background:
      "rgba(255,90,90,.08)",

    border:
      "1px solid rgba(255,90,90,.3)",

    color:
      "#ffaaaa",
  },

  simulationText: {
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

    marginBottom:
      "0",
  },

  transactionBox: {
    marginTop:
      "14px",

    padding:
      "13px",

    borderRadius:
      "9px",

    background:
      "#0d1011",

    border:
      "1px solid #282c2e",

    fontSize:
      "12px",
  },

  verified: {
    marginTop:
      "14px",

    padding:
      "14px",

    borderRadius:
      "10px",

    background:
      "rgba(126,226,168,.08)",

    border:
      "1px solid rgba(126,226,168,.25)",

    color:
      "#7ee2a8",

    lineHeight:
      "1.7",
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
