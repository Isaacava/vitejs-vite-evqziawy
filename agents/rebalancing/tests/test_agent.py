import json
from app.agent.main import fulfill_job

def test_rebalancing_moves_out_of_range():
    text, meta = fulfill_job({"jobId": 1, "description": json.dumps({"params": {"current_tick": 20, "tick_lower": 0, "tick_upper": 10}})})
    assert meta["execution_status"] == "observed"
    assert json.loads(text)["decision"]["action"] == "move_range"

def test_rebalancing_holds_inside_range():
    text, _ = fulfill_job({"jobId": 2, "description": json.dumps({"params": {"current_tick": 5, "tick_lower": 0, "tick_upper": 10}})})
    assert json.loads(text)["decision"]["action"] == "hold"
