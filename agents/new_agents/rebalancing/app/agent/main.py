from __future__ import annotations

import json, os, time
from typing import Any
from web3 import Web3

RPC = os.getenv("BSC_TESTNET_RPC_URL", "https://bsc-testnet-rpc.publicnode.com")
FACTORY = Web3.to_checksum_address(os.getenv("PANCAKE_V3_FACTORY", "0x1BB72E0CbbEA93c08f535fc7856E0338D7F7a8aB"))
POSITION_MANAGER = Web3.to_checksum_address(os.getenv("PANCAKE_V3_POSITION_MANAGER", "0x427bF5b37357632377eCbEC9de3626C71A5396c1"))
EDGE_THRESHOLD = float(os.getenv("LP_EDGE_THRESHOLD", "0.10"))
WIDEN_FACTOR = float(os.getenv("LP_WIDEN_FACTOR", "1.50"))

# Published provider contract for AgentMarket discovery/hiring.
# AgentMarket's capability UI consumes an inputs[] schema, not JSON Schema properties.
CAPABILITY_SCHEMA = {
    "version": 1,
    "inputs": [
        {
            "name": "wallet_address",
            "label": "Execution wallet",
            "type": "string",
            "required": True,
            "help": "BSC Testnet wallet address containing the Pancake V3 position. This is the user/job wallet, not the provider wallet.",
        },
        {
            "name": "position_token_id",
            "label": "Pancake V3 position token ID",
            "type": "integer",
            "required": True,
            "help": "Pancake V3 NonfungiblePositionManager NFT token ID for the LP position to inspect and, when authorized, rebalance.",
        },
    ],
}

w3 = Web3(Web3.HTTPProvider(RPC, request_kwargs={"timeout": 15}))
PM_ABI = [
    {"name":"positions","type":"function","stateMutability":"view","inputs":[{"name":"tokenId","type":"uint256"}],"outputs":[{"type":"uint96"},{"type":"address"},{"type":"address"},{"type":"address"},{"type":"uint24"},{"type":"int24"},{"type":"int24"},{"type":"uint128"},{"type":"uint256"},{"type":"uint256"},{"type":"uint128"},{"type":"uint128"}]},
]
FACTORY_ABI = [{"name":"getPool","type":"function","stateMutability":"view","inputs":[{"name":"tokenA","type":"address"},{"name":"tokenB","type":"address"},{"name":"fee","type":"uint24"}],"outputs":[{"name":"pool","type":"address"}]}]
POOL_ABI = [
    {"name":"slot0","type":"function","stateMutability":"view","inputs":[],"outputs":[{"type":"uint160"},{"type":"int24"},{"type":"uint16"},{"type":"uint16"},{"type":"uint16"},{"type":"uint8"},{"type":"bool"}]},
    {"name":"tickSpacing","type":"function","stateMutability":"view","inputs":[],"outputs":[{"type":"int24"}]},
]


def _obj(v: Any) -> dict[str, Any]:
    if isinstance(v, dict): return v
    if isinstance(v, str) and v.strip():
        try:
            x = json.loads(v); return x if isinstance(x, dict) else {}
        except json.JSONDecodeError: return {}
    return {}


def _params(job: dict[str, Any]) -> dict[str, Any]:
    m = {**_obj(job.get("metadata")), **_obj(job.get("description"))}
    if isinstance(m.get("params"), dict): m = {**m, **m["params"]}
    return m


def _address(v: Any) -> str:
    s = str(v or "").strip()
    if not Web3.is_address(s): raise ValueError("A valid wallet address is required")
    return Web3.to_checksum_address(s)


def _align_down(tick: int, spacing: int) -> int:
    return (tick // spacing) * spacing


def _align_up(tick: int, spacing: int) -> int:
    return -((-tick) // spacing) * spacing


def inspect_position(wallet: str, token_id: int) -> dict[str, Any]:
    if not w3.is_connected(): raise RuntimeError("BSC Testnet RPC is unavailable")
    pm = w3.eth.contract(address=POSITION_MANAGER, abi=PM_ABI)
    raw = pm.functions.positions(token_id).call()
    token0, token1 = raw[2], raw[3]
    fee, tick_lower, tick_upper, liquidity = int(raw[4]), int(raw[5]), int(raw[6]), int(raw[7])
    factory = w3.eth.contract(address=FACTORY, abi=FACTORY_ABI)
    pool_address = factory.functions.getPool(token0, token1, fee).call()
    if not pool_address or int(pool_address, 16) == 0: raise RuntimeError("No Pancake V3 pool exists for this position")
    pool = w3.eth.contract(address=Web3.to_checksum_address(pool_address), abi=POOL_ABI)
    slot0 = pool.functions.slot0().call(); current_tick = int(slot0[1]); spacing = int(pool.functions.tickSpacing().call())
    width = max(tick_upper - tick_lower, spacing * 2)
    edge_ratio = min(current_tick - tick_lower, tick_upper - current_tick) / width
    action = "move_range" if current_tick < tick_lower or current_tick > tick_upper else ("widen" if edge_ratio < EDGE_THRESHOLD else "hold")
    target_width = int(width * (WIDEN_FACTOR if action == "widen" else 1.0))
    target_width = max(target_width, spacing * 2)
    center = current_tick
    target_lower = _align_down(center - target_width // 2, spacing)
    target_upper = _align_up(center + target_width // 2, spacing)
    if target_upper <= target_lower: target_upper = target_lower + spacing * 2
    return {
        "wallet": wallet, "token_id": token_id, "position_manager": POSITION_MANAGER, "pool": Web3.to_checksum_address(pool_address),
        "token0": token0, "token1": token1, "fee": fee, "liquidity": liquidity,
        "tick_lower": tick_lower, "tick_upper": tick_upper, "current_tick": current_tick, "tick_spacing": spacing,
        "range_width": width, "edge_ratio": max(0.0, edge_ratio), "action": action,
        "target_lower": target_lower, "target_upper": target_upper,
    }


def decide_job(job: dict[str, Any]) -> dict[str, Any]:
    p = _params(job)
    wallet = _address(p.get("wallet_address") or p.get("execution_wallet"))
    token_id = int(p.get("position_token_id") or p.get("token_id") or 0)
    if token_id <= 0: raise ValueError("Live LP rebalancing requires position_token_id")
    obs = inspect_position(wallet, token_id)
    action = obs["action"]
    return {
        "job_id": str(job.get("jobId", job.get("id", ""))), "network": "bsc-testnet", "task": "lp_range_rebalancing",
        "observation": obs,
        "decision": {"action": action, "target_lower": obs["target_lower"], "target_upper": obs["target_upper"]},
        "execution_required": action != "hold", "authorization_required": action != "hold",
    }


def _balances(wallet: str, token0: str, token1: str) -> tuple[int, int]:
    abi = [{"name":"balanceOf","type":"function","stateMutability":"view","inputs":[{"name":"owner","type":"address"}],"outputs":[{"type":"uint256"}]}]
    c0 = w3.eth.contract(address=Web3.to_checksum_address(token0), abi=abi)
    c1 = w3.eth.contract(address=Web3.to_checksum_address(token1), abi=abi)
    return int(c0.functions.balanceOf(wallet).call()), int(c1.functions.balanceOf(wallet).call())


def fulfill_job(job: dict[str, Any]) -> tuple[str, dict[str, Any]]:
    p = _params(job); decision = decide_job(job); obs = decision["observation"]; action = decision["decision"]["action"]
    if action == "hold":
        payload = {"agent":"lp-range-rebalancer-v2","job_id":decision["job_id"],"network":"bsc-testnet","task":"lp_range_rebalancing","observation":obs,"decision":decision["decision"],"execution_status":"observed","workflow":["read_position","read_pool_tick","hold"],"note":"Live Pancake V3 position state was read from BSC Testnet; no state-changing transaction was required."}
        return json.dumps(payload,separators=(",",":")), {"execution_status":"observed","transaction_hash":None,"decision":"hold"}

    auth = p.get("execution_authorization") or p.get("authorization")
    if not isinstance(auth, dict): raise RuntimeError("Range-changing execution requires job-scoped execution authorization")
    wallet = _address(p.get("wallet_address") or auth.get("execution_wallet") or p.get("execution_wallet"))
    before0, before1 = _balances(wallet, obs["token0"], obs["token1"])
    job_id = int(job.get("jobId", job.get("id", 0)))
    if job_id <= 0: raise ValueError("A positive ERC-8183 jobId is required")

    execution_url = os.getenv("ALTANA_EXECUTION_INTERNAL_URL", "http://127.0.0.1:8788").rstrip("/")
    import urllib.request
    def post(path: str, body: dict[str, Any]) -> dict[str, Any]:
        req = urllib.request.Request(execution_url + path, data=json.dumps(body).encode(), headers={"content-type":"application/json"}, method="POST")
        with urllib.request.urlopen(req, timeout=60) as r: return json.loads(r.read().decode())

    withdraw = post("/execute-lp-withdraw", {"jobId":job_id,"walletAddress":wallet,"tokenId":obs["token_id"],"positionManager":obs["position_manager"],"liquidity":str(obs["liquidity"]),"executionAuthorization":auth})
    if withdraw.get("status") == "FAILED" or withdraw.get("error"): raise RuntimeError(str(withdraw.get("error") or "LP withdrawal failed"))
    tx1 = withdraw.get("transactionHash") or withdraw.get("transaction_hash")
    time.sleep(float(os.getenv("LP_SETTLE_WAIT_SECONDS", "3")))
    after0, after1 = _balances(wallet, obs["token0"], obs["token1"])
    amount0 = max(0, after0 - before0); amount1 = max(0, after1 - before1)
    if amount0 <= 0 and amount1 <= 0: raise RuntimeError("LP withdrawal produced no token balance increase; refusing to mint a new position")
    mint = post("/execute-lp-mint", {"jobId":job_id,"walletAddress":wallet,"token0":obs["token0"],"token1":obs["token1"],"fee":obs["fee"],"tickLower":obs["target_lower"],"tickUpper":obs["target_upper"],"amount0Desired":str(int(amount0*0.99)),"amount1Desired":str(int(amount1*0.99)),"positionManager":obs["position_manager"],"executionAuthorization":auth})
    if mint.get("status") == "FAILED" or mint.get("error"): raise RuntimeError(str(mint.get("error") or "LP mint failed"))
    tx2 = mint.get("transactionHash") or mint.get("transaction_hash")
    if not tx1 or not tx2: raise RuntimeError("LP range workflow completed without both transaction hashes")
    payload = {"agent":"lp-range-rebalancer-v2","job_id":decision["job_id"],"network":"bsc-testnet","task":"lp_range_rebalancing","observation":obs,"decision":decision["decision"],"execution_status":"executed","workflow":["read_position","read_pool_tick","decrease_liquidity","collect_fees","burn_old_position","mint_centered_position"],"transactions":{"withdraw_collect_burn":tx1,"mint_new_range":tx2},"new_position_range":{"tick_lower":obs["target_lower"],"tick_upper":obs["target_upper"]},"reinvested_amounts":{"token0":str(int(amount0*0.99)),"token1":str(int(amount1*0.99))}}
    return json.dumps(payload,separators=(",",":")), {"execution_status":"executed","transaction_hash":tx2,"decision":action}
