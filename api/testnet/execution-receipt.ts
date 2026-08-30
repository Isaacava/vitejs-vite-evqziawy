import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createPublicClient, http } from "viem";
import { bscTestnet } from "viem/chains";
import { getAuthenticatedUser } from "../../src/server/authHandlers.js";
import { serverClient } from "../../src/server/authHandlers.js";

const publicClient = createPublicClient({
  chain: bscTestnet,
  transport: http(process.env.BSC_TESTNET_RPC_URL || "https://bsc-testnet-rpc.publicnode.com"),
});

function validHash(value: string): value is `0x${string}` {
  return /^0x[a-fA-F0-9]{64}$/.test(value);
}

function object(value: unknown) {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

async function fetchReceipt(txHash: `0x${string}`) {
  try {
    const receipt = await publicClient.getTransactionReceipt({ hash: txHash });
    return {
      observed: true,
      transaction_hash: receipt.transactionHash,
      block_number: receipt.blockNumber.toString(),
      block_hash: receipt.blockHash,
      status: receipt.status,
      gas_used: receipt.gasUsed.toString(),
      effective_gas_price: receipt.effectiveGasPrice.toString(),
      contract_address: receipt.contractAddress,
      from: receipt.from,
      to: receipt.to,
    };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message.toLowerCase() : "";
    if (
      cause instanceof Error &&
      (
        cause.name === "TransactionReceiptNotFoundError" ||
        message.includes("transaction receipt") ||
        message.includes("receipt not found") ||
        message.includes("could not find transaction")
      )
    ) {
      return {
        observed: false,
        transaction_hash: txHash,
      };
    }
    throw new Error("Unable to independently read the BSC Testnet transaction receipt");
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const auth = await getAuthenticatedUser(req);
  if (!auth) return res.status(401).json({ error: "Authentication required" });

  const txHash = typeof req.query.tx_hash === "string"
    ? req.query.tx_hash.trim()
    : typeof req.body?.tx_hash === "string"
      ? req.body.tx_hash.trim()
      : "";

  if (!validHash(txHash)) {
    return res.status(400).json({ error: "tx_hash must be a 32-byte transaction hash" });
  }

  try {
    const receipt = await fetchReceipt(txHash);
    const normalized = {
      chain_id: 97,
      ...receipt,
    };

    if (req.method === "GET") {
      return res.status(200).json({
        ok: true,
        network: "bsc-testnet",
        chain_id: 97,
        transaction_hash: txHash,
        observed: normalized.observed,
        receipt: normalized,
      });
    }

    if (!normalized.observed) {
      return res.status(409).json({
        ok: false,
        confirmed: false,
        error: "Transaction receipt is not yet observed on BSC Testnet",
        network: "bsc-testnet",
        chain_id: 97,
        transaction_hash: txHash,
        receipt: normalized,
      });
    }

    const requestId = typeof req.body?.request_id === "string" ? req.body.request_id.trim() : "";
    if (!requestId) return res.status(400).json({ error: "request_id is required when confirming a receipt" });

    const supabase = serverClient();
    const { data: request, error: requestError } = await supabase
      .from("execution_capital_requests")
      .select("id,job_id,requester_wallet,status,evidence")
      .eq("id", requestId)
      .maybeSingle();
    if (requestError) throw new Error(requestError.message);
    if (!request) return res.status(404).json({ error: "Execution capital request not found" });
    if (String(request.requester_wallet).toLowerCase() !== auth.user.wallet_address.toLowerCase()) {
      return res.status(403).json({ error: "You do not own this execution capital request" });
    }
    if (request.status !== "authorized" && request.status !== "active") {
      return res.status(409).json({ error: `Receipt confirmation requires an authorized or active request; current status is ${request.status}` });
    }

    const evidenceRoot = object(request.evidence);
    const lastExecution = object(evidenceRoot.last_execution);
    if (String(lastExecution.transaction_hash || "").toLowerCase() !== txHash.toLowerCase()) {
      return res.status(409).json({ error: "Transaction hash does not match the request's recorded execution" });
    }

    const now = new Date().toISOString();
    const mergedExecution = {
      ...lastExecution,
      transaction_hash: txHash,
      receipt: normalized,
      receipt_verified: true,
      receipt_verified_at: now,
    };
    const nextEvidence = {
      ...evidenceRoot,
      last_execution: mergedExecution,
      execution_receipt_verification: {
        method: "bsc_testnet_public_rpc_receipt",
        chain_id: 97,
        transaction_hash: txHash,
        verified_at: now,
      },
    };

    const { data: updatedRequest, error: updateError } = await supabase
      .from("execution_capital_requests")
      .update({
        evidence: nextEvidence,
        updated_at: now,
      })
      .eq("id", request.id)
      .eq("requester_wallet", auth.user.wallet_address)
      .select("*")
      .single();
    if (updateError) throw new Error(updateError.message);

    const { data: executionEvidence, error: evidenceReadError } = await supabase
      .from("execution_capital_execution_evidence")
      .select("*")
      .eq("execution_capital_request_id", request.id)
      .eq("transaction_hash", txHash)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (evidenceReadError) throw new Error(evidenceReadError.message);

    if (executionEvidence) {
      const { error: evidenceUpdateError } = await supabase
        .from("execution_capital_execution_evidence")
        .update({
          receipt: normalized,
          receipt_verified: true,
        })
        .eq("id", executionEvidence.id);
      if (evidenceUpdateError) throw new Error(evidenceUpdateError.message);
    }

    return res.status(200).json({
      ok: true,
      confirmed: true,
      network: "bsc-testnet",
      chain_id: 97,
      transaction_hash: txHash,
      receipt: normalized,
      request: updatedRequest,
      execution_evidence: executionEvidence ? {
        ...executionEvidence,
        receipt: normalized,
        receipt_verified: true,
      } : null,
      note: "BSC Testnet receipt independently observed from the public RPC and persisted as execution evidence. Capital deployed/returned and P&L remain unchanged until independent accounting evidence exists.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to verify Testnet execution receipt";
    const status = /not found|does not own|requires|current status|does not match/i.test(message) ? 409 : 503;
    return res.status(status).json({ error: message });
  }
}
