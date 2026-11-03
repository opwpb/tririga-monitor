# -*- coding: utf-8 -*-
"""
worktask_service.py
Core intelligence engine for identifying TRIRIGA Work Tasks (triWorkTask)
and Workflow Tasks causing long-running database queries, heavy table scans,
and high DB2 lock contention / deadlocks.
"""

import re
import json
import time
from datetime import datetime, timezone, timedelta
from typing import Dict, Any, List, Optional, Tuple, Set

from ..db.database import db_read_session, dict_from_row, dict_list_from_rows
from .tririga_resolver import TririgaResolver
from .tririga_admin_client import TririgaAdminClient

class WorkTaskQueryService:
    """
    Identifies specific worktasks, SQL statements, and workflow tasks that trigger
    long-running queries (>1s, >5s, >30s), table scans, or lock contention in TRIRIGA.
    """

    # Regex patterns for query duration in logs
    DURATION_PATTERNS = [
        re.compile(r'lasting\s+(\d+(?:\.\d+)?)\s*(ms|milliseconds|s|seconds|sec)\b', re.IGNORECASE),
        re.compile(r'(?:execution\s+time|took|duration|spent|time|elapsed|completed\s+in|ran\s+in)\s*[:=]?\s*(\d+(?:\.\d+)?)\s*(ms|milliseconds|s|seconds|sec)\b', re.IGNORECASE),
        re.compile(r'query\s+executed\s+in\s+(\d+(?:\.\d+)?)\s*(ms|s)\b', re.IGNORECASE),
        re.compile(r'\[(\d+(?:\.\d+)?)\s*(?:ms|s)\]', re.IGNORECASE),
        re.compile(r'duration\s*=\s*(\d+(?:\.\d+)?)\s*(ms|s)?\b', re.IGNORECASE),
        re.compile(r'Time:\s*(\d+(?:\.\d+)?)\s*(ms|s)?\b', re.IGNORECASE),
        re.compile(r'\b(\d+(?:\.\d+)?)\s*ms\b', re.IGNORECASE),
    ]

    # Regex for SQL statements embedded in log messages
    SQL_EXTRACT_PATTERNS = [
        re.compile(r'(SELECT\s+[\s\S]+?FROM\s+[\s\S]+?)(?:;|\]|\n\tat|\n\s*\d{4}-|$)', re.IGNORECASE),
        re.compile(r'(UPDATE\s+[\s\S]+?SET\s+[\s\S]+?)(?:;|\]|\n\tat|\n\s*\d{4}-|$)', re.IGNORECASE),
        re.compile(r'(DELETE\s+FROM\s+[\s\S]+?)(?:;|\]|\n\tat|\n\s*\d{4}-|$)', re.IGNORECASE),
        re.compile(r'sql\s*=\s*["\']([^"\']+)["\']', re.IGNORECASE),
        re.compile(r'statement\s*[:=]\s*\[(.*?)\]', re.IGNORECASE)
    ]

    # Contention signatures
    DEADLOCK_PATTERNS = [
        re.compile(r'deadlock\s+detected', re.IGNORECASE),
        re.compile(r'lock\s+timeout\s+exceeded', re.IGNORECASE),
        re.compile(r'PessimisticLockingFailure', re.IGNORECASE),
        re.compile(r'SqlTransactionException', re.IGNORECASE),
        re.compile(r'SQLCODE\s*[:=]?\s*-911', re.IGNORECASE),
        re.compile(r'SQLSTATE\s*[:=]?\s*40001', re.IGNORECASE),
        re.compile(r'IbsSpec(?:InclExcl)?Dao\.lock', re.IGNORECASE),
        re.compile(r'waiting\s+for\s+lock\s+on\s+([A-Za-z0-9_\.]+)', re.IGNORECASE)
    ]

    # Target Work Task and associated system tables
    WORKTASK_TABLES = [
        "T_TRIWORKTASK", "T_TASK", "IBS_SPEC_ASSIGNMENTS", "IBS_SPEC",
        "T_TRIASSET", "T_TRIBUILDING", "T_TRISPACE", "WF_EVENT", "WF_ACTIVE"
    ]

    @classmethod
    def _extract_duration_ms(cls, text: str) -> Optional[float]:
        """Extracts execution duration in milliseconds from a log line or message."""
        if not text:
            return None
        for p in cls.DURATION_PATTERNS:
            m = p.search(text)
            if m:
                try:
                    val = float(m.group(1))
                    unit = m.group(2).lower() if len(m.groups()) > 1 and m.group(2) else "ms"
                    if unit in ("s", "sec", "seconds"):
                        val *= 1000.0
                    return round(val, 2)
                except Exception:
                    pass
        return None

    @classmethod
    def _extract_sql_snippet(cls, text: str) -> str:
        """Extracts clean SQL query text from a log message or stack trace."""
        if not text:
            return ""
        for p in cls.SQL_EXTRACT_PATTERNS:
            m = p.search(text)
            if m:
                sql = m.group(1).strip()
                sql = re.sub(r'\s+', ' ', sql)
                if len(sql) > 10:
                    return sql[:1000]
        return ""

    @classmethod
    def _detect_tables(cls, text: str) -> List[str]:
        """Detects TRIRIGA database tables referenced in the message or SQL."""
        text_upper = text.upper()
        found = []
        for tbl in cls.WORKTASK_TABLES:
            if tbl in text_upper:
                found.append(tbl)
        # Catch any T_ table
        other_t_tables = re.findall(r'\b(T_[A-Z0-9_]+)\b', text_upper)
        for t in other_t_tables:
            if t not in found and len(t) > 3:
                found.append(t)
        return found if found else ["T_TRIWORKTASK"]

    @classmethod
    def _classify_incident(cls, text: str, duration_ms: Optional[float], log_level: str) -> Tuple[str, str]:
        """
        Classifies the incident into type and severity.
        Types: 'DEADLOCK', 'LOCK_CONTENTION', 'SLOW_QUERY', 'TABLE_SCAN', 'THREAD_BLOCKED'
        """
        text_lower = text.lower()

        if any(p.search(text) for p in cls.DEADLOCK_PATTERNS):
            if "deadlock" in text_lower or "-911" in text_lower or "40001" in text_lower:
                return "DEADLOCK", "CRITICAL"
            if "timeout" in text_lower or "pessimistic" in text_lower:
                return "LOCK_CONTENTION", "HIGH"
            return "LOCK_CONTENTION", "HIGH"

        if duration_ms is not None:
            if duration_ms >= 30000:
                return "SLOW_QUERY", "CRITICAL"
            elif duration_ms >= 5000:
                return "SLOW_QUERY", "HIGH"
            elif duration_ms >= 1000:
                return "SLOW_QUERY", "MEDIUM"
            else:
                return "SLOW_QUERY", "LOW"

        if "full table scan" in text_lower or "table scan" in text_lower or "rows_read" in text_lower:
            return "TABLE_SCAN", "HIGH"

        if "lock" in text_lower or "blocked" in text_lower:
            return "LOCK_CONTENTION", "MEDIUM"

        if log_level in ("ERROR", "FATAL"):
            return "SLOW_QUERY", "HIGH"

        return "SLOW_QUERY", "LOW"

    @classmethod
    def _generate_recommendation(
        cls,
        incident_type: str,
        sql: str,
        tables: List[str],
        worktask_ctrl: Optional[str],
        duration_ms: Optional[float]
    ) -> Dict[str, Any]:
        """Generates tailored DB2 Index DDL and TRIRIGA Workflow/Data Modeler optimization advice."""
        primary_table = tables[0] if tables else "T_TRIWORKTASK"
        title = "Query Index Tuning Required"
        category = "Database Indexing"
        db2_ddl = ""
        action_plan = []

        if incident_type == "DEADLOCK":
            title = f"Deadlock Contention on {primary_table} & IBS_SPEC_ASSIGNMENTS"
            category = "Concurrency & Lock Ordering"
            db2_ddl = f"CREATE INDEX TRIDATA.IDX_{primary_table}_CONCURRENCY ON TRIDATA.{primary_table} (SPEC_ID, SYS_OBJECTSTATE) ALLOW REVERSE SCANS;\nCREATE INDEX TRIDATA.IDX_SPEC_ASS_ORDER ON TRIDATA.IBS_SPEC_ASSIGNMENTS (SPEC_ID, ASS_SPEC_ID, ASS_TYPE) ALLOW REVERSE SCANS;"
            action_plan = [
                f"Deadlock detected during concurrent update of {worktask_ctrl or 'Work Task'} records.",
                "Ensure child association updates in synchronous workflows are ordered by SPEC_ID ascending to prevent circular lock wait graphs.",
                "Verify DB2 lock timeout setting (LOCKTIMEOUT parameter) is configured between 30 and 45 seconds.",
                "Convert high-frequency synchronous workflows on triWorkTask to Asynchronous events via WF_EVENT queue."
            ]

        elif incident_type == "LOCK_CONTENTION":
            title = f"Lock Wait Contention on {primary_table}"
            category = "Locking & Isolation"
            db2_ddl = f"CREATE INDEX TRIDATA.IDX_{primary_table}_LOCK_OPT ON TRIDATA.{primary_table} (SPEC_ID, SYS_PROJECTID, SYS_ORGID) ALLOW REVERSE SCANS;"
            action_plan = [
                f"Long-held row or table lock detected on {primary_table}.",
                "Check for uncommitted transactions in custom Java extensions or OSLC integration calls.",
                "Ensure TRIRIGA Query Builder queries referencing triWorkTask utilize 'Uncommitted Read' (WITH UR) where strict transactional consistency is not mandatory."
            ]

        elif primary_table == "IBS_SPEC_ASSIGNMENTS" or "IBS_SPEC_ASSIGNMENTS" in tables:
            title = "High-Cardinality Spec Assignment Join Bottleneck"
            category = "Association Optimization"
            db2_ddl = "CREATE INDEX TRIDATA.IDX_SPEC_ASS_COMPOSITE ON TRIDATA.IBS_SPEC_ASSIGNMENTS (SPEC_ID, ASS_TYPE, ASS_SPEC_ID) ALLOW REVERSE SCANS;"
            action_plan = [
                "Multi-hop association traversal is scanning large portions of IBS_SPEC_ASSIGNMENTS.",
                "Add composite index on (SPEC_ID, ASS_TYPE, ASS_SPEC_ID) to allow index-only access paths in DB2 optimizer.",
                "Limit TRIRIGA Workflow Query Task results to top 50 rows or filter by specific association type strings."
            ]

        else:
            title = f"Slow Query Scan on {primary_table}"
            category = "Index Optimization"
            db2_ddl = f"CREATE INDEX TRIDATA.IDX_{primary_table}_PERF ON TRIDATA.{primary_table} (SYS_OBJECTSTATE, SPEC_ID) ALLOW REVERSE SCANS;"
            action_plan = [
                f"Query on {primary_table} executed in {duration_ms or 'multiple'} ms.",
                "Create composite index on filtered columns in DB2 to eliminate expensive table scans.",
                "In TRIRIGA Data Modeler, verify that search filter fields on triWorkTask have 'Do Not Index' set to False."
            ]

        return {
            "title": title,
            "category": category,
            "primary_table": primary_table,
            "db2_ddl": db2_ddl,
            "action_plan": action_plan
        }

    @classmethod
    def _compute_timing_and_impact(
        cls,
        timestamp_str: str,
        duration_ms: Optional[float],
        incident_type: str,
        severity: str,
        tables: List[str],
        worktask_ctrl: Optional[str],
        workflow_name: Optional[str],
        thread_name: Optional[str]
    ) -> Dict[str, Any]:
        """Calculates precise query start time, end time, duration string, and system/business impact."""
        started_at = None
        completed_at = timestamp_str
        duration_formatted = None

        if duration_ms is not None:
            if duration_ms >= 1000:
                duration_formatted = f"{duration_ms / 1000.0:.2f}s ({int(duration_ms):,} ms)"
            else:
                duration_formatted = f"{int(duration_ms)} ms"

            try:
                # Calculate start time = completion timestamp - duration
                clean_ts = timestamp_str.replace("Z", "+00:00")
                end_dt = datetime.fromisoformat(clean_ts)
                start_dt = end_dt - timedelta(milliseconds=duration_ms)
                started_at = start_dt.strftime("%Y-%m-%d %H:%M:%S.%f")[:-3] + " UTC"
                completed_at = end_dt.strftime("%Y-%m-%d %H:%M:%S.%f")[:-3] + " UTC"
            except Exception:
                started_at = None
        else:
            duration_formatted = "Active Lock Wait" if incident_type in ("DEADLOCK", "LOCK_CONTENTION") else "Unspecified in Log"

        primary_table = tables[0] if tables else "T_TRIWORKTASK"
        task_label = worktask_ctrl or "Work Task record"

        # Formulate system impact
        if incident_type == "DEADLOCK":
            system_impact = f"DB2 Lock Manager aborted transaction (SQLCODE=-911, SQLSTATE=40001) due to cyclical lock contention on {primary_table}. Forced immediate rollback."
            business_impact = f"Immediate transaction failure on {task_label}. Changes were not persisted; requires automated retry or manual user re-save."
        elif incident_type == "LOCK_CONTENTION":
            dur_text = f"for {duration_formatted}" if duration_ms else "during concurrent execution"
            system_impact = f"Thread '{thread_name or 'WFAgent'}' blocked in lock-wait state {dur_text} on {primary_table}, consuming connection slot and stalling worker queue."
            business_impact = f"Delays background processing and prevents concurrent updates on {task_label}."
        elif incident_type == "TABLE_SCAN":
            system_impact = f"Full table scan on {primary_table} scanning unindexed rows, flooding DB2 buffer pool and displacing cached data pages."
            business_impact = f"Generates high database I/O latency, slowing down all concurrent TRIRIGA users and background agents."
        else:
            # SLOW_QUERY
            if duration_ms and duration_ms >= 30000:
                system_impact = f"Critical long-running query ({duration_formatted}) held database connection on {primary_table}, causing thread starvation across cluster."
                business_impact = f"Severe UI freeze or timeout (>30s) during {task_label} lookup, approval, or status update."
            elif duration_ms and duration_ms >= 5000:
                system_impact = f"High execution latency ({duration_formatted}) on {primary_table} with un-indexed filter criteria."
                business_impact = f"Noticeable latency (>5s) for technicians and administrators loading {task_label}."
            elif duration_ms and duration_ms >= 1000:
                system_impact = f"Moderate query execution time ({duration_formatted}) on {primary_table}."
                business_impact = f"Elevated latency during automated workflow dispatch or batch search."
            else:
                system_impact = f"Sub-second query or un-timed event logged on {primary_table}."
                business_impact = f"Minimal immediate impact on {task_label}."

        return {
            "started_at": started_at,
            "completed_at": completed_at,
            "duration_formatted": duration_formatted,
            "system_impact": system_impact,
            "business_impact": business_impact
        }

    @classmethod
    def get_queries_and_contention(
        cls,
        server_id: Optional[int] = None,
        server_ids: Optional[str] = None,
        issue_type: Optional[str] = None,
        min_duration_ms: int = 1000,
        search: Optional[str] = None,
        worktask_identifier: Optional[str] = None,
        start_time: Optional[str] = None,
        end_time: Optional[str] = None,
        page: int = 1,
        page_size: int = 50
    ) -> Dict[str, Any]:
        """
        Scans amalgamated cluster logs and extracts slow queries and lock contentions
        specifically correlated with Work Tasks (triWorkTask) and Workflow Tasks.
        """
        offset = (page - 1) * page_size
        conditions = []
        params: List[Any] = []

        # Server filter
        if server_ids and server_ids.strip() and server_ids.upper() != "ALL":
            sids = [int(s.strip()) for s in server_ids.split(",") if s.strip().isdigit()]
            if sids:
                placeholders = ",".join("?" * len(sids))
                conditions.append(f"e.server_id IN ({placeholders})")
                params.extend(sids)
        elif server_id:
            conditions.append("e.server_id = ?")
            params.append(server_id)

        # Date / Time filter
        if start_time and start_time.strip():
            st = start_time.strip()
            if len(st) == 10 and re.match(r"^\d{4}-\d{2}-\d{2}$", st):
                st = f"{st}T00:00:00.000Z"
            conditions.append("e.timestamp >= ?")
            params.append(st)

        if end_time and end_time.strip():
            et = end_time.strip()
            if len(et) == 10 and re.match(r"^\d{4}-\d{2}-\d{2}$", et):
                et = f"{et}T23:59:59.999Z"
            conditions.append("e.timestamp <= ?")
            params.append(et)

        # Exclude internal admin console / monitoring script executions
        exclusions = """
            (
                e.logger_name NOT LIKE '%DBScriptRunner%'
                AND e.message NOT LIKE '%DBScriptRunner%'
                AND e.message NOT LIKE '%MON_GET_PKG_CACHE_STMT%'
                AND e.message NOT LIKE '%MON_LOCKWAITS%'
                AND e.message NOT LIKE '%SYSIBMADM.MON_%'
                AND e.message NOT LIKE '%TABLE(MON_%'
                AND e.message NOT LIKE '%SELECT SUBSTR(STMT_TEXT%'
                AND e.message NOT LIKE '%SELECT TABNAME, HLD_%'
                AND e.message NOT LIKE '%SELECT AI.APPL_NAME%'
                AND e.message NOT LIKE '%SELECT S.AGENT_NAME%'
            )
        """
        conditions.append(exclusions)

        # Target WorkTask keywords in logs: worktask, sql, deadlock, lock, query, duration, time, spec_id
        if min_duration_ms > 0:
            duration_kw = """
                (
                    (e.message LIKE '%lasting%ms%' AND e.message NOT LIKE '%lasting _ ms%' AND e.message NOT LIKE '%lasting __ ms%' AND e.message NOT LIKE '%lasting ___ ms%')
                    OR e.message LIKE '%lasting%second%'
                    OR e.message LIKE '%duration=%' OR e.message LIKE '%Execution time%'
                    OR e.message LIKE '%query executed in%' OR e.message LIKE '%[%ms]%'
                    OR e.message LIKE '%worktask%' OR e.message LIKE '%triWorkTask%' OR e.message LIKE '%WRK-%'
                    OR e.message LIKE '%T_TRIWORKTASK%' OR e.message LIKE '%IBS_SPEC_ASSIGNMENTS%'
                    OR e.message LIKE '%deadlock%' OR e.message LIKE '%lock wait%' OR e.message LIKE '%PessimisticLocking%'
                    OR e.message LIKE '%SQLCODE%-911%' OR e.stack_trace LIKE '%deadlock%'
                    OR e.logger_name LIKE '%PerformanceLogger%'
                )
            """
            conditions.append(duration_kw)
        else:
            kw_conditions = """
                (
                    e.message LIKE '%worktask%' OR e.message LIKE '%triWorkTask%' OR e.message LIKE '%WRK-%' 
                    OR e.message LIKE '%T_TRIWORKTASK%' OR e.message LIKE '%IBS_SPEC_ASSIGNMENTS%'
                    OR e.message LIKE '%deadlock%' OR e.message LIKE '%lock wait%' OR e.message LIKE '%PessimisticLocking%'
                    OR e.message LIKE '%Execution time%' OR e.message LIKE '%Slow query%' OR e.message LIKE '%duration=%'
                    OR e.message LIKE '%lasting%'
                    OR e.stack_trace LIKE '%T_TRIWORKTASK%' OR e.stack_trace LIKE '%IbsSpec%' OR e.stack_trace LIKE '%WFAgent%'
                    OR e.logger_name LIKE '%SqlSession%' OR e.logger_name LIKE '%PerformanceLogger%' OR e.logger_name LIKE '%WFAgent%'
                )
            """
            conditions.append(kw_conditions)

        if search and search.strip():
            s_clean = f"%{search.strip()}%"
            conditions.append("(e.message LIKE ? OR e.stack_trace LIKE ? OR e.logger_name LIKE ? OR lf.filename LIKE ?)")
            params.extend([s_clean, s_clean, s_clean, s_clean])

        where_clause = "WHERE " + " AND ".join(conditions)

        with db_read_session() as conn:
            cur = conn.cursor()
            query = f"""
                SELECT 
                    e.id, e.server_id, e.file_id, e.timestamp, e.log_level,
                    e.logger_name, e.thread_name, e.message, e.stack_trace,
                    e.error_hash, e.line_number, s.name as server_name, lf.filename, lf.file_type
                FROM log_entries e
                JOIN servers s ON e.server_id = s.id
                JOIN log_files lf ON e.file_id = lf.id
                {where_clause}
                ORDER BY e.timestamp DESC
                LIMIT 500;
            """
            cur.execute(query, params)
            rows = dict_list_from_rows(cur.fetchall())

        # Process each row, extract worktask details, latency, and categorize
        processed: List[Dict[str, Any]] = []
        total_slow_queries = 0
        total_contentions = 0
        total_deadlocks = 0
        max_duration = 0.0

        for r in rows:
            msg = r.get("message", "")
            trace = r.get("stack_trace", "")
            combined_text = f"{msg}\n{trace or ''}"

            duration_ms = cls._extract_duration_ms(combined_text)
            sql_snippet = cls._extract_sql_snippet(combined_text)
            tables = cls._detect_tables(combined_text)
            incident_type, severity = cls._classify_incident(combined_text, duration_ms, r.get("log_level", "INFO"))

            # Filter by min_duration_ms if specified (> 0)
            if min_duration_ms > 0:
                if incident_type == "SLOW_QUERY":
                    if duration_ms is None or duration_ms < min_duration_ms:
                        continue
                elif duration_ms is not None and duration_ms < min_duration_ms:
                    continue

            # Filter by issue_type if specified
            if issue_type and issue_type.upper() != "ALL":
                if issue_type.upper() == "SLOW_QUERY" and incident_type != "SLOW_QUERY":
                    continue
                if issue_type.upper() == "LOCK_CONTENTION" and incident_type not in ("LOCK_CONTENTION", "DEADLOCK"):
                    continue
                if issue_type.upper() == "DEADLOCK" and incident_type != "DEADLOCK":
                    continue
                if issue_type.upper() == "TABLE_SCAN" and incident_type != "TABLE_SCAN":
                    continue

            # Exclude internal admin console / monitoring script executions
            logger_n = r.get("logger_name") or ""
            if "DBScriptRunner" in logger_n or "DBScriptRunner" in msg:
                continue
            if "MON_GET_" in combined_text or "MON_LOCKWAITS" in combined_text or "TABLE(MON_" in combined_text or "SYSIBMADM" in combined_text:
                continue
            if "SELECT SUBSTR(STMT_TEXT" in combined_text or "SELECT TABNAME, HLD_" in combined_text or "SELECT AI.APPL_NAME" in combined_text:
                continue

            # Extract TRIRIGA identifiers
            extracted_ids = TririgaResolver.extract_identifiers(combined_text)
            spec_ids = extracted_ids.get("spec_ids", [])
            wf_ids = extracted_ids.get("wf_ids", [])

            # Check for WRK- control numbers
            wrk_ctrl_match = re.search(r'\b(WRK-\d{5,8}|TASK-\d{5,8}|WO-\d{5,8})\b', combined_text, re.IGNORECASE)
            worktask_ctrl = wrk_ctrl_match.group(1).upper() if wrk_ctrl_match else None

            # Resolve work task record
            worktask_rec = None
            if spec_ids:
                worktask_rec = TririgaResolver.resolve_spec(spec_ids[0])
                if not worktask_ctrl and worktask_rec.get("control_number"):
                    worktask_ctrl = worktask_rec.get("control_number")

            # Resolve workflow template & task step
            workflow_rec = None
            if wf_ids:
                workflow_rec = TririgaResolver.resolve_workflow(wf_ids[0])

            wf_step_name = None
            for p in TririgaResolver.WF_TASK_STEP_PATTERNS:
                m = p.search(combined_text)
                if m:
                    wf_step_name = m.group(1).strip()
                    break

            # Check if matching worktask_identifier filter
            if worktask_identifier and worktask_identifier.strip():
                wid = worktask_identifier.strip().upper()
                if worktask_ctrl != wid and str(spec_ids) not in wid and wid not in str(worktask_rec):
                    continue

            if duration_ms is not None:
                max_duration = max(max_duration, duration_ms)

            if incident_type == "DEADLOCK":
                total_deadlocks += 1
            elif incident_type == "LOCK_CONTENTION":
                total_contentions += 1
            elif incident_type == "SLOW_QUERY":
                total_slow_queries += 1

            # Cross-reference incident context when no SQL or uncataloged spec
            cross_ref = cls._cross_reference_incident(
                server_id=r["server_id"],
                thread_name=r.get("thread_name"),
                timestamp=r["timestamp"],
                entry_id=r["id"],
                spec_id=spec_ids[0] if spec_ids else None,
                message=msg,
                stack_trace=trace
            )
            # Calculate start time, duration string, and system/business impact
            wf_name_str = workflow_rec.get("template_name") if workflow_rec else None
            timing_info = cls._compute_timing_and_impact(
                timestamp_str=r["timestamp"],
                duration_ms=duration_ms,
                incident_type=incident_type,
                severity=severity,
                tables=tables,
                worktask_ctrl=worktask_ctrl,
                workflow_name=wf_name_str,
                thread_name=r.get("thread_name")
            )

            # Generate fix recommendations
            recom = cls._generate_recommendation(incident_type, sql_snippet, tables, worktask_ctrl, duration_ms)

            processed.append({
                "id": r["id"],
                "server_id": r["server_id"],
                "server_name": r["server_name"],
                "timestamp": r["timestamp"],
                "started_at": timing_info["started_at"],
                "completed_at": timing_info["completed_at"],
                "duration_ms": duration_ms,
                "duration_formatted": timing_info["duration_formatted"],
                "system_impact": timing_info["system_impact"],
                "business_impact": timing_info["business_impact"],
                "log_level": r["log_level"],
                "thread_name": r.get("thread_name"),
                "logger_name": r["logger_name"],
                "filename": r["filename"],
                "incident_type": incident_type,
                "severity": severity,
                "sql_statement": sql_snippet or None,
                "tables_involved": tables,
                "worktask": {
                    "control_number": worktask_ctrl or (worktask_rec.get("control_number") if worktask_rec else None),
                    "spec_id": spec_ids[0] if spec_ids else (worktask_rec.get("spec_id") if worktask_rec else None),
                    "name": worktask_rec.get("spec_name") if worktask_rec else None,
                    "status": worktask_rec.get("status") if worktask_rec else None,
                    "priority": worktask_rec.get("priority") if worktask_rec else None,
                    "assigned_to": worktask_rec.get("assigned_to") if worktask_rec else None,
                    "location": worktask_rec.get("location") if worktask_rec else None
                },
                "workflow": {
                    "template_id": wf_ids[0] if wf_ids else (workflow_rec.get("wf_id") if workflow_rec else None),
                    "template_name": workflow_rec.get("template_name") if workflow_rec else None,
                    "task_step": wf_step_name,
                    "event_name": workflow_rec.get("event_name") if workflow_rec else None
                } if (wf_ids or workflow_rec or wf_step_name) else None,
                "cross_referenced_context": cross_ref,
                "recommendation": recom,
                "raw_message": msg,
                "stack_trace": trace
            })

        # Paginate results
        total_count = len(processed)
        paged_items = processed[offset : offset + page_size]

        return {
            "items": paged_items,
            "total": total_count,
            "page": page,
            "page_size": page_size,
            "total_pages": (total_count + page_size - 1) // page_size if total_count > 0 else 1,
            "metrics": {
                "total_incidents": total_count,
                "slow_queries_count": total_slow_queries,
                "lock_contentions_count": total_contentions,
                "deadlocks_count": total_deadlocks,
                "max_latency_ms": round(max_duration, 2),
                "high_contention_tables": ["T_TRIWORKTASK", "IBS_SPEC_ASSIGNMENTS", "WF_EVENT"]
            }
        }

    @classmethod
    def _cross_reference_incident(
        cls,
        server_id: int,
        thread_name: Optional[str],
        timestamp: str,
        entry_id: int,
        spec_id: Optional[int],
        message: str,
        stack_trace: Optional[str]
    ) -> Dict[str, Any]:
        """
        Cross-references an incident that has no direct SQL with other system data:
        1. Sibling log lines on the same thread/server within a temporal execution window (+/- 5 seconds).
        2. Other log entries mentioning the same SPEC_ID across the cluster.
        3. Exception stack frame signatures (IbsSpecDao, SOFieldMap, OSLC handlers, State transitions).
        """
        correlated_events = []
        inferred_subsystem = "Core Platform"
        root_cause = None

        full_text = f"{message}\n{stack_trace or ''}"

        # 1. Stack trace / error signature diagnosis
        if "IbsSpecDao.lock" in full_text or "IbsSpecInclExclDao.lock" in full_text:
            inferred_subsystem = "Association Engine (IBS_SPEC_ASSIGNMENTS)"
            root_cause = "Pessimistic association lock contention during concurrent record association updates. Lock ordering cycle between parallel threads."
        elif "SOFieldMapImpl" in full_text or "MapEntry Field-to-Field" in full_text:
            inferred_subsystem = "Workflow SmartObject Mapping"
            root_cause = "Workflow Smart Object field-to-field evaluation error or slow mapping traversal on un-indexed business object fields."
        elif "OslcRequestDispatcherImpl" in full_text or "OslcCreationHandler" in full_text or "CommonQuerySerializer" in full_text:
            inferred_subsystem = "OSLC REST Integration"
            root_cause = "External OSLC integration query or record creation failure. Heavy unpaginated JSON/XML payload processing."
        elif "No transition exists on this Business Object" in full_text or "BoStateImpl" in full_text:
            inferred_subsystem = "State Machine & Actions"
            root_cause = "Invalid state transition attempted by synchronous workflow or automated agent while object was in a non-permitted state."
        elif "CreateAFPAndExpenditureLineItems" in full_text:
            inferred_subsystem = "Custom Financial Extension"
            root_cause = "Custom Java extension creating multiple line items in a tight loop holding uncommitted row locks."
        elif "Clear All Hierarchy Caches" in full_text:
            inferred_subsystem = "Platform Cache Manager"
            root_cause = "Periodic hierarchy cache flush causing temporary thread blocking on metadata cache read locks."

        # 2. Thread-level temporal cross-referencing
        if thread_name and thread_name.strip():
            with db_read_session() as conn:
                cur = conn.cursor()
                cur.execute("""
                    SELECT id, timestamp, log_level, logger_name, message
                    FROM log_entries
                    WHERE server_id = ? AND thread_name = ? AND id != ?
                      AND logger_name NOT LIKE '%DBScriptRunner%'
                      AND message NOT LIKE '%DBScriptRunner%'
                    ORDER BY ABS(julianday(timestamp) - julianday(?)) ASC
                    LIMIT 4
                """, (server_id, thread_name, entry_id, timestamp))
                rows = dict_list_from_rows(cur.fetchall())
                for row in rows:
                    correlated_events.append({
                        "id": row["id"],
                        "timestamp": row["timestamp"],
                        "log_level": row["log_level"],
                        "logger_name": row["logger_name"],
                        "message_snippet": (row["message"] or "")[:150]
                    })

        # 3. Spec ID cross-referencing across other logs
        spec_related_logs = []
        if spec_id:
            with db_read_session() as conn:
                cur = conn.cursor()
                cur.execute("""
                    SELECT id, timestamp, log_level, logger_name, message
                    FROM log_entries
                    WHERE (message LIKE ? OR stack_trace LIKE ?) AND id != ?
                      AND logger_name NOT LIKE '%DBScriptRunner%'
                    ORDER BY timestamp DESC
                    LIMIT 3
                """, (f"%{spec_id}%", f"%{spec_id}%", entry_id))
                spec_rows = dict_list_from_rows(cur.fetchall())
                for srow in spec_rows:
                    spec_related_logs.append({
                        "id": srow["id"],
                        "timestamp": srow["timestamp"],
                        "log_level": srow["log_level"],
                        "logger_name": srow["logger_name"],
                        "message_snippet": (srow["message"] or "")[:150]
                    })

        return {
            "inferred_subsystem": inferred_subsystem,
            "root_cause_diagnosis": root_cause,
            "correlated_thread_events": correlated_events,
            "spec_related_logs": spec_related_logs
        }

    @classmethod
    async def get_live_telemetry(cls, server_info: Dict[str, Any]) -> Dict[str, Any]:
        """
        Queries DB2 live monitor views (MON_LOCKWAITS, TOP_DYNAMIC_SQL, WF_EVENT, WF_ACTIVE)
        specifically targeting Work Task tables and active lock contention.
        """
        t0 = time.perf_counter()

        # 1. Query Lock Waits on WorkTask tables
        lock_sql = (
            "SELECT TABNAME, HLD_APPLICATION_HANDLE, HLD_USERID, HLD_CURRENT_STMT_TEXT, "
            "LOCK_MODE, REQ_APPLICATION_HANDLE, LOCK_WAIT_ELAPSED_TIME / 1000 AS WAIT_SECS "
            "FROM SYSIBMADM.MON_LOCKWAITS "
            "WHERE TABNAME IN ('T_TRIWORKTASK', 'IBS_SPEC_ASSIGNMENTS', 'T_TASK', 'WF_EVENT', 'T_REQUISITION')"
        )
        lock_res = await TririgaAdminClient.execute_query_via_admin_console(server_info, lock_sql)

        # 2. Query Top Slow Dynamic SQL on WorkTask tables
        slow_sql = (
            "SELECT SUBSTR(STMT_TEXT, 1, 250) AS QUERY_SNIPPET, NUM_EXECUTIONS, "
            "TOTAL_ACT_TIME / 1000 AS TOTAL_EXEC_MS, "
            "(TOTAL_ACT_TIME / CASE WHEN NUM_EXECUTIONS = 0 THEN 1 ELSE NUM_EXECUTIONS END) / 1000 AS AVG_EXEC_MS, "
            "ROWS_READ, ROWS_RETURNED "
            "FROM TABLE(MON_GET_PKG_CACHE_STMT('D', CAST(NULL AS VARCHAR(128)), CAST(NULL AS VARCHAR(128)), -2)) AS M "
            "WHERE UPPER(STMT_TEXT) LIKE '%T_TRIWORKTASK%' OR UPPER(STMT_TEXT) LIKE '%IBS_SPEC_ASSIGNMENTS%' "
            "ORDER BY TOTAL_ACT_TIME DESC FETCH FIRST 15 ROWS ONLY"
        )
        slow_res = await TririgaAdminClient.execute_query_via_admin_console(server_info, slow_sql)

        # 3. Query Active Workflows for WorkTasks
        wf_active_sql = (
            "SELECT a.WF_IID, a.WF_TEMPLATE_ID, t.WF_NAME, a.START_DATETIME, a.USER_ID, a.MACHINE_ID "
            "FROM WF_ACTIVE a LEFT JOIN WF_TEMPLATE t ON a.WF_TEMPLATE_ID = t.WF_TEMPLATE_ID "
            "WHERE UPPER(t.WF_NAME) LIKE '%WORKTASK%' OR UPPER(t.WF_NAME) LIKE '%TASK%' "
            "FETCH FIRST 20 ROWS ONLY"
        )
        wf_active_res = await TririgaAdminClient.execute_query_via_admin_console(server_info, wf_active_sql)

        dur_ms = round((time.perf_counter() - t0) * 1000, 2)
        success = lock_res.get("success", False) or slow_res.get("success", False) or wf_active_res.get("success", False)
        error = lock_res.get("error") or slow_res.get("error") or wf_active_res.get("error")

        return {
            "success": success,
            "error": error if not success else None,
            "server_id": server_info.get("id"),
            "server_name": server_info.get("name"),
            "execution_time_ms": dur_ms,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "lock_contentions": lock_res.get("rows", []),
            "slow_dynamic_queries": slow_res.get("rows", []),
            "active_worktask_workflows": wf_active_res.get("rows", []),
            "has_active_locks": len(lock_res.get("rows", [])) > 0
        }

    @classmethod
    def resolve_worktask_record(cls, identifier: str) -> Dict[str, Any]:
        """Resolves a Work Task record by Spec ID or Control Number from real log data and database records."""
        clean_id = identifier.strip()
        spec_id = int(clean_id) if clean_id.isdigit() else None
        control_num = clean_id if not clean_id.isdigit() else None

        spec_rec = None
        if spec_id:
            spec_rec = TririgaResolver.resolve_spec(spec_id)
            if spec_rec.get("control_number"):
                control_num = spec_rec["control_number"]
        elif control_num:
            with db_read_session() as conn:
                cur = conn.cursor()
                cur.execute("SELECT * FROM tririga_resolved_specs WHERE control_number = ? LIMIT 1", (control_num,))
                row = cur.fetchone()
                if row:
                    spec_rec = dict_from_row(row)
                    spec_id = spec_rec.get("spec_id")

        # Find recent log entries referring to this identifier
        recent_logs = []
        with db_read_session() as conn:
            cur = conn.cursor()
            cur.execute("""
                SELECT e.id, e.timestamp, e.log_level, e.message, e.logger_name, lf.filename, e.thread_name
                FROM log_entries e
                JOIN log_files lf ON e.file_id = lf.id
                WHERE (e.message LIKE ? OR e.stack_trace LIKE ?)
                  AND e.logger_name NOT LIKE '%DBScriptRunner%'
                  AND e.message NOT LIKE '%DBScriptRunner%'
                ORDER BY e.timestamp DESC
                LIMIT 10
            """, (f"%{clean_id}%", f"%{clean_id}%"))
            recent_logs = dict_list_from_rows(cur.fetchall())

        # Synthesize cross-referenced insights from recent logs
        inferred_subsystem = None
        inferred_root_cause = None
        if recent_logs:
            sample_msg = recent_logs[0].get("message", "")
            sample_thread = recent_logs[0].get("thread_name")
            sample_server_id = recent_logs[0].get("server_id", 1)
            sample_time = recent_logs[0].get("timestamp", "")
            sample_id = recent_logs[0].get("id", 0)

            diag = cls._cross_reference_incident(
                server_id=sample_server_id,
                thread_name=sample_thread,
                timestamp=sample_time,
                entry_id=sample_id,
                spec_id=spec_id,
                message=sample_msg,
                stack_trace=None
            )
            inferred_subsystem = diag.get("inferred_subsystem")
            inferred_root_cause = diag.get("root_cause_diagnosis")

        return {
            "spec_id": spec_id,
            "control_number": control_num or (f"REC-{spec_id}" if spec_id else clean_id),
            "name": spec_rec.get("spec_name") if spec_rec else None,
            "module_name": spec_rec.get("module_name") if spec_rec else ("triTask" if "WRK" in clean_id.upper() else None),
            "bo_name": spec_rec.get("bo_name") if spec_rec else ("triWorkTask" if "WRK" in clean_id.upper() else None),
            "status": spec_rec.get("status") if spec_rec else None,
            "priority": spec_rec.get("priority") if spec_rec else None,
            "assigned_to": spec_rec.get("assigned_to") if spec_rec else None,
            "location": spec_rec.get("location") if spec_rec else None,
            "description": spec_rec.get("description") if spec_rec else None,
            "is_resolved": spec_rec.get("is_resolved", False) if spec_rec else False,
            "associated_logs_count": len(recent_logs),
            "recent_logs": recent_logs,
            "inferred_subsystem": inferred_subsystem,
            "root_cause_diagnosis": inferred_root_cause
        }

    @classmethod
    def get_workflow_bottlenecks(cls, server_id: Optional[int] = None) -> Dict[str, Any]:
        """
        Dynamically analyzes actual workflow engine errors, deadlocks, and slow tasks
        directly from the ingested cluster log database.
        """
        conditions = [
            """(
                e.logger_name LIKE '%Workflow%' OR e.logger_name LIKE '%WFAgent%' OR e.logger_name LIKE '%WorkflowEngine%'
                OR e.message LIKE '%Workflow%' OR e.message LIKE '%WFAgent%' OR e.message LIKE '%Deadlock detected%'
                OR e.stack_trace LIKE '%WorkflowEngine%' OR e.stack_trace LIKE '%WFAgent%'
            )"""
        ]
        params: List[Any] = []
        if server_id:
            conditions.append("e.server_id = ?")
            params.append(server_id)

        where = "WHERE " + " AND ".join(conditions)

        with db_read_session() as conn:
            cur = conn.cursor()
            cur.execute(f"""
                SELECT e.id, e.timestamp, e.log_level, e.logger_name, e.message, e.stack_trace, e.error_hash
                FROM log_entries e
                {where}
                ORDER BY e.timestamp DESC
                LIMIT 500
            """, params)
            rows = dict_list_from_rows(cur.fetchall())

        aggregated: Dict[str, Dict[str, Any]] = {}
        for r in rows:
            msg = r.get("message", "")
            trace = r.get("stack_trace", "")
            full = f"{msg}\n{trace or ''}"

            extracted = TririgaResolver.extract_identifiers(full)
            wf_ids = extracted.get("wf_ids", [])
            dur = cls._extract_duration_ms(full)

            key = f"wf_{wf_ids[0]}" if wf_ids else (r.get("error_hash") or r.get("logger_name", "WFAgent"))

            if key not in aggregated:
                wf_rec = TririgaResolver.resolve_workflow(wf_ids[0]) if wf_ids else None
                wf_step = None
                for p in TririgaResolver.WF_TASK_STEP_PATTERNS:
                    m = p.search(full)
                    if m:
                        wf_step = m.group(1).strip()
                        break

                is_deadlock = "deadlock" in full.lower() or "-911" in full
                aggregated[key] = {
                    "workflow_id": wf_ids[0] if wf_ids else None,
                    "workflow_name": wf_rec.get("template_name") if wf_rec else None,
                    "task_step": wf_step,
                    "task_type": "Workflow Deadlock" if is_deadlock else ("Workflow Error" if r.get("log_level") in ("ERROR", "FATAL") else "Workflow Task Event"),
                    "target_table": "IBS_SPEC_ASSIGNMENTS" if "IBS_SPEC" in full else ("T_TRIWORKTASK" if "WORKTASK" in full.upper() else "WF_EVENT"),
                    "occurrences": 0,
                    "durations": [],
                    "latest_message": msg[:200],
                    "impact": "Deadlock lock timeout during concurrent task execution" if is_deadlock else "Workflow processing event in logs",
                    "remedy": "Order association updates by SPEC_ID ascending and add composite index on IBS_SPEC_ASSIGNMENTS." if is_deadlock else "Review WFAgent thread utilization and query indexes."
                }

            aggregated[key]["occurrences"] += 1
            if dur:
                aggregated[key]["durations"].append(dur)

        bottlenecks = []
        for item in aggregated.values():
            dur_list = item.pop("durations")
            avg_dur = round(sum(dur_list) / len(dur_list), 1) if dur_list else None
            item["avg_duration_ms"] = avg_dur
            bottlenecks.append(item)

        bottlenecks.sort(key=lambda x: x["occurrences"], reverse=True)

        return {
            "bottlenecks": bottlenecks[:15],
            "total_bottlenecks_detected": len(bottlenecks)
        }
