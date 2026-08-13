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

  const [jobIdInput, setJobIdInput] =
    useState("");

  const [loadedJob, setLoadedJob] =
    useState<LoadedJob | null>(
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

  const [
    registerTransactionHash,
    setRegisterTransactionHash,
  ] =
    useState<`0x${string}` | null>(
      null
    );

  const [
    budgetTransactionHash,
    setBudgetTransactionHash,
  ] =
    useState<`0x${string}` | null>(
      null
    );

  const [
    approvalTransactionHash,
    setApprovalTransactionHash,
  ] =
    useState<`0x${string}` | null>(
      null
    );

  const [
    fundTransactionHash,
    setFundTransactionHash,
  ] =
    useState<`0x${string}` | null>(
      null
    );

  const [
    registeredPolicy,
    setRegisteredPolicy,
  ] =
    useState<Address | null>(
      null
    );

  const [paymentToken, setPaymentToken] =
    useState<Address | null>(
      null
    );

  const [tokenSymbol, setTokenSymbol] =
    useState("—");

  const [tokenDecimals, setTokenDecimals] =
    useState<number | null>(
      null
    );

  const [tokenBalance, setTokenBalance] =
    useState("—");

  const [budget, setBudget] =
    useState("1");

  const [budgetRaw, setBudgetRaw] =
    useState<bigint | null>(
      null
    );

  const [allowanceRaw, setAllowanceRaw] =
    useState<bigint | null>(
      null
    );

  const [loading, setLoading] =
    useState(false);

  const [error, setError] =
    useState<string | null>(
      null
    );

  /*
   * ========================================================
   * RESTORE LAST JOB
   * ========================================================
   */

  useEffect(() => {
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
  }, []);

  /*
   * ========================================================
   * SAVE JOB ID
   * ========================================================
   */

  function saveJobId(
    id: bigint
  ) {
    setJobId(id);

    setJobIdInput(
      id.toString()
    );

    window.localStorage.setItem(
      SAVED_JOB_KEY,
      id.toString()
    );
  }

  /*
   * ========================================================
   * CONNECT WALLET
   * ========================================================
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
   * ========================================================
   * LOAD EXISTING JOB
   * ========================================================
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

      if (
        job.budget >
        0n
      ) {
        setBudgetRaw(
          job.budget
        );
      } else {
        setBudgetRaw(
          null
        );
      }

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
   * ========================================================
   * AUTO LOAD SAVED JOB
   * ========================================================
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
   * ========================================================
   * LOAD PAYMENT TOKEN
   * ========================================================
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
      (
        jobId !== null &&
        tokenAddress
          ? await publicClient.readContract(
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
            )
          : 0n
      ) as bigint;

    setPaymentToken(
      tokenAddress
    );

    setTokenDecimals(
      Number(
        decimals
      )
    );

    setTokenSymbol(
      symbol
    );

    setTokenBalance(
      formatUnits(
        balance,
        Number(
          decimals
        )
      )
    );

    setAllowanceRaw(
      allowance
    );

    return {
      tokenAddress,
      decimals:
        Number(
          decimals
        ),
      symbol,
      balance,
      allowance,
    };
  }

  /*
   * ========================================================
   * CREATE JOB
   * ========================================================
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
        `✅ Job #${latestJobId.toString()} created`
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
   * ========================================================
   * REGISTER JOB
   * ========================================================
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

    try {
      setError(null);
      setLoading(true);

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
          "Policy verification failed."
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
   * ========================================================
   * SET BUDGET
   * ========================================================
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
      registeredPolicy ===
      null
    ) {
      setError(
        "Register the job first."
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
            `Your balance: ${formatUnits(
              token.balance,
              token.decimals
            )} ${token.symbol}`,
            `Required: ${trimmed} ${token.symbol}`,
          ].join("\n")
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
   * ========================================================
   * FUND JOB
   * ========================================================
   *
   * This performs:
   *
   * 1. Read U allowance
   * 2. Approve U if necessary
   * 3. Call Commerce.fund()
   * 4. Verify the job becomes FUNDED
   *
   * This mirrors the official BNB Agent SDK's
   * documented approve + fund flow.
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

    try {
      setError(null);
      setLoading(true);

      setApprovalTransactionHash(
        null
      );

      setFundTransactionHash(
        null
      );

      /*
       * Read payment token and
       * current allowance.
       */
      setStatus(
        "Checking U balance and allowance..."
      );

      const token =
        await loadPaymentToken();

      /*
       * Make absolutely sure the user's
       * current balance covers the budget.
       */
      if (
        token.balance <
        budgetRaw
      ) {
        throw new Error(
          [
            `Insufficient ${token.symbol}.`,
            "",
            `Wallet balance: ${formatUnits(
              token.balance,
              token.decimals
            )} ${token.symbol}`,
            `Job budget: ${formatUnits(
              budgetRaw,
              token.decimals
            )} ${token.symbol}`,
          ].join("\n")
        );
      }

      /*
       * ----------------------------------------------------
       * STEP 1: APPROVAL
       * ----------------------------------------------------
       */

      if (
        token.allowance <
        budgetRaw
      ) {
        setStatus(
          `Waiting for wallet confirmation to approve ${formatUnits(
            budgetRaw,
            token.decimals
          )} ${token.symbol}...`
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
         * We approve exactly the amount needed
         * for this test job.
         *
         * This keeps the test simple and
         * conservative.
         */
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

        /*
         * Verify allowance after approval.
         */
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
              "Approval transaction succeeded, but the allowance is still too low.",
              "",
              `Required: ${budgetRaw.toString()}`,
              `Actual: ${newAllowance.toString()}`,
            ].join("\n")
          );
        }
      } else {
        /*
         * No approval needed.
         */
        setAllowanceRaw(
          token.allowance
        );

        setStatus(
          "Existing U allowance is sufficient."
        );
      }

      /*
       * ----------------------------------------------------
       * STEP 2: FUND
       * ----------------------------------------------------
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
        `Waiting for wallet confirmation to fund Job #${jobId.toString()} with ${formatUnits(
          budgetRaw,
          token.decimals
        )} ${token.symbol}...`
      );

      /*
       * Official Commerce ABI:
       *
       * fund(jobId, expectedBudget, optParams)
       */
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
          "Fund transaction failed."
        );
      }

      /*
       * ----------------------------------------------------
       * STEP 3: VERIFY ON-CHAIN
       * ----------------------------------------------------
       */

      setStatus(
        "Funding confirmed. Verifying job state..."
      );

      await loadExistingJob(
        jobId.toString()
      );

      /*
       * The official ERC-8183 lifecycle uses:
       *
       * OPEN
       * FUNDED
       * SUBMITTED
       * COMPLETED
       * REJECTED
       * EXPIRED
       *
       * We expect FUNDED here.
       */
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

      if (
        Number(
          finalJob.status
        ) !== 1
      ) {
        throw new Error(
          [
            "Funding transaction succeeded, but the job is not in FUNDED state.",
            "",
            `Current status: ${getStatusName(
              Number(
                finalJob.status
              )
            )}`,
          ].join("\n")
        );
      }

      setLoadedJob(
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
        }
      );

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

        {/* ================================================== */}
        {/* WALLET */}
        {/* ================================================== */}

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

        {/* ================================================== */}
        {/* LOAD JOB */}
        {/* ================================================== */}

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
              Job IDs are stored on-chain, so you
              can continue after a page reload.
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

        {/* ================================================== */}
        {/* LOADED JOB */}
        {/* ================================================== */}

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
            </div>

            <div
              style={
                loadedJob.status ===
                1
                  ? styles.fundedBanner
                  : styles.statusBanner
              }
            >
              {loadedJob.status ===
              1
                ? "🎉 FUNDED — the escrow now contains the job budget."
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

        {/* ================================================== */}
        {/* CREATE JOB */}
        {/* ================================================== */}

        {address && (
          <div
            style={
              styles.panel
            }
          >
            <h3>
              Create New Test Job
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
                : "Create ERC-8183 Job"}
            </button>

            {transactionHash && (
              <div
                style={
                  styles.success
                }
              >
                <strong>
                  ✓ createJob confirmed
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
                  View createJob transaction ↗
                </a>
              </div>
            )}
          </div>
        )}

        {/* ================================================== */}
        {/* REGISTER */}
        {/* ================================================== */}

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

              {registeredPolicy ? (
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

        {/* ================================================== */}
        {/* PAYMENT TOKEN */}
        {/* ================================================== */}

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

              <p
                style={
                  styles.subtitleSmall
                }
              >
                The official Commerce contract determines
                which settlement token is used.
              </p>

              <button
                onClick={
                  async () => {
                    try {
                      setError(
                        null
                      );

                      setStatus(
                        "Reading U token..."
                      );

                      await loadPaymentToken();

                      setStatus(
                        "✅ U token information loaded"
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
                  }
                }
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
                    label="Current allowance"
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
                      {paymentToken}
                    </code>
                  </div>
                </div>
              )}
            </div>
          )}

        {/* ================================================== */}
        {/* SET BUDGET */}
        {/* ================================================== */}

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

              {budgetRaw !==
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

                  <p
                    style={
                      styles.tokenHint
                    }
                  >
                    Token:{" "}
                    <strong>
                      {tokenSymbol}
                    </strong>
                  </p>

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

        {/* ================================================== */}
        {/* FUND JOB */}
        {/* ================================================== */}

        {loadedJob &&
          registeredPolicy &&
          budgetRaw !== null &&
          address && (
            <div
              style={
                styles.panel
              }
            >
              <h3>
                Fund Job
              </h3>

              <p
                style={
                  styles.subtitleSmall
                }
              >
                This transfers the budget into the
                ERC-8183 escrow.
              </p>

              {loadedJob.status ===
              1 ? (
                <div
                  style={
                    styles.fundedBanner
                  }
                >
                  <strong>
                    ✓ Job is already FUNDED
                  </strong>

                  <p>
                    The escrow has accepted the
                    job budget.
                  </p>
                </div>
              ) : (
                <>
                  <div
                    style={
                      styles.stepBox
                    }
                  >
                    <strong>
                      What will happen
                    </strong>

                    <p>
                      1. Check U allowance
                    </p>

                    <p>
                      2. Approve U if needed
                    </p>

                    <p>
                      3. Fund Job #{loadedJob.id.toString()}
                    </p>

                    <p>
                      4. Verify FUNDED on-chain
                    </p>
                  </div>

                  <button
                    onClick={
                      fundJob
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
                      : `Fund Job #${loadedJob.id.toString()} with ${tokenSymbol}`}
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

        {/* ================================================== */}
        {/* ERROR */}
        {/* ================================================== */}

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
 * ============================================================
 * JOB STATUS
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
 * BSC TESTNET
 * ============================================================
 */

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
 * ============================================================
 * CHAIN ID
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
      "650px",

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

  tokenHint: {
    color:
      "#888",

    fontSize:
      "12px",
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
      "1.45",
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

  success: {
    marginTop:
      "18px",

    padding:
      "16px",

    borderRadius:
      "10px",

    background:
      "rgba(50,200,120,.1)",

    border:
      "1px solid rgba(50,200,120,.3)",
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
