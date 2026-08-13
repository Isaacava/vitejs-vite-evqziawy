import { useState } from "react";
import {
  formatUnits,
  parseUnits,
  type Address,
  type EIP1193Provider,
} from "viem";

import {
  ERC8183_ADDRESSES,
  COMMERCE_ABI,
  publicClient,
  getWalletClient,
} from "./lib/erc8183";

type Props = {
  provider: EIP1193Provider | null;
  address: string | null;
};

export default function Erc8183Test({
  provider,
  address,
}: Props) {
  const [description, setDescription] =
    useState(
      "Analyze recent BNB wallet activity and return a short risk summary."
    );

  const [loading, setLoading] =
    useState(false);

  const [jobId, setJobId] =
    useState<bigint | null>(null);

  const [error, setError] =
    useState<string | null>(null);

  const [tokenSymbol, setTokenSymbol] =
    useState("...");

  const [tokenDecimals, setTokenDecimals] =
    useState<number | null>(null);

  const [tokenBalance, setTokenBalance] =
    useState<string>("...");

  const [transactionHash, setTransactionHash] =
    useState<string | null>(null);

  async function loadPaymentToken() {
    if (!address) {
      throw new Error(
        "Wallet address is missing."
      );
    }

    const tokenAddress =
      await publicClient.readContract({
        address:
          ERC8183_ADDRESSES.commerce,
        abi: COMMERCE_ABI,
        functionName:
          "paymentToken",
      });

    const decimals =
      await publicClient.readContract({
        address:
          tokenAddress,
        abi: [
          {
            type: "function",
            name: "decimals",
            stateMutability: "view",
            inputs: [],
            outputs: [
              {
                type: "uint8",
              },
            ],
          },
        ],
        functionName:
          "decimals",
      });

    const symbol =
      await publicClient.readContract({
        address:
          tokenAddress,
        abi: [
          {
            type: "function",
            name: "symbol",
            stateMutability: "view",
            inputs: [],
            outputs: [
              {
                type: "string",
              },
            ],
          },
        ],
        functionName:
          "symbol",
      });

    const balance =
      await publicClient.readContract({
        address:
          tokenAddress,
        abi: [
          {
            type: "function",
            name: "balanceOf",
            stateMutability: "view",
            inputs: [
              {
                name: "account",
                type: "address",
              },
            ],
            outputs: [
              {
                type: "uint256",
              },
            ],
          },
        ],
        functionName:
          "balanceOf",
        args: [
          address as Address,
        ],
      });

    setTokenDecimals(
      Number(decimals)
    );

    setTokenSymbol(symbol);

    setTokenBalance(
      formatUnits(
        balance,
        decimals
      )
    );
  }

  async function createJob() {
    if (!provider) {
      setError(
        "Please connect your wallet first."
      );
      return;
    }

    if (!address) {
      setError(
        "Wallet address is missing."
      );
      return;
    }

    setLoading(true);
    setError(null);
    setJobId(null);
    setTransactionHash(null);

    try {
      let decimals =
        tokenDecimals;

      if (
        decimals === null
      ) {
        await loadPaymentToken();

        /*
         * Reload it from the contract because
         * state updates happen asynchronously.
         */
        const tokenAddress =
          await publicClient.readContract({
            address:
              ERC8183_ADDRESSES.commerce,
            abi: COMMERCE_ABI,
            functionName:
              "paymentToken",
          });

        const rawDecimals =
          await publicClient.readContract({
            address:
              tokenAddress,
            abi: [
              {
                type: "function",
                name: "decimals",
                stateMutability:
                  "view",
                inputs: [],
                outputs: [
                  {
                    type: "uint8",
                  },
                ],
              },
            ],
            functionName:
              "decimals",
          });

        decimals =
          Number(rawDecimals);
      }

      /*
       * TEST PROVIDER
       *
       * We are not connecting to a real
       * agent yet.
       *
       * For this first blockchain test,
       * we'll use the connected wallet as
       * the provider.
       *
       * Later this becomes the selected
       * marketplace agent's address.
       */
      const providerAddress =
        address as Address;

      /*
       * The EvaluatorRouter is both the
       * evaluator and hook in the official
       * BNB architecture.
       */
      const evaluator =
        ERC8183_ADDRESSES.router;

      const hook =
        ERC8183_ADDRESSES.router;

      /*
       * Give the test job 60 minutes.
       */
      const expiredAt =
        BigInt(
          Math.floor(
            Date.now() / 1000
          ) +
            60 * 60
        );

      const walletClient =
        getWalletClient(
          provider,
          address as Address
        );

      /*
       * CREATE JOB
       */
      const hash =
        await walletClient.writeContract(
          {
            address:
              ERC8183_ADDRESSES.commerce,

            abi: COMMERCE_ABI,

            functionName:
              "createJob",

            args: [
              providerAddress,
              evaluator,
              expiredAt,
              description,
              hook,
            ],
          }
        );

      setTransactionHash(
        hash
      );

      /*
       * Wait until the transaction is
       * actually included in a block.
       */
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

      /*
       * Find the newest job ID.
       *
       * For this first test we're reading
       * job IDs around the created transaction.
       *
       * The next step will make this more
       * precise using the emitted event.
       */
      const latestJob =
        await publicClient.readContract({
          address:
            ERC8183_ADDRESSES.commerce,
          abi: [
            {
              type: "function",
              name: "jobCounter",
              stateMutability:
                "view",
              inputs: [],
              outputs: [
                {
                  type: "uint256",
                },
              ],
            },
          ],
          functionName:
            "jobCounter",
        });

      setJobId(
        latestJob
      );
    } catch (err) {
      console.error(
        "createJob failed:",
        err
      );

      setError(
        err instanceof Error
          ? err.message
          : String(err)
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      style={{
        maxWidth: 600,
        margin: "0 auto",
        padding: 24,
      }}
    >
      <h1>
        ERC-8183 Test
      </h1>

      <p>
        This is our first test of the
        official BNB Agent commerce system.
      </p>

      <div
        style={{
          border:
            "1px solid #ddd",
          padding: 20,
          borderRadius: 12,
          marginTop: 20,
        }}
      >
        <h3>
          Payment Token
        </h3>

        <p>
          Token:{" "}
          <strong>
            {tokenSymbol}
          </strong>
        </p>

        <p>
          Balance:{" "}
          <strong>
            {tokenBalance}
          </strong>
        </p>

        <button
          onClick={loadPaymentToken}
          disabled={
            !address ||
            loading
          }
        >
          Check Token
        </button>
      </div>

      <div
        style={{
          border:
            "1px solid #ddd",
          padding: 20,
          borderRadius: 12,
          marginTop: 20,
        }}
      >
        <h3>
          Create Test Job
        </h3>

        <label>
          Task description
        </label>

        <textarea
          value={description}
          onChange={(event) =>
            setDescription(
              event.target.value
            )
          }
          rows={5}
          style={{
            width: "100%",
            marginTop: 8,
            marginBottom: 16,
          }}
        />

        <p>
          Provider:
        </p>

        <code>
          {address ||
            "Connect wallet first"}
        </code>

        <p>
          Evaluator:
        </p>

        <code>
          {ERC8183_ADDRESSES.router}
        </code>

        <button
          onClick={createJob}
          disabled={
            !provider ||
            !address ||
            loading
          }
          style={{
            display: "block",
            marginTop: 20,
          }}
        >
          {loading
            ? "Creating Job..."
            : "Create ERC-8183 Job"}
        </button>
      </div>

      {transactionHash && (
        <div
          style={{
            marginTop: 20,
            padding: 16,
            background: "#eef7ee",
            borderRadius: 10,
          }}
        >
          <strong>
            Job transaction sent
          </strong>

          <p
            style={{
              wordBreak:
                "break-all",
            }}
          >
            {transactionHash}
          </p>

          <a
            href={`https://testnet.bscscan.com/tx/${transactionHash}`}
            target="_blank"
            rel="noreferrer"
          >
            View on BscScan
          </a>
        </div>
      )}

      {jobId !== null && (
        <div
          style={{
            marginTop: 20,
            padding: 16,
            background: "#eef7ee",
            borderRadius: 10,
          }}
        >
          <strong>
            Job created
          </strong>

          <p>
            Job ID:{" "}
            <strong>
              {jobId.toString()}
            </strong>
          </p>
        </div>
      )}

      {error && (
        <div
          style={{
            marginTop: 20,
            padding: 16,
            background: "#fff0f0",
            borderRadius: 10,
            color: "#b00020",
            whiteSpace:
              "pre-wrap",
          }}
        >
          {error}
        </div>
      )}
    </div>
  );
        }
