import pytest
import sqlite3
import os
from backend.app.services.log_amalgamator import LogAmalgamator, normalize_timestamp, compute_error_hash
from backend.app.services.tririga_collector import TririgaCollector
from backend.app.services.local_llm import LocalLLMService
from backend.app.db.database import db_session, init_db
from backend.app.config import settings

def test_normalize_timestamp():
    ts1 = "2026-08-31 10:15:23,456"
    norm1 = normalize_timestamp(ts1)
    assert norm1 == "2026-08-31T10:15:23.456Z"

    ts2 = "8/31/26 10:15:23:456 UTC"
    norm2 = normalize_timestamp(ts2)
    assert norm2 == "2026-08-31T10:15:23.456Z"

def test_log_amalgamator_multiline():
    raw_sample = """2026-08-31 10:15:23,456 ERROR [com.tririga.ws.TririgaWS] [Thread-12] Error executing workflow ID: 12345
com.tririga.platform.error.PlatformException: Deadlock detected
\tat com.tririga.platform.workflow.engine.WorkflowEngine.processTask(WorkflowEngine.java:512)
\tat java.base/java.lang.Thread.run(Thread.java:834)
2026-08-31 10:15:25,100 INFO  [com.tririga.platform.bootstrap.TririgaBootstrap] [main] Platform steady state
"""
    entries = LogAmalgamator.parse_log_text(raw_sample, server_id=1, file_id=1)
    assert len(entries) == 2
    assert entries[0]["log_level"] == "ERROR"
    assert entries[0]["logger_name"] == "com.tririga.ws.TririgaWS"
    assert "WorkflowEngine.java" in entries[0]["stack_trace"]
    assert entries[0]["error_hash"] is not None
    assert entries[1]["log_level"] == "INFO"

def test_full_pipeline_mock_and_fts():
    test_db = ":memory:"
    conn = sqlite3.connect(test_db)
    conn.row_factory = sqlite3.Row
    with open(settings.base_dir / "backend" / "app" / "db" / "schema.sql", "r") as f:
        conn.executescript(f.read())
    
    cur = conn.cursor()
    cur.execute("INSERT OR REPLACE INTO servers (id, name, host, port, protocol) VALUES (101, 'Test-Node', 'mock', 8001, 'http');")
        
    mock_files = TririgaCollector.generate_mock_tririga_logs(101, "Test-Node")
    assert len(mock_files) >= 2
    
    cur.execute("INSERT OR REPLACE INTO log_files (id, server_id, filename, file_type, local_path) VALUES (201, 101, 'server.log', 'server', 'dummy');")
    res = LogAmalgamator.ingest_file(conn, 101, 201, mock_files[0]["content"])
    assert res["total"] > 0
    assert res["errors"] > 0

    # Test FTS5 Search
    cur.execute("""
        SELECT e.message, e.log_level 
        FROM log_entries_fts fts
        JOIN log_entries e ON fts.rowid = e.id
        WHERE log_entries_fts MATCH 'deadlock'
    """)
    matches = cur.fetchall()
    assert len(matches) > 0

    # Test Forensic Context Assembly
    ctx = LocalLLMService.assemble_log_forensic_context(conn, [101])
    assert ctx["stats"]["total_logs"] > 0
    assert len(ctx["error_clusters"]) > 0

    from backend.app.services.local_llm import format_ordinal_date
    today_formatted = format_ordinal_date()

    # Test Fallback Report Generation
    report = LocalLLMService.generate_rule_based_fallback_report(ctx, "ollama", "http://localhost:11434", "llama3")
    assert "TRIRIGA" in report
    assert "Incident" in report
    assert f"*Date of report preparation: {today_formatted}*" in report

    # Test Compact Prompt Construction
    prompt = LocalLLMService.build_tririga_analysis_prompt(ctx)
    assert "OVERALL CLUSTER LOG STATISTICS" in prompt
    assert "IBM DB2" in prompt
    assert f"*Date of report preparation: {today_formatted}*" in prompt

@pytest.mark.anyio
async def test_sse_heartbeat_stream():
    from backend.app.api.analysis import sse_heartbeat_stream
    import asyncio

    async def sample_gen():
        yield "chunk 1"
        await asyncio.sleep(0.05)
        yield "chunk 2"

    chunks = []
    async for item in sse_heartbeat_stream(sample_gen(), ping_interval=0.02):
        chunks.append(item)

    assert any("chunk 1" in c for c in chunks)
    assert any("chunk 2" in c for c in chunks)
    assert any("keepalive-ping" in c for c in chunks)

def test_date_filtering_context():
    test_db = ":memory:"
    conn = sqlite3.connect(test_db)
    conn.row_factory = sqlite3.Row
    with open(settings.base_dir / "backend" / "app" / "db" / "schema.sql", "r") as f:
        conn.executescript(f.read())
    
    cur = conn.cursor()
    cur.execute("INSERT OR REPLACE INTO servers (id, name, host, port, protocol) VALUES (101, 'Test-Node', 'mock', 8001, 'http');")
    mock_files = TririgaCollector.generate_mock_tririga_logs(101, "Test-Node")
    
    cur.execute("INSERT OR REPLACE INTO log_files (id, server_id, filename, file_type, local_path) VALUES (201, 101, 'server.log', 'server', 'dummy');")
    LogAmalgamator.ingest_file(conn, 101, 201, mock_files[0]["content"])
    conn.commit()

    from backend.app.services.local_llm import LocalLLMService
    from datetime import datetime, timezone

    today_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    # Test with preset 'TODAY'
    ctx_today = LocalLLMService.assemble_log_forensic_context(
        conn,
        server_ids=[101],
        date_preset="TODAY",
        start_time=f"{today_str}T00:00:00.000Z",
        end_time=f"{today_str}T23:59:59.999Z"
    )
    assert ctx_today["stats"]["total_logs"] > 0
    assert ctx_today["time_window_label"] == "Today (00:00 - 23:59)"
    assert "Today" in ctx_today["scope_title"]

    # Test with preset '6H'
    ctx_6h = LocalLLMService.assemble_log_forensic_context(
        conn,
        server_ids=[101],
        date_preset="6H",
        start_time=f"{today_str}T00:00:00.000Z",
        end_time=f"{today_str}T23:59:59.999Z"
    )
    assert ctx_6h["stats"]["total_logs"] > 0
    assert ctx_6h["time_window_label"] == "Last 6 Hours"
    assert "Last 6 Hours" in ctx_6h["scope_title"]

    # Test out-of-range window returns 0
    ctx_empty = LocalLLMService.assemble_log_forensic_context(
        conn,
        server_ids=[101],
        start_time="2025-01-01T00:00:00.000Z",
        end_time="2025-01-01T01:00:00.000Z"
    )
    assert ctx_empty["stats"]["total_logs"] == 0

def test_context_window_scaling():
    test_db = ":memory:"
    conn = sqlite3.connect(test_db)
    conn.row_factory = sqlite3.Row
    with open(settings.base_dir / "backend" / "app" / "db" / "schema.sql", "r") as f:
        conn.executescript(f.read())

    cur = conn.cursor()
    cur.execute("INSERT OR REPLACE INTO servers (id, name, host, port, protocol) VALUES (101, 'Test-Node', 'mock', 8001, 'http');")
    mock_files = TririgaCollector.generate_mock_tririga_logs(101, "Test-Node")
    cur.execute("INSERT OR REPLACE INTO log_files (id, server_id, filename, file_type, local_path) VALUES (201, 101, 'server.log', 'server', 'dummy');")
    LogAmalgamator.ingest_file(conn, 101, 201, mock_files[0]["content"])
    conn.commit()

    # Test 32k context prompt construction
    ctx_32k = LocalLLMService.assemble_log_forensic_context(conn, [101], context_window=32768)
    prompt_32k = LocalLLMService.build_tririga_analysis_prompt(ctx_32k, context_window=32768)
    assert len(prompt_32k) > 0
    assert "Stack:" in prompt_32k

    # Test 16k context prompt construction
    ctx_16k = LocalLLMService.assemble_log_forensic_context(conn, [101], context_window=16384)
    prompt_16k = LocalLLMService.build_tririga_analysis_prompt(ctx_16k, context_window=16384)
    assert len(prompt_16k) > 0

    # Ensure prompt sizes leave guaranteed completion headroom for the LLM report
    assert len(prompt_32k) / 3.2 < 32768 - 4000
    assert len(prompt_16k) / 3.2 < 16384 - 2500

def test_live_thread_parsing_and_subsystems():
    from backend.app.services.tririga_admin_client import TririgaAdminClient

    # Test JVM thread dump parsing
    sample_threads_dump = """
<pre>
"WFA-Thread-1" #42 prio=5 os_prio=0 tid=0x00007f9c40001000 nid=0x1a03 waiting on condition [0x00007f9c20000000]
   java.lang.Thread.State: WAITING (parking)
\tat com.ibm.db2.jcc.am.b7.b(b7.java:4938)
\tat com.tririga.platform.persistence.sql.IbsSpecInclExclDao.lock(IbsSpecInclExclDao.java:120)

"Default Executor-thread-5" #89 prio=5 tid=0x00007f9c40002000 runnable
   java.lang.Thread.State: RUNNABLE
\tat com.tririga.web.servlet.DispatcherServlet.service(DispatcherServlet.java:88)
</pre>
"""
    threads = TririgaAdminClient._parse_threads_html(sample_threads_dump)
    assert len(threads) == 2

    # Check Workflow Agent thread classification
    wfa = next(t for t in threads if "WFA" in t["name"])
    assert wfa["subsystem"] == "Workflow Agent"
    assert wfa["state"] == "WAITING"
    assert wfa["db_blocked"] is True

    # Check HTTP Executor thread classification
    http_thread = next(t for t in threads if "Executor" in t["name"])
    assert http_thread["subsystem"] == "Web Container / HTTP"
    assert http_thread["state"] == "RUNNABLE"
    assert http_thread["db_blocked"] is False

def test_docx_chat_export():
    from backend.app.services.docx_exporter import DocxReportExporter
    markdown_chat = """# IBM TRIRIGA AI Assistant – Chat Transcript
*Generated: September 9th, 2026*

---

### User
> How do I analyze workflow agent thread deadlocks?

---

### Assistant
Deadlocks in the IBM TRIRIGA Workflow Agent typically occur when multiple threads lock `IBS_SPEC_ASSIGNMENTS` concurrently.
Here are the key diagnostic steps:
1. Inspect thread dumps for `lock(IbsSpecInclExclDao.java)`
2. Review DB2 application snapshot lock waits
"""
    docx_bytes = DocxReportExporter.generate_docx("IBM TRIRIGA AI Assistant – Consultation Transcript", markdown_chat)
    raw = docx_bytes.getvalue()
    assert len(raw) > 1000
    assert raw[:4] == b"PK\x03\x04"  # Valid zip / docx magic header

def get_auth_client(app):
    from fastapi.testclient import TestClient
    client = TestClient(app)
    res = client.post("/api/auth/login", json={"password": "admin2026!"})
    token = res.json().get("token")
    client.headers["Authorization"] = f"Bearer {token}"
    client.headers["X-Auth-Token"] = token
    return client

@pytest.mark.anyio
async def test_operations_service_and_endpoints():
    from backend.app.services.operations_service import OperationsService
    from backend.main import app
    import zipfile

    # 1. Test Cluster Parity
    parity = OperationsService.get_cluster_parity()
    assert parity["success"] is True
    assert isinstance(parity["nodes"], list)

    # 2. Test GC Telemetry fallback
    gc = OperationsService.get_gc_telemetry(99999)
    assert gc["has_gc_logs"] is False
    assert gc["summary"]["total_events"] == 0

    # 3. Test Diagnostic Bundle generation
    server_info = {
        "id": 1,
        "name": "Test-App1",
        "host": "localhost",
        "port": 9080,
        "protocol": "http",
        "admin_path": "/html/en/default/admin"
    }
    bundle_io = await OperationsService.generate_diagnostic_bundle(server_info, 1)
    assert bundle_io.getvalue()[:4] == b"PK\x03\x04"

    # Verify contents of zip
    with zipfile.ZipFile(bundle_io, "r") as zf:
        namelist = zf.namelist()
        assert any(n.endswith(".docx") for n in namelist)
        assert "thread_dump.txt" in namelist
        assert "error_logs.txt" in namelist
        assert "database_locks.json" in namelist

    # 4. Test API Endpoints with authenticated client
    client = get_auth_client(app)
    res_parity = client.get("/api/operations/cluster-parity")
    assert res_parity.status_code == 200
    assert res_parity.json()["success"] is True
    assert "clusters" in res_parity.json()


def test_server_reconfiguration_and_clustering():
    from backend.main import app
    from backend.app.db.database import db_session, db_read_session
    client = get_auth_client(app)

    # 1. Create a test server
    res_create = client.post("/api/servers", json={
        "name": "Test Cluster Node A",
        "host": "test-a.tririga.internal",
        "port": 443,
        "protocol": "https",
        "admin_path": "/html/en/default/admin",
        "username": "admin",
        "password": "SecretPassword123",
        "auth_type": "form",
        "cluster_name": "QA Clustered Pair"
    })
    assert res_create.status_code == 200
    server_id = res_create.json()["id"]

    try:
        # 2. Update server (reconfigure cluster & host without touching password)
        res_update = client.put(f"/api/servers/{server_id}", json={
            "name": "Test Cluster Node A (Updated)",
            "host": "test-a-new.tririga.internal",
            "cluster_name": "QA Clustered Pair"
        })
        assert res_update.status_code == 200
        assert res_update.json()["name"] == "Test Cluster Node A (Updated)"
        assert res_update.json()["host"] == "test-a-new.tririga.internal"
        assert res_update.json()["cluster_name"] == "QA Clustered Pair"

        # Verify password wasn't wiped out when omitted
        with db_read_session() as conn:
            cur = conn.cursor()
            cur.execute("SELECT password FROM servers WHERE id=?", (server_id,))
            row = cur.fetchone()
            assert row["password"] == "SecretPassword123"

        # 3. Test cluster parity returns the QA cluster
        res_parity = client.get("/api/operations/cluster-parity")
        assert res_parity.status_code == 200
        parity_data = res_parity.json()
        cluster_names = [c["name"] for c in parity_data.get("clusters", [])]
        assert "QA Clustered Pair" in cluster_names

    finally:
        # Clean up test server
        client.delete(f"/api/servers/{server_id}")


def test_server_config_service_and_endpoints():
    from backend.app.services.server_config_service import ServerConfigService
    from backend.main import app

    # 1. Test parsing sample machineMain HTML
    sample_machine_html = """
    <table>
        <tr><td class="adminhdr">Server Summary</td></tr>
        <tr><td>Operating System</td><td>Linux amd64</td></tr>
        <tr><td>Number of CPUs available</td><td>8</td></tr>
        <tr><td>Base Application Server</td><td>Liberty</td></tr>
        <tr><td>Users</td><td>42 users online</td></tr>
        <tr><td>Java Process ID on Host OS</td><td>123456</td></tr>
        <tr><td>Java Version</td><td>IBM Corporation 17.0.11</td></tr>
        <tr><td>Used Memory:</td><td>4096 MB</td></tr>
        <tr><td>Free Memory:</td><td>4096 MB</td></tr>
        <tr><td>Total Memory</td><td>8192 MB</td></tr>
        <tr><td>Max Memory</td><td>8192 MB</td></tr>
        <tr><td>Free Disk Space</td><td>50000 MB</td></tr>
        <tr><td>Free Temp Space</td><td>25000 MB</td></tr>
        <tr><td>TRIRIGA Build Number</td><td>403913 Database Build Number 403913</td></tr>
        <tr><td>TRIRIGA Platform Release</td><td>5.0.7</td></tr>
        <tr><td>Database Connection:</td><td>jdbc:db2://10.165.1.1:50005/tridb</td></tr>
        <tr><td>Record Runtime UX Enhancement:</td><td>ON</td></tr>
        <tr><td>Geography/Organization Security Model:</td><td>OFF</td></tr>
    </table>
    <input name="USER_SESSION_TIMEOUT" value="45"/>
    <a href="viewProperties.jsp?name=TRIRIGADB">View</a>
    <a href="serverXml.jsp">View</a>
    """
    mach_data = ServerConfigService.parse_machine_main(sample_machine_html)
    assert mach_data["os"] == "Linux amd64"
    assert mach_data["cpu_count"] == 8
    assert mach_data["app_server"] == "Liberty"
    assert mach_data["users_online"] == 42
    assert mach_data["java_pid"] == 123456
    assert mach_data["jvm_memory"]["used_mb"] == 4096
    assert mach_data["jvm_memory"]["total_mb"] == 8192
    assert mach_data["jvm_memory"]["max_mb"] == 8192
    assert mach_data["jvm_memory"]["used_pct"] == 50.0
    assert mach_data["platform_release"] == "5.0.7"
    assert mach_data["tririga_build"] == "403913"
    assert mach_data["db_connection"] == "jdbc:db2://10.165.1.1:50005/tridb"
    assert mach_data["session_timeout_min"] == 45
    assert mach_data["record_runtime_ux"] == "ON"
    assert "TRIRIGADB" in mach_data["property_files"]

    # 2. Test parsing sample performanceMain HTML
    sample_perf_html = """
    <table>
        <tr><td>Java use of CPU (%)</td><td>3.5 %</td></tr>
        <tr><td>Java Memory (Used/Free/Total):</td><td>3000 MB / 5192 MB / 8192 MB</td></tr>
        <tr><td>Active Database Connections:</td><td>14</td></tr>
        <tr><td>Workflow Events Queue Count:</td><td>3</td></tr>
        <tr><td>Workflow Events Throughput per 1 minutes:</td><td>25</td></tr>
        <tr><td>Total Workflows Started:</td><td>1000</td></tr>
        <tr><td>Total Workflows Completed:</td><td>998</td></tr>
        <tr><td>Total Workflow Steps Processed:</td><td>15000</td></tr>
        <tr><td>Total Workflows Failed:</td><td>2</td></tr>
        <tr><td>Logged In User Count:</td><td>42</td></tr>
        <tr><td>Cache Info (Hits/Object Count/Misses/Ratio):</td><td>10000 / 500 / 100 / 99%</td></tr>
    </table>
    """
    perf_data = ServerConfigService.parse_performance_main(sample_perf_html)
    assert perf_data["cpu_pct"] == 3.5
    assert perf_data["jvm_memory"]["used_mb"] == 3000
    assert perf_data["jvm_memory"]["total_mb"] == 8192
    assert perf_data["active_db_connections"] == 14
    assert perf_data["wf_queue_count"] == 3
    assert perf_data["wf_throughput_1min"] == 25
    assert perf_data["wf_started"] == 1000
    assert perf_data["wf_completed"] == 998
    assert perf_data["wf_failed"] == 2
    assert perf_data["logged_in_users"] == 42
    assert perf_data["cache"]["hits"] == 10000

    # 3. Test API route registration with authenticated client
    client = get_auth_client(app)
    res_compare = client.get("/api/server-config/compare")
    assert res_compare.status_code == 200
    comp_json = res_compare.json()
    assert "cluster_kpis" in comp_json
    assert "servers" in comp_json
    assert "drift_items" in comp_json

    # Ensure no false positive DB target drift for production HA cluster
    prod_db_drifts = [d for d in comp_json.get("drift_items", []) if "DB Connection Target" in d.get("parameter", "")]
    assert len(prod_db_drifts) == 0

    # 4. Test Clustered Property File endpoint (side-by-side)
    res_prop = client.get("/api/server-config/cluster-property-file?property_name=TRIRIGADB")
    assert res_prop.status_code == 200
    prop_json = res_prop.json()
    assert prop_json["success"] is True
    assert "servers" in prop_json
    assert len(prop_json["servers"]) > 0
    assert "properties" in prop_json
    assert len(prop_json["properties"]) > 0
    # Check that properties contain side-by-side values dictionary
    first_prop = prop_json["properties"][0]
    assert "key" in first_prop
    assert "values" in first_prop
    assert "has_diff" in first_prop



def test_preprod_not_in_production_cluster_drift():
    # Construct mock server comparison data with prod app1, prod app2, and opw-preprod
    online_servers = [
        {
            "server_id": 106,
            "server_name": "prod app1",
            "cluster_name": "Production Cluster",
            "is_online": True,
            "machine": {
                "db_connection": "jdbc:db2://10.164.252.7:50005/tridb",
                "platform_release": "5.0.7",
                "tririga_build": "403913",
                "java_version": "IBM Corporation 17.0.11",
                "jvm_memory": {"max_mb": 8192, "used_mb": 4096, "total_mb": 8192},
                "session_timeout_min": 30,
                "record_runtime_ux": "OFF",
                "geo_org_security": "OFF",
                "date_general_processing": False
            },
            "performance": {"logged_in_users": 10, "cpu_pct": 5.0}
        },
        {
            "server_id": 107,
            "server_name": "prod app2",
            "cluster_name": "Production Cluster",
            "is_online": True,
            "machine": {
                "db_connection": "jdbc:db2://10.164.252.7:50005/tridb",
                "platform_release": "5.0.7",
                "tririga_build": "403913",
                "java_version": "IBM Corporation 17.0.11",
                "jvm_memory": {"max_mb": 8192, "used_mb": 4096, "total_mb": 8192},
                "session_timeout_min": 30,
                "record_runtime_ux": "OFF",
                "geo_org_security": "OFF",
                "date_general_processing": False
            },
            "performance": {"logged_in_users": 12, "cpu_pct": 6.0}
        },
        {
            "server_id": 104,
            "server_name": "opw-preprod",
            "cluster_name": "",  # standalone / unclustered
            "is_online": True,
            "machine": {
                "db_connection": "jdbc:db2://10.164.252.2:50005/tridb",
                "platform_release": "5.0.7",
                "tririga_build": "403913",
                "java_version": "IBM Corporation 17.0.11",
                "jvm_memory": {"max_mb": 4096, "used_mb": 2048, "total_mb": 4096},
                "session_timeout_min": 30,
                "record_runtime_ux": "OFF",
                "geo_org_security": "OFF",
                "date_general_processing": False
            },
            "performance": {"logged_in_users": 2, "cpu_pct": 2.0}
        }
    ]

    # Group online nodes by cluster assignment
    clusters_map = {}
    for s in online_servers:
        cname = (s.get("cluster_name") or "").strip()
        if not cname:
            sname = (s.get("server_name") or "").lower().strip()
            if sname in ("prod app1", "prod app2"):
                cname = "Production Cluster"
        if cname and cname.lower() != "standalone (unclustered)":
            clusters_map.setdefault(cname, []).append(s)

    assert "Production Cluster" in clusters_map
    prod_cluster_names = [s["server_name"] for s in clusters_map["Production Cluster"]]
    assert "prod app1" in prod_cluster_names
    assert "prod app2" in prod_cluster_names
    assert "opw-preprod" not in prod_cluster_names

    # Ensure identical DB targets for Production Cluster
    c_dbs = {s["server_name"]: s["machine"].get("db_connection") for s in clusters_map["Production Cluster"]}
    assert len(set(c_dbs.values())) == 1


def test_master_password_auth():
    from fastapi.testclient import TestClient
    from backend.main import app
    client = TestClient(app)

    # 1. Unauthenticated request to protected endpoint fails with 401
    res = client.get("/api/servers")
    assert res.status_code == 401
    assert "Authentication required" in res.json().get("detail", "")

    # 2. Status endpoint returns is_enabled=True, authenticated=False when no token provided
    status_res = client.get("/api/auth/status")
    assert status_res.status_code == 200
    assert status_res.json()["is_enabled"] is True
    assert status_res.json()["authenticated"] is False

    # 3. Invalid password fails with 401
    bad_login = client.post("/api/auth/login", json={"password": "wrongpassword"})
    assert bad_login.status_code == 401
    assert "Invalid master password" in bad_login.json().get("detail", "")

    # 4. Valid login with admin2026! succeeds and returns token
    good_login = client.post("/api/auth/login", json={"password": "admin2026!"})
    assert good_login.status_code == 200
    token = good_login.json().get("token")
    assert token is not None and len(token) > 10

    # 5. Authenticated request succeeds
    auth_res = client.get("/api/servers", headers={"Authorization": f"Bearer {token}"})
    assert auth_res.status_code == 200

    # 6. Status endpoint with token returns authenticated=True
    auth_status = client.get("/api/auth/status", headers={"Authorization": f"Bearer {token}"})
    assert auth_status.status_code == 200
    assert auth_status.json()["authenticated"] is True

    # 7. Logout revokes token
    logout_res = client.post("/api/auth/logout", headers={"Authorization": f"Bearer {token}"})
    assert logout_res.status_code == 200

    # 8. Subsequent request with revoked token fails with 401
    revoked_res = client.get("/api/servers", headers={"Authorization": f"Bearer {token}"})
    assert revoked_res.status_code == 401


@pytest.mark.anyio
async def test_automated_ingestion_schedule_service():
    from backend.app.services.log_scheduler import LogSchedulerService
    from backend.main import app

    # 1. Test direct service schedule retrieval
    sched = LogSchedulerService.get_schedule()
    assert "is_enabled" in sched
    assert "interval_minutes" in sched
    assert sched["interval_minutes"] == 15 or sched["interval_minutes"] > 0

    # 2. Test updating schedule to 15m enabled
    updated = LogSchedulerService.update_schedule(is_enabled=True, interval_minutes=15)
    assert updated["is_enabled"] is True
    assert updated["interval_minutes"] == 15
    assert updated["next_run_at"] is not None

    # 3. Test API endpoint GET /api/collector/schedule
    client = get_auth_client(app)
    res = client.get("/api/collector/schedule")
    assert res.status_code == 200
    res_data = res.json()
    assert res_data["is_enabled"] is True
    assert res_data["interval_minutes"] == 15
    assert "next_run_at" in res_data
    assert "is_running" in res_data

    # 4. Test API endpoint POST /api/collector/schedule
    update_res = client.post("/api/collector/schedule", json={"is_enabled": True, "interval_minutes": 30})
    assert update_res.status_code == 200
    assert update_res.json()["interval_minutes"] == 30

    # Reset back to 15 minutes default
    reset_res = client.post("/api/collector/schedule", json={"is_enabled": True, "interval_minutes": 15})
    assert reset_res.status_code == 200
    assert reset_res.json()["interval_minutes"] == 15

    # 5. Test API endpoint POST /api/collector/schedule/run-now
    run_now_res = client.post("/api/collector/schedule/run-now")
    assert run_now_res.status_code == 200
    run_data = run_now_res.json()
    assert "result" in run_data
    assert "schedule" in run_data
    assert run_data["schedule"]["interval_minutes"] == 15

def test_near_concurrency_log_search():
    from backend.main import app
    from backend.app.db.database import db_session

    client = get_auth_client(app)

    # Ingest test log entries with specific timestamps on server 1
    with db_session() as conn:
        cur = conn.cursor()
        cur.execute("INSERT OR IGNORE INTO servers (id, name, host, port, protocol) VALUES (1, 'prod app1', 'localhost', 8001, 'http');")
        cur.execute("INSERT OR IGNORE INTO servers (id, name, host, port, protocol) VALUES (2, 'prod app2', 'localhost', 8002, 'http');")
        cur.execute("INSERT OR IGNORE INTO log_files (id, server_id, filename, file_type, local_path) VALUES (10, 1, 'server.log', 'server', 'dummy');")
        cur.execute("INSERT OR IGNORE INTO log_files (id, server_id, filename, file_type, local_path) VALUES (20, 2, 'server.log', 'server', 'dummy');")

        # Server 1: GIS event at 12:00:00, rollback at 12:00:03 (delta +3s)
        cur.execute("""
            INSERT OR REPLACE INTO log_entries (id, server_id, file_id, timestamp, log_level, logger_name, thread_name, message)
            VALUES (90001, 1, 10, '2026-09-21T12:00:00.000Z', 'ERROR', 'com.tririga.gis.Connector', 'Thread-1', 'GIS MapServer connection timeout for layer Buildings');
        """)
        cur.execute("""
            INSERT OR REPLACE INTO log_entries (id, server_id, file_id, timestamp, log_level, logger_name, thread_name, message)
            VALUES (90002, 1, 10, '2026-09-21T12:00:03.000Z', 'WARN', 'com.tririga.platform.Tx', 'Thread-2', 'Transaction rolled back by TriWorkTaskAgent due to failed sync');
        """)

    # 1. Test Near-concurrency query matching GIS near rolled back
    res = client.get('/api/logs?search="GIS" NEAR "rolled back"&server_id=1')
    assert res.status_code == 200
    data = res.json()
    assert data["total"] >= 1
    found_item = next((item for item in data["items"] if item["id"] == 90001), None)
    assert found_item is not None
    assert found_item["correlated_id"] == 90002
    assert abs(found_item["delta_seconds"] - 3.0) < 0.5
    assert "rolled back" in found_item["correlated_message"]

    # 2. Test explicit window syntax: NEAR/5s
    res_5s = client.get('/api/logs?search="GIS" NEAR/5s "rolled back"&server_id=1')
    assert res_5s.status_code == 200
    assert any(item["id"] == 90001 for item in res_5s.json()["items"])

    # 3. Test explicit window syntax that is too short: NEAR/1s (delta is 3s, so should NOT match)
    res_1s = client.get('/api/logs?search="GIS" NEAR/1s "rolled back"&server_id=1')
    assert res_1s.status_code == 200
    assert not any(item["id"] == 90001 for item in res_1s.json()["items"])

    # 4. Test Log Context endpoint GET /api/logs/90001/context
    ctx_res = client.get('/api/logs/90001/context?window_seconds=10')
    assert ctx_res.status_code == 200
    ctx_data = ctx_res.json()
    assert ctx_data["anchor"]["id"] == 90001
    assert any(s["id"] == 90002 for s in ctx_data["surrounding"])





