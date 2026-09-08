from __future__ import annotations

import json, os, urllib.parse, urllib.request, math
from typing import Any

LLAMA_URL = os.getenv("DEFILLAMA_YIELDS_URL", "https://yields.llama.fi/pools")
CHAIN = os.getenv("YIELD_CHAIN", "BSC")
MIN_TVL = float(os.getenv("YIELD_MIN_TVL_USD", "100000"))
MAX_APY = float(os.getenv("YIELD_MAX_APY", "500"))

def _obj(v: Any) -> dict[str, Any]:
    if isinstance(v, dict): return v
    if isinstance(v, str) and v.strip():
        try:
            x=json.loads(v); return x if isinstance(x,dict) else {}
        except json.JSONDecodeError: return {}
    return {}

def _params(job: dict[str,Any])->dict[str,Any]:
    m={**_obj(job.get("metadata")),**_obj(job.get("description"))}
    if isinstance(m.get("params"),dict): m={**m,**m["params"]}
    return m

def fetch_current_pools()->list[dict[str,Any]]:
    with urllib.request.urlopen(LLAMA_URL, timeout=20) as r:
        data=json.loads(r.read().decode())
    pools=data.get("data") if isinstance(data,dict) else None
    if not isinstance(pools,list): raise RuntimeError("Yield data provider returned no pool list")
    out=[]
    for p in pools:
        if not isinstance(p,dict) or str(p.get("chain","")).upper()!=CHAIN.upper(): continue
        try:
            apy=float(p.get("apy") if p.get("apy") is not None else 0)
            tvl=float(p.get("tvlUsd") if p.get("tvlUsd") is not None else 0)
        except (TypeError,ValueError): continue
        if not math.isfinite(apy) or not math.isfinite(tvl) or tvl < MIN_TVL or apy < 0 or apy > MAX_APY: continue
        out.append({
            "pool":str(p.get("pool") or ""), "project":str(p.get("project") or ""), "symbol":str(p.get("symbol") or ""),
            "chain":str(p.get("chain") or CHAIN), "tvl_usd":round(tvl,2), "apy":round(apy,4),
            "apy_base":round(float(p.get("apyBase") or 0),4), "apy_reward":round(float(p.get("apyReward") or 0),4),
            "stablecoin":bool(p.get("stablecoin")), "url":p.get("url")
        })
    return out

def _score(p:dict[str,Any], prefer_stable:bool)->float:
    tvl_factor=min(1.0,max(0.0,math.log10(max(p["tvl_usd"],1))/8.0))
    stability=0.08 if prefer_stable and p["stablecoin"] else (0.02 if p["stablecoin"] else 0)
    reward_penalty=0.04 if p["apy_reward"]>p["apy"]*0.75 else 0
    return p["apy"]*(0.78+0.22*tvl_factor)+stability-reward_penalty

def decide_job(job:dict[str,Any])->dict[str,Any]:
    p=_params(job); pools=fetch_current_pools()
    if not pools: raise RuntimeError("No current BSC yield opportunities met the agent's data-quality filters")
    prefer_stable=bool(p.get("prefer_stablecoin"))
    wanted=[str(x).lower() for x in (p.get("protocols") if isinstance(p.get("protocols"),list) else [])]
    if wanted:
        filtered=[x for x in pools if x["project"].lower() in wanted or any(w in x["project"].lower() for w in wanted)]
        if filtered: pools=filtered
    ranked=sorted(pools,key=lambda x:_score(x,prefer_stable),reverse=True)
    winner=ranked[0]
    return {"job_id":str(job.get("jobId",job.get("id",""))),"network":"bsc-testnet","task":"yield_optimisation","observation":{"source":LLAMA_URL,"source_timestamp":"provider_current","candidate_count":len(ranked),"filters":{"chain":CHAIN,"min_tvl_usd":MIN_TVL,"max_apy":MAX_APY}},"decision":{"action":"select_opportunity","score":round(_score(winner,prefer_stable),6),"selected":winner},"candidates":ranked[:5],"execution_required":False,"authorization_required":False}

def fulfill_job(job:dict[str,Any])->tuple[str,dict[str,Any]]:
    decision=decide_job(job)
    payload={"agent":"yield-optimizer-v2","job_id":decision["job_id"],"network":"bsc-testnet","task":"yield_optimisation","observation":decision["observation"],"decision":decision["decision"],"ranked_candidates":decision["candidates"],"execution_status":"evaluated","execution":"current-market-opportunity-analysis","note":"Selection is computed from a fresh DefiLlama yield dataset at job execution time; supplied opportunity lists are not trusted as the market source."}
    return json.dumps(payload,separators=(",",":")),{"execution_status":"evaluated","transaction_hash":None,"decision":"select_opportunity"}
