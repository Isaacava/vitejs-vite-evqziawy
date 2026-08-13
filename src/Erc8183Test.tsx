import { useState } from "react";
import {
  createWalletClient,
  custom,
  type Address,
  type EIP1193Provider,
} from "viem";
import { EthereumProvider } from "@walletconnect/ethereum-provider";

import {
  ERC8183_ADDRESSES,
  COMMERCE_ABI,
  publicClient,
} from "./lib/erc8183";

const PROJECT_ID =
  "1dbe8fd5e4974ae7c80d074c4082b5a0";

const TESTNET_CHAIN_ID = 97;

export default function Erc8183Test() {
  const [address, setAddress] =
    useState<Address | null>(null);

  const [provider, setProvider] =
    useState<EIP1193Provider | null>(null);

  const [status, setStatus] =
    useState("Not connected");

  const [jobId, setJobId] =
    useState<string | null>(null);

  const [error, setError] =
    useState<string | null>(null);

  async function connect() {
    try {
      setError(null);
      setStatus("Connecting...");

      const wc =
        await EthereumProvider.init({
          projectId: PROJECT_ID,
          optionalChains: [
            TESTNET_CHAIN_ID,
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
        });

      await wc.connect();

      const accounts =
        wc.accounts as string[];

      if (!accounts.length) {
        throw new Error(
          "No wallet account returned."
        );
      }

      const walletProvider =
        wc as unknown as EIP1193Provider;

      const chain =
        await walletProvider.request({
          method: "eth_chainId",
        });

      const chainId =
        typeof chain === "string" &&
        chain.startsWith("0x")
          ? parseInt(chain, 16)
          : Number(chain);

      if (
        chainId !==
        TESTNET_CHAIN_ID
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

      setStatus(
        "Connected to BSC Testnet"
      );
    } catch (err) {
      console.error(err);

      setStatus(
        "Connection failed"
      );

      setError(
        err instanceof Error
          ? err.message
          : String(err)
      );
    }
  }

  async function createJob() {
    if (!provider || !address) {
      setError(
        "Connect wallet first."
      );
      return;
    }

    try {
      setError(null);
      setStatus(
        "Preparing transaction..."
      );

      const walletClient =
        createWalletClient({
          account: address,
          chain: {
            ...getBscTestnetChain(),
          },
          transport:
            custom(provider),
        });

      const expiry =
        BigInt(
          Math.floor(
            Date.now() / 1000
          ) + 3600
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
              "Test ERC-8183 job from our BSC marketplace.",
              ERC8183_ADDRESSES.router,
            ],
          }
        );

      setStatus(
        "Transaction submitted. Waiting for BSC..."
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
          "Transaction failed on BSC."
        );
      }

      const latest =
        await publicClient.readContract({
          address:
            ERC8183_ADDRESSES.commerce,

          abi:
            COMMERCE_ABI,

          functionName:
            "jobCounter",
        });

      setJobId(
        latest.toString()
      );

      setStatus(
        "✅ ERC-8183 job created successfully"
      );
    } catch (err) {
      console.error(err);

      setError(
        err instanceof Error
          ? err.message
          : String(err)
      );

      setStatus(
        "Job creation failed"
      );
    }
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        padding: 24,
        background:
          "#0b0d0e",
        color: "white",
        fontFamily:
          "system-ui, sans-serif",
      }}
    >
      <div
        style={{
          maxWidth: 600,
          margin: "0 auto",
        }}
      >
        <h1>
          ERC-8183 Test
        </h1>

        <p>
          Testing the official BNB Agent
          commerce layer on BSC Testnet.
        </p>

        <button
          onClick={connect}
          style={
            styles.button
          }
        >
          {address
            ? "Wallet Connected"
            : "Connect Wallet"}
        </button>

        {address && (
          <div
            style={
              styles.panel
            }
          >
            <strong>
              Wallet
            </strong>

            <p
              style={{
                wordBreak:
                  "break-all",
              }}
            >
              {address}
            </p>

            <p>
              Status:{" "}
              {status}
            </p>

            <button
              onClick={
                createJob
              }
              style={
                styles.button
              }
            >
              Create Test Job
            </button>
          </div>
        )}

        {jobId && (
          <div
            style={
              styles.success
            }
          >
            <strong>
              Job created successfully
            </strong>

            <p>
              Job ID: {jobId}
            </p>
          </div>
        )}

        {error && (
          <div
            style={
              styles.error
            }
          >
            {error}
          </div>
        )}
      </div>
    </div>
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

const styles: Record<
  string,
  React.CSSProperties
> = {
  button: {
    marginTop: 16,
    padding:
      "13px 18px",
    border: "none",
    borderRadius: 10,
    background:
      "#f0b90b",
    color: "#111",
    fontWeight: 800,
    cursor: "pointer",
  },

  panel: {
    marginTop: 20,
    padding: 18,
    borderRadius: 12,
    background:
      "#151819",
    border:
      "1px solid #2c3032",
  },

  success: {
    marginTop: 20,
    padding: 18,
    borderRadius: 12,
    background:
      "rgba(50,200,120,.12)",
    border:
      "1px solid rgba(50,200,120,.3)",
  },

  error: {
    marginTop: 20,
    padding: 18,
    borderRadius: 12,
    background:
      "#291616",
    color:
      "#ffaaaa",
  },
};
