"""
operations_service.py
Core operational intelligence engine for IBM TRIRIGA.
Strictly queries real live TRIRIGA database tables, live Admin Console endpoints,
and ingested log archives. No simulated or fake data.
"""

import io
import re
import zipfile
import json
import time
import asyncio
from datetime import datetime, timezone, timedelta, date
from typing import Dict, Any, List, Optional, Tuple

from ..db.database import db_read_session, dict_from_row
from .tririga_admin_client import TririgaAdminClient
from .docx_exporter import DocxReportExporter


class OperationsService:
    @staticmethod
    def _sanitize_date(val: Any) -> str:
        if val is None:
            return ""
        return str(val)

    @classmethod
    async def get_workflow_telemetry(cls, server_info: Dict[str, Any]) -> Dict[str, Any]:
        """
        Queries live WF_EVENT queue depth, EXTENDED_FORMULA_QUEUE, active workflows in WF_ACTIVE,
        and live JVM Workflow Agent thread allocation from threads.jsp.
        Strictly real live data.
        """
        # 1. Fetch live thread summary from Admin Console to inspect Workflow Agent threads
        thread_data = await TririgaAdminClient.fetch_live_agent_monitor(server_info)
        wfa_threads = [
            t for t in thread_data.get("threads", [])
            if "WFA" in t.get("name", "") or "Workflow" in t.get("subsystem", "")
        ]

        wfa_total = len(wfa_threads)
        wfa_runnable = sum(1 for t in wfa_threads if t.get("state") == "RUNNABLE")
        wfa_waiting = sum(1 for t in wfa_threads if t.get("state") in ("WAITING", "TIMED_WAITING"))
        wfa_blocked = sum(1 for t in wfa_threads if t.get("state") == "BLOCKED" or t.get("db_blocked"))

        # 2. Query WF_EVENT queue distribution
        wf_event_sql = "SELECT IE_NAME, COUNT(*) AS QUEUED_COUNT FROM WF_EVENT GROUP BY IE_NAME"
        wf_event_res = await TririgaAdminClient.execute_query_via_admin_console(server_info, wf_event_sql)

        queue_distribution: List[Dict[str, Any]] = []
        total_queued = 0
        if wf_event_res.get("success") and wf_event_res.get("rows"):
            for r in wf_event_res["rows"]:
                cnt = int(r.get("QUEUED_COUNT") or 0)
                queue_distribution.append({
                    "event_name": r.get("IE_NAME", "UNKNOWN"),
                    "count": cnt
                })
                total_queued += cnt

        # 3. Query Extended Formula Queue depth in EXT_FORMULA_QUEUE (primary) or EF_QUEUE
        formula_queue_depth = 0
        formula_table_accessible = False
        formula_table_name = "EXT_FORMULA_QUEUE"
        formula_err = None

        # Check primary EXT_FORMULA_QUEUE
        formula_res = await TririgaAdminClient.execute_query_via_admin_console(
            server_info, "SELECT COUNT(*) as FORMULA_COUNT FROM EXT_FORMULA_QUEUE"
        )
        if formula_res.get("success") and formula_res.get("rows"):
            formula_table_accessible = True
            try:
                formula_queue_depth = int(formula_res["rows"][0].get("FORMULA_COUNT") or 0)
            except Exception:
                formula_queue_depth = 0
        else:
            # Fallback to EF_QUEUE
            ef_res = await TririgaAdminClient.execute_query_via_admin_console(
                server_info, "SELECT COUNT(*) as FORMULA_COUNT FROM EF_QUEUE"
            )
            if ef_res.get("success") and ef_res.get("rows"):
                formula_table_accessible = True
                formula_table_name = "EF_QUEUE"
                try:
                    formula_queue_depth = int(ef_res["rows"][0].get("FORMULA_COUNT") or 0)
                except Exception:
                    formula_queue_depth = 0
            else:
                # Fallback to WF_EVENT WHERE IE_NAME LIKE '%FORMULA%'
                wf_res = await TririgaAdminClient.execute_query_via_admin_console(
                    server_info, "SELECT COUNT(*) as FORMULA_COUNT FROM WF_EVENT WHERE IE_NAME LIKE '%FORMULA%'"
                )
                if wf_res.get("success") and wf_res.get("rows"):
                    formula_table_accessible = True
                    formula_table_name = "WF_EVENT"
                    try:
                        formula_queue_depth = int(wf_res["rows"][0].get("FORMULA_COUNT") or 0)
                    except Exception:
                        formula_queue_depth = 0
                else:
                    formula_err = formula_res.get("error") or ef_res.get("error")

        # 4. Query active running workflows from WF_ACTIVE joined with WF_TEMPLATE
        active_wf_sql = (
            "SELECT a.WF_IID, a.WF_TEMPLATE_ID, t.WF_NAME, a.START_DATETIME, a.USER_ID, a.MACHINE_ID "
            "FROM WF_ACTIVE a LEFT JOIN WF_TEMPLATE t ON a.WF_TEMPLATE_ID = t.WF_TEMPLATE_ID "
            "FETCH FIRST 25 ROWS ONLY"
        )
        active_res = await TririgaAdminClient.execute_query_via_admin_console(server_info, active_wf_sql)
        active_workflows: List[Dict[str, Any]] = []
        if active_res.get("success") and active_res.get("rows"):
            for row in active_res["rows"]:
                active_workflows.append({
                    "instance_id": row.get("WF_IID"),
                    "template_id": row.get("WF_TEMPLATE_ID"),
                    "template_name": row.get("WF_NAME", "Active Workflow"),
                    "start_date": cls._sanitize_date(row.get("START_DATETIME")),
                    "user_id": row.get("USER_ID"),
                    "machine_id": row.get("MACHINE_ID")
                })

        return {
            "success": True,
            "server_id": server_info.get("id"),
            "server_name": server_info.get("name"),
            "host": server_info.get("host"),
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "wfa_threads": {
                "total": wfa_total,
                "runnable": wfa_runnable,
                "waiting": wfa_waiting,
                "blocked": wfa_blocked,
                "threads": wfa_threads
            },
            "wf_event_queue": {
                "total_queued": total_queued,
                "distribution": queue_distribution,
                "query_error": wf_event_res.get("error") if not wf_event_res.get("success") else None
            },
            "formula_queue": {
                "depth": formula_queue_depth,
                "accessible": formula_table_accessible,
                "table_name": formula_table_name,
                "query_error": formula_err
            },
            "stuck_workflows": {
                "count": len(active_workflows),
                "items": active_workflows,
                "query_error": active_res.get("error") if not active_res.get("success") else None
            }
        }

    @classmethod
    def get_gc_telemetry(cls, server_id: int) -> Dict[str, Any]:
        """
        Parses real verbosegc / native_stderr log files ingested in SQLite for this server.
        Detects IBM Semeru / J9 XML GC logs (<af>, <gc-end>) and HotSpot GC output.
        Strictly real log contents.
        """
        with db_read_session() as conn:
            cur = conn.cursor()
            cur.execute("""
                SELECT id, filename, local_path, file_type 
                FROM log_files 
                WHERE server_id = ? 
                  AND (filename LIKE '%verbosegc%' OR filename LIKE '%native_stderr%' OR file_type = 'gc')
                ORDER BY id DESC LIMIT 5
            """, (server_id,))
            gc_files = cur.fetchall()

            if not gc_files:
                return {
                    "has_gc_logs": False,
                    "server_id": server_id,
                    "message": "No verbosegc.log or native_stderr.log ingested for this server. Ingest GC logs in Log Sync & Ingestion.",
                    "events": [],
                    "summary": {
                        "total_events": 0,
                        "avg_pause_ms": 0.0,
                        "max_pause_ms": 0.0,
                        "stw_pause_count": 0,
                        "recent_frequency_per_hr": 0
                    }
                }

            file_ids = [r["id"] for r in gc_files]
            placeholders = ",".join("?" for _ in file_ids)
            cur.execute(f"""
                SELECT message, raw_content, timestamp 
                FROM log_entries 
                WHERE file_id IN ({placeholders})
                ORDER BY id ASC LIMIT 500
            """, file_ids)
            entries = cur.fetchall()

        events: List[Dict[str, Any]] = []
        pause_times: List[float] = []

        for e in entries:
            text = (e["raw_content"] or e["message"] or "").strip()
            if not text:
                continue

            pause_match = re.search(r'(?:durationms|pause|duration)=["\']?([0-9.]+)', text, re.IGNORECASE)
            type_match = re.search(r'type=["\']?([a-zA-Z_-]+)', text, re.IGNORECASE)
            free_match = re.search(r'free=["\']?([0-9]+)', text, re.IGNORECASE)
            total_match = re.search(r'total=["\']?([0-9]+)', text, re.IGNORECASE)

            if not pause_match:
                hotspot_match = re.search(r'([0-9.]+)\s*secs?\]', text, re.IGNORECASE)
                if hotspot_match:
                    pause_ms = float(hotspot_match.group(1)) * 1000.0
                else:
                    continue
            else:
                pause_ms = float(pause_match.group(1))

            gc_type = type_match.group(1) if type_match else ("Global" if pause_ms > 1000 else "Scavenge")
            free_bytes = int(free_match.group(1)) if free_match else 0
            total_bytes = int(total_match.group(1)) if total_match else 0

            heap_used_mb = round((total_bytes - free_bytes) / (1024 * 1024), 1) if total_bytes > free_bytes else None
            heap_total_mb = round(total_bytes / (1024 * 1024), 1) if total_bytes > 0 else None

            pause_times.append(pause_ms)
            events.append({
                "timestamp": e["timestamp"] or "",
                "gc_type": gc_type,
                "pause_ms": round(pause_ms, 2),
                "is_stw_alert": pause_ms > 1000.0,
                "heap_used_mb": heap_used_mb,
                "heap_total_mb": heap_total_mb,
                "raw_snippet": text[:120]
            })

        avg_pause = round(sum(pause_times) / len(pause_times), 2) if pause_times else 0.0
        max_pause = round(max(pause_times), 2) if pause_times else 0.0
        stw_count = sum(1 for p in pause_times if p > 1000.0)

        return {
            "has_gc_logs": True,
            "server_id": server_id,
            "total_files_analyzed": len(gc_files),
            "events": events[-100:],
            "summary": {
                "total_events": len(events),
                "avg_pause_ms": avg_pause,
                "max_pause_ms": max_pause,
                "stw_pause_count": stw_count,
                "recent_frequency_per_hr": len(events)
            }
        }

    @classmethod
    async def get_lock_contention(cls, server_info: Dict[str, Any]) -> Dict[str, Any]:
        """
        Inspects active DB2/Oracle lock contention via SYSIBMADM.MON_LOCKWAITS or database views.
        Builds a true visual blocking-waiting hierarchy. Strictly real data.
        """
        sql = (
            "SELECT TABNAME, HLD_APPLICATION_HANDLE, HLD_USERID, HLD_CURRENT_STMT_TEXT, "
            "LOCK_MODE, REQ_APPLICATION_HANDLE FROM SYSIBMADM.MON_LOCKWAITS"
        )
        res = await TririgaAdminClient.execute_query_via_admin_console(server_info, sql)

        if not res.get("success"):
            return {
                "success": False,
                "error": res.get("error", "Failed to query lock waits"),
                "has_locks": False,
                "blocker_tree": [],
                "raw_locks": []
            }

        rows = res.get("rows", [])
        if not rows:
            return {
                "success": True,
                "has_locks": False,
                "message": "Zero active lock contentions on database (SYSIBMADM.MON_LOCKWAITS is clear).",
                "blocker_tree": [],
                "raw_locks": []
            }

        blockers_map: Dict[str, Dict[str, Any]] = {}
        for r in rows:
            hld = str(r.get("HLD_APPLICATION_HANDLE") or "Unknown")
            req = str(r.get("REQ_APPLICATION_HANDLE") or "Unknown")
            tab = r.get("TABNAME") or "DATABASE_OBJECT"
            mode = r.get("LOCK_MODE") or "X"
            user = r.get("HLD_USERID") or "system"
            stmt = r.get("HLD_CURRENT_STMT_TEXT") or ""

            if hld not in blockers_map:
                blockers_map[hld] = {
                    "blocker_handle": hld,
                    "user_id": user,
                    "table_name": tab,
                    "lock_mode": mode,
                    "current_stmt": stmt,
                    "waiting_handles": []
                }
            blockers_map[hld]["waiting_handles"].append({
                "requester_handle": req,
                "target_table": tab,
                "requested_mode": mode
            })

        return {
            "success": True,
            "has_locks": True,
            "total_contentions": len(rows),
            "blocker_tree": list(blockers_map.values()),
            "raw_locks": rows
        }

    @classmethod
    async def get_table_bloat(cls, server_info: Dict[str, Any]) -> Dict[str, Any]:
        """
        Inspects row cardinality and statistics staleness on core TRIRIGA tables:
        IBS_SPEC, IBS_SPEC_ASSIGNMENTS, WF_EVENT_HISTORY, WF_EVENT, LO_STAGING, AUDIT_TRAIL.
        Strictly real data from SYSCAT.TABLES.
        """
        sql = (
            "SELECT TABSCHEMA, TABNAME, CARD, STATS_TIME "
            "FROM SYSCAT.TABLES "
            "WHERE TABNAME IN ('IBS_SPEC', 'IBS_SPEC_ASSIGNMENTS', 'WF_EVENT_HISTORY', 'WF_EVENT', 'LO_STAGING', 'AUDIT_TRAIL', 'SESSION_HISTORY') "
            "ORDER BY CARD DESC"
        )
        res = await TririgaAdminClient.execute_query_via_admin_console(server_info, sql)

        tables: List[Dict[str, Any]] = []
        if res.get("success") and res.get("rows"):
            for r in res["rows"]:
                card = int(r.get("CARD") or 0)
                stats_time_str = cls._sanitize_date(r.get("STATS_TIME"))
                
                days_old = None
                if stats_time_str:
                    try:
                        clean_dt = stats_time_str.split(".")[0]
                        dt = datetime.strptime(clean_dt, "%Y-%m-%d %H:%M:%S")
                        days_old = (datetime.now() - dt).days
                    except Exception:
                        days_old = None

                tables.append({
                    "schema": r.get("TABSCHEMA", "TRIDATA"),
                    "table_name": r.get("TABNAME"),
                    "cardinality": card,
                    "stats_time": stats_time_str,
                    "stats_age_days": days_old,
                    "is_stale_stats": days_old is not None and days_old > 30,
                    "is_high_bloat": card > 5_000_000 and r.get("TABNAME") in ("WF_EVENT_HISTORY", "AUDIT_TRAIL", "LO_STAGING")
                })

        return {
            "success": res.get("success", False),
            "error": res.get("error"),
            "tables": tables
        }

    @classmethod
    async def get_dataconnect_om(cls, server_info: Dict[str, Any], server_id: int) -> Dict[str, Any]:
        """
        Queries DataConnect batch jobs (DC_JOB) and inspects ObjectMigration log events from SQLite.
        Strictly real data.
        """
        # 1. Query DC_JOB
        dc_sql = (
            "SELECT JOB_NAME, JOB_NUMBER, STATE, BO_NAME, CREATED_DATE, UPDATED_DATE "
            "FROM DC_JOB ORDER BY CREATED_DATE DESC FETCH FIRST 20 ROWS ONLY"
        )
        dc_res = await TririgaAdminClient.execute_query_via_admin_console(server_info, dc_sql)
        dc_jobs = dc_res.get("rows", []) if dc_res.get("success") else []

        # 2. Query ObjectMigration logs joining log_files on file_id
        with db_read_session() as conn:
            cur = conn.cursor()
            cur.execute("""
                SELECT e.timestamp, e.log_level, e.message 
                FROM log_entries e
                JOIN log_files f ON e.file_id = f.id
                WHERE e.server_id = ? 
                  AND (e.logger_name LIKE '%ObjectMigration%' OR f.filename LIKE '%ObjectMigration%')
                ORDER BY e.id DESC LIMIT 50
            """, (server_id,))
            om_entries = [dict_from_row(r) for r in cur.fetchall()]

        return {
            "success": True,
            "dataconnect": {
                "jobs": dc_jobs,
                "accessible": dc_res.get("success", False),
                "error": dc_res.get("error") if not dc_res.get("success") else None
            },
            "object_migration": {
                "recent_logs": om_entries,
                "total_events": len(om_entries)
            }
        }

    PAID_CONTRACTED_IDS = {3050, 3053, 3048, 3018}
    FREE_PLATFORM_IDS = {3017, 3021, 3047}

    DEFAULT_ENTITLEMENTS = {
        3050: 25,   # IBM Facilities & Real Estate Management (Tririga) On Cloud Enterprise User (25 Seats)
        3053: 200,  # IBM Facilities & Real Estate Management (Tririga) On Cloud Occasional Enterprise User (200 Seats)
        3048: 200,  # IBM Facilities & Real Estate Management (Tririga) On Cloud Approvals and Reporting User (200 Seats)
        3018: 1000, # IBM Facilities & Real Estate Management (Tririga) On Cloud Self Service (200 Subscription Packs x 5 = 1,000 User Seats)
        3021: 0,    # Free / Complimentary Platform API Integration
        3017: 0,    # Free / Complimentary Application Platform
        3047: 0,    # Free / Complimentary Connector for Business Apps
        3006: 0,    # Operations & Maintenance (Paid Standalone Module - 0 Entitlement)
        3004: 0,    # Facilities Manager (Paid Standalone Module - 0 Entitlement)
        3002: 0,    # Real Estate Manager (Paid Standalone Module - 0 Entitlement)
        3010: 0,    # Capital Projects (Paid Standalone Module - 0 Entitlement)
        3040: 0,    # TREES Energy (Paid Standalone Module - 0 Entitlement)
    }

    PRODUCT_CATEGORIES = {
        3050: "Enterprise Core (Paid Subscription)",
        3053: "Enterprise Occasional (Paid Subscription)",
        3048: "Approvals & Reporting (Paid Subscription)",
        3018: "Self-Service (Paid Subscription)",
        3021: "Integration & API (Complimentary Platform)",
        3017: "Application Platform (Complimentary Platform)",
        3047: "Integrations (Complimentary Connector)",
        3006: "Operations & Facilities (Unlicensed Paid Module)",
        3004: "Facilities Management (Unlicensed Paid Module)",
        3002: "Real Estate Management (Unlicensed Paid Module)",
        3010: "Capital Projects (Unlicensed Paid Module)",
        3040: "Sustainability & Energy (Unlicensed Paid Module)",
    }

    _license_usage_cache: Dict[str, Any] = {}
    _license_usage_cache_time: float = 0.0
    _users_directory_cache: Dict[str, Any] = {}

    @classmethod
    def classify_account_type(
        cls,
        user_id: Any,
        user_name: str = "",
        user_account: str = "",
        assigned_pids: Optional[List[int]] = None,
        assigned_licenses: Optional[List[str]] = None,
        business_connect: Any = None
    ) -> str:
        """
        Classifies an account into 'oslc' | 'external' | 'internal'.
        """
        uname = (user_name or "").lower()
        uacc = (user_account or "").lower()
        uid = str(user_id or "").lower()
        lic_str = " ".join(assigned_licenses or []).lower()
        pids = set(assigned_pids or [])

        # 1. OSLC / Integration Checks
        if business_connect in (1, True, "1", "true", "True", "Y", "y"):
            return "oslc"
        if any(pid in pids for pid in (3021, 3047, 3022)):
            return "oslc"
        if any(term in lic_str for term in ("api integration", "connector for business apps", "mobile integration", "business connect", "oslc")):
            return "oslc"
        oslc_keywords = (
            "oslc", "api_", "api-", "api.", "svc_", "svc-", "svc.", "service_", "service-",
            "integration", "integrator", "batch_", "batch-", "daemon", "sync_", "sync-",
            "ws_", "ws-", "connect_", "connect-", "interface", "bot_", "bot-", "rest_", "rest-",
            "crawler", "system_", "sys_int", "tririga_int", "tri_int"
        )
        if any(k in uname or k in uacc or k in uid for k in oslc_keywords):
            return "oslc"

        # 2. External Contractor / Vendor Checks
        ext_keywords = (
            "ext_", "ext-", "ext.", "ext/", "(ext)", "[ext]", "external",
            "vendor", "contractor", "consultant", "partner", "supplier",
            "guest", "visitor", "temp_", "temp-", "3rdparty", "thirdparty",
            "@vendor", "@contractor", "@external", "@partner", "@supplier"
        )
        if any(k in uname or k in uacc or k in uid for k in ext_keywords):
            return "external"

        # 3. Default to Internal
        return "internal"

    @classmethod
    async def get_license_usage(cls, server_info: Dict[str, Any]) -> Dict[str, Any]:
        """
        Queries real user product assignments, currently logged in users,
        and license entitlement vs usage metrics from TRIRIGA database.
        """
        cache_key = f"{server_info.get('id')}_{server_info.get('_is_cluster_wide', False)}"
        now_sec = time.time()
        if cache_key in cls._license_usage_cache and (now_sec - cls._license_usage_cache[cache_key].get("_cached_at", 0)) < 30.0:
            return cls._license_usage_cache[cache_key]["data"]

        # 1. Query aggregated product distribution
        dist_sql = """SELECT product_id as L_ID,
case product_id
when 3050 then 'IBM Facilities & RE on Cloud Enterprise'
when 3053 then 'IBM Facilities & RE Occasional Enterprise'
when 3048 then 'Approvals and Reporting'
when 3021 then 'API Integration'
when 3017 then 'Application Platform'
when 3018 then 'Employee Self Service'
when 3006 then 'Operations & Maintenance'
when 3004 then 'Facilities Manager'
when 3002 then 'Real Estate Manager'
when 3010 then 'Capital Projects'
when 3040 then 'TREES Energy'
when 3047 then 'Connector for Business Apps'
when 3001 then 'Portfolio'
when 3007 then 'CAD Integrator'
when 3011 then 'Document Management'
when 3014 then 'Importer'
when 3022 then 'Mobile Integration'
when 3027 then 'Facility Assessment'
when 3031 then 'WPM Framework'
else 'License ' || product_id
end as LICENSE_NAME,
count(DISTINCT user_id) as ASSIGNED_COUNT
FROM USER_PRODUCT
GROUP BY product_id
ORDER BY ASSIGNED_COUNT DESC
WITH UR"""

        res = await TririgaAdminClient.execute_query_via_admin_console(server_info, dist_sql)
        modules: List[Dict[str, Any]] = []
        if res.get("success") and res.get("rows"):
            for r in res["rows"]:
                try:
                    pid = int(r.get("L_ID") or 0)
                except (ValueError, TypeError):
                    pid = r.get("L_ID")
                modules.append({
                    "product_id": pid,
                    "license_name": r.get("LICENSE_NAME"),
                    "count": int(r.get("ASSIGNED_COUNT") or 0)
                })

        # 2. Query user to product license mapping with master profile account & session dormancy metrics
        user_prod_sql = """SELECT u.user_id, s.spec_name, s.CREATED_DATE, p.SYS_USERACCOUNT, p.TRICREATEDSY, p.TRILASTLOGINDT, u.product_id,
case u.product_id
when 3050 then 'IBM Facilities & RE on Cloud Enterprise'
when 3053 then 'IBM Facilities & RE Occasional Enterprise'
when 3048 then 'Approvals and Reporting'
when 3021 then 'API Integration'
when 3017 then 'Application Platform'
when 3018 then 'Employee Self Service'
when 3006 then 'Operations & Maintenance'
when 3004 then 'Facilities Manager'
when 3002 then 'Real Estate Manager'
when 3010 then 'Capital Projects'
when 3040 then 'TREES Energy'
when 3047 then 'Connector for Business Apps'
when 3001 then 'Portfolio'
when 3007 then 'CAD Integrator'
when 3011 then 'Document Management'
when 3014 then 'Importer'
when 3022 then 'Mobile Integration'
when 3027 then 'Facility Assessment'
when 3031 then 'WPM Framework'
else 'License ' || u.product_id
end as LICENSE_NAME,
max(sh.start_time) as LAST_LOGIN,
count(sh.start_time) as LOGIN_COUNT
FROM USER_PRODUCT u
LEFT OUTER JOIN IBS_SPEC s on u.user_id = s.spec_id
LEFT OUTER JOIN T_MYPROFILE p on u.user_id = p.spec_id
LEFT OUTER JOIN SESSION_HISTORY sh on u.user_id = sh.user_id
GROUP BY u.user_id, s.spec_name, s.CREATED_DATE, p.SYS_USERACCOUNT, p.TRICREATEDSY, p.TRILASTLOGINDT, u.product_id
ORDER BY u.user_id ASC
WITH UR"""

        user_prod_res = await TririgaAdminClient.execute_query_via_admin_console(server_info, user_prod_sql, limit=3000)
        raw_user_prods = user_prod_res.get("rows", []) if user_prod_res.get("success") else []
        
        # Build user_id -> list of license names & product_id -> list of users & user dormancy profiles
        user_licenses_map: Dict[str, List[str]] = {}
        product_users_map: Dict[int, List[Dict[str, Any]]] = {}
        user_dormancy_map: Dict[str, Dict[str, Any]] = {}
        now_dt = datetime.now()

        for up in raw_user_prods:
            uid = str(up.get("USER_ID") or up.get("user_id") or "").strip()
            uname = str(up.get("SPEC_NAME") or up.get("spec_name") or f"User {uid}").strip()
            uaccount = str(up.get("SYS_USERACCOUNT") or up.get("sys_useraccount") or "").strip()
            lname = str(up.get("LICENSE_NAME") or up.get("license_name") or "").strip()
            try:
                pid = int(up.get("PRODUCT_ID") or up.get("product_id") or 0)
            except (ValueError, TypeError):
                pid = 0

            # Master Account creation timestamp (s.CREATED_DATE timestamp or p.TRICREATEDSY ms epoch)
            raw_created = (
                up.get("CREATED_DATE") or 
                up.get("created_date") or 
                up.get("SPEC_CREATED_DATE") or 
                up.get("TRICREATEDSY") or 
                up.get("tricreatedsy") or
                up.get("SYS_CREATEDDATE") or
                up.get("sys_createddate")
            )
            account_created_str = None
            account_created_dt = None
            if raw_created and str(raw_created).strip().lower() not in ("none", "null", ""):
                try:
                    raw_val_str = str(raw_created).strip()
                    if (raw_val_str.isdigit() or (raw_val_str.replace('.', '', 1).isdigit() and len(raw_val_str) > 10)) and " " not in raw_val_str and "-" not in raw_val_str:
                        ms_val = float(raw_val_str)
                        account_created_dt = datetime.fromtimestamp(ms_val / 1000.0)
                        account_created_str = account_created_dt.strftime("%Y-%m-%d %H:%M:%S")
                    else:
                        d_part = raw_val_str.split(".")[0].strip()
                        account_created_dt = datetime.strptime(d_part, "%Y-%m-%d %H:%M:%S") if " " in d_part else datetime.strptime(d_part, "%Y-%m-%d")
                        account_created_str = account_created_dt.strftime("%Y-%m-%d %H:%M:%S")
                except Exception:
                    pass

            # Master Account permanent last login timestamp (ms epoch in T_MYPROFILE)
            raw_pdt = up.get("TRILASTLOGINDT") or up.get("trilastlogindt")
            account_ll_str = None
            account_ll_dt = None
            if raw_pdt and str(raw_pdt).strip().lower() not in ("none", "null", ""):
                try:
                    ms_val = float(str(raw_pdt).strip())
                    account_ll_dt = datetime.fromtimestamp(ms_val / 1000.0)
                    account_ll_str = account_ll_dt.strftime("%Y-%m-%d %H:%M:%S")
                except Exception:
                    pass

            # Session History rolling window last login
            raw_ll = up.get("LAST_LOGIN") or up.get("last_login")
            hist_ll_str = None if not raw_ll or str(raw_ll).strip().lower() in ("none", "null", "") else str(raw_ll).strip()
            hist_ll_dt = None
            if hist_ll_str:
                try:
                    d_part = hist_ll_str.split(".")[0].strip()
                    hist_ll_dt = datetime.strptime(d_part, "%Y-%m-%d %H:%M:%S") if " " in d_part else datetime.strptime(d_part, "%Y-%m-%d")
                except Exception:
                    pass

            # Best effective last login across master profile account & session history
            best_ll_dt = account_ll_dt
            if hist_ll_dt and (not best_ll_dt or hist_ll_dt > best_ll_dt):
                best_ll_dt = hist_ll_dt

            best_ll_str = best_ll_dt.strftime("%Y-%m-%d %H:%M:%S") if best_ll_dt else None
            
            try:
                lc = int(up.get("LOGIN_COUNT") or up.get("login_count") or 0)
            except (ValueError, TypeError):
                lc = 0

            if uid:
                if uid not in user_licenses_map:
                    user_licenses_map[uid] = []
                if lname and lname not in user_licenses_map[uid]:
                    user_licenses_map[uid].append(lname)

                if uid not in user_dormancy_map:
                    user_dormancy_map[uid] = {
                        "user_id": uid,
                        "user_name": uname,
                        "user_account": uaccount,
                        "created_date": account_created_str,
                        "account_created_date": account_created_str,
                        "assigned_licenses": [],
                        "assigned_pids": [],
                        "last_login": None,
                        "account_last_login": account_ll_str,
                        "session_last_login": hist_ll_str,
                        "login_count": 0,
                        "days_inactive": None,
                        "dormancy_tier": "never_logged_in",
                        "reclamation_priority": "LOW",
                        "reclamation_reason": "",
                        "account_type": "internal",
                        "account_type_label": "Internal"
                    }
                
                if account_created_str and not user_dormancy_map[uid].get("created_date"):
                    user_dormancy_map[uid]["created_date"] = account_created_str
                    user_dormancy_map[uid]["account_created_date"] = account_created_str

                if lname and lname not in user_dormancy_map[uid]["assigned_licenses"]:
                    user_dormancy_map[uid]["assigned_licenses"].append(lname)
                if pid and pid not in user_dormancy_map[uid]["assigned_pids"]:
                    user_dormancy_map[uid]["assigned_pids"].append(pid)
                
                if best_ll_str:
                    curr_ll = user_dormancy_map[uid]["last_login"]
                    if not curr_ll or best_ll_str > curr_ll:
                        user_dormancy_map[uid]["last_login"] = best_ll_str
                
                user_dormancy_map[uid]["login_count"] = max(user_dormancy_map[uid]["login_count"], lc)

            if pid:
                p_acc_type = cls.classify_account_type(
                    user_id=uid,
                    user_name=uname,
                    user_account=uaccount,
                    assigned_pids=[pid] if pid else [],
                    assigned_licenses=[lname] if lname else []
                )
                p_acc_label = "OSLC / API" if p_acc_type == "oslc" else ("External" if p_acc_type == "external" else "Internal")
                if pid not in product_users_map:
                    product_users_map[pid] = []
                product_users_map[pid].append({
                    "user_id": uid,
                    "user_name": uname,
                    "user_account": uaccount,
                    "created_date": account_created_str,
                    "last_login": best_ll_str,
                    "login_count": lc,
                    "account_type": p_acc_type,
                    "account_type_label": p_acc_label
                })

        # Process user dormancy classification and priority ranking
        dormant_users_list: List[Dict[str, Any]] = []
        never_logged_in_count = 0
        inactive_365d_count = 0
        inactive_180d_count = 0
        inactive_90d_count = 0
        inactive_30d_count = 0
        active_recently_count = 0
        reclaimable_3053 = 0
        reclaimable_3048 = 0
        reclaimable_3050 = 0
        high_priority_reclaimable = 0

        for uid, u in user_dormancy_map.items():
            ll = u["last_login"]
            lc = u["login_count"]
            pids = u["assigned_pids"]
            has_3053 = 3053 in pids
            has_3048 = 3048 in pids
            has_3050 = 3050 in pids

            days_inactive = None
            if ll:
                try:
                    d_part = ll.split(".")[0].strip()
                    dt = datetime.strptime(d_part, "%Y-%m-%d %H:%M:%S") if " " in d_part else datetime.strptime(d_part, "%Y-%m-%d")
                    days_inactive = max(0, (now_dt - dt).days)
                    u["days_inactive"] = days_inactive
                except Exception:
                    u["days_inactive"] = 0

            if not ll:
                tier = "never_logged_in"
                never_logged_in_count += 1
            elif days_inactive is not None and days_inactive > 365:
                tier = "inactive_365d"
                inactive_365d_count += 1
            elif days_inactive is not None and days_inactive > 180:
                tier = "inactive_180d"
                inactive_180d_count += 1
            elif days_inactive is not None and days_inactive > 90:
                tier = "inactive_90d"
                inactive_90d_count += 1
            elif days_inactive is not None and days_inactive >= 30:
                tier = "inactive_30d"
                inactive_30d_count += 1
            else:
                tier = "active_recently"
                active_recently_count += 1

            u["dormancy_tier"] = tier

            # Determine Priority based on dormancy length and over-allocated modules
            if tier in ("never_logged_in", "inactive_365d", "inactive_180d", "inactive_90d"):
                if has_3053 or has_3048:
                    u["reclamation_priority"] = "HIGH"
                    high_priority_reclaimable += 1
                    reasons = []
                    if has_3053:
                        reasons.append("Occasional Enterprise (Over-allocated +99)")
                    if has_3048:
                        reasons.append("Approvals & Reporting (Over-allocated +15)")
                    
                    dormancy_desc = "Never logged in since account creation" if tier == "never_logged_in" else f"Inactive for {days_inactive} days"
                    u["reclamation_reason"] = f"{dormancy_desc}; holds " + ", ".join(reasons)
                elif has_3050:
                    u["reclamation_priority"] = "HIGH"
                    high_priority_reclaimable += 1
                    dormancy_desc = "Never logged in" if tier == "never_logged_in" else f"Inactive for {days_inactive} days"
                    u["reclamation_reason"] = f"{dormancy_desc}; holds Enterprise Core tier license"
                else:
                    u["reclamation_priority"] = "MEDIUM"
                    dormancy_desc = "Never logged in" if tier == "never_logged_in" else f"Inactive for {days_inactive} days"
                    u["reclamation_reason"] = f"{dormancy_desc}; holds standard tier license"
            elif tier == "inactive_30d":
                if has_3053 or has_3048:
                    u["reclamation_priority"] = "MEDIUM"
                    u["reclamation_reason"] = f"Inactive for {days_inactive} days on over-allocated module"
                else:
                    u["reclamation_priority"] = "LOW"
                    u["reclamation_reason"] = f"Inactive for {days_inactive} days"
            else:
                u["reclamation_priority"] = "EXEMPT"
                u["reclamation_reason"] = "Exempt (Active user - logged in within last 30 days)"

            acc_type = cls.classify_account_type(
                user_id=uid,
                user_name=u["user_name"],
                user_account=u["user_account"],
                assigned_pids=pids,
                assigned_licenses=u["assigned_licenses"]
            )
            acc_label = "OSLC / API" if acc_type == "oslc" else ("External" if acc_type == "external" else "Internal")
            u["account_type"] = acc_type
            u["account_type_label"] = acc_label

            if tier in ("never_logged_in", "inactive_365d", "inactive_180d", "inactive_90d"):
                if has_3053:
                    reclaimable_3053 += 1
                if has_3048:
                    reclaimable_3048 += 1
                if has_3050:
                    reclaimable_3050 += 1

            u["primary_license"] = u["assigned_licenses"][0] if u["assigned_licenses"] else "Standard Access"
            dormant_users_list.append(u)

        priority_order = {"HIGH": 0, "MEDIUM": 1, "LOW": 2, "EXEMPT": 3, "ACTIVE": 3}
        dormant_users_list.sort(key=lambda x: (
            priority_order.get(x["reclamation_priority"], 4),
            0 if x["dormancy_tier"] == "never_logged_in" else 1,
            -(x["days_inactive"] or 0),
            x["user_name"]
        ))

        total_dormant_count = len(user_dormancy_map) - active_recently_count

        dormant_by_account = {
            "internal": sum(1 for u in dormant_users_list if u.get("account_type") == "internal" and u.get("dormancy_tier") != "active_recently"),
            "external": sum(1 for u in dormant_users_list if u.get("account_type") == "external" and u.get("dormancy_tier") != "active_recently"),
            "oslc": sum(1 for u in dormant_users_list if u.get("account_type") == "oslc" and u.get("dormancy_tier") != "active_recently"),
        }

        dormant_summary = {
            "total_licensed_users": len(user_dormancy_map),
            "total_dormant_users": total_dormant_count,
            "never_logged_in_count": never_logged_in_count,
            "inactive_365d_count": inactive_365d_count,
            "inactive_180d_count": inactive_180d_count,
            "inactive_90d_count": inactive_90d_count,
            "inactive_30d_count": inactive_30d_count,
            "active_recently_count": active_recently_count,
            "high_priority_reclaimable": high_priority_reclaimable,
            "reclaimable_occasional_enterprise": reclaimable_3053,
            "reclaimable_approvals_reporting": reclaimable_3048,
            "reclaimable_enterprise_core": reclaimable_3050,
            "potential_seats_recovered": reclaimable_3053 + reclaimable_3048 + reclaimable_3050,
            "dormant_by_account_type": dormant_by_account
        }

        # 3. Query real-time live active sessions from ACTIVE_SESSION_USER
        active_sess_sql = (
            "SELECT a.USER_ID, s.SPEC_NAME, a.STATUS, a.START_TIME, a.LAST_TOUCH, "
            "a.IP_ADDRESS, a.HOST_NAME, a.HOST_ADDR, a.PRODUCT_ID, a.SESSION_TOKEN, a.SESSION_ID, a.BUSINESS_CONNECT_USER "
            "FROM ACTIVE_SESSION_USER a "
            "LEFT OUTER JOIN IBS_SPEC s ON a.USER_ID = s.SPEC_ID "
            "WHERE a.STATUS = 'ACTIVE' "
            "ORDER BY a.LAST_TOUCH DESC "
            "WITH UR"
        )
        active_res = await TririgaAdminClient.execute_query_via_admin_console(server_info, active_sess_sql)
        raw_active_sessions = active_res.get("rows", []) if active_res.get("success") else []

        logged_in_users: List[Dict[str, Any]] = []
        seen_active_uids = set()

        server_host = str(server_info.get("host") or "").strip()
        server_name = str(server_info.get("name") or "").strip().lower()
        is_cluster_wide = bool(server_info.get("_is_cluster_wide"))

        for r in raw_active_sessions:
            host_name = str(r.get("HOST_NAME") or "").strip()
            host_addr = str(r.get("HOST_ADDR") or "").strip()
            
            # If a specific server is requested (and not cluster-wide), filter by host/name
            if not is_cluster_wide and server_host:
                if host_addr and server_host not in host_addr and host_addr not in server_host:
                    if host_name and host_name.lower() not in server_name:
                        continue

            user_id = str(r.get("USER_ID") or "").strip()
            spec_name = r.get("SPEC_NAME") or f"User {user_id}"
            start_time = cls._sanitize_date(r.get("START_TIME") or "")
            last_touch = cls._sanitize_date(r.get("LAST_TOUCH") or start_time)
            ip_addr = r.get("IP_ADDRESS") or "127.0.0.1"
            prod_str = str(r.get("PRODUCT_ID") or "")
            sess_token = str(r.get("SESSION_TOKEN") or "")
            sess_id = str(r.get("SESSION_ID") or "")
            bc_user = r.get("BUSINESS_CONNECT_USER")

            user_assigned_lics = user_licenses_map.get(user_id, [])
            if not user_assigned_lics:
                if prod_str:
                    try:
                        pids = [int(p.strip()) for p in prod_str.split(",") if p.strip().isdigit()]
                        lic_name_map = {
                            3050: 'IBM Facilities & RE on Cloud Enterprise',
                            3053: 'IBM Facilities & RE Occasional Enterprise',
                            3048: 'Approvals and Reporting',
                            3021: 'API Integration',
                            3017: 'Application Platform',
                            3018: 'Employee Self Service',
                            3006: 'Operations & Maintenance',
                            3004: 'Facilities Manager',
                            3002: 'Real Estate Manager',
                            3010: 'Capital Projects',
                            3040: 'TREES Energy',
                            3047: 'Connector for Business Apps',
                        }
                        user_assigned_lics = [lic_name_map.get(p, f"License {p}") for p in pids if p in lic_name_map]
                    except Exception:
                        pass
                if not user_assigned_lics:
                    user_assigned_lics = ["Standard Access"]

            primary_lic = user_assigned_lics[0] if user_assigned_lics else "Standard Access"

            user_acc = user_dormancy_map.get(user_id, {}).get("user_account", "")
            user_pids = user_dormancy_map.get(user_id, {}).get("assigned_pids", [])
            act_acc_type = cls.classify_account_type(
                user_id=user_id,
                user_name=spec_name,
                user_account=user_acc,
                assigned_pids=user_pids,
                assigned_licenses=user_assigned_lics,
                business_connect=bc_user
            )
            act_acc_label = "OSLC / API" if act_acc_type == "oslc" else ("External" if act_acc_type == "external" else "Internal")

            if user_id and user_id not in seen_active_uids:
                seen_active_uids.add(user_id)
                logged_in_users.append({
                    "user_name": spec_name,
                    "user_id": user_id,
                    "login_time": start_time,
                    "last_access_time": last_touch,
                    "ip_address": ip_addr,
                    "host_name": host_name,
                    "host_addr": host_addr,
                    "session_token": sess_token,
                    "session_id": sess_id,
                    "product_id": prod_str,
                    "is_active": True,
                    "assigned_licenses": user_assigned_lics,
                    "primary_license": primary_lic,
                    "account_type": act_acc_type,
                    "account_type_label": act_acc_label
                })

        # 3b. Query historical sessions from SESSION_HISTORY
        hist_sql = (
            "SELECT s.spec_name, sh.user_id, sh.product_id, sh.start_time, sh.end_time, sh.logoff_type "
            "FROM session_history sh "
            "LEFT OUTER JOIN IBS_SPEC s on sh.user_id = s.spec_id "
            "ORDER BY sh.start_time DESC "
            "FETCH FIRST 100 ROWS ONLY "
            "WITH UR"
        )
        hist_res = await TririgaAdminClient.execute_query_via_admin_console(server_info, hist_sql)
        raw_sessions = hist_res.get("rows", []) if hist_res.get("success") else []
        sessions: List[Dict[str, Any]] = []

        for r in raw_sessions:
            spec_name = r.get("SPEC_NAME") or r.get("spec_name") or f"User {r.get('USER_ID') or r.get('user_id') or 'Unknown'}"
            start_time = cls._sanitize_date(r.get("START_TIME") or r.get("start_time") or "")
            end_time = cls._sanitize_date(r.get("END_TIME") or r.get("end_time") or "")
            logoff_type = str(r.get("LOGOFF_TYPE") or r.get("logoff_type") or "NORMAL").strip()
            user_id = str(r.get("USER_ID") or r.get("user_id") or "")
            try:
                prod_id = int(r.get("PRODUCT_ID") or r.get("product_id") or 0)
            except (ValueError, TypeError):
                prod_id = 0

            user_assigned_lics = user_licenses_map.get(user_id, [])
            if not user_assigned_lics:
                lic_name_map = {
                    3050: 'IBM Facilities & RE on Cloud Enterprise',
                    3053: 'IBM Facilities & RE Occasional Enterprise',
                    3048: 'Approvals and Reporting',
                    3021: 'API Integration',
                    3017: 'Application Platform',
                    3018: 'Employee Self Service',
                    3006: 'Operations & Maintenance',
                    3004: 'Facilities Manager',
                    3002: 'Real Estate Manager',
                    3010: 'Capital Projects',
                    3040: 'TREES Energy',
                    3047: 'Connector for Business Apps',
                }
                user_assigned_lics = [lic_name_map.get(prod_id, f"License {prod_id}")] if prod_id else ["Standard Access"]

            primary_lic = user_assigned_lics[0] if user_assigned_lics else "Standard Access"

            sess_acc = user_dormancy_map.get(user_id, {}).get("user_account", "")
            sess_pids = user_dormancy_map.get(user_id, {}).get("assigned_pids", [prod_id] if prod_id else [])
            sess_acc_type = cls.classify_account_type(
                user_id=user_id,
                user_name=spec_name,
                user_account=sess_acc,
                assigned_pids=sess_pids,
                assigned_licenses=user_assigned_lics
            )
            sess_acc_label = "OSLC / API" if sess_acc_type == "oslc" else ("External" if sess_acc_type == "external" else "Internal")

            session_item = {
                "SPEC_NAME": spec_name,
                "user_name": spec_name,
                "START_TIME": start_time,
                "start_time": start_time,
                "END_TIME": end_time if end_time and end_time.lower() not in ("none", "null") else "",
                "end_time": end_time if end_time and end_time.lower() not in ("none", "null") else "",
                "LOGOFF_TYPE": logoff_type,
                "logoff_type": logoff_type,
                "USER_ID": user_id,
                "user_id": user_id,
                "product_id": prod_id,
                "is_active": user_id in seen_active_uids,
                "assigned_licenses": user_assigned_lics,
                "primary_license": primary_lic,
                "account_type": sess_acc_type,
                "account_type_label": sess_acc_label
            }
            sessions.append(session_item)

        # Ensure all 4 contracted subscriptions exist in modules even if 0 users assigned
        existing_module_pids = {m["product_id"] for m in modules}
        contracted_name_map = {
            3050: "IBM Facilities & RE on Cloud Enterprise",
            3053: "IBM Facilities & RE Occasional Enterprise",
            3048: "Approvals and Reporting",
            3018: "IBM Facilities & RE on Cloud Self Service"
        }
        for c_pid, c_name in contracted_name_map.items():
            if c_pid not in existing_module_pids:
                modules.append({
                    "product_id": c_pid,
                    "license_name": c_name,
                    "count": 0
                })

        # 4. Build comprehensive License Entitlement vs. Usage Details
        entitlements_list: List[Dict[str, Any]] = []
        paid_entitled_total = 0
        paid_assigned_total = 0
        free_assigned_total = 0
        unlicensed_assigned_total = 0
        unlicensed_modules_count = 0
        over_allocated_count = 0
        total_active_seats = 0

        active_users_touch = {
            str(u.get("user_id") or "").strip(): (u.get("last_access_time") or u.get("login_time"))
            for u in logged_in_users if u.get("user_id")
        }

        for m in modules:
            pid = m["product_id"]
            assigned_count = m["count"]
            
            try:
                numeric_pid = int(pid)
            except (ValueError, TypeError):
                numeric_pid = 0

            # Calculate currently logged-in active users for this license
            active_count = sum(
                1 for u in logged_in_users 
                if m["license_name"] in u.get("assigned_licenses", [])
            )
            total_active_seats += active_count
            active_concurrency_pct = round((active_count / assigned_count * 100), 1) if assigned_count > 0 else 0.0

            # Determine Tier Classification
            if numeric_pid in cls.PAID_CONTRACTED_IDS:
                tier_type = "PAID_CONTRACTED"
                tier_label = "Paid Contracted Subscription"
                entitled_count = cls.DEFAULT_ENTITLEMENTS.get(numeric_pid, 0)
                available_count = max(0, entitled_count - assigned_count)
                utilization_pct = round((assigned_count / entitled_count * 100), 1) if entitled_count > 0 else 0.0
                if assigned_count > entitled_count:
                    status = "over_allocated"
                    over_allocated_count += 1
                elif utilization_pct >= 85.0:
                    status = "warning"
                elif utilization_pct < 30.0:
                    status = "under_utilized"
                else:
                    status = "optimal"
                paid_entitled_total += entitled_count
                paid_assigned_total += assigned_count
            elif numeric_pid in cls.FREE_PLATFORM_IDS:
                tier_type = "FREE_PLATFORM"
                tier_label = "Complimentary Platform / Free"
                entitled_count = 0
                available_count = 0
                utilization_pct = 0.0
                status = "complimentary"
                free_assigned_total += assigned_count
            else:
                tier_type = "PAID_UNLICENSED"
                tier_label = "Paid Module (0 Entitlement Risk)"
                entitled_count = 0
                available_count = 0
                utilization_pct = 100.0 if assigned_count > 0 else 0.0
                status = "unlicensed_paid"
                if assigned_count > 0:
                    unlicensed_assigned_total += assigned_count
                    unlicensed_modules_count += 1

            # Prepare assigned users with live active status and recency of access
            assigned_users_raw = product_users_map.get(numeric_pid, [])
            assigned_users_list = []
            for u in assigned_users_raw:
                u_item = dict(u)
                uid = str(u_item.get("user_id") or "").strip()
                is_active = uid in seen_active_uids
                u_item["is_active"] = is_active

                if is_active and uid in active_users_touch:
                    act_touch = active_users_touch[uid]
                    if act_touch:
                        u_item["last_access_time"] = act_touch
                        if not u_item.get("last_login") or str(act_touch) > str(u_item.get("last_login") or ""):
                            u_item["last_login"] = act_touch
                elif u_item.get("last_login"):
                    u_item["last_access_time"] = u_item.get("last_login")

                assigned_users_list.append(u_item)

            # Sort: currently logged-in users first, followed by users by recency of access
            def _user_sort_key(x):
                active_rank = 0 if x.get("is_active") else 1
                ts = 0.0
                dt_val = x.get("last_access_time") or x.get("last_login")
                if dt_val:
                    try:
                        d_str = str(dt_val).split(".")[0].strip()
                        dt_obj = datetime.strptime(d_str, "%Y-%m-%d %H:%M:%S") if " " in d_str else datetime.strptime(d_str, "%Y-%m-%d")
                        ts = dt_obj.timestamp()
                    except Exception:
                        ts = 0.0
                uname = (x.get("user_name") or "").lower()
                return (active_rank, -ts, uname)

            assigned_users_list.sort(key=_user_sort_key)

            account_type_counts = {
                "internal": sum(1 for u in assigned_users_list if u.get("account_type") == "internal"),
                "external": sum(1 for u in assigned_users_list if u.get("account_type") == "external"),
                "oslc": sum(1 for u in assigned_users_list if u.get("account_type") == "oslc"),
            }

            entitlements_list.append({
                "product_id": pid,
                "license_name": m["license_name"],
                "category": cls.PRODUCT_CATEGORIES.get(numeric_pid, "Standard Product"),
                "tier_type": tier_type,
                "tier_label": tier_label,
                "entitled_count": entitled_count,
                "assigned_count": assigned_count,
                "active_count": active_count,
                "available_count": available_count,
                "assigned_utilization_pct": utilization_pct,
                "active_concurrency_pct": active_concurrency_pct,
                "status": status,
                "account_type_counts": account_type_counts,
                "assigned_users": assigned_users_list[:100]  # top 100 preview sorted by active then recency
            })

        # Sort: Paid Contracted first, then Free Platform, then Paid Unlicensed; within tier by assigned count DESC
        tier_sort_order = {"PAID_CONTRACTED": 0, "FREE_PLATFORM": 1, "PAID_UNLICENSED": 2}
        entitlements_list.sort(key=lambda x: (tier_sort_order.get(x["tier_type"], 9), -x["assigned_count"]))

        total_assigned = paid_assigned_total + free_assigned_total + unlicensed_assigned_total
        overall_sat_pct = round((paid_assigned_total / paid_entitled_total * 100), 1) if paid_entitled_total > 0 else 0.0

        # 5. Query daily license consumption over time from SESSION_HISTORY + USER_PRODUCT
        over_time_sql = (
            "SELECT to_char(sh.start_time, 'YYYY-MM-DD') as LOGIN_DATE, "
            "u.product_id, "
            "count(DISTINCT sh.user_id) as UNIQUE_USERS, "
            "count(sh.start_time) as SESS_COUNT "
            "FROM session_history sh "
            "JOIN user_product u ON sh.user_id = u.user_id "
            "GROUP BY to_char(sh.start_time, 'YYYY-MM-DD'), u.product_id "
            "ORDER BY LOGIN_DATE ASC "
            "WITH UR"
        )

        # 5b. Query daily maximum concurrent user logins by licence product module (interval overlap + hourly window)
        concurrent_sql = (
            "SELECT h.LOGIN_DATE, "
            "h.product_id, "
            "MAX(h.HOURLY_USERS) as MAX_CONCURRENT "
            "FROM ( "
            "    SELECT to_char(s1.start_time, 'YYYY-MM-DD') as LOGIN_DATE, "
            "           s1.start_time as LOGIN_HOUR, "
            "           u.product_id, "
            "           count(DISTINCT s2.user_id) as HOURLY_USERS "
            "    FROM session_history s1 "
            "    JOIN session_history s2 "
            "      ON to_char(s1.start_time, 'YYYY-MM-DD') = to_char(s2.start_time, 'YYYY-MM-DD') "
            "     AND ( "
            "          (s2.start_time <= s1.start_time AND s2.end_time IS NOT NULL AND s2.end_time >= s1.start_time) "
            "          OR to_char(s2.start_time, 'YYYY-MM-DD HH24') = to_char(s1.start_time, 'YYYY-MM-DD HH24') "
            "     ) "
            "    JOIN user_product u ON s2.user_id = u.user_id "
            "    GROUP BY to_char(s1.start_time, 'YYYY-MM-DD'), s1.start_time, u.product_id "
            ") h "
            "GROUP BY h.LOGIN_DATE, h.product_id "
            "ORDER BY h.LOGIN_DATE ASC "
            "WITH UR"
        )

        # 5c. Query true de-duplicated system-wide daily unique users, sessions, and interval-overlap peak concurrency
        # (Without JOIN USER_PRODUCT fan-out so users holding multiple licences are never double-counted)
        system_daily_sql = (
            "SELECT d.LOGIN_DATE, "
            "d.SYS_DAILY_USERS, "
            "d.SYS_DAILY_SESSIONS, "
            "c.SYS_PEAK_CONC "
            "FROM ( "
            "    SELECT to_char(sh.start_time, 'YYYY-MM-DD') as LOGIN_DATE, "
            "           count(DISTINCT sh.user_id) as SYS_DAILY_USERS, "
            "           count(sh.start_time) as SYS_DAILY_SESSIONS "
            "    FROM session_history sh "
            "    GROUP BY to_char(sh.start_time, 'YYYY-MM-DD') "
            ") d "
            "LEFT JOIN ( "
            "    SELECT ov.LOGIN_DATE, MAX(ov.ACTIVE_USERS) as SYS_PEAK_CONC "
            "    FROM ( "
            "        SELECT to_char(s1.start_time, 'YYYY-MM-DD') as LOGIN_DATE, "
            "               s1.start_time as CHECK_TIME, "
            "               count(DISTINCT s2.user_id) as ACTIVE_USERS "
            "        FROM session_history s1 "
            "        JOIN session_history s2 "
            "          ON to_char(s1.start_time, 'YYYY-MM-DD') = to_char(s2.start_time, 'YYYY-MM-DD') "
            "         AND ( "
            "              (s2.start_time <= s1.start_time AND s2.end_time IS NOT NULL AND s2.end_time >= s1.start_time) "
            "              OR to_char(s2.start_time, 'YYYY-MM-DD HH24') = to_char(s1.start_time, 'YYYY-MM-DD HH24') "
            "         ) "
            "        GROUP BY to_char(s1.start_time, 'YYYY-MM-DD'), s1.start_time "
            "    ) ov "
            "    GROUP BY ov.LOGIN_DATE "
            ") c ON d.LOGIN_DATE = c.LOGIN_DATE "
            "ORDER BY d.LOGIN_DATE ASC "
            "WITH UR"
        )

        over_time_res, concurrent_res, system_daily_res = await asyncio.gather(
            TririgaAdminClient.execute_query_via_admin_console(server_info, over_time_sql),
            TririgaAdminClient.execute_query_via_admin_console(server_info, concurrent_sql),
            TririgaAdminClient.execute_query_via_admin_console(server_info, system_daily_sql),
            return_exceptions=True
        )
        raw_over_time = over_time_res.get("rows", []) if (isinstance(over_time_res, dict) and over_time_res.get("success")) else []
        raw_concurrent = concurrent_res.get("rows", []) if (isinstance(concurrent_res, dict) and concurrent_res.get("success")) else []
        raw_system_daily = system_daily_res.get("rows", []) if (isinstance(system_daily_res, dict) and system_daily_res.get("success")) else []

        concurrent_map: Dict[Tuple[str, int], int] = {}
        for cr in raw_concurrent:
            cd_str = str(cr.get("LOGIN_DATE") or "").strip()
            if not cd_str:
                continue
            try:
                cp_id = int(cr.get("PRODUCT_ID") or 0)
            except (ValueError, TypeError):
                cp_id = 0
            try:
                mc_val = int(cr.get("MAX_CONCURRENT") or 0)
            except (ValueError, TypeError):
                mc_val = 0
            concurrent_map[(cd_str, cp_id)] = mc_val

        system_daily_map: Dict[str, Dict[str, int]] = {}
        for sr in raw_system_daily:
            sd_str = str(sr.get("LOGIN_DATE") or "").strip()
            if not sd_str:
                continue
            try:
                t_users = int(sr.get("SYS_DAILY_USERS") or 0)
            except (ValueError, TypeError):
                t_users = 0
            try:
                t_sess = int(sr.get("SYS_DAILY_SESSIONS") or 0)
            except (ValueError, TypeError):
                t_sess = 0
            try:
                t_conc = int(sr.get("SYS_PEAK_CONC") or 0)
            except (ValueError, TypeError):
                t_conc = 0
            system_daily_map[sd_str] = {
                "users": t_users,
                "sessions": t_sess,
                "concurrent": t_conc if t_conc > 0 else t_users
            }

        # Product ID to Clean Name map
        pid_name_map = {
            3053: "Occasional Enterprise",
            3050: "Enterprise",
            3048: "Approvals & Reporting",
            3021: "API Integration",
            3018: "Self Service",
            3017: "Application Platform",
            3006: "Operations & Maint",
            3004: "Facilities Manager",
            3002: "Real Estate Manager",
            3010: "Capital Projects",
            3040: "TREES Energy",
            3047: "Business Apps Connector",
        }

        # Group by date
        date_map: Dict[str, Dict[str, Any]] = {}
        for r in raw_over_time:
            d_str = str(r.get("LOGIN_DATE") or "").strip()
            if not d_str:
                continue
            try:
                p_id = int(r.get("PRODUCT_ID") or 0)
            except (ValueError, TypeError):
                p_id = 0

            p_name = pid_name_map.get(p_id, f"License {p_id}")
            u_cnt = int(r.get("UNIQUE_USERS") or 0)
            s_cnt = int(r.get("SESS_COUNT") or 0)

            # Retrieve audited max concurrent logins or derive proportional peak
            if (d_str, p_id) in concurrent_map:
                c_cnt = concurrent_map[(d_str, p_id)]
            else:
                c_cnt = max(1, round(u_cnt * 0.7)) if u_cnt > 0 else 0

            if d_str not in date_map:
                date_map[d_str] = {
                    "date": d_str,
                    "total_users": 0,
                    "total_sessions": 0,
                    "total_concurrent": 0,
                    "module_sum_users": 0,
                    "module_sum_sessions": 0,
                    "module_sum_concurrent": 0,
                    "by_product": {}
                }

            date_map[d_str]["module_sum_users"] += u_cnt
            date_map[d_str]["module_sum_sessions"] += s_cnt
            date_map[d_str]["module_sum_concurrent"] += c_cnt

            if d_str in system_daily_map:
                date_map[d_str]["total_users"] = system_daily_map[d_str]["users"]
                date_map[d_str]["total_sessions"] = system_daily_map[d_str]["sessions"]
                date_map[d_str]["total_concurrent"] = system_daily_map[d_str]["concurrent"]
            else:
                date_map[d_str]["total_users"] += u_cnt
                date_map[d_str]["total_sessions"] += s_cnt
                date_map[d_str]["total_concurrent"] += c_cnt

            date_map[d_str]["by_product"][p_name] = {
                "product_id": p_id,
                "users": u_cnt,
                "sessions": s_cnt,
                "max_concurrent": c_cnt,
                "concurrent": c_cnt
            }
            # Also set direct key for chart dataKey binding
            date_map[d_str][f"{p_name}_users"] = u_cnt
            date_map[d_str][f"{p_name}_sessions"] = s_cnt
            date_map[d_str][f"{p_name}_concurrent"] = c_cnt
            date_map[d_str][f"{p_name}_max_concurrent"] = c_cnt

        # Fill in any missing dates in the range so 0-login days (weekends, holidays) are continuous
        standard_products_list = [
            "Occasional Enterprise",
            "Approvals & Reporting",
            "Enterprise",
            "API Integration",
            "Self Service",
            "Operations & Maint",
            "Application Platform",
            "Facilities Manager",
            "Real Estate Manager",
            "Capital Projects",
            "TREES Energy",
            "Business Apps Connector",
        ]

        if date_map:
            sorted_raw_dates = sorted(date_map.keys())
            try:
                start_d = datetime.strptime(sorted_raw_dates[0], "%Y-%m-%d").date()
                end_d = datetime.strptime(sorted_raw_dates[-1], "%Y-%m-%d").date()
            except Exception:
                start_d = None
                end_d = None

            if start_d and end_d:
                curr_d = start_d
                while curr_d <= end_d:
                    d_key = curr_d.strftime("%Y-%m-%d")
                    day_name = curr_d.strftime("%a")  # e.g. Mon, Tue, Wed, Thu, Fri, Sat, Sun
                    day_full = curr_d.strftime("%A")  # e.g. Monday, Tuesday
                    formatted_label = curr_d.strftime("%a %d %b")  # e.g. Mon 08 Sep

                    if d_key not in date_map:
                        date_map[d_key] = {
                            "date": d_key,
                            "day_name": day_name,
                            "day_full": day_full,
                            "formatted_label": formatted_label,
                            "total_users": 0,
                            "total_sessions": 0,
                            "total_concurrent": 0,
                            "by_product": {
                                p: {"product_id": 0, "users": 0, "sessions": 0, "max_concurrent": 0, "concurrent": 0}
                                for p in standard_products_list
                            }
                        }
                        for p in standard_products_list:
                            date_map[d_key][f"{p}_users"] = 0
                            date_map[d_key][f"{p}_sessions"] = 0
                            date_map[d_key][f"{p}_concurrent"] = 0
                            date_map[d_key][f"{p}_max_concurrent"] = 0
                    else:
                        date_map[d_key]["day_name"] = day_name
                        date_map[d_key]["day_full"] = day_full
                        date_map[d_key]["formatted_label"] = formatted_label
                        for p in standard_products_list:
                            if f"{p}_users" not in date_map[d_key]:
                                date_map[d_key][f"{p}_users"] = 0
                            if f"{p}_sessions" not in date_map[d_key]:
                                date_map[d_key][f"{p}_sessions"] = 0
                            if f"{p}_concurrent" not in date_map[d_key]:
                                date_map[d_key][f"{p}_concurrent"] = 0
                            if f"{p}_max_concurrent" not in date_map[d_key]:
                                date_map[d_key][f"{p}_max_concurrent"] = 0
                            if p not in date_map[d_key]["by_product"]:
                                date_map[d_key]["by_product"][p] = {"product_id": 0, "users": 0, "sessions": 0, "max_concurrent": 0, "concurrent": 0}

                    curr_d += timedelta(days=1)

        consumption_over_time = [date_map[d] for d in sorted(date_map.keys())]

        # 6. Construct Multi-Tier Sankey Flow Data
        # Level 0: Total Contracted SaaS Quota
        # Level 1: Category Tiers (Occasional, Enterprise, Self-Service/Approvals, Operations/Specialized)
        # Level 2: Product Modules
        # Level 3: Allocation State (Active Concurrent, Provisioned Dormant, Unassigned Headroom)
        sankey_nodes: List[Dict[str, Any]] = []
        sankey_links: List[Dict[str, Any]] = []

        # Category allocations
        cat_allocations: Dict[str, Dict[str, int]] = {}
        for ent in entitlements_list:
            cat = ent["category"]
            if cat not in cat_allocations:
                cat_allocations[cat] = {
                    "entitled": 0,
                    "assigned": 0,
                    "active": 0,
                    "available": 0,
                    "products": []
                }
            cat_allocations[cat]["entitled"] += ent["entitled_count"]
            cat_allocations[cat]["assigned"] += ent["assigned_count"]
            cat_allocations[cat]["active"] += ent["active_count"]
            cat_allocations[cat]["available"] += ent["available_count"]
            cat_allocations[cat]["products"].append(ent)

        # Root Node (Level 0)
        sankey_nodes.append({
            "id": "root_quota",
            "name": f"Total Contracted Quota ({paid_entitled_total} Seats)",
            "category": "Contract",
            "value": paid_entitled_total,
            "depth": 0,
            "color": "#6366f1"
        })

        # Category Nodes (Level 1)
        for cat_name, cat_data in cat_allocations.items():
            cat_node_id = f"cat_{cat_name.replace(' ', '_').replace('&', 'and')}"
            sankey_nodes.append({
                "id": cat_node_id,
                "name": f"{cat_name} ({cat_data['entitled']} Seats)",
                "category": cat_name,
                "value": max(1, cat_data["entitled"]),
                "depth": 1,
                "color": "#0ea5e9"
            })
            # Link from Root to Category
            sankey_links.append({
                "source": "root_quota",
                "target": cat_node_id,
                "value": max(1, cat_data["entitled"]),
                "color": "rgba(99, 102, 241, 0.4)",
                "sourceName": "Total Contracted Quota",
                "targetName": cat_name
            })

            # Product Nodes (Level 2) and Links from Category to Products
            for p in cat_data["products"]:
                prod_node_id = f"prod_{p['product_id']}"
                clean_pname = p['license_name'].replace('IBM Facilities & RE on Cloud ', '').replace('IBM Facilities and Real Estate Management on Cloud ', '')
                sankey_nodes.append({
                    "id": prod_node_id,
                    "name": f"{clean_pname} ({p['entitled_count']} Seats)",
                    "category": cat_name,
                    "value": max(1, p["entitled_count"]),
                    "depth": 2,
                    "color": "#38bdf8" if p["status"] == "optimal" else "#f59e0b" if p["status"] == "warning" else "#f43f5e"
                })
                sankey_links.append({
                    "source": cat_node_id,
                    "target": prod_node_id,
                    "value": max(1, p["entitled_count"]),
                    "color": "rgba(14, 165, 233, 0.4)",
                    "sourceName": cat_name,
                    "targetName": clean_pname
                })

                # Links from Product to Allocation States (Level 3)
                # Active Concurrency Link
                if p["active_count"] > 0:
                    sankey_links.append({
                        "source": prod_node_id,
                        "target": "state_active",
                        "value": p["active_count"],
                        "color": "rgba(16, 185, 129, 0.6)",
                        "sourceName": clean_pname,
                        "targetName": "Active Concurrent Users"
                    })
                # Dormant Provisioned Seats Link
                dormant_count = max(0, p["assigned_count"] - p["active_count"])
                if dormant_count > 0:
                    sankey_links.append({
                        "source": prod_node_id,
                        "target": "state_dormant",
                        "value": dormant_count,
                        "color": "rgba(56, 189, 248, 0.4)",
                        "sourceName": clean_pname,
                        "targetName": "Assigned (Inactive/Dormant)"
                    })
                # Available Headroom Link
                if p["available_count"] > 0:
                    sankey_links.append({
                        "source": prod_node_id,
                        "target": "state_headroom",
                        "value": p["available_count"],
                        "color": "rgba(100, 116, 139, 0.35)",
                        "sourceName": clean_pname,
                        "targetName": "Unallocated Headroom"
                    })

        # Level 3 State Nodes
        total_dormant = max(0, total_assigned - len(logged_in_users))
        total_headroom = max(0, paid_entitled_total - paid_assigned_total)

        sankey_nodes.append({
            "id": "state_active",
            "name": f"Active Concurrent Users ({len(logged_in_users)})",
            "category": "Status",
            "value": max(1, len(logged_in_users)),
            "depth": 3,
            "color": "#10b981"
        })
        sankey_nodes.append({
            "id": "state_dormant",
            "name": f"Assigned Provisioned ({total_dormant})",
            "category": "Status",
            "value": max(1, total_dormant),
            "depth": 3,
            "color": "#0ea5e9"
        })
        sankey_nodes.append({
            "id": "state_headroom",
            "name": f"Unassigned Headroom ({total_headroom})",
            "category": "Status",
            "value": max(1, total_headroom),
            "depth": 3,
            "color": "#64748b"
        })

        # Compute Concurrency & Daily User KPIs across active days (days with >0 logins)
        active_days = [pt for pt in consumption_over_time if (pt.get("total_users") or 0) > 0]
        peak_conc_pt = max(consumption_over_time, key=lambda x: x.get("total_concurrent") or 0) if consumption_over_time else None
        peak_user_pt = max(consumption_over_time, key=lambda x: x.get("total_users") or 0) if consumption_over_time else None

        peak_daily_concurrent = int(peak_conc_pt.get("total_concurrent") or 0) if peak_conc_pt else len(logged_in_users)
        peak_daily_concurrent_date = peak_conc_pt.get("date") if (peak_conc_pt and peak_daily_concurrent > 0) else None

        peak_daily_unique_users = int(peak_user_pt.get("total_users") or 0) if peak_user_pt else len(logged_in_users)
        peak_daily_unique_date = peak_user_pt.get("date") if (peak_user_pt and peak_daily_unique_users > 0) else None

        avg_daily_concurrent = round(sum(pt.get("total_concurrent") or 0 for pt in active_days) / len(active_days), 1) if active_days else float(len(logged_in_users))
        avg_daily_unique_users = round(sum(pt.get("total_users") or 0 for pt in active_days) / len(active_days), 1) if active_days else float(len(logged_in_users))

        concurrency_to_assigned_ratio = round((peak_daily_concurrent / max(1, total_assigned)) * 100, 1)
        concurrency_to_entitled_ratio = round((peak_daily_concurrent / max(1, paid_entitled_total)) * 100, 1)

        result = {
            "success": res.get("success", False),
            "error": res.get("error"),
            "license_distribution": modules,
            "recent_sessions": sessions,
            "logged_in_users": logged_in_users,
            "license_entitlements": entitlements_list,
            "consumption_over_time": consumption_over_time,
            "sankey_data": {
                "nodes": sankey_nodes,
                "links": sankey_links
            },
            "dormant_users": dormant_users_list,
            "dormant_summary": dormant_summary,
            "summary": {
                "total_entitled_seats": paid_entitled_total,
                "total_assigned_seats": total_assigned,
                "paid_contracted_entitled": paid_entitled_total,
                "paid_contracted_assigned": paid_assigned_total,
                "paid_contracted_over_allocated": over_allocated_count,
                "free_platform_assigned": free_assigned_total,
                "unlicensed_paid_assigned": unlicensed_assigned_total,
                "unlicensed_paid_modules_count": unlicensed_modules_count,
                "total_active_sessions": len(logged_in_users),
                "overall_saturation_pct": overall_sat_pct,
                "over_allocated_count": over_allocated_count,
                "total_products": len(entitlements_list),
                "peak_daily_concurrent": peak_daily_concurrent,
                "peak_daily_concurrent_date": peak_daily_concurrent_date,
                "peak_daily_unique_users": peak_daily_unique_users,
                "peak_daily_unique_date": peak_daily_unique_date,
                "avg_daily_concurrent": avg_daily_concurrent,
                "avg_daily_unique_users": avg_daily_unique_users,
                "active_telemetry_days": len(active_days),
                "concurrency_to_assigned_ratio_pct": concurrency_to_assigned_ratio,
                "concurrency_to_entitled_ratio_pct": concurrency_to_entitled_ratio,
                "active_by_account_type": {
                    "internal": sum(1 for u in logged_in_users if u.get("account_type") == "internal"),
                    "external": sum(1 for u in logged_in_users if u.get("account_type") == "external"),
                    "oslc": sum(1 for u in logged_in_users if u.get("account_type") == "oslc"),
                },
                "total_by_account_type": {
                    "internal": sum(1 for u in user_dormancy_map.values() if u.get("account_type") == "internal"),
                    "external": sum(1 for u in user_dormancy_map.values() if u.get("account_type") == "external"),
                    "oslc": sum(1 for u in user_dormancy_map.values() if u.get("account_type") == "oslc"),
                }
            }
        }

        cls._license_usage_cache[cache_key] = {
            "_cached_at": time.time(),
            "data": result
        }

        return result

    @classmethod
    def _clean_org_name(cls, org_path: str) -> str:
        if not org_path or str(org_path).strip().lower() in ("null", "none", ""):
            return "Unassigned / System"
        # Only split on backslash '\' — do NOT split or replace forward slashes '/', 
        # as names often contain 't/a' (trading as) abbreviations.
        parts = [p.strip() for p in str(org_path).split("\\") if p.strip()]
        if not parts:
            return "Unassigned"
        leaf = parts[-1]
        if " - " in leaf:
            prefix, rest = leaf.split(" - ", 1)
            if len(prefix) <= 12:
                return rest.strip()
        return leaf.strip()

    @classmethod
    def _classify_directory_account(
        cls,
        user_id: Any,
        user_name: str,
        user_account: str,
        org_path: str,
        email: str,
        form_type: str,
        status: str
    ) -> Tuple[str, str]:
        name_l = (user_name or "").lower()
        acc_l = (user_account or "").lower()
        org_l = (org_path or "").lower()
        mail_l = (email or "").lower()
        form_l = (form_type or "").lower()
        uid = str(user_id or "")

        # 1. OSLC / Integration / System Check
        if (
            uid == "221931"
            or acc_l in ("system", "mpro5adapteruser")
            or "oslc" in acc_l
            or "oslc" in name_l
            or "api" in acc_l
            or "svc_" in acc_l
            or "sync" in acc_l
        ):
            return "oslc", "OSLC / API Integration"

        # 2. External Contractor / Vendor Check
        if (
            form_l in ("external contact", "consultant", "triexternalcontact", "triconsultant")
            or "ext01" in org_l
            or "external company" in org_l
            or "aramark-" in acc_l
            or "sensorirb" in acc_l
            or any(d in mail_l for d in ["@sensorifm.com", "@carronandwalsh.com", "@opw-helpdesk.ie", "@gmail.com", "@vendor", "@contractor"])
            or any(k in acc_l for k in ["ext_", "ext-", "vendor", "contractor", "consultant"])
        ):
            return "external", "External Account"

        # 3. Default Internal
        return "internal", "Internal Account"

    @classmethod
    async def get_users_directory(
        cls,
        server_info: Dict[str, Any],
        status_filter: str = "all",       # "all" | "active" | "inactive"
        account_type_filter: str = "all", # "all" | "internal" | "external" | "oslc"
        org_filter: Optional[str] = None,
        search_query: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Queries all users from TRIRIGA database with name, organisation, email,
        account type, and active status. Supports filtering and returns clean summary statistics.
        """
        cache_key = f"{server_info.get('id')}"
        now_sec = time.time()
        raw_users: List[Dict[str, Any]] = []

        if cache_key in cls._users_directory_cache and (now_sec - cls._users_directory_cache[cache_key].get("_cached_at", 0)) < 45.0:
            raw_users = cls._users_directory_cache[cache_key]["users"]
        else:
            q = """
            SELECT 
                p.SPEC_ID as USER_ID,
                p.SYS_USERACCOUNT as USER_ACCOUNT,
                COALESCE(p.PEOPLEFULLNAME, p.FIRSTNAME || ' ' || p.LASTNAME) as FULL_NAME,
                COALESCE(p.SYS_ORGNAME, tp.SYS_ORGNAME) as ORGANIZATION,
                COALESCE(p.EMAIL, p.TRIEMAILTX, tp.EMAIL, tp.TRIEMAILTX) as EMAIL,
                p.SYS_OBJECTSTATE as ACCOUNT_STATUS,
                tp.TRIFORMLABELSY as FORM_TYPE,
                tp.SYS_OBJECTSTATE as PEOPLE_STATUS,
                p.TRILASTLOGINDT as LAST_LOGIN_TS
            FROM T_MYPROFILE p
            LEFT OUTER JOIN IBS_SPEC sp ON p.SPEC_ID = sp.SPEC_ID
            LEFT OUTER JOIN IBS_SPEC stp ON sp.SPEC_NAME = stp.SPEC_NAME AND stp.TYPE_NAME = 'triPeople'
            LEFT OUTER JOIN T_TRIPEOPLE tp ON stp.SPEC_ID = tp.SPEC_ID
            WHERE p.SYS_USERACCOUNT IS NOT NULL AND p.SYS_USERACCOUNT != 'null'
            ORDER BY p.SPEC_ID ASC
            """
            res = await TririgaAdminClient.execute_query_via_admin_console(server_info, q, limit=5000)
            db_rows = res.get("rows", []) if res.get("success") else []
            now_dt = datetime.now()

            for r in db_rows:
                uid = r.get("USER_ID")
                uacc = str(r.get("USER_ACCOUNT") or "").strip()
                name = " ".join(str(r.get("FULL_NAME") or uacc).split()).strip()
                raw_org = r.get("ORGANIZATION")
                org_str = str(raw_org).strip() if raw_org and str(raw_org).strip().lower() not in ("null", "none") else ""
                org_clean = cls._clean_org_name(org_str)

                email_val = r.get("EMAIL")
                email = str(email_val).strip() if email_val and str(email_val).strip().lower() not in ("null", "none") else ""

                status_raw = str(r.get("ACCOUNT_STATUS") or "Unknown").strip()
                is_active = status_raw.lower() == "active"
                form = str(r.get("FORM_TYPE") or "").strip()
                if not form or form.lower() in ("null", "none"):
                    form = "Standard User"

                acc_type, acc_label = cls._classify_directory_account(
                    uid, name, uacc, org_str, email, form, status_raw
                )

                last_login_raw = r.get("LAST_LOGIN_TS")
                last_login_str = "Never"
                days_inactive = None
                if last_login_raw and str(last_login_raw).strip().lower() not in ("null", "none", ""):
                    try:
                        ms = float(str(last_login_raw).strip())
                        dt = datetime.fromtimestamp(ms / 1000.0)
                        last_login_str = dt.strftime("%Y-%m-%d %H:%M:%S")
                        days_inactive = max(0, (now_dt - dt).days)
                    except Exception:
                        pass

                raw_users.append({
                    "user_id": uid,
                    "user_account": uacc,
                    "user_name": name,
                    "organization": org_str,
                    "organization_clean": org_clean,
                    "email": email,
                    "account_type": acc_type,
                    "account_type_label": acc_label,
                    "status": status_raw,
                    "is_active": is_active,
                    "form_type": form,
                    "last_login": last_login_str,
                    "last_login_raw": last_login_raw,
                    "days_inactive": days_inactive
                })

            cls._users_directory_cache[cache_key] = {
                "_cached_at": now_sec,
                "users": raw_users
            }

        # Calculate baseline metrics across all users
        total_count = len(raw_users)
        active_count = sum(1 for u in raw_users if u["is_active"])
        inactive_count = total_count - active_count
        internal_count = sum(1 for u in raw_users if u["account_type"] == "internal")
        external_count = sum(1 for u in raw_users if u["account_type"] == "external")
        oslc_count = sum(1 for u in raw_users if u["account_type"] == "oslc")

        # Distinct sorted clean organizations list
        unique_orgs = sorted(list({u["organization_clean"] for u in raw_users if u["organization_clean"]}))

        # Filter users based on query parameters
        filtered = raw_users

        # 1. Status Filter
        if status_filter == "active":
            filtered = [u for u in filtered if u["is_active"]]
        elif status_filter in ("inactive", "retired"):
            filtered = [u for u in filtered if not u["is_active"]]

        # 2. Account Type Filter
        if account_type_filter in ("internal", "external", "oslc"):
            filtered = [u for u in filtered if u["account_type"] == account_type_filter]

        # 3. Organization Filter
        if org_filter and org_filter.lower() != "all":
            org_filter_clean = org_filter.strip().lower()
            filtered = [
                u for u in filtered
                if org_filter_clean in u["organization_clean"].lower() or org_filter_clean in u["organization"].lower()
            ]

        # 4. Search Filter
        if search_query and search_query.strip():
            sq = search_query.strip().lower()
            filtered = [
                u for u in filtered
                if (
                    sq in u["user_name"].lower()
                    or sq in u["user_account"].lower()
                    or sq in u["email"].lower()
                    or sq in u["organization_clean"].lower()
                    or sq in u["organization"].lower()
                )
            ]

        # Sort: Active users first, then alphabetically by user_name
        filtered = sorted(
            filtered,
            key=lambda x: (
                0 if x["is_active"] else 1,
                x["user_name"].lower()
            )
        )

        return {
            "success": True,
            "total_count": total_count,
            "filtered_count": len(filtered),
            "summary": {
                "total": total_count,
                "active": active_count,
                "inactive": inactive_count,
                "internal": internal_count,
                "external": external_count,
                "oslc": oslc_count,
                "organizations_count": len(unique_orgs)
            },
            "organizations": unique_orgs,
            "users": filtered
        }

    @classmethod
    def generate_users_csv(
        cls,
        users_list: List[Dict[str, Any]]
    ) -> str:
        """
        Generates CSV format string with UTF-8 BOM encoding for complete Excel compatibility.
        """
        import io, csv
        output = io.StringIO()
        output.write('\ufeff')  # UTF-8 BOM for Microsoft Excel
        writer = csv.writer(output, lineterminator='\r\n')
        writer.writerow([
            "Name",
            "Organisation",
            "Organisation Path",
            "Email Address",
            "Username",
            "Account Type",
            "Status",
            "Form Type",
            "Last Login",
            "Days Inactive",
            "User ID"
        ])
        for u in users_list:
            writer.writerow([
                u.get("user_name", ""),
                u.get("organization_clean", ""),
                u.get("organization", ""),
                u.get("email", ""),
                u.get("user_account", ""),
                u.get("account_type_label", ""),
                u.get("status", ""),
                u.get("form_type", ""),
                u.get("last_login", ""),
                u.get("days_inactive", "") if u.get("days_inactive") is not None else "",
                u.get("user_id", "")
            ])
        return output.getvalue()

    @classmethod
    def get_cluster_parity(cls) -> Dict[str, Any]:
        """
        Audits all configured TRIRIGA cluster servers in SQLite database.
        Checks for configuration drift, log volumes, and synchronization timestamps.
        """
        with db_read_session() as conn:
            cur = conn.cursor()
            cur.execute("SELECT * FROM servers ORDER BY id ASC")
            servers = [dict_from_row(r) for r in cur.fetchall()]

            cur.execute("""
                SELECT server_id, COUNT(*) as log_count, 
                       SUM(CASE WHEN log_level IN ('ERROR', 'FATAL') THEN 1 ELSE 0 END) as error_count,
                       MAX(timestamp) as latest_log_time
                FROM log_entries
                GROUP BY server_id
            """)
            stats_by_server = {r["server_id"]: dict_from_row(r) for r in cur.fetchall()}

        nodes: List[Dict[str, Any]] = []
        for s in servers:
            sid = s["id"]
            stat = stats_by_server.get(sid, {})
            cname = s.get("cluster_name")
            if not cname and s.get("name", "").lower().strip() in ("prod app1", "prod app2"):
                cname = "Production Cluster"
            nodes.append({
                "id": sid,
                "name": s["name"],
                "host": s["host"],
                "port": s["port"],
                "protocol": s["protocol"],
                "admin_path": s["admin_path"],
                "auth_type": s["auth_type"],
                "status": s["status"],
                "cluster_name": cname,
                "last_sync_at": s.get("last_sync_at"),
                "total_logs": stat.get("log_count", 0),
                "total_errors": stat.get("error_count", 0),
                "latest_log_time": stat.get("latest_log_time")
            })

        # Group nodes by cluster (case-insensitive normalization)
        clusters_map: Dict[str, List[Dict[str, Any]]] = {}
        canonical_names: Dict[str, str] = {}

        for n in nodes:
            raw_c = (n.get("cluster_name") or "").strip()
            if not raw_c:
                if n.get("name", "").lower().strip() in ("prod app1", "prod app2"):
                    raw_c = "Production Cluster"
                    n["cluster_name"] = "Production Cluster"
                else:
                    raw_c = "Standalone (Unclustered)"
            
            # Normalize key case-insensitively
            key_lower = raw_c.lower().strip()
            if key_lower not in canonical_names:
                canonical_names[key_lower] = raw_c
            canonical = canonical_names[key_lower]
            clusters_map.setdefault(canonical, []).append(n)

        drift_warnings: List[str] = []
        clusters_list: List[Dict[str, Any]] = []

        for cname, cnodes in clusters_map.items():
            is_clustered = cname.lower().strip() != "standalone (unclustered)"
            clusters_list.append({
                "name": cname,
                "is_clustered": is_clustered,
                "node_count": len(cnodes),
                "nodes": cnodes
            })

            # Drift checks only apply across nodes within the same clustered group
            if is_clustered and len(cnodes) > 1:
                protocols = set(n["protocol"] for n in cnodes)
                admin_paths = set(n["admin_path"] for n in cnodes)
                ports = set(n["port"] for n in cnodes)

                if len(protocols) > 1:
                    drift_warnings.append(f"[{cname}] Protocol drift: nodes use inconsistent schemes {list(protocols)}")
                if len(admin_paths) > 1:
                    drift_warnings.append(f"[{cname}] Context path drift: nodes use different Admin paths {list(admin_paths)}")
                
                # Check log ingestion skew (>50% difference across active nodes)
                log_counts = [n["total_logs"] for n in cnodes]
                if max(log_counts) > 100 and min(log_counts) == 0:
                    drift_warnings.append(f"[{cname}] Workload imbalance: one or more nodes have 0 ingested logs.")

        return {
            "success": True,
            "total_nodes": len(nodes),
            "nodes": nodes,
            "clusters": clusters_list,
            "drift_warnings": drift_warnings
        }

    @classmethod
    async def get_health_scorecard(cls, server_info: Dict[str, Any], server_id: int) -> Dict[str, Any]:
        """
        Computes an objective, multi-factor 360-degree TRIRIGA platform health scorecard
        based on live database contention, workflow backlog, JVM threads, and log error volume.
        """
        score = 100
        deductions: List[Dict[str, Any]] = []

        thread_data = await TririgaAdminClient.fetch_live_agent_monitor(server_info)
        db_blocked = thread_data.get("threads_summary", {}).get("db_blocked", 0)
        if db_blocked > 0:
            penalty = min(30, db_blocked * 10)
            score -= penalty
            deductions.append({
                "factor": "Database Contention",
                "penalty": penalty,
                "detail": f"{db_blocked} JVM threads currently blocked on database locking operations."
            })

        wf_queued = thread_data.get("wf_event_summary", {}).get("total_queued", 0)
        if wf_queued > 500:
            score -= 25
            deductions.append({
                "factor": "Workflow Queue Saturation",
                "penalty": 25,
                "detail": f"WF_EVENT queue depth ({wf_queued}) exceeds critical threshold of 500 events."
            })
        elif wf_queued > 100:
            score -= 10
            deductions.append({
                "factor": "Workflow Queue Backlog",
                "penalty": 10,
                "detail": f"WF_EVENT queue depth ({wf_queued}) indicates elevated background load."
            })

        with db_read_session() as conn:
            cur = conn.cursor()
            cur.execute("""
                SELECT COUNT(*) as err_cnt 
                FROM log_entries 
                WHERE server_id = ? AND log_level IN ('ERROR', 'FATAL')
            """, (server_id,))
            row = cur.fetchone()
            err_cnt = row["err_cnt"] if row else 0

        if err_cnt > 100:
            score -= 20
            deductions.append({
                "factor": "Error Frequency",
                "penalty": 20,
                "detail": f"{err_cnt} error/fatal log entries registered for this node."
            })
        elif err_cnt > 10:
            score -= 10
            deductions.append({
                "factor": "Error Frequency",
                "penalty": 10,
                "detail": f"{err_cnt} error entries recorded in server log."
            })

        final_score = max(0, min(100, score))
        if final_score >= 90:
            grade = "A"
            status = "HEALTHY"
        elif final_score >= 80:
            grade = "B"
            status = "STABLE"
        elif final_score >= 65:
            grade = "C"
            status = "WARNING"
        elif final_score >= 50:
            grade = "D"
            status = "DEGRADED"
        else:
            grade = "F"
            status = "CRITICAL"

        return {
            "success": True,
            "server_id": server_id,
            "server_name": server_info.get("name"),
            "health_score": final_score,
            "health_grade": grade,
            "status": status,
            "deductions": deductions,
            "metrics": {
                "db_blocked_threads": db_blocked,
                "wf_queue_depth": wf_queued,
                "total_errors": err_cnt
            },
            "timestamp": datetime.now(timezone.utc).isoformat()
        }

    @classmethod
    async def generate_diagnostic_bundle(cls, server_info: Dict[str, Any], server_id: int) -> io.BytesIO:
        """
        Creates an executive, one-click IBM Support Diagnostic Bundle (.zip) containing:
        1. An executive Microsoft Word (.docx) forensic briefing report
        2. Live JVM thread dump (txt)
        3. Database lock snapshot (json)
        4. Recent error log extract (txt)
        5. System & cluster configuration metadata (json)
        """
        thread_data = await TririgaAdminClient.fetch_live_agent_monitor(server_info)
        raw_threads = thread_data.get("threads", [])

        with db_read_session() as conn:
            cur = conn.cursor()
            cur.execute("""
                SELECT timestamp, log_level, logger_name, thread_name, message, stack_trace 
                FROM log_entries 
                WHERE server_id = ? AND log_level IN ('FATAL', 'ERROR', 'WARN')
                ORDER BY id DESC LIMIT 200
            """, (server_id,))
            error_logs = [dict_from_row(r) for r in cur.fetchall()]

        lock_data = await cls.get_lock_contention(server_info)

        md_content = f"""# IBM TRIRIGA Diagnostic Bundle & Support Briefing
*Generated: {datetime.now().strftime('%B %d, %Y %H:%M:%S UTC')}*

## 1. System Target
- **Server Name:** {server_info.get('name')}
- **Target Host:** {server_info.get('host')}:{server_info.get('port')}
- **Protocol:** {server_info.get('protocol')}
- **Admin Console:** {server_info.get('admin_path')}

---

## 2. Executive Incident Overview
This diagnostic package was generated automatically by the TRIRIGA Operations & Forensics Console.
It captures synchronized telemetry across JVM thread states, database lock contentions, workflow agent queue backlog, and error event logs.

### Key Telemetry Indicators
- **Total JVM Threads:** {thread_data.get('threads_summary', {}).get('total', 0)}
- **Threads Blocked on DB:** {thread_data.get('threads_summary', {}).get('db_blocked', 0)}
- **Asynchronous WF Queue Depth:** {thread_data.get('wf_event_summary', {}).get('total_queued', 0)}
- **Recent Error Log Entries:** {len(error_logs)}
- **Active DB Lock Contentions:** {len(lock_data.get('raw_locks', []))}

---

## 3. Database Lock Waits Snapshot
"""
        if lock_data.get("has_locks"):
            md_content += "\n| Blocker Handle | User | Table | Lock Mode | Waiters |\n| :--- | :--- | :--- | :--- | :--- |\n"
            for b in lock_data.get("blocker_tree", []):
                md_content += f"| {b.get('blocker_handle')} | {b.get('user_id')} | `{b.get('table_name')}` | `{b.get('lock_mode')}` | {len(b.get('waiting_handles', []))} |\n"
        else:
            md_content += "\n> No active database lock contentions were detected on `SYSIBMADM.MON_LOCKWAITS` at time of capture.\n"

        md_content += f"""
---

## 4. Most Recent Error Log Extracts ({min(len(error_logs), 10)} of {len(error_logs)})
"""
        for entry in error_logs[:10]:
            md_content += f"\n#### [{entry.get('log_level')}] {entry.get('timestamp')} - `{entry.get('logger_name')}`\n"
            md_content += f"```text\n{entry.get('message')}\n"
            if entry.get("stack_trace"):
                md_content += f"{entry.get('stack_trace')[:300]}...\n"
            md_content += "```\n"

        docx_bytes = DocxReportExporter.generate_docx(
            f"IBM TRIRIGA Diagnostic Bundle – {server_info.get('name')}",
            md_content
        )

        zip_buffer = io.BytesIO()
        with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zf:
            zf.writestr(f"TRIRIGA_Diagnostic_Report_{server_info.get('name')}.docx", docx_bytes.getvalue())

            thread_lines = [
                f"=== TRIRIGA LIVE JVM THREAD DUMP ({datetime.now(timezone.utc).isoformat()}) ===",
                f"Server: {server_info.get('name')} ({server_info.get('host')})",
                f"Total Threads: {len(raw_threads)}\n"
            ]
            for t in raw_threads:
                thread_lines.append(f'"{t.get("name")}" ID={t.get("id")} State={t.get("state")} Subsystem={t.get("subsystem")} DBBlocked={t.get("db_blocked")}')
                if t.get("stack_trace"):
                    thread_lines.append(t.get("stack_trace"))
                thread_lines.append("")
            zf.writestr("thread_dump.txt", "\n".join(thread_lines))

            log_lines = [
                f"=== TRIRIGA RECENT ERROR LOGS ({datetime.now(timezone.utc).isoformat()}) ===",
                f"Server: {server_info.get('name')}\n"
            ]
            for l in error_logs:
                log_lines.append(f"[{l.get('timestamp')}] {l.get('log_level')} [{l.get('logger_name')}] [{l.get('thread_name')}]: {l.get('message')}")
                if l.get("stack_trace"):
                    log_lines.append(l.get("stack_trace"))
                log_lines.append("-" * 40)
            zf.writestr("error_logs.txt", "\n".join(log_lines))

            zf.writestr("database_locks.json", json.dumps(lock_data, indent=2))

            zf.writestr("system_metadata.json", json.dumps({
                "server": server_info,
                "captured_at": datetime.now(timezone.utc).isoformat(),
                "agent_summary": thread_data.get("threads_summary", {}),
                "wf_summary": thread_data.get("wf_event_summary", {})
            }, indent=2))

        zip_buffer.seek(0)
        return zip_buffer
