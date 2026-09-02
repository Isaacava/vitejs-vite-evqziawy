import json
from app.agent.main import fulfill_job

def test_yield_selects_highest_apr():
    text, meta = fulfill_job({"jobId": 1, "description": json.dumps({"params": {"opportunities": [{"protocol": "A", "apr": 5}, {"protocol": "B", "apr": 8}]}})})
    assert meta["execution_status"] == "evaluated"
    assert json.loads(text)["selection"]["protocol"] == "B"

def test_yield_rejects_empty_opportunities():
    try:
        fulfill_job({"jobId": 2, "description": json.dumps({"params": {"opportunities": []}})})
    except ValueError:
        return
    raise AssertionError("empty yield opportunities must be rejected")
