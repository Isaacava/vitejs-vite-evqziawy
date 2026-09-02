import json
from app.agent.main import fulfill_job

def test_health_guardian_detects_critical():
    text, meta = fulfill_job({"jobId": 1, "description": json.dumps({"params": {"health_factor": 1.05}})})
    assert meta["execution_status"] == "observed"
    assert json.loads(text)["decision"]["action"] == "protect_now"

def test_health_guardian_monitors_healthy_position():
    text, _ = fulfill_job({"jobId": 2, "description": json.dumps({"params": {"health_factor": 2.0}})})
    assert json.loads(text)["decision"]["action"] == "monitor"
