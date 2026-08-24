import { useCallback, useEffect, useMemo, useState } from "react";
import type { EIP1193Provider, Hex } from "viem";
import {
  bscExplorerUrl,
  claimRefundJob,
  disputeJob,
  readPolicyConfig,
  readPolicyVerdict,
  settleJob,
} from "./lib/erc8183Adapter";

// ...

