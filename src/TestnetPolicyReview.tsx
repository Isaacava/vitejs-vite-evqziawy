import { useEffect, useMemo, useState } from "react";
import { type Address, type EIP1193Provider } from "viem";
import { EthereumProvider } from "@walletconnect/ethereum-provider";
import {
  ERC8183_ADDRESSES,
} from "./lib/erc8183";
import {
  bscExplorerUrl,
  claimRefundJob,
  disputeJob,
  readChainJob,
  readPolicyConfig,
  readPolicyVerdict,
  settleJob,
} from "./lib/erc8183Adapter";
import "./mission-console.css";

const WALLETCONNECT_PROJECT_ID = "1dbe8fd5e4974ae7c80d074c4082b5a0";

type ReviewState = {
  id: bigint;
  client: Address;
  provider: Address;
  expiredAt: bigint;
  submittedAt: bigint;
  status: number;
  deliverable: `0x${string}`;
};

const STATUS: Record<number, string> = {
  0: "OPEN",
  1: "FUNDED",
  2: "SUBMITTED",
  3: "COMPLETED",
  4: "REJECTED",
  5: "EXPIRED",
};

// Keep the remainder of the existing component implementation intact.
