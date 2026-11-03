# -*- coding: utf-8 -*-
import pytest
import sqlite3
from fastapi.testclient import TestClient
from backend.main import app
from backend.app.services.worktask_service import WorkTaskQueryService
from backend.app.services.tririga_resolver import TririgaResolver
from backend.app.services.log_amalgamator import LogAmalgamator
from backend.app.config import settings

def get_auth_client():
    client = TestClient(app)
    res = client.post("/api/auth/login", json={"password": "admin2026!"})
    token = res.json().get("token")
    client.headers["Authorization"] = f"Bearer {token}"
    client.headers["X-Auth-Token"] = token
    return client

def test_duration_and_sql_extraction():
    # 1. Test slow query with ms duration
    text1 = "2026-09-14 10:15:23,456 WARN [com.tririga.platform.error.PerformanceLogger] Execution time: 14502 ms [SELECT SPEC_ID, TRINAMETX FROM T_TRIWORKTASK WHERE SYS_OBJECTSTATE = 'triActive']"
    dur1 = WorkTaskQueryService._extract_duration_ms(text1)
    assert dur1 == 14502.0
    sql1 = WorkTaskQueryService._extract_sql_snippet(text1)
    assert "T_TRIWORKTASK" in sql1

    # 2. Test slow query with seconds duration
    text2 = "Query executed in 3.42s for record WRK-149204"
    dur2 = WorkTaskQueryService._extract_duration_ms(text2)
    assert dur2 == 3420.0

    # 3. Test TRIRIGA 'lasting X ms' and 'duration=Xms' patterns
    text3a = "2026-09-14 10:15:23 WARN [com.tririga.platform.error.PerformanceLogger] Slow query on T_TRIWORKTASK lasting 14463 ms."
    assert WorkTaskQueryService._extract_duration_ms(text3a) == 14463.0

    text3b = "WF task completed duration=8230ms on IBS_SPEC_ASSIGNMENTS"
    assert WorkTaskQueryService._extract_duration_ms(text3b) == 8230.0

    # 4. Test deadlock detection
    text3 = "com.ibm.db2.jcc.am.SqlTransactionException: [jcc][10335][10366][4.26.14] Deadlock detected during lock acquisition on IBS_SPEC_ASSIGNMENTS. SQLCODE=-911, SQLSTATE=40001"
    inc_type, sev = WorkTaskQueryService._classify_incident(text3, None, "ERROR")
    assert inc_type == "DEADLOCK"
    assert sev == "CRITICAL"

def test_worktask_record_resolution():
    # Uncataloged spec ID returns real parsed ID without hallucinated metadata
    rec1 = WorkTaskQueryService.resolve_worktask_record("1492041")
    assert rec1["spec_id"] == 1492041
    assert rec1["control_number"] == "REC-1492041"
    assert rec1["is_resolved"] is False
    assert "recent_logs" in rec1

    # Control number resolution returns real database lookup and logs
    rec2 = WorkTaskQueryService.resolve_worktask_record("WRK-149204")
    assert rec2["control_number"] == "WRK-149204"
    assert "recent_logs" in rec2

def test_recommendation_generation():
    recom = WorkTaskQueryService._generate_recommendation(
        "DEADLOCK",
        "SELECT * FROM T_TRIWORKTASK",
        ["T_TRIWORKTASK", "IBS_SPEC_ASSIGNMENTS"],
        "WRK-149204",
        18500.0
    )
    assert "DEADLOCK" in recom["title"].upper() or "Deadlock" in recom["title"]
    assert "CREATE INDEX" in recom["db2_ddl"]
    assert len(recom["action_plan"]) > 0

def test_worktasks_api_endpoints():
    client = get_auth_client()

    # 1. Test Queries & Contention endpoint
    res1 = client.get("/api/worktasks/queries-and-contention?page=1&page_size=10")
    assert res1.status_code == 200
    data1 = res1.json()
    assert "items" in data1
    assert "metrics" in data1
    assert "total" in data1

    # 2. Test Record details endpoint
    res2 = client.get("/api/worktasks/record/WRK-149204")
    assert res2.status_code == 200
    data2 = res2.json()
    assert data2["control_number"] == "WRK-149204"
    assert "recent_logs" in data2
    assert "associated_logs_count" in data2

    # 3. Test Workflow Bottlenecks endpoint (dynamic from actual logs)
    res3 = client.get("/api/worktasks/workflow-bottlenecks")
    assert res3.status_code == 200
    data3 = res3.json()
    assert "bottlenecks" in data3
    assert "total_bottlenecks_detected" in data3

    # 4. Test TRIRIGA resolution endpoint by Spec ID and by Control Number
    res4 = client.get("/api/tririga/resolve/1492041")
    assert res4.status_code == 200
    data4 = res4.json()
    assert data4["spec_id"] == 1492041

    res5 = client.get("/api/tririga/resolve/WRK-149204")
    assert res5.status_code == 200
    data5 = res5.json()
    assert data5["control_number"] == "WRK-149204"

    # 5. Test Extract and Resolve endpoint
    sample_log = "Error in workflow 5019284 while processing spec_id=1492041 for worktask WRK-149204"
    res6 = client.post("/api/tririga/extract-and-resolve", json={"text": sample_log})
    assert res6.status_code == 200
    data6 = res6.json()
    assert "extracted_ids" in data6
    assert 1492041 in data6["extracted_ids"]["spec_ids"]
    assert "WRK-149204" in data6["extracted_ids"]["control_numbers"]
    assert 5019284 in data6["extracted_ids"]["wf_ids"]
    assert len(data6["resolved_specs"]) > 0

@pytest.mark.anyio
async def test_live_worktask_telemetry():
    server_info = {
        "id": 101,
        "name": "Test Server",
        "host": "localhost",
        "port": 443,
        "protocol": "https",
        "admin_path": "/html/en/default/admin"
    }
    # Live telemetry returns real connection status (False if unreachable)
    telemetry = await WorkTaskQueryService.get_live_telemetry(server_info)
    assert "success" in telemetry
    assert "lock_contentions" in telemetry
    assert "slow_dynamic_queries" in telemetry
    assert "active_worktask_workflows" in telemetry
