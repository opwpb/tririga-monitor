import json
import httpx
import sqlite3
import re
import socket
from urllib.parse import urlparse
from typing import List, Dict, Any, Optional, AsyncGenerator
from datetime import datetime, timezone, timedelta
from ..db.database import db_session, dict_from_row, dict_list_from_rows
from .tririga_resolver import TririgaResolver

class ThinkingFilter:
    """Stateful filter to separate <think>...</think> and <thought>...</thought> tags from content."""
    def __init__(self):
        self.in_think = False
        self.buffer = ""

    def process(self, chunk: str):
        """Returns tuple (content_chunk, thought_chunk)."""
        if not chunk:
            return "", ""
        self.buffer += chunk
        content_out = []
        thought_out = []

        while self.buffer:
            if not self.in_think:
                lower = self.buffer.lower()
                idx_think = lower.find("<think>")
                idx_thought = lower.find("<thought>")
                idx = -1
                tag_len = 0
                if idx_think != -1 and idx_thought != -1:
                    idx = min(idx_think, idx_thought)
                    tag_len = 7 if idx == idx_think else 9
                elif idx_think != -1:
                    idx = idx_think
                    tag_len = 7
                elif idx_thought != -1:
                    idx = idx_thought
                    tag_len = 9

                if idx != -1:
                    content_out.append(self.buffer[:idx])
                    self.buffer = self.buffer[idx + tag_len:]
                    self.in_think = True
                else:
                    # Check for partial start tag at the end of buffer
                    partial_len = 0
                    for tag in ("<think>", "<thought>"):
                        for i in range(len(tag) - 1, 0, -1):
                            if lower.endswith(tag[:i]):
                                if i > partial_len:
                                    partial_len = i
                    if partial_len > 0:
                        content_out.append(self.buffer[:-partial_len])
                        self.buffer = self.buffer[-partial_len:]
                    else:
                        content_out.append(self.buffer)
                        self.buffer = ""
                    break
            else:
                lower = self.buffer.lower()
                idx_think = lower.find("</think>")
                idx_thought = lower.find("</thought>")
                idx = -1
                tag_len = 0
                if idx_think != -1 and idx_thought != -1:
                    idx = min(idx_think, idx_thought)
                    tag_len = 8 if idx == idx_think else 10
                elif idx_think != -1:
                    idx = idx_think
                    tag_len = 8
                elif idx_thought != -1:
                    idx = idx_thought
                    tag_len = 10

                if idx != -1:
                    thought_out.append(self.buffer[:idx])
                    self.buffer = self.buffer[idx + tag_len:]
                    self.in_think = False
                else:
                    # Check for partial end tag at the end of buffer
                    partial_len = 0
                    for tag in ("</think>", "</thought>"):
                        for i in range(len(tag) - 1, 0, -1):
                            if lower.endswith(tag[:i]):
                                if i > partial_len:
                                    partial_len = i
                    if partial_len > 0:
                        thought_out.append(self.buffer[:-partial_len])
                        self.buffer = self.buffer[-partial_len:]
                    else:
                        thought_out.append(self.buffer)
                        self.buffer = ""
                    break

        return "".join(content_out), "".join(thought_out)

    def flush(self):
        """Flushes any remaining un-streamed buffer content."""
        buf = self.buffer
        self.buffer = ""
        if self.in_think:
            return "", buf
        return buf, ""

def format_ordinal_date(dt: Optional[datetime] = None) -> str:
    """Format a datetime with ordinal day suffix in British/Irish format (e.g. 8th September 2026)."""
    if dt is None:
        dt = datetime.now()
    day = dt.day
    if 11 <= (day % 100) <= 13:
        suffix = 'th'
    else:
        suffix = {1: 'st', 2: 'nd', 3: 'rd'}.get(day % 10, 'th')
    return f"{day}{suffix} {dt.strftime('%B %Y')}"

class LocalLLMService:
    """Interfaces with local LLMs (Ollama, LM Studio, OpenAI-compatible local servers)."""

    @classmethod
    async def resolve_active_model_name(cls, provider: str, base_url: str, requested_model: Optional[str]) -> str:
        """Resolves the exact model ID available in the local LLM server."""
        if requested_model and requested_model not in ("local-model", "", "undefined"):
            return requested_model
        try:
            models = await cls.list_available_models(provider, base_url)
            if models and len(models) > 0:
                return models[0]["id"]
        except Exception:
            pass
        return requested_model or ("llama3" if provider == "ollama" else "local-model")

    @staticmethod
    async def list_available_models(provider: str, base_url: str) -> List[Dict[str, Any]]:
        """Lists models from Ollama or LM Studio / OpenAI-compatible endpoint with instant port check."""
        # Replace localhost with 127.0.0.1 to avoid Windows IPv6 resolution latency
        normalized_url = base_url.replace("://localhost:", "://127.0.0.1:").replace("://localhost/", "://127.0.0.1/")
        if normalized_url.endswith("://localhost"):
            normalized_url = normalized_url.replace("://localhost", "://127.0.0.1")

        # Fast socket probe: if local port is not listening, return immediately in 1ms instead of waiting seconds
        try:
            parsed = urlparse(normalized_url)
            host = parsed.hostname or "127.0.0.1"
            if host in ("127.0.0.1", "localhost"):
                port = parsed.port or (11434 if provider == "ollama" else 1234)
                with socket.create_connection((host, port), timeout=0.15):
                    pass
        except Exception:
            return []

        models = []
        try:
            timeout_cfg = httpx.Timeout(connect=0.5, read=1.5, write=1.0, pool=1.0)
            async with httpx.AsyncClient(timeout=timeout_cfg) as client:
                if provider == "ollama":
                    url = f"{normalized_url.rstrip('/')}/api/tags"
                    res = await client.get(url)
                    if res.status_code == 200:
                        data = res.json()
                        for m in data.get("models", []):
                            models.append({
                                "id": m.get("name"),
                                "name": m.get("name"),
                                "size": m.get("size", 0),
                                "modified_at": m.get("modified_at")
                            })
                else: # lm_studio or openai_compatible
                    # Check LM Studio native v0 API first to detect loaded state and context length
                    root_url = normalized_url.split('/v1')[0].rstrip('/')
                    v0_succeeded = False
                    try:
                        v0_res = await client.get(f"{root_url}/api/v0/models")
                        if v0_res.status_code == 200:
                            v0_data = v0_res.json().get("data", [])
                            for m in v0_data:
                                models.append({
                                    "id": m.get("id"),
                                    "name": m.get("id"),
                                    "size": 0,
                                    "loaded_context_length": m.get("loaded_context_length"),
                                    "state": m.get("state")
                                })
                            if models:
                                v0_succeeded = True
                    except Exception:
                        pass

                    if not v0_succeeded:
                        url = f"{normalized_url.rstrip('/')}/models"
                        if not url.endswith("/v1/models") and "v1" not in url:
                            url = f"{normalized_url.rstrip('/')}/v1/models"
                        res = await client.get(url)
                        if res.status_code == 200:
                            data = res.json()
                            for m in data.get("data", []):
                                models.append({
                                    "id": m.get("id"),
                                    "name": m.get("id"),
                                    "size": 0
                                })
        except Exception:
            pass
        return models

    @classmethod
    async def get_loaded_context_length(cls, provider: str, base_url: str, model_name: str) -> Optional[int]:
        """Queries LM Studio's /api/v0/models to check the actual loaded_context_length for the active model."""
        if provider != "lm_studio":
            return None
        try:
            norm_base = base_url.replace("://localhost:", "://127.0.0.1:").replace("://localhost/", "://127.0.0.1/")
            root_url = norm_base.split('/v1')[0].rstrip('/')
            async with httpx.AsyncClient(timeout=1.0) as client:
                res = await client.get(f"{root_url}/api/v0/models")
                if res.status_code == 200:
                    data = res.json().get("data", [])
                    for m in data:
                        mid = m.get("id", "")
                        if mid == model_name or model_name in mid or mid in model_name:
                            ctx = m.get("loaded_context_length")
                            if ctx and isinstance(ctx, int) and ctx > 0:
                                return ctx
        except Exception:
            pass
        return None

    @staticmethod
    async def test_llm_connection(provider: str, base_url: str, model_name: str) -> Dict[str, Any]:
        """Tests if the local LLM endpoint is reachable and responsive."""
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(5.0, connect=2.0)) as client:
                if provider == "ollama":
                    url = f"{base_url.rstrip('/')}/api/generate"
                    payload = {"model": model_name, "prompt": "ping", "stream": False}
                    res = await client.post(url, json=payload)
                    if res.status_code == 200:
                        return {"success": True, "message": f"Ollama model '{model_name}' is online and responsive!"}
                    return {"success": False, "message": f"Ollama returned HTTP status {res.status_code}: {res.text}"}
                else:
                    norm_base = base_url.rstrip('/').replace("://localhost:", "://127.0.0.1:").replace("://localhost/", "://127.0.0.1/")
                    if norm_base.endswith("://localhost"):
                        norm_base = norm_base.replace("://localhost", "://127.0.0.1")
                    if not norm_base.endswith("/v1") and "/v1/" not in norm_base:
                        norm_base = f"{norm_base}/v1"
                    url = f"{norm_base}/chat/completions"
                    payload = {
                        "model": model_name,
                        "messages": [{"role": "user", "content": "ping"}],
                        "max_tokens": 50
                    }
                    res = await client.post(url, json=payload)
                    if res.status_code == 200:
                        return {"success": True, "message": f"Local endpoint responded successfully for '{model_name}'!"}
                    return {"success": False, "message": f"Endpoint returned HTTP status {res.status_code}: {res.text}"}
        except Exception as e:
            return {"success": False, "message": f"Failed to connect to local LLM at {base_url}: {str(e)}"}

    @classmethod
    def assemble_log_forensic_context(
        cls,
        conn: sqlite3.Connection,
        server_ids: Optional[List[int]] = None,
        start_time: Optional[str] = None,
        end_time: Optional[str] = None,
        date_preset: Optional[str] = None,
        max_errors: Optional[int] = None,
        max_samples: Optional[int] = None,
        context_window: int = 32768,
    ) -> Dict[str, Any]:
        """
        Extracts structured forensic context from SQLite, dynamically scaled to available context window (16k - 32k tokens).
        """
        if max_errors is None:
            if context_window >= 28000:
                max_errors = 35
            elif context_window >= 18000:
                max_errors = 25
            else:
                max_errors = 15
        if max_samples is None:
            if context_window >= 28000:
                max_samples = 60
            elif context_window >= 18000:
                max_samples = 40
            else:
                max_samples = 20

        cur = conn.cursor()
        
        where_clauses = ["1=1"]
        params: List[Any] = []
        if server_ids:
            placeholders = ",".join("?" * len(server_ids))
            where_clauses.append(f"e.server_id IN ({placeholders})")
            params.extend(server_ids)
        if start_time:
            where_clauses.append("e.timestamp >= ?")
            params.append(start_time)
        if end_time:
            where_clauses.append("e.timestamp <= ?")
            params.append(end_time)

        where_sql = " AND ".join(where_clauses)

        # 1. Total statistics & time range
        stats_query = f"""
            SELECT 
                COUNT(*) as total_logs,
                SUM(CASE WHEN log_level IN ('FATAL', 'ERROR') THEN 1 ELSE 0 END) as total_errors,
                SUM(CASE WHEN log_level = 'WARN' THEN 1 ELSE 0 END) as total_warns,
                SUM(CASE WHEN log_level = 'INFO' THEN 1 ELSE 0 END) as total_infos,
                MIN(e.timestamp) as earliest_ts,
                MAX(e.timestamp) as latest_ts
            FROM log_entries e
            WHERE {where_sql};
        """
        cur.execute(stats_query, params)
        stats_row = cur.fetchone()
        stats = {
            "total_logs": stats_row[0] or 0,
            "total_errors": stats_row[1] or 0,
            "total_warns": stats_row[2] or 0,
            "total_infos": stats_row[3] or 0,
            "earliest_ts": stats_row[4] or "N/A",
            "latest_ts": stats_row[5] or "N/A"
        }

        # 2. Hourly Activity Distribution across the entire time window
        hourly_query = f"""
            SELECT 
                substr(e.timestamp, 1, 13) as time_bucket,
                COUNT(*) as total_count,
                SUM(CASE WHEN e.log_level IN ('FATAL', 'ERROR') THEN 1 ELSE 0 END) as error_count,
                SUM(CASE WHEN e.log_level = 'WARN' THEN 1 ELSE 0 END) as warn_count
            FROM log_entries e
            WHERE {where_sql}
            GROUP BY time_bucket
            ORDER BY time_bucket ASC;
        """
        cur.execute(hourly_query, params)
        hourly_distribution = [
            {
                "hour": row[0],
                "total": row[1],
                "errors": row[2] or 0,
                "warns": row[3] or 0
            }
            for row in cur.fetchall()
        ]

        # 3. Server node breakdown
        server_query = f"""
            SELECT s.name, COUNT(*) as count,
                   SUM(CASE WHEN e.log_level IN ('FATAL', 'ERROR') THEN 1 ELSE 0 END) as errors
            FROM log_entries e
            JOIN servers s ON e.server_id = s.id
            WHERE {where_sql}
            GROUP BY s.id
            ORDER BY count DESC;
        """
        cur.execute(server_query, params)
        server_breakdown = [
            {"server_name": r[0], "count": r[1], "errors": r[2] or 0}
            for r in cur.fetchall()
        ]

        # 4. Clustered Unique Errors (by error_hash)
        cluster_query = f"""
            SELECT 
                s.name as server_name,
                e.log_level,
                e.logger_name,
                e.message,
                e.stack_trace,
                e.error_hash,
                COUNT(*) as occurrence_count,
                MIN(e.timestamp) as first_seen,
                MAX(e.timestamp) as last_seen
            FROM log_entries e
            JOIN servers s ON e.server_id = s.id
            WHERE e.log_level IN ('FATAL', 'ERROR', 'WARN') AND {where_sql}
            GROUP BY e.error_hash, s.id
            ORDER BY occurrence_count DESC, e.log_level DESC
            LIMIT ?;
        """
        cluster_params = params + [max_errors]
        cur.execute(cluster_query, cluster_params)
        error_clusters = dict_list_from_rows(cur.fetchall())

        # 5. Chronological Critical Timeline Events (Sampled across the entire time span)
        timeline_query = f"""
            SELECT 
                s.name as server_name,
                e.timestamp,
                e.log_level,
                e.logger_name,
                e.thread_name,
                e.message,
                e.stack_trace
            FROM log_entries e
            JOIN servers s ON e.server_id = s.id
            WHERE e.log_level IN ('FATAL', 'ERROR', 'WARN') AND {where_sql}
            ORDER BY e.timestamp ASC
            LIMIT ?;
        """
        timeline_params = params + [max_samples]
        cur.execute(timeline_query, timeline_params)
        critical_timeline = dict_list_from_rows(cur.fetchall())

        # 6. Ingested Log Files in Scope
        files_query = f"""
            SELECT f.filename, f.file_type, s.name as server_name, f.entry_count, f.error_count
            FROM log_files f
            JOIN servers s ON f.server_id = s.id
            {"WHERE f.server_id IN (" + ",".join("?" * len(server_ids)) + ")" if server_ids else ""}
            ORDER BY f.entry_count DESC;
        """
        cur.execute(files_query, server_ids if server_ids else [])
        ingested_files = dict_list_from_rows(cur.fetchall())

        # Determine scope title dynamically based on server_ids
        scope_title = "All Cluster Nodes"
        if server_ids:
            placeholders = ",".join("?" * len(server_ids))
            cur.execute(f"SELECT name FROM servers WHERE id IN ({placeholders}) ORDER BY name;", server_ids)
            s_rows = cur.fetchall()
            server_names = [r[0] for r in s_rows]
            if server_names:
                lower_names = [n.lower() for n in server_names]
                if set(lower_names) == {"prod app1", "prod app2"}:
                    scope_title = "Production Nodes (prod app1 & prod app2)"
                elif len(server_names) == 1:
                    scope_title = f"{server_names[0]} Node"
                else:
                    scope_title = f"Selected Nodes ({', '.join(server_names)})"

        preset_labels = {
            "ALL": "All Time Available",
            "30M": "Last 30 Minutes",
            "1H": "Last 1 Hour",
            "6H": "Last 6 Hours",
            "24H": "Last 24 Hours",
            "TODAY": "Today (00:00 - 23:59)",
            "7D": "Last 7 Days",
            "30D": "Last 30 Days",
            "CUSTOM": "Custom Date Range"
        }
        time_window_label = preset_labels.get(date_preset, "")
        if not time_window_label:
            if start_time and end_time:
                time_window_label = f"{start_time[:10]} to {end_time[:10]}"
            elif start_time:
                time_window_label = f"From {start_time[:10]}"
            elif end_time:
                time_window_label = f"Until {end_time[:10]}"
            else:
                time_window_label = "All Time Available"

        if date_preset and date_preset != "ALL":
            scope_title = f"{scope_title} ({time_window_label})"

        return {
            "stats": stats,
            "scope_title": scope_title,
            "time_window_label": time_window_label,
            "hourly_distribution": hourly_distribution,
            "server_breakdown": server_breakdown,
            "error_clusters": error_clusters,
            "critical_timeline": critical_timeline,
            "ingested_files": ingested_files
        }

    @classmethod
    def build_tririga_analysis_prompt(cls, forensic_context: Dict[str, Any], context_window: int = 32768) -> str:
        """Constructs a rich forensic prompt tailored for IBM TRIRIGA diagnostics, dynamically scaling evidence depth to available context window (16k - 32k tokens)."""
        stats = forensic_context["stats"]
        hourly = forensic_context.get("hourly_distribution", [])
        servers = forensic_context.get("server_breakdown", [])
        clusters = forensic_context.get("error_clusters", [])
        timeline = forensic_context.get("critical_timeline", [])
        ingested_files = forensic_context.get("ingested_files", [])

        # Dynamic capacity allocation strictly calibrated to guarantee at least 5,000 - 8,000 completion tokens
        if context_window >= 28000:
            clusters_limit = 20
            msg_max_len = 450
            stack_lines_count = 6
            timeline_limit = 30
            timeline_msg_len = 200
            hourly_hours = 24
        elif context_window >= 18000:
            clusters_limit = 15
            msg_max_len = 350
            stack_lines_count = 5
            timeline_limit = 20
            timeline_msg_len = 160
            hourly_hours = 24
        else:
            clusters_limit = 10
            msg_max_len = 200
            stack_lines_count = 3
            timeline_limit = 12
            timeline_msg_len = 120
            hourly_hours = 12

        hourly_text = ""
        if hourly:
            hourly_text = "\n".join([
                f"- **{h['hour']}:00**: {h['total']} logs ({h['errors']} errors, {h['warns']} warnings)"
                for h in hourly[-hourly_hours:]
            ])

        server_text = ", ".join([f"{s['server_name']}: {s['count']} logs ({s['errors']} errs)" for s in servers])

        files_text = ""
        if ingested_files:
            files_text = "\n".join([
                f"- **{f['filename']}** ({f['server_name']}) – Type: {f['file_type']}, Entries: {f['entry_count']:,}, Errors: {f['error_count']:,}"
                for f in ingested_files
            ])
        else:
            files_text = "No specific log files recorded."

        clusters_text = ""
        for i, c in enumerate(clusters[:clusters_limit], 1):
            msg = (c.get("message") or "").strip()
            if len(msg) > msg_max_len:
                msg = msg[:msg_max_len - 3] + "..."
            stack_sample = ""
            if c.get("stack_trace"):
                lines = [l.strip() for l in c["stack_trace"].splitlines() if l.strip()][:stack_lines_count]
                if lines:
                    stack_sample = "\n    Stack:\n      " + "\n      ".join(lines)

            clusters_text += f"""
Pattern #{i} [{c['log_level']}] ({c['occurrence_count']}x): [{c['server_name']}] {c['logger_name']} -> {msg}{stack_sample}
"""

        timeline_text = ""
        if timeline:
            step = max(1, len(timeline) // timeline_limit)
            sampled = timeline[::step][:timeline_limit]
            timeline_text = "\n".join([
                f"- [{e.get('timestamp', 'N/A')}] [{e.get('server_name', 'node')}] [{e.get('log_level', 'ERR')}] {e.get('logger_name', '')}: {(e.get('message') or '')[:timeline_msg_len]}"
                for e in sampled
            ])

        combined_text = clusters_text + "\n" + timeline_text
        resolved_records_block = TririgaResolver.build_evidence_resolution_block(combined_text)
        scope_title = forensic_context.get("scope_title", "All Cluster Nodes")
        is_multi_node = len(servers) > 1 or "cluster" in scope_title.lower() or "production nodes" in scope_title.lower() or "selected nodes" in scope_title.lower() or "all" in scope_title.lower()
        timeline_heading = "3. Multi-Server Timeline & Cascading Failures" if is_multi_node else "3. Timeline & Failure Dynamics"

        time_label = forensic_context.get("time_window_label", "")
        time_filter_line = f"- Time Filter Active: {time_label}\n" if time_label and time_label != "All Time Available" else ""
        report_run_date = format_ordinal_date()

        prompt = f"""You are an expert diagnostic assistant specialising in IBM TRIRIGA, DB2 databases, and WebSphere Liberty. Your primary function is to analyse logs, configurations, and system behaviours to provide factually accurate root cause analyses and actionable remediation plans.
Analyze the following TRIRIGA logs strictly focused on {scope_title}.

### INGESTED LOG FILES IN SCOPE ({scope_title}):
{files_text}

### OVERALL CLUSTER LOG STATISTICS:
{time_filter_line}- Time Range Covered: {stats['earliest_ts']} to {stats['latest_ts']}
- Total Ingested Logs: {stats['total_logs']}
- Total ERROR/FATAL Events: {stats['total_errors']}
- Total WARNING Events: {stats['total_warns']}
- Server Breakdown: {server_text if server_text else 'All nodes'}

### HOURLY TIMELINE DISTRIBUTION (Peak Activity):
{hourly_text if hourly_text else "No hourly distribution available."}

### TOP DETECTED ERROR SIGNATURE CLUSTERS:
{clusters_text if clusters_text else "No severe error clusters detected."}

### CHRONOLOGICAL INCIDENT SAMPLE:
{timeline_text if timeline_text else "No critical events found in timeline."}
{resolved_records_block}
### ARCHITECTURAL CONSTRAINTS & INSTRUCTIONS FOR YOUR REPORT:
Produce a comprehensive, highly readable, and structured technical audit report in GitHub-flavored Markdown.

CRITICAL FORMATTING, SPACING & READABILITY RULES:
- Use generous paragraph spacing, double line breaks (`\n\n`), distinct Markdown headings (`#`, `##`, `###`), and bullet points (`- `) to ensure the report is visually clear and easy to read. NEVER bundle separate incidents, timeline points, or remediation steps into a single dense block of text.
- Follow this exact structure with clear whitespace and paragraph separation:

# Technical Audit Report – TRIRIGA {scope_title}
*Date of report preparation: {report_run_date}*

## 1. Executive Summary
Provide 1-2 clean paragraphs with clear line breaks. Deliver a high-level verdict, overall platform health assessment, peak incident hours, and highest severity level (Critical, High, Medium, or Low). Health Rating Logic: Do not conflate incident severity with system health. If a platform is experiencing high-severity issues, deadlocks, or connection exhaustion, you must rate the overall system health as 'Critical' or 'Poor'. Never rate system health as 'High' or 'Healthy' under these conditions.

## 2. Key Detected Incidents & Root Cause Analysis

You MUST strictly follow this exact structure for reporting each incident, with blank lines between fields and horizontal rules (`---`) separating incidents:

### Incident [Letter] – [Brief Title]
- **Affected Component/Module**: [Component Name]
- **Technical Root Cause**: [Direct, technical explanation integrating all definitions naturally without meta-commentary.]
- **Impact & Business Consequences**: [Specific end-user and business process failure.]

---

## {timeline_heading}
Structure timeline with distinct bullet points and double line breaks:

- **Early morning (00:00–08:00)**: Technical summary of events during this window.

- **Mid-morning (08:00–13:00)**: Technical summary of events during this window.

- **Afternoon & Evening (13:00+)**: Technical summary of events during this window.

Provide an authoritative narrative analysis explaining failure dynamics directly without structural labels, bracketed meta-text, or meta-commentary.

---

## 4. Actionable Remediation Plan

### Immediate Mitigations (Local Admin Self-Service via TRIRIGA Administrator Console)
- **Clear Caches**: [Direct action and specific cache names]
- **Verify OSLC Mappings**: [Direct action in Data Modeler / OSLC Manager]
- **Validate Workflow Templates**: [Direct action in Workflow Designer]
- **Check List Manager**: [Direct action in List Manager]
- **Verify User Provisioning**: [Direct action]
- **Temporary-File Cache**: [Direct action]

### Permanent Fixes & IBM SRE Escalations (Service Request Required)
- **IBM SRE Service Request (SR)**: [Details on server.xml, TRIRIGAWEB.properties, JVM restarts, and recommending access to Liberty messages.log or thread dumps if thread contention / connection pool starvation needs deeper investigation]
- **DB2 Diagnostic Queries**: [DB2 queries using TABNAME on SYSIBMADM.MON_LOCKWAITS, noting VPN or SRE execution requirement]
- **Workflow & Index Optimization**: [Permanent BO and workflow fixes]

---
*Report generated by Local LLM Log Analysis (Automated AI Diagnostic Analysis) – all statements reflect automated log analysis for {scope_title} only.*

OUTPUT FORMATTING RULES & MANDATORY TEMPLATE:
- Present findings strictly as a finalised, professional executive report written by a Senior TRIRIGA Architect for an engineering audience.
- ZERO-TOLERANCE FOR META-COMMENTARY OR STRUCTURAL LABELS:
  NEVER include structural labels, self-announcements, or meta-commentary in ANY form (whether in brackets [...], parentheses (...), or plain text). 
  PROHIBITED EXAMPLES: Do NOT write "(Detailed analytical paragraph...)", "[Analytical paragraph explaining...]", "Note:", "Concept:", or "Plain-English explanation:". 
  Output your analysis directly as standard narrative paragraphs.
- NO INSTRUCTION ECHOING: Never cite or reference the names of the rules provided to you (e.g., do not write "per Health Rating Logic" or "per Architectural Boundaries"). Just apply the logic silently.
- Strict Date Formatting: Every single date must include an ordinal suffix (e.g., "4th not 4", "2nd not 2", "1st not 1", "3rd not 3"). NEVER output non-ordinal dates.
- Report Preparation Date: The date of report preparation in the header must strictly be '{report_run_date}' (the date this report is being executed/prepared, NOT the date of the log files).
- Strict Grounding in Ingested Data: Restrict all findings and conclusions strictly to the files listed under ### INGESTED LOG FILES IN SCOPE. You do NOT have access to WebSphere Liberty `messages.log` or other unprovided system logs. NEVER state or imply that `messages.log` was checked or that "no thread contention errors were found in messages.log". If `messages.log` is needed to investigate thread contention or connection pool starvation, recommend requesting access to it via IBM SRE in Section 4.
- Table Formatting: Never invent table names like `T_SMARTOBJECT` or `TRIRIGA_SMARTOBJECT`. Use valid examples like `T_REQUISITION` or `IBS_SPEC`.

- MANDATORY INCIDENT MARKDOWN LAYOUT (Inside Section 2): Under '## 2. Key Detected Incidents & Root Cause Analysis', each incident MUST use this exact Markdown syntax:

### Incident [Letter] – [Brief Title]
- **Affected Component/Module**: [Component Name]
- **Technical Root Cause**: [Direct, technical explanation integrating all definitions naturally without meta-commentary.]
- **Impact & Business Consequences**: [Specific end-user and business process failure.]

- MANDATORY SECTION SEQUENCING:
  Never skip Section 1 or Section 2. Your report headings MUST strictly proceed in numerical order:
  1. Executive Summary ('## 1. Executive Summary')
  2. Key Detected Incidents ('## 2. Key Detected Incidents & Root Cause Analysis')
  3. Timeline & Failure Dynamics ('## {timeline_heading}')
  4. Actionable Remediation Plan ('## 4. Actionable Remediation Plan')
  Numbering must NEVER start at 3. Always output Section 1 and Section 2 first.
- PERSONA, TONE, EXPERTISE & AI TRANSPARENCY:
  * Identity: You are an automated AI diagnostic assistant. You must be completely transparent about your AI nature. Do not feign human experiences, pretend to be a human employee, or invent a human name.
  * Expertise & Tone: While you are an AI, you must write with the absolute authority, precision, and professional tone of a Senior TRIRIGA Architect. Do not use an apologetic or subservient AI tone (e.g., never say "I am just an AI, but...").
  * Banned Phrases List: You are strictly forbidden from using the exact phrase "Plain-English concept explanation:" or "Plain-English explanation:". If you need to use an analogy, state it directly as a technical fact without announcing it as an explanation.
  * Transparent AI Attribution: Clearly indicate that this is automated LLM output in the report footer (e.g., `*Report generated by Local LLM Log Analysis (Automated AI Diagnostic Analysis) – all statements reflect automated log analysis for {scope_title} only.*`). Do NOT claim or output that the report was generated by a human Senior TRIRIGA Architect.
  * Mandatory Markdown Structure: You must strictly preserve the exact Markdown bolding (**) and heading syntax (###) provided in the Incident Reporting Structure. Do not drop the bolding for - **Affected Component/Module**:, - **Technical Root Cause**:, or - **Impact & Business Consequences**:.

STRICT ARCHITECTURAL FACTS & CONSTRAINTS:
- Strict Server & Environment Isolation: This report is strictly and exclusively scoped to {scope_title}. You must ONLY evaluate and cite log files, log entries, and failure events originating from the servers in this scope ({server_text if server_text else scope_title}). You are STRICTLY FORBIDDEN from citing, conflating, or inventing log files, errors, or events from any other servers or environments outside this scope.
- DATA AVAILABILITY & STRICT EVIDENCE GROUNDING:
  * Restrict all analytical conclusions, root causes, and negative assertions strictly to the data and log files provided in ### INGESTED LOG FILES IN SCOPE.
  * ABSOLUTE PROHIBITION ON CLAIMING UNPROVIDED LOGS WERE CHECKED: You do NOT have access to WebSphere Liberty `messages.log`, `trace.log`, `console.log`, GC logs, or OS-level metrics unless they appear in ### INGESTED LOG FILES IN SCOPE.
  * NEVER claim or state that you checked `messages.log` or that "no thread contention errors were found in messages.log" or that "this confirms the issue is not connection pool starvation because no errors were found in messages.log". You cannot rule out issues based on files you do not possess!
  * Recommend Access for Missing System Data: If diagnosing potential connection pool starvation, thread contention, thread deadlocks, or JVM memory issues where Liberty `messages.log`, Java thread dumps (`kill -3`), or DB2 lock snapshots are needed for definitive diagnosis, you must explicitly state that `messages.log` is not currently accessible/ingested, and recommend requesting access to `messages.log` (via an IBM SRE Service Request) for further analysis.
- Database Schema: TRIRIGA records and metadata are stored in `IBS_SPEC`, `IBS_SPEC_ASSIGNMENTS`, and specific `T_` tables (e.g., `T_TRIBUILDING`, `T_TRICONTRACT`, `T_MYBUSINESSMAP`). NEVER invent or reference fictional tables like `TRIRIGA_SMARTOBJECT` or `T_SMARTOBJECT`.
- TRIRIGA Schema & Primary Key Conventions:
  * Primary Keys: The universal primary key for `IBS_SPEC`, `IBS_SPEC_ASSIGNMENTS`, and all `T_` tables is `SPEC_ID`. Never write SQL queries using generic identifiers like `id`, `record_id`, or `uuid`.
  * System Columns: TRIRIGA manages record states, audit trails, and security via reserved system columns on the `T_` tables. Record state is always stored in `SYS_STATE1`. Audit data uses `SYS_UPDATEDBY`. Never hallucinate generic web application columns like `status`, `created_date`, or `updated_by`.
  * DB2 System Catalog: If generating diagnostic queries to verify table or column metadata (e.g., checking if a custom field exists), you must use DB2's `SYSCAT.TABLES` and `SYSCAT.COLUMNS` views. Never use ANSI standard `information_schema`.
- Custom Data Fields and Indexes: Custom data fields (e.g., `triCurrencyUO`) reside on specific business object `T_` tables (such as `T_REQUISITION`). `IBS_SPEC` only holds core system metadata. Direct any index creation or field-level queries to the appropriate `T_` table, never to `IBS_SPEC`.
- Data Manipulation Constraints: Never advise the manual execution of UPDATE, INSERT, or DELETE statements directly against `IBS_SPEC`, `IBS_SPEC_ASSIGNMENTS`, or `T_` tables. All data manipulation must occur via the TRIRIGA application UI, DataConnect, or OSLC APIs. Direct database writes corrupt the Object State.
- Record Associations: Recognise that TRIRIGA does not use standard relational foreign keys. All record-to-record links are stored in the `IBS_SPEC_ASSIGNMENTS` table. Diagnostic queries involving linked objects must query this table using the `SPEC_ID`.
- List Manager vs. Associations: List values are static metadata managed in the TRIRIGA List Manager. Never state that List Values (dropdown options) are stored in `IBS_SPEC_ASSIGNMENTS` or managed in the Data Modeler. `IBS_SPEC_ASSIGNMENTS` is strictly for linking distinct data records (e.g., linking a Requisition to a Location).
- Expanded Core Code Boundaries: You are strictly forbidden from recommending modifications to any core platform Java classes. This includes, but is not limited to, `CommonQuerySerializer`, `OslcRequestDispatcherImpl`, `OslcCreationHandler`, `ListServiceImpl`, and `ObjectSerializer` (e.g. classes within `tririga-ib.jar`). Limit customisation advice strictly to external OSLC wrappers or TRIRIGA workflow logic.
- Connection Pooling: Acknowledge that connection capacity is managed via Liberty `server.xml` (e.g. `maxPoolSize`) or `TRIRIGAWEB.properties`. If a pool size is large but exhausted, or if connection starvation is suspected, do NOT claim to have checked `messages.log`. Note that `messages.log` is not ingested in this scope, and recommend requesting `messages.log` and DB2 lock wait snapshots (`MON_LOCKWAITS`) from IBM SRE rather than suggesting superficial capacity increases.
- Database Isolation: TRIRIGA operates on `TRANSACTION_READ_COMMITTED` isolation level. NEVER recommend `READ UNCOMMITTED` or dirty reads (violates platform standards and risks severe data integrity corruption).
- Health Rating Logic: Do not conflate incident severity with system health. If a platform is experiencing high-severity issues, deadlocks, or connection exhaustion, you must rate the overall system health as 'Critical' or 'Poor'. Never rate system health as 'High' or 'Healthy' under these conditions.
- Strict Component Isolation & Causation: Do not force correlation or invent causal links between unrelated system failures just because they occur in the same time window. Missing user profile data cannot cause OS-level file system failures or connection pool exhaustion. Treat distinct architectural errors as separate root causes unless they mathematically interact (e.g., long DB2 queries do cause pool exhaustion).
- Strict Subsystem Isolation (Do Not Conflate Components):
  * OSLC vs. Workflow Engine: Never conflate HTTP/OSLC integration errors with internal workflow logic. ObjectSerializer and IllegalArgumentException occur exclusively at the incoming HTTP/OSLC web request layer. Workflow Engine field mapping errors (e.g., SOFieldMapImpl, InvalidFieldRequestException) occur internally during execution. Do not state that the Workflow Engine uses ObjectSerializer to unmarshall data.
  * Filesystem vs. Workflow Agents: Temporary file cache errors (userfiles) are strictly OS-level filesystem, storage, or permission issues. Never instruct an admin to restart a Workflow Agent to fix userfiles or temporary file cache errors. Workflow Agents manage asynchronous database events (WF_EVENT), not local disk space or filesystem mounts.
  * Mail Preparation Boundaries: Mail preparation failures are caused strictly by SMTP configuration issues or userfiles attachment generation failures (the system cannot cache/write the physical file). Never link missing user profile metadata (e.g., LabeledObjectFactory lookups) to mail preparation failures.
- Workflow Event Queue Validation (WF_EVENT): Success in the `WF_EVENT` table is indicated by an empty queue (the absence of rows), as the Workflow Agent clears them upon completion. Do not search for a 'completed' status. The `WF_EVENT` table is exclusively used to monitor if an asynchronous workflow process is queued, executing, or stalled. Never advise querying `WF_EVENT` to check if a Smart Object or data record exists. Record existence must only be verified via standard OSLC lookups or querying `IBS_SPEC`. Differentiate between synchronous locking and asynchronous event queuing. If a process is stalled after a state transition, instruct the user to check the `WF_EVENT` table and the TRIRIGA Workflow Agent status before assuming a DB2 connection pool issue.
- Metadata & OSLC Configuration: When diagnosing missing custom fields in OSLC payloads or serializers, mandate checking if the Business Object (BO) was successfully 'Published' in the TRIRIGA Data Modeler. Additionally, instruct the user to verify that the OSLC Resource mapping was updated in the OSLC Manager.
- DB2 Lock Diagnostic Syntax: When querying `SYSIBMADM.MON_LOCKWAITS`, strictly use the `TABNAME` column to filter by table (e.g., `WHERE TABNAME = 'T_REQUISITION'`). Never use `object_name` or `table_name`. To retrieve lock holder details, use the `HLD_APPLICATION_HANDLE`, `HLD_USERID`, and `HLD_CURRENT_STMT_TEXT` columns.
- DB2 Lock Escalation: When addressing connection pool starvation linked to DB2 locks, instruct the user to check for Lock Escalation. Query `MON_LOCKWAITS` to check if the `LOCK_MODE` indicates a table-level lock (e.g., 'Z' or 'X' on a table rather than a row), which typically occurs during large data imports.
- File System & Content: Treat temporary file cache errors as TRIRIGA `userfiles` directory issues. Direct diagnostics to the storage path defined in `TRIRIGAWEB.properties` or the configured Content Management System, rather than generic web application temporary folders.
- STRICT FILESYSTEM VS. UI CACHE BOUNDARIES: The userfiles temporary file cache is a physical OS-level filesystem issue. You must NEVER suggest that clearing the JVM 'List Cache' or 'Object MetaData Cache' in the Administrator Console will resolve userfiles or Content cache errors. If userfiles errors are present, the only self-service mitigation is verifying the path in the properties view; the actual fix requires an IBM SRE Service Request (SR).
- User Profiles as Records: Recognise that usernames or IDs (e.g., 'farrellde' or '10095356') missing during lookups are tied to TRIRIGA 'My Profile' or 'Employee' records. Direct remediation toward user provisioning integrations rather than generic Smart Object creation.
- Cache Management & Boundaries: If metadata, list values, or object labels are stale, direct the user to clear the specific cache (e.g., 'List Cache' or 'Object MetaData Cache') via the TRIRIGA Administrator Console. Never recommend restarting the WebSphere Liberty server as a first step for cache issues. Do not suggest that clearing TRIRIGA Admin Console JVM caches will fix OS-level issues, filesystem errors (`userfiles`), or DB2 deadlocks; cache clearing only fixes stale metadata or UI dropdown display issues.
- Log Boundaries & Availability: Analysis is strictly confined to the ingested files in scope (typically `server.log` for OSLC payload exceptions, state transition errors, and platform logic; `performance.log` for slow workflow steps and DB2 queries). WebSphere Liberty `messages.log` is NOT ingested or accessible in this environment. Never claim `messages.log` was inspected or that absence of messages in it proves anything; recommend requesting `messages.log` if thread contention or connection pool starvation needs deeper investigation.
- Formatting and Localisation Requirements: You must strictly use traditional Irish/British English spellings (e.g., 'specialising', 'customisation', 'analyse') and standard date formats with ordinal indicators (e.g., '4th not 4', '2nd not 2', or 'dd/mm/yyyy'). Do not use ISO or US date formats.
- Operational Boundaries & Strict SaaS Constraints: Limit self-service remediation strictly to the TRIRIGA Administrator Console (clearing caches, reviewing logs, restarting Workflow Agents) and the application UI (Data Modeler, OSLC mapping). In an IBM SaaS environment, the local admin has zero OS-level visibility: do not instruct the local admin to check disk space, verify read/write file permissions, or directly modify backend configuration files like `TRIRIGAWEB.properties` or `server.xml`.
- Configuration Verification: The local admin can view active properties via the Administrator Console. You may instruct the admin to read `TRIRIGAWEB.properties` in the Admin Console to verify settings (such as directory paths or mail hosts), but any required modifications require an SR.
- IBM SRE Escalations (Service Requests): The local admin has zero OS-level visibility. Instruct the user to "Submit a Service Request (SR) ticket to the IBM SRE team" for modifications to `server.xml`, `TRIRIGAWEB.properties` (e.g., increasing connection pool sizes), WebSphere Liberty / JVM restarts, OS-level file permissions (`userfiles`), or killing DB2 locks / resolving database deadlocks.
- Prioritise Actionable Diagnostics & Missing Log Recommendations: When providing remediation steps, prioritise actionable diagnostics. If `messages.log`, Java thread dumps (`kill -3`), or DB2 diagnostic queries (`MON_LOCKWAITS`, `MON_GET_ACTIVITY`, `SYSIBMADM.SNAPLOCK`, `db2pd`) are needed for further analysis, explicitly recommend that the user request them via an IBM SRE Service Request (or run DB queries over read-only VPN).
- Database Syntax: DATABASE REQUIREMENT: This TRIRIGA environment uses IBM DB2. All SQL examples, diagnostic queries, and remediation scripts MUST use DB2-compatible syntax (SYSCAT views, SYSIBMADM.SNAPLOCK, SYSIBMADM.MON_LOCKWAITS, SYSIBMADM.SNAPSQL, db2pd). NEVER output MySQL (performance_schema, SHOW commands), Oracle, or PostgreSQL syntax.
"""
        return prompt

    @classmethod
    async def stream_analysis(
        cls,
        provider: str,
        base_url: str,
        model_name: str,
        temperature: float,
        server_ids: Optional[List[int]] = None,
        start_time: Optional[str] = None,
        end_time: Optional[str] = None,
        date_preset: Optional[str] = None,
        context_window: int = 32768,
    ) -> AsyncGenerator[str, None]:
        effective_model = await cls.resolve_active_model_name(provider, base_url, model_name)

        # Detect actual loaded context length in LM Studio to prevent prompt overflow
        loaded_ctx = await cls.get_loaded_context_length(provider, base_url, effective_model)
        if loaded_ctx and loaded_ctx > 0 and loaded_ctx < context_window:
            context_window = loaded_ctx

        with db_session() as conn:
            forensic_context = cls.assemble_log_forensic_context(
                conn, 
                server_ids=server_ids, 
                start_time=start_time, 
                end_time=end_time, 
                date_preset=date_preset,
                context_window=context_window,
            )

        if forensic_context["stats"]["total_logs"] == 0:
            time_label = forensic_context.get("time_window_label", "")
            scope_desc = forensic_context.get("scope_title", "the selected scope")
            msg = (
                f"No log entries were found for {scope_desc} matching the selected time filter ('{time_label}'). "
                f"Please select a broader time window (such as 'All Time Available' or a wider date range) "
                f"or synchronize fresh log files from the Log Collector."
            )
            yield json.dumps({"chunk": msg})
            yield "[DONE]"
            return

        prompt = cls.build_tririga_analysis_prompt(forensic_context, context_window=context_window)
        llm_connected = False
        received_any_chunk = False
        is_truncated = False
        think_filter = ThinkingFilter()

        total_logs = forensic_context["stats"]["total_logs"]
        total_errs = forensic_context["stats"]["total_errors"]
        scope_title = forensic_context.get("scope_title", "All Cluster Nodes")
        yield json.dumps({"status": f"Aggregated {total_logs:,} log entries across {scope_title} ({total_errs:,} error events)..."})
        yield json.dumps({"status": f"Cross-referencing TRIRIGA Spec IDs and Workflow templates..."})
        yield json.dumps({"status": f"Analysing log files with {effective_model} in {provider.upper()} ({context_window:,} token context)..."})

        report_run_date = format_ordinal_date()
        try:
            timeout_cfg = httpx.Timeout(900.0, connect=10.0, read=900.0, write=60.0)
            async with httpx.AsyncClient(timeout=timeout_cfg) as client:
                system_instruction = (
                    "OUTPUT FORMATTING RULES & MANDATORY TEMPLATE:\n"
                    "- Present findings strictly as a finalised, professional executive report written by a Senior TRIRIGA Architect for an engineering audience.\n"
                    "- ZERO-TOLERANCE FOR META-COMMENTARY OR STRUCTURAL LABELS:\n"
                    "  NEVER include structural labels, self-announcements, or meta-commentary in ANY form (whether in brackets [...], parentheses (...), or plain text).\n"
                    "  PROHIBITED EXAMPLES: Do NOT write \"(Detailed analytical paragraph...)\", \"[Analytical paragraph explaining...]\", \"Note:\", \"Concept:\", or \"Plain-English explanation:\".\n"
                    "  Output your analysis directly as standard narrative paragraphs.\n"
                    "- NO INSTRUCTION ECHOING: Never cite or reference the names of the rules provided to you (e.g., do not write \"per Health Rating Logic\" or \"per Architectural Boundaries\"). Just apply the logic silently.\n"
                    "- Strict Date Formatting: Every single date must include an ordinal suffix (e.g., '4th not 4', '2nd not 2', '1st not 1', '3rd not 3'). NEVER output non-ordinal dates.\n"
                    f"- Report Preparation Date: The date of report preparation in the header must strictly be '{report_run_date}' (the date this report is being executed/prepared, NOT the date of the log files).\n"
                    "- Table Formatting: Never invent table names like `T_SMARTOBJECT` or `TRIRIGA_SMARTOBJECT`. Use valid examples like `T_REQUISITION` or `IBS_SPEC`.\n\n"
                    "- MANDATORY INCIDENT MARKDOWN LAYOUT (Inside Section 2): Under '## 2. Key Detected Incidents & Root Cause Analysis', each incident MUST use this exact Markdown syntax:\n\n"
                    "### Incident [Letter] – [Brief Title]\n"
                    "- **Affected Component/Module**: [Component Name]\n"
                    "- **Technical Root Cause**: [Direct, technical explanation integrating all definitions naturally without meta-commentary.]\n"
                    "- **Impact & Business Consequences**: [Specific end-user and business process failure.]\n\n"
                    "- MANDATORY SECTION SEQUENCING:\n"
                    "  Never skip Section 1 or Section 2. Your report headings MUST strictly proceed in numerical order:\n"
                    "  1. Executive Summary ('## 1. Executive Summary')\n"
                    "  2. Key Detected Incidents ('## 2. Key Detected Incidents & Root Cause Analysis')\n"
                    "  3. Timeline & Failure Dynamics ('## 3. Timeline & Failure Dynamics' or '## 3. Multi-Server Timeline & Cascading Failures')\n"
                    "  4. Actionable Remediation Plan ('## 4. Actionable Remediation Plan')\n"
                    "  Numbering must NEVER start at 3. Always output Section 1 and Section 2 first.\n"
                    "- PERSONA, TONE, EXPERTISE & AI TRANSPARENCY:\n"
                    "  * Identity: You are an automated AI diagnostic assistant. You must be completely transparent about your AI nature. Do not feign human experiences, pretend to be a human employee, or invent a human name.\n"
                    "  * Expertise & Tone: While you are an AI, you must write with the absolute authority, precision, and professional tone of a Senior TRIRIGA Architect. Do not use an apologetic or subservient AI tone (e.g., never say \"I am just an AI, but...\").\n"
                    "  * Banned Phrases List: You are strictly forbidden from using the exact phrase \"Plain-English concept explanation:\" or \"Plain-English explanation:\". If you need to use an analogy, state it directly as a technical fact without announcing it as an explanation.\n"
                    f"  * Transparent AI Attribution: Clearly indicate that this is automated LLM output in the report footer (e.g., `*Report generated by Local LLM Log Analysis (Automated AI Diagnostic Analysis) – all statements reflect automated log analysis for {scope_title} only.*`). Do NOT claim or output that the report was generated by a human Senior TRIRIGA Architect.\n"
                    "  * Mandatory Markdown Structure: You must strictly preserve the exact Markdown bolding (**) and heading syntax (###) provided in the Incident Reporting Structure. Do not drop the bolding for - **Affected Component/Module**:, - **Technical Root Cause**:, or - **Impact & Business Consequences**:.\n"
                    "- Use generous whitespace, paragraphs, double line breaks (\\n\\n), distinct headers (##, ###), and bullet points. Never compress separate topics or steps into a single dense wall of text.\n"
                    "STRICT ARCHITECTURAL FACTS & CONSTRAINTS:\n"
                    f"- Strict Server & Environment Isolation: This report is strictly and exclusively scoped to {scope_title}. You must ONLY evaluate and cite log files, log entries, and failure events originating from the servers in this scope. You are STRICTLY FORBIDDEN from citing, conflating, or inventing log files, errors, or events from any other servers or environments outside this scope.\n"
                    "- Strict Data Availability & Evidence Grounding: Restrict all findings and conclusions strictly to the ingested log files. You do NOT have access to WebSphere Liberty `messages.log` or other unprovided system logs. NEVER claim `messages.log` was examined or that 'no thread contention errors were found in messages.log'. If access to `messages.log` or thread dumps is needed for further analysis, explicitly note its absence and recommend requesting `messages.log` via IBM SRE in the remediation plan.\n"
                    "- Operational Boundaries (IBM SaaS / Cloud Delivery Services): Limit self-service remediation strictly to the TRIRIGA Administrator Console (clearing caches, reviewing logs, restarting Workflow Agents) and the application UI (Data Modeler, OSLC mapping).\n"
                    "- IBM SRE Escalations: The local admin has zero OS-level visibility. Instruct the user to \"Submit a Service Request (SR) ticket to the IBM SRE team\" for modifications to `server.xml`, `TRIRIGAWEB.properties`, JVM restarts, OS-level file permissions (`userfiles`), or killing DB2 locks.\n"
                    "- Configuration Verification: The local admin can view active properties via the Administrator Console. You may instruct the admin to read `TRIRIGAWEB.properties` to verify settings, but modifications require an SR.\n"
                    "- Strict Component Isolation & Causation Rules: Treat distinct architectural errors as separate root causes unless they mathematically interact. Missing user profile data cannot cause OS-level file system failures.\n"
                    "- Strict Subsystem Isolation (Do Not Conflate Components):\n"
                    "  * OSLC vs. Workflow Engine: Never conflate HTTP/OSLC integration errors with internal workflow logic. ObjectSerializer and IllegalArgumentException occur exclusively at the incoming HTTP/OSLC web request layer. Workflow Engine field mapping errors (e.g., SOFieldMapImpl, InvalidFieldRequestException) occur internally during execution. Do not state that the Workflow Engine uses ObjectSerializer to unmarshall data.\n"
                    "  * Filesystem vs. Workflow Agents: Temporary file cache errors (userfiles) are strictly OS-level filesystem, storage, or permission issues. Never instruct an admin to restart a Workflow Agent to fix userfiles or temporary file cache errors. Workflow Agents manage asynchronous database events (WF_EVENT), not local disk space or filesystem mounts.\n"
                    "  * Mail Preparation Boundaries: Mail preparation failures are caused strictly by SMTP configuration issues or userfiles attachment generation failures (the system cannot cache/write the physical file). Never link missing user profile metadata (e.g., LabeledObjectFactory lookups) to mail preparation failures.\n"
                    "- List Manager vs. Associations: List values are static metadata managed in the TRIRIGA List Manager. `IBS_SPEC_ASSIGNMENTS` is strictly for linking distinct data records.\n"
                    "- Cache Boundaries: Do not suggest that clearing TRIRIGA Admin Console JVM caches will fix OS-level issues, filesystem errors, or DB2 deadlocks.\n"
                    "- STRICT FILESYSTEM VS. UI CACHE BOUNDARIES: The userfiles temporary file cache is a physical OS-level filesystem issue. You must NEVER suggest that clearing the JVM 'List Cache' or 'Object MetaData Cache' in the Administrator Console will resolve userfiles or Content cache errors. If userfiles errors are present, the only self-service mitigation is verifying the path in the properties view; the actual fix requires an IBM SRE Service Request (SR).\n"
                    "- DB2 Lock Diagnostic Syntax: When querying `SYSIBMADM.MON_LOCKWAITS`, strictly use the `TABNAME` column to filter by table (e.g., `WHERE TABNAME = 'T_REQUISITION'`). Never use `object_name` or `table_name`. To retrieve lock holder details, use the `HLD_APPLICATION_HANDLE`, `HLD_USERID`, and `HLD_CURRENT_STMT_TEXT` columns.\n"
                    "- DB2 Lock Escalation: When addressing connection pool starvation linked to DB2 locks, instruct the user to check for Lock Escalation. Query `MON_LOCKWAITS` to check if the `LOCK_MODE` indicates a table-level lock (e.g., 'Z' or 'X' on a table rather than a row), which typically occurs during large data imports.\n"
                    "- Workflow Event Queue Validation (WF_EVENT): Success in the `WF_EVENT` table is indicated by an empty queue (the absence of rows), as the Workflow Agent clears them upon completion. Do not search for a 'completed' status.\n"
                    "- Diagnostic Query Caveat: Note that DB2 diagnostic queries (e.g., `MON_LOCKWAITS`) require a read-only VPN database connection, or must be run by IBM SRE via an SR.\n"
                    "- Health Rating Logic: Do not conflate incident severity with system health. If a platform is experiencing high-severity issues, deadlocks, or connection exhaustion, you must rate the overall system health as 'Critical' or 'Poor'. Never rate system health as 'High' under these conditions.\n"
                    "- Database Schema: TRIRIGA records and metadata are stored in `IBS_SPEC`, `IBS_SPEC_ASSIGNMENTS`, and specific `T_` tables. If an example is needed, strictly use `T_REQUISITION` or `IBS_SPEC`. Custom data fields (e.g., `triCurrencyUO`) reside on specific business object `T_` tables (such as `T_REQUISITION`); `IBS_SPEC` only holds core system metadata. Direct any index creation or field-level queries to the appropriate `T_` table, never to `IBS_SPEC`.\n"
                    "- TRIRIGA Schema & Primary Key Conventions:\n"
                    "  * Primary Keys: The universal primary key for `IBS_SPEC`, `IBS_SPEC_ASSIGNMENTS`, and all `T_` tables is `SPEC_ID`. Never write SQL queries using generic identifiers like `id`, `record_id`, or `uuid`.\n"
                    "  * System Columns: TRIRIGA manages record states, audit trails, and security via reserved system columns on the `T_` tables. Record state is always stored in `SYS_STATE1`. Audit data uses `SYS_UPDATEDBY`. Never hallucinate generic web application columns like `status`, `created_date`, or `updated_by`.\n"
                    "  * DB2 System Catalog: If generating diagnostic queries to verify table or column metadata (e.g., checking if a custom field exists), you must use DB2's `SYSCAT.TABLES` and `SYSCAT.COLUMNS` views. Never use ANSI standard `information_schema`.\n"
                    "- Data Manipulation Constraints: Never advise manual UPDATE, INSERT, or DELETE statements directly against `IBS_SPEC`, `IBS_SPEC_ASSIGNMENTS`, or `T_` tables; all data manipulation must occur via the TRIRIGA application UI, DataConnect, or OSLC APIs.\n"
                    "- Expanded Core Code Boundaries: You are strictly forbidden from recommending modifications to any core platform Java classes. This includes, but is not limited to, `CommonQuerySerializer`, `OslcRequestDispatcherImpl`, `OslcCreationHandler`, `ListServiceImpl`, and `ObjectSerializer`. Limit customisation advice strictly to external OSLC wrappers or TRIRIGA workflow logic.\n"
                    "- Database Isolation: TRIRIGA operates on `TRANSACTION_READ_COMMITTED` isolation level; never suggest `READ UNCOMMITTED` or dirty reads. For connection exhaustion or thread contention, note that Liberty `messages.log` is not ingested; recommend requesting `messages.log` and DB2 lock wait metrics from IBM SRE.\n"
                    "- Metadata & OSLC Configuration: When diagnosing missing custom fields in OSLC payloads or serializers, mandate checking if the Business Object (BO) was successfully 'Published' in the TRIRIGA Data Modeler and that OSLC Resource mapping was updated in the OSLC Manager.\n"
                    "- File System & Content: Treat temporary file cache errors as TRIRIGA `userfiles` directory issues, directing diagnostics to the storage path defined in `TRIRIGAWEB.properties` or the configured Content Management System rather than generic web application temp folders.\n"
                    "- User Profiles as Records: Recognise that usernames or IDs (e.g., 'farrellde' or '10095356') missing during lookups are tied to TRIRIGA 'My Profile' or 'Employee' records; direct remediation toward user provisioning integrations rather than generic Smart Object creation.\n"
                    "- Log Roles & Grounding: Analysis is strictly confined to the ingested files (e.g. `server.log`). Liberty `messages.log` is NOT accessible. Never claim `messages.log` was inspected or that lack of errors in it rules out an issue; recommend requesting `messages.log` if thread contention investigation is needed.\n"
                    "- Formatting and Localisation Requirements: Strictly use traditional Irish/British English spellings (e.g., 'specialising', 'customisation', 'analyse').\n"
                    "- Prioritise Actionable Diagnostics & Missing Log Recommendations: When providing remediation steps, prioritise actionable diagnostics such as requesting Liberty `messages.log` and Java thread dumps (`kill -3`) from IBM SRE for connection timeouts, and identifying specific blocking DB2 transactions.\n"
                    "- Database Syntax: DATABASE REQUIREMENT: Use strict IBM DB2 syntax (`SYSCAT`, `SYSIBMADM.SNAPLOCK`, `SYSIBMADM.MON_LOCKWAITS`, `MON_GET_ACTIVITY`, `db2pd`). Never provide MySQL, Oracle, or PostgreSQL syntax."
                )

                # Estimate prompt token count to dynamically compute safe completion tokens within context_window
                # Logs average ~3.2 characters per token due to timestamps, IPs, brackets, and stack frames
                est_prompt_tokens = int((len(prompt) + len(system_instruction)) / 3.2)
                min_completion_tokens = 4096 if context_window >= 20000 else 2560
                safe_max_tokens = max(min_completion_tokens, min(16384, context_window - est_prompt_tokens - 256))

                if provider == "ollama":
                    url = f"{base_url.rstrip('/')}/api/generate"
                    payload = {
                        "model": effective_model,
                        "prompt": prompt,
                        "system": system_instruction,
                        "stream": True,
                        "options": {
                            "temperature": temperature,
                            "num_ctx": context_window,
                            "num_predict": safe_max_tokens
                        }
                    }
                    async with client.stream("POST", url, json=payload) as response:
                        if response.status_code == 200:
                            llm_connected = True
                            async for line in response.aiter_lines():
                                if not line:
                                    continue
                                try:
                                    data = json.loads(line)
                                    if "error" in data:
                                        err_msg = data["error"] if isinstance(data["error"], str) else data["error"].get("message", "Ollama error")
                                        yield json.dumps({"chunk": f"\n\n> [!WARNING]\n> **Ollama Notice**: {err_msg}\n"})
                                        break
                                    raw_chunk = data.get("response") or ""
                                    raw_thought = data.get("thinking") or ""
                                    clean_chunk, inline_thought = think_filter.process(raw_chunk)
                                    final_thought = raw_thought + inline_thought
                                    if final_thought:
                                        received_any_chunk = True
                                        yield json.dumps({"thought": final_thought})
                                    if clean_chunk:
                                        received_any_chunk = True
                                        yield json.dumps({"chunk": clean_chunk})
                                    if data.get("done", False):
                                        if data.get("done_reason") == "length":
                                            is_truncated = True
                                        break
                                except Exception:
                                    continue
                        else:
                            err_body = await response.aread()
                            err_text = err_body.decode("utf-8", errors="ignore")
                            yield json.dumps({"chunk": f"\n\n> [!WARNING]\n> **Ollama Error (HTTP {response.status_code})**: {err_text}\n"})
                            llm_connected = False
                else: # lm_studio / openai_compatible
                    norm_base = base_url.rstrip('/').replace("://localhost:", "://127.0.0.1:").replace("://localhost/", "://127.0.0.1/")
                    if norm_base.endswith("://localhost"):
                        norm_base = norm_base.replace("://localhost", "://127.0.0.1")
                    if not norm_base.endswith("/v1") and "/v1/" not in norm_base:
                        norm_base = f"{norm_base}/v1"
                    url = f"{norm_base}/chat/completions"
                    payload = {
                        "model": effective_model,
                        "messages": [
                            {"role": "system", "content": system_instruction},
                            {"role": "user", "content": prompt}
                        ],
                        "temperature": temperature,
                        "max_tokens": safe_max_tokens,
                        "stream": True
                    }
                    async with client.stream("POST", url, json=payload) as response:
                        if response.status_code == 200:
                            llm_connected = True
                            async for line in response.aiter_lines():
                                if not line:
                                    continue
                                clean_line = line.strip()
                                if clean_line.startswith("data:"):
                                    payload_str = clean_line[5:].strip()
                                    if payload_str == "[DONE]":
                                        break
                                    try:
                                        data = json.loads(payload_str)
                                        if "error" in data:
                                            err_val = data["error"]
                                            err_msg = err_val.get("message") if isinstance(err_val, dict) else str(err_val)
                                            yield json.dumps({"chunk": f"\n\n> [!WARNING]\n> **LM Studio Notice**: {err_msg}\n"})
                                            break
                                        choice = data.get("choices", [{}])[0]
                                        finish_reason = choice.get("finish_reason")
                                        if finish_reason in ("length", "max_tokens"):
                                            is_truncated = True
                                        delta = choice.get("delta", {})
                                        raw_chunk = delta.get("content") or ""
                                        raw_thought = delta.get("reasoning_content") or delta.get("reasoning") or delta.get("thought") or ""
                                        clean_chunk, inline_thought = think_filter.process(raw_chunk)
                                        final_thought = raw_thought + inline_thought
                                        if final_thought:
                                            received_any_chunk = True
                                            yield json.dumps({"thought": final_thought})
                                        if clean_chunk:
                                            received_any_chunk = True
                                            yield json.dumps({"chunk": clean_chunk})
                                    except Exception:
                                        continue
                        else:
                            err_body = await response.aread()
                            err_text = err_body.decode("utf-8", errors="ignore")
                            yield json.dumps({"chunk": f"\n\n> [!WARNING]\n> **Local LLM Server (HTTP {response.status_code})**: {err_text}\n"})
                            llm_connected = False
            
            # Flush any remaining thinking/chunk tokens
            rem_content, rem_thought = think_filter.flush()
            if rem_thought:
                yield json.dumps({"thought": rem_thought})
            if rem_content:
                yield json.dumps({"chunk": rem_content})

            if is_truncated:
                trunc_warning = (
                    "\n\n> [!WARNING]\n"
                    "> **Report Truncated (Context Window Limit Reached)**: "
                    "The local model reached its maximum context length (`truncated = 1`).\n"
                    "> - In **LM Studio**: Increase the model's **Context Length** in the model load settings (e.g. to 32,768 or 65,536).\n"
                    "> - In **Log Analysis Settings**: Select a narrower time window (such as 'Last 6 Hours' or 'Today') to reserve maximum room for the generated report.\n"
                )
                yield json.dumps({"chunk": trunc_warning})

        except Exception as e:
            if not received_any_chunk:
                llm_connected = False

        if not llm_connected and not received_any_chunk:
            fallback_report = cls.generate_rule_based_fallback_report(forensic_context, provider, base_url, model_name)
            for paragraph in fallback_report.split("\n\n"):
                yield json.dumps({"chunk": paragraph + "\n\n"})

        yield "[DONE]"

    @classmethod
    def generate_rule_based_fallback_report(
        cls,
        forensic_context: Dict[str, Any],
        provider: str,
        base_url: str,
        model_name: str
    ) -> str:
        """Generates an intelligent TRIRIGA forensic audit report when local LLM server is offline or starting up."""
        stats = forensic_context["stats"]
        hourly = forensic_context.get("hourly_distribution", [])
        clusters = forensic_context["error_clusters"]
        
        scope_title = forensic_context.get("scope_title", "All Cluster Nodes")
        has_deadlock = any("deadlock" in (c.get("message") or "").lower() or "ora-00060" in (c.get("stack_trace") or "").lower() for c in clusters)
        has_pool_exhaust = any("datapool" in (c.get("logger_name") or "").lower() or "connection pool exhausted" in (c.get("message") or "").lower() for c in clusters)
        has_oom = any("outofmemory" in (c.get("message") or "").lower() or "heap space" in (c.get("stack_trace") or "").lower() for c in clusters)

        severity = "Critical" if (has_deadlock or has_oom or has_pool_exhaust) else ("High" if clusters else "Low")

        hourly_summary = ""
        if hourly:
            peak_hour = max(hourly, key=lambda h: h.get("errors", 0))
            hourly_summary = f"- **Peak Error Hour**: `{peak_hour['hour']}:00` with {peak_hour['errors']} error events ({peak_hour['total']} total logs recorded in that hour)."

        report_run_date = format_ordinal_date()

        return f"""> [!NOTE]
> *Local LLM Note: Local {provider.upper()} endpoint at `{base_url}` was unreachable or offline. Displaying real-time heuristic log audit report from SQLite data. Once Ollama/LM Studio is running, deep generative LLM inferences will stream directly.*

# Technical Audit Report – TRIRIGA {scope_title}
*Date of report preparation: {report_run_date}*

## 1. Executive Summary
- **Platform Severity Rating**: **{severity.upper()}**
- **Time Window Analyzed**: `{stats['earliest_ts']}` to `{stats['latest_ts']}`
- **Total Processed Logs**: {stats['total_logs']} entries across {scope_title}
- **Critical / Error Incidents**: {stats['total_errors']} events
- **Warning Threshold Events**: {stats['total_warns']} events
{hourly_summary}

---

## 2. Key Detected Incidents & Root Cause Analysis

### Incident A – Database Connection Pool Contention (`DataPool`)

**Affected Component/Module**: Database Connection Pool / JDBC DataPool

**Technical Root Cause**: Active connections exhausted pool capacity limit (100/100) leading to `ConnectionTimeoutException`. Long-running asynchronous workflows or unclosed JDBC result sets hold database connections beyond the acquisition timeout window. For instance, an un-indexed query executing for 45 seconds holds a thread connection, creating cascading contention until all available connections in the pool become exhausted.

**Impact & Business Consequences**: Incoming user sessions and synchronous record updates fail with connection timeout errors, degrading system availability.

**Actionable Remediation**:
1. Check `SYSIBMADM.MON_LOCKWAITS` and `MON_GET_ACTIVITY` over read-only VPN or via IBM SRE to identify blocking threads.
2. If pool size increase is required, submit a Service Request (SR) to IBM SRE to adjust `DBCONNECTION_POOL_MAX` in `TRIRIGAWEB.properties`.
3. Optimize and index filter fields in long-running workflow Query Tasks.

---

### Incident B – Asynchronous Workflow Engine Lock Contention (`WorkflowEngine`)

**Affected Component/Module**: Asynchronous Workflow Engine / Record State Transition

**Technical Root Cause**: Concurrent workflow agent threads attempting to update overlapping child records (`T_TRICONTRACT`) in conflicting lock order, resulting in DB2 lock timeout or deadlock conditions. Lock contention occurs when concurrent transactions hold exclusive row locks while requesting locks held by the other, forcing the database engine to roll back the victim transaction.

**Impact & Business Consequences**: Background lease and contract calculation workflows fail to complete, leaving records in intermediary states.

**Actionable Remediation**:
1. Monitor `WF_EVENT` table queue depth in the TRIRIGA Administrator Console.
2. Review Lease Calculation workflow triggers to sequence child record updates deterministically or process via asynchronous batches.
3. Submit an IBM SRE Service Request (SR) to inspect `MON_LOCKWAITS` if table-level lock escalation is detected.

---

### Incident C – JVM Memory Saturation & Heap Contention (`MemoryMonitor`)

**Affected Component/Module**: WebSphere Liberty JVM Heap / Graphics Processing

**Technical Root Cause**: Large graphic or geometric datasets loaded into heap memory exceeding configured maximum heap limits, triggering garbage collection thrashing and `OutOfMemoryError`. High-density object graphs unmarshalled simultaneously exhaust available heap space before the garbage collector can reclaim tenure generations.

**Impact & Business Consequences**: Worker threads crash, causing transaction drops and intermittent node unavailability.

**Actionable Remediation**:
1. Submit an IBM SRE Service Request (SR) to increase 64-bit JVM max heap allocation (`-Xmx16g -Xms16g`) and tune G1GC parameters in `jvm.options` / `server.xml`.
2. Restrict maximum file upload sizes for CAD/BIM models in Data Modeler settings.

---

## 3. Recommended Immediate Action Items
1. **DB Pool Adjustment**: Tune JDBC pool max connection ceiling and connection timeout parameters.
2. **Process Queue Balancing**: Segregate Process Servers (WFE agents) from UI App Servers.
3. **Memory Sizing**: Elevate JVM maximum heap allocation and monitor garbage collection pause times.
"""

    @classmethod
    def extract_related_log_evidence(cls, user_query: str, cur: sqlite3.Cursor) -> str:
        """
        Proactively consults the SQLite database for similar, related, or contemporaneous
        log events to provide autonomous context for the log entry being diagnosed.

        SERVER ISOLATION POLICY:
        - Only consult logs on the exact same server as the event being investigated.
        - EXCEPTION: If the event is on 'prod app1' or 'prod app2', both production servers
          ('prod app1' and 'prod app2') are consulted and correlated together.
        """
        blocks = []

        # 0. Identify Target Server & Determine Allowed Server IDs
        cur.execute("SELECT id, name FROM servers;")
        all_servers = cur.fetchall()  # [(102, 'opw-dev'), (106, 'prod app1'), ...]

        server_match = re.search(r'server\s+["\']?([^"\'\r\n()]+)', user_query, re.IGNORECASE)
        matched_server = server_match.group(1).strip() if server_match else None

        allowed_server_ids = []
        scope_description = ""

        if matched_server:
            canonical_name = None
            found_id = None
            for s_id, s_name in all_servers:
                if s_name.lower() == matched_server.lower() or matched_server.lower() in s_name.lower():
                    found_id = s_id
                    canonical_name = s_name
                    break

            if found_id:
                # Production cluster exception: check both prod app1 and prod app2
                if canonical_name.lower() in ["prod app1", "prod app2"]:
                    prod_ids = [s_id for s_id, s_name in all_servers if s_name.lower() in ["prod app1", "prod app2"]]
                    allowed_server_ids = prod_ids
                    scope_description = "Production Cluster Nodes (prod app1 & prod app2 correlated)"
                else:
                    allowed_server_ids = [found_id]
                    scope_description = f"Server Node: {canonical_name} (Strict Single-Server Scope)"

        # Prepare SQL filter condition for server scoping
        if allowed_server_ids:
            placeholders = ",".join("?" * len(allowed_server_ids))
            server_filter_sql = f"AND e.server_id IN ({placeholders})"
            server_filter_params = allowed_server_ids
        else:
            server_filter_sql = ""
            server_filter_params = []
            scope_description = "All Available Cluster Nodes"

        # 1. Contemporaneous timeline (+/- 5 min window around event timestamp)
        ts_match = re.search(
            r'(?:Timestamp|Time):\s*([0-9]{4}-[0-9]{2}-[0-9]{2}[T ][0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]+)?Z?)',
            user_query,
            re.IGNORECASE
        )
        if ts_match:
            ts_str = ts_match.group(1).replace(' ', 'T')
            clean_ts = ts_str.rstrip('Z')
            try:
                dt = datetime.fromisoformat(clean_ts)
                t_start = (dt - timedelta(minutes=5)).strftime('%Y-%m-%dT%H:%M:%S.000Z')
                t_end = (dt + timedelta(minutes=5)).strftime('%Y-%m-%dT%H:%M:%S.999Z')
                
                query_sql = f"""
                    SELECT e.timestamp, s.name, e.log_level, e.logger_name, e.message
                    FROM log_entries e
                    JOIN servers s ON e.server_id = s.id
                    WHERE e.timestamp >= ? AND e.timestamp <= ? {server_filter_sql}
                    ORDER BY e.timestamp ASC
                    LIMIT 15;
                """
                cur.execute(query_sql, [t_start, t_end] + server_filter_params)
                c_rows = cur.fetchall()
                if c_rows:
                    lines = [f"  - [{r[0]}] [{r[1]}] [{r[2]}] [{r[3]}]: {r[4][:150]}" for r in c_rows]
                    blocks.append(
                        f"### CONTEMPORANEOUS LOG ACTIVITY (+/- 5 min window: {t_start} to {t_end}) [{scope_description}]:\n" +
                        "\n".join(lines)
                    )
            except Exception:
                pass

        # 2. Similar recent events from this Logger or subsystem on target server(s)
        logger_match = re.search(r'Logger:\s*([^\r\n]+)', user_query, re.IGNORECASE)
        if logger_match:
            l_name = logger_match.group(1).strip()
            if l_name and l_name != 'N/A':
                query_sql = f"""
                    SELECT e.timestamp, s.name, e.log_level, e.message
                    FROM log_entries e
                    JOIN servers s ON e.server_id = s.id
                    WHERE e.logger_name = ? {server_filter_sql}
                    ORDER BY e.timestamp DESC
                    LIMIT 8;
                """
                cur.execute(query_sql, [l_name] + server_filter_params)
                s_rows = cur.fetchall()
                if s_rows:
                    lines = [f"  - [{r[0]}] [{r[1]}] [{r[2]}]: {r[3][:150]}" for r in s_rows]
                    blocks.append(
                        f"### SIMILAR RECENT EVENTS FROM SAME LOGGER ({l_name}) [{scope_description}]:\n" +
                        "\n".join(lines)
                    )

        # 3. Targeted keyword / MID / Spec ID search on target server(s)
        mid_matches = re.findall(r'MID-\d+', user_query)
        spec_matches = re.findall(r'\b\d{6,10}\b', user_query)
        search_terms = list(set(mid_matches + spec_matches))[:4]
        if search_terms:
            like_clauses = ' OR '.join(['e.message LIKE ?'] * len(search_terms))
            like_params = [f'%{t}%' for t in search_terms]
            try:
                query_sql = f"""
                    SELECT e.timestamp, s.name, e.log_level, e.logger_name, e.message
                    FROM log_entries e
                    JOIN servers s ON e.server_id = s.id
                    WHERE ({like_clauses}) {server_filter_sql}
                    ORDER BY e.timestamp DESC
                    LIMIT 10;
                """
                cur.execute(query_sql, like_params + server_filter_params)
                t_rows = cur.fetchall()
                if t_rows:
                    lines = [f"  - [{r[0]}] [{r[1]}] [{r[2]}] [{r[3]}]: {r[4][:150]}" for r in t_rows]
                    blocks.append(
                        f"### CORRELATED LOG MATCHES FOR REFERENCED IDENTIFIERS [{scope_description}]:\n" +
                        "\n".join(lines)
                    )
            except Exception:
                pass

        return "\n\n".join(blocks)

    @classmethod
    async def chat_with_logs(
        cls,
        provider: str,
        base_url: str,
        model_name: str,
        user_query: str,
        server_ids: Optional[List[int]] = None,
        density: str = "concise",
        start_time: Optional[str] = None,
        end_time: Optional[str] = None,
        date_preset: Optional[str] = None,
        context_window: int = 32768,
    ) -> AsyncGenerator[str, None]:
        """Allows natural language interactive queries with full-day temporal awareness against SQLite log context."""
        query_lower = user_query.lower()
        
        with db_session() as conn:
            cur = conn.cursor()

            # If not explicitly provided via date filter, determine temporal scope from query
            if not start_time and not end_time:
                cur.execute("SELECT MAX(date(timestamp)), MIN(date(timestamp)) FROM log_entries;")
                date_row = cur.fetchone()
                latest_date = date_row[0] if date_row and date_row[0] else datetime.now(timezone.utc).strftime("%Y-%m-%d")
                earliest_date = date_row[1] if date_row and date_row[1] else latest_date

                # Check if query references "today"
                if any(w in query_lower for w in ["today", "today's", "todays", "past 24h", "24 hours", "current day"]):
                    start_time = f"{latest_date}T00:00:00.000Z"
                    end_time = f"{latest_date}T23:59:59.999Z"
                
                # Check for explicit date mentions like 2026-08-31 or 2026-08-26
                date_match = re.search(r"\b(202\d-\d{2}-\d{2})\b", user_query)
                if date_match:
                    target_d = date_match.group(1)
                    start_time = f"{target_d}T00:00:00.000Z"
                    end_time = f"{target_d}T23:59:59.999Z"

            # Assemble rich forensic context for the requested scope (or whole cluster)
            # Dynamically scale error and sample budgets to available context window
            if density == "concise":
                max_err = 16 if context_window >= 16000 else 8
                max_samp = 30 if context_window >= 16000 else 15
            else:
                max_err = 50 if context_window >= 24000 else (35 if context_window >= 14000 else 20)
                max_samp = 80 if context_window >= 24000 else (50 if context_window >= 14000 else 30)

            context_data = cls.assemble_log_forensic_context(
                conn=conn,
                server_ids=server_ids,
                start_time=start_time,
                end_time=end_time,
                date_preset=date_preset,
                max_errors=max_err,
                max_samples=max_samp,
                context_window=context_window,
            )

            stats = context_data["stats"]
            hourly = context_data["hourly_distribution"]
            servers = context_data["server_breakdown"]
            clusters = context_data["error_clusters"]
            timeline = context_data["critical_timeline"]

            # Also perform targeted search if query contains specific terms (MID, error code, keyword)
            # Skip heavy full-text search if the user query is already a self-contained log analysis prompt
            is_direct_analysis = "please analyze" in query_lower or "log entry from server" in query_lower or "stack trace" in query_lower
            search_matches = []
            related_evidence_str = ""

            if is_direct_analysis:
                related_evidence_str = cls.extract_related_log_evidence(user_query, cur)
            else:
                # Extract clean alphanumeric search terms (at most 4 specific terms)
                stopwords = {
                    "the", "and", "for", "from", "with", "what", "how", "why", "are", "you",
                    "logs", "log", "summary", "today", "todays", "give", "show", "tell", "about",
                    "can", "fix", "error", "errors", "warn", "warning", "info", "server", "cluster",
                    "please", "help", "find", "check", "app1", "app2", "prod", "something"
                }
                words = re.findall(r"\b[a-zA-Z0-9_]{3,30}\b", user_query)
                clean_terms = [w for w in words if w.lower() not in stopwords][:4]
                
                if clean_terms:
                    # Safe FTS5 query with quoted terms
                    fts_query = " OR ".join([f'"{t}"*' for t in clean_terms])
                    server_clause = ""
                    query_params = [fts_query]
                    if server_ids:
                        placeholders = ",".join("?" * len(server_ids))
                        server_clause = f"AND e.server_id IN ({placeholders})"
                        query_params.extend(server_ids)
                    try:
                        cur.execute(f"""
                            SELECT e.timestamp, s.name as server_name, e.log_level, e.logger_name, e.message, e.stack_trace
                            FROM log_entries_fts fts
                            JOIN log_entries e ON fts.rowid = e.id
                            JOIN servers s ON e.server_id = s.id
                            WHERE log_entries_fts MATCH ? {server_clause}
                            ORDER BY e.timestamp DESC
                            LIMIT 25;
                        """, query_params)
                        search_matches = dict_list_from_rows(cur.fetchall())
                    except Exception:
                        # Fallback LIKE search limited to at most 2 terms
                        fallback_terms = clean_terms[:2]
                        like_clauses = " OR ".join(["e.message LIKE ? OR e.logger_name LIKE ?"] * len(fallback_terms))
                        like_params = []
                        for t in fallback_terms:
                            like_params.extend([f"%{t}%", f"%{t}%"])
                        server_clause = ""
                        if server_ids:
                            placeholders = ",".join("?" * len(server_ids))
                            server_clause = f"AND e.server_id IN ({placeholders})"
                            like_params.extend(server_ids)
                        try:
                            cur.execute(f"""
                                SELECT e.timestamp, s.name as server_name, e.log_level, e.logger_name, e.message, e.stack_trace
                                FROM log_entries e
                                JOIN servers s ON e.server_id = s.id
                                WHERE ({like_clauses}) {server_clause}
                                ORDER BY e.timestamp DESC
                                LIMIT 20;
                            """, like_params)
                            search_matches = dict_list_from_rows(cur.fetchall())
                        except Exception:
                            search_matches = []

        if is_direct_analysis:
            combined_query_evidence = f"{user_query}\n{related_evidence_str}"
            resolved_records_block = TririgaResolver.build_evidence_resolution_block(combined_query_evidence)
            system_msg = f"""OUTPUT FORMATTING RULES & MANDATORY TEMPLATE:
- Present findings strictly as a finalised, professional executive report written by a Senior TRIRIGA Architect for an engineering audience.
- ZERO-TOLERANCE FOR META-COMMENTARY OR STRUCTURAL LABELS:
  NEVER include structural labels, self-announcements, or meta-commentary in ANY form (whether in brackets [...], parentheses (...), or plain text).
  PROHIBITED EXAMPLES: Do NOT write "(Detailed analytical paragraph...)", "[Analytical paragraph explaining...]", "Note:", "Concept:", or "Plain-English explanation:".
  Output your analysis directly as standard narrative paragraphs.
- NO INSTRUCTION ECHOING: Never cite or reference the names of the rules provided to you (e.g., do not write "per Health Rating Logic" or "per Architectural Boundaries"). Just apply the logic silently.
- Strict Date Formatting: Every single date must include an ordinal suffix (e.g., "4th not 4", "2nd not 2", "1st not 1", "3rd not 3"). NEVER output non-ordinal dates.
- Table Formatting: Never invent table names like `T_SMARTOBJECT` or `TRIRIGA_SMARTOBJECT`. Use valid examples like `T_REQUISITION` or `IBS_SPEC`.

- PERSONA, TONE, EXPERTISE & AI TRANSPARENCY:
  * Identity: You are an automated AI diagnostic assistant. You must be completely transparent about your AI nature. Do not feign human experiences, pretend to be a human employee, or invent a human name.
  * Expertise & Tone: While you are an AI, you must write with the absolute authority, precision, and professional tone of a Senior TRIRIGA Architect. Do not use an apologetic or subservient AI tone (e.g., never say "I am just an AI, but...").
  * Banned Phrases List: You are strictly forbidden from using the exact phrase "Plain-English concept explanation:" or "Plain-English explanation:". If you need to use an analogy, state it directly as a technical fact without announcing it as an explanation.
  * Transparent AI Attribution: Clearly indicate that this is automated LLM output in the report footer or disclaimer. Do NOT claim or output that the report was generated by a human Senior TRIRIGA Architect.
- Use generous whitespace, paragraphs, double line breaks (\n\n), distinct headers (###), and bullet points. Never compress separate topics or steps into a single dense wall of text.
Analyze the specific TRIRIGA log event and stack trace provided by the user, alongside the contemporaneous and related cluster logs retrieved automatically from SQLite.

STRICT ARCHITECTURAL FACTS & CONSTRAINTS:
- STRICT DATA AVAILABILITY & EVIDENCE GROUNDING:
  * Restrict all analytical conclusions, root causes, and negative assertions strictly to the data and log files actually provided in the cluster evidence.
  * ABSOLUTE PROHIBITION ON CLAIMING UNPROVIDED LOGS WERE CHECKED: You do NOT have access to WebSphere Liberty `messages.log`, `trace.log`, `console.log`, GC logs, or OS-level metrics. NEVER claim or state that you checked `messages.log` or that "no thread contention errors were found in messages.log" or that "this confirms the issue is not connection pool starvation because no errors were found in messages.log".
  * Recommend Access for Missing System Data: If diagnosing potential connection pool starvation, thread contention, thread deadlocks, or JVM memory issues where Liberty `messages.log`, Java thread dumps (`kill -3`), or DB2 lock snapshots are needed for definitive diagnosis, you must explicitly state that `messages.log` is not accessible, and recommend requesting access to `messages.log` (via an IBM SRE Service Request) for further analysis.
- Database Schema: TRIRIGA records and metadata are stored in `IBS_SPEC`, `IBS_SPEC_ASSIGNMENTS`, and specific `T_` tables (e.g., `T_TRIBUILDING`, `T_TRICONTRACT`, `T_MYBUSINESSMAP`). Never invent or reference fictional tables like `TRIRIGA_SMARTOBJECT` or `T_SMARTOBJECT`.
- TRIRIGA Schema & Primary Key Conventions:
  * Primary Keys: The universal primary key for `IBS_SPEC`, `IBS_SPEC_ASSIGNMENTS`, and all `T_` tables is `SPEC_ID`. Never write SQL queries using generic identifiers like `id`, `record_id`, or `uuid`.
  * System Columns: TRIRIGA manages record states, audit trails, and security via reserved system columns on the `T_` tables. Record state is always stored in `SYS_STATE1`. Audit data uses `SYS_UPDATEDBY`. Never hallucinate generic web application columns like `status`, `created_date`, or `updated_by`.
  * DB2 System Catalog: If generating diagnostic queries to verify table or column metadata (e.g., checking if a custom field exists), you must use DB2's `SYSCAT.TABLES` and `SYSCAT.COLUMNS` views. Never use ANSI standard `information_schema`.
- Custom Data Fields and Indexes: Custom data fields (e.g., `triCurrencyUO`) reside on specific business object `T_` tables (such as `T_REQUISITION`). `IBS_SPEC` only holds core system metadata. Direct any index creation or field-level queries to the appropriate `T_` table, never to `IBS_SPEC`.
- Data Manipulation Constraints: Never advise the manual execution of UPDATE, INSERT, or DELETE statements directly against `IBS_SPEC`, `IBS_SPEC_ASSIGNMENTS`, or `T_` tables. All data manipulation must occur via the TRIRIGA application UI, DataConnect, or OSLC APIs. Direct database writes corrupt the Object State.
- Record Associations: Recognise that TRIRIGA does not use standard relational foreign keys. All record-to-record links are stored in the `IBS_SPEC_ASSIGNMENTS` table. Diagnostic queries involving linked objects must query this table using the `SPEC_ID`.
- List Manager vs. Associations: List values are static metadata managed in the TRIRIGA List Manager. Never state that List Values (dropdown options) are stored in `IBS_SPEC_ASSIGNMENTS` or managed in the Data Modeler. `IBS_SPEC_ASSIGNMENTS` is strictly for linking distinct data records (e.g., linking a Requisition to a Location).
- Expanded Core Code Boundaries: You are strictly forbidden from recommending modifications to any core platform Java classes. This includes, but is not limited to, `CommonQuerySerializer`, `OslcRequestDispatcherImpl`, `OslcCreationHandler`, `ListServiceImpl`, and `ObjectSerializer` (e.g. classes within `tririga-ib.jar`). Limit customisation advice strictly to external OSLC wrappers or TRIRIGA workflow logic.
- Connection Pooling: Acknowledge that connection capacity is managed via Liberty `server.xml` (e.g., `maxPoolSize`) or `TRIRIGAWEB.properties`. If connection starvation or thread contention is suspected, note that `messages.log` is not ingested and recommend requesting Liberty `messages.log` and DB2 lock wait snapshots (`MON_LOCKWAITS`) from IBM SRE rather than suggesting superficial capacity increases.
- Database Isolation: TRIRIGA operates on `TRANSACTION_READ_COMMITTED` isolation level. Never recommend `READ UNCOMMITTED` or dirty reads, as this violates platform standards and risks severe data integrity issues.
- Health Rating Logic: Do not conflate incident severity with system health. If a platform is experiencing high-severity issues, deadlocks, or connection exhaustion, you must rate the overall system health as 'Critical' or 'Poor'. Never rate system health as 'High' or 'Healthy' under these conditions.
- Strict Component Isolation & Causation: Do not force correlation or invent causal links between unrelated system failures just because they occur in the same time window. Missing user profile data cannot cause OS-level file system failures or connection pool exhaustion. Treat distinct architectural errors as separate root causes unless they mathematically interact (e.g., long DB2 queries do cause pool exhaustion).
- Strict Subsystem Isolation (Do Not Conflate Components):
  * OSLC vs. Workflow Engine: Never conflate HTTP/OSLC integration errors with internal workflow logic. ObjectSerializer and IllegalArgumentException occur exclusively at the incoming HTTP/OSLC web request layer. Workflow Engine field mapping errors (e.g., SOFieldMapImpl, InvalidFieldRequestException) occur internally during execution. Do not state that the Workflow Engine uses ObjectSerializer to unmarshall data.
  * Filesystem vs. Workflow Agents: Temporary file cache errors (userfiles) are strictly OS-level filesystem, storage, or permission issues. Never instruct an admin to restart a Workflow Agent to fix userfiles or temporary file cache errors. Workflow Agents manage asynchronous database events (WF_EVENT), not local disk space or filesystem mounts.
  * Mail Preparation Boundaries: Mail preparation failures are caused strictly by SMTP configuration issues or userfiles attachment generation failures (the system cannot cache/write the physical file). Never link missing user profile metadata (e.g., LabeledObjectFactory lookups) to mail preparation failures.
- Workflow Event Queue Validation (WF_EVENT): Success in the `WF_EVENT` table is indicated by an empty queue (the absence of rows), as the Workflow Agent clears them upon completion. Do not search for a 'completed' status. The `WF_EVENT` table is exclusively used to monitor if an asynchronous workflow process is queued, executing, or stalled. Never advise querying `WF_EVENT` to check if a Smart Object or data record exists. Record existence must only be verified via standard OSLC lookups or querying `IBS_SPEC`. Differentiate between synchronous locking and asynchronous event queuing. If a process is stalled after a state transition, instruct the user to check the `WF_EVENT` table and the TRIRIGA Workflow Agent status before assuming a DB2 connection pool issue.
- Metadata & OSLC Configuration: When diagnosing missing custom fields in OSLC payloads or serializers, mandate checking if the Business Object (BO) was successfully 'Published' in the TRIRIGA Data Modeler. Additionally, instruct the user to verify that the OSLC Resource mapping was updated in the OSLC Manager.
- DB2 Lock Diagnostic Syntax: When querying `SYSIBMADM.MON_LOCKWAITS`, strictly use the `TABNAME` column to filter by table (e.g., `WHERE TABNAME = 'T_REQUISITION'`). Never use `object_name` or `table_name`. To retrieve lock holder details, use the `HLD_APPLICATION_HANDLE`, `HLD_USERID`, and `HLD_CURRENT_STMT_TEXT` columns.
- DB2 Lock Escalation: When addressing connection pool starvation linked to DB2 locks, instruct the user to check for Lock Escalation. Query `MON_LOCKWAITS` to check if the `LOCK_MODE` indicates a table-level lock (e.g., 'Z' or 'X' on a table rather than a row), which typically occurs during large data imports.
- File System & Content: Treat temporary file cache errors as TRIRIGA `userfiles` directory issues. Direct diagnostics to the storage path defined in `TRIRIGAWEB.properties` or the configured Content Management System, rather than generic web application temporary folders.
- STRICT FILESYSTEM VS. UI CACHE BOUNDARIES: The userfiles temporary file cache is a physical OS-level filesystem issue. You must NEVER suggest that clearing the JVM 'List Cache' or 'Object MetaData Cache' in the Administrator Console will resolve userfiles or Content cache errors. If userfiles errors are present, the only self-service mitigation is verifying the path in the properties view; the actual fix requires an IBM SRE Service Request (SR).
- User Profiles as Records: Recognise that usernames or IDs (e.g., 'farrellde' or '10095356') missing during lookups are tied to TRIRIGA 'My Profile' or 'Employee' records. Direct remediation toward user provisioning integrations rather than generic Smart Object creation.
- Cache Management & Boundaries: If metadata, list values, or object labels are stale, direct the user to clear the specific cache (e.g., 'List Cache' or 'Object MetaData Cache') via the TRIRIGA Administrator Console. Never recommend restarting the WebSphere Liberty server as a first step for cache issues. Do not suggest that clearing TRIRIGA Admin Console JVM caches will fix OS-level issues, filesystem errors (`userfiles`), or DB2 deadlocks; cache clearing only fixes stale metadata or UI dropdown display issues.
- Log Roles & Availability: Analysis is strictly confined to the ingested files in scope (typically `server.log` for OSLC payload exceptions, state transition errors, and platform logic; `performance.log` for slow workflow steps and DB2 queries). WebSphere Liberty `messages.log` is NOT ingested or accessible in this environment. Never claim `messages.log` was inspected or that absence of messages in it proves anything; recommend requesting `messages.log` if thread contention or connection pool starvation needs deeper investigation.
- Formatting and Localisation Requirements: You must strictly use traditional Irish/British English spellings (e.g., 'specialising', 'customisation', 'analyse') and standard date formats with ordinal indicators (e.g., '4th not 4', '2nd not 2', or 'dd/mm/yyyy'). Do not use ISO or US date formats.
- Operational Boundaries & Strict SaaS Constraints: Limit self-service remediation strictly to the TRIRIGA Administrator Console (clearing caches, reviewing logs, restarting Workflow Agents) and the application UI (Data Modeler, OSLC mapping). In an IBM SaaS environment, the local admin has zero OS-level visibility: do not instruct the local admin to check disk space, verify read/write file permissions, or directly modify backend configuration files like `TRIRIGAWEB.properties` or `server.xml`.
- Configuration Verification: The local admin can view active properties via the Administrator Console. You may instruct the admin to read `TRIRIGAWEB.properties` in the Admin Console to verify settings (such as directory paths or mail hosts), but any required modifications require an SR.
- IBM SRE Escalations (Service Requests): The local admin has zero OS-level visibility. Instruct the user to "Submit a Service Request (SR) ticket to the IBM SRE team" for modifications to `server.xml`, `TRIRIGAWEB.properties` (e.g., increasing connection pool sizes), WebSphere Liberty / JVM restarts, OS-level file permissions (`userfiles`), or killing DB2 locks / resolving database deadlocks.
- Prioritise Actionable Diagnostics & Missing Log Recommendations: When providing remediation steps, prioritise actionable diagnostics. If `messages.log`, Java thread dumps (`kill -3`), or DB2 diagnostic queries (`MON_LOCKWAITS`, `MON_GET_ACTIVITY`, `SYSIBMADM.SNAPLOCK`, `db2pd`) are needed for further analysis, explicitly recommend that the user request them via an IBM SRE Service Request (or run DB queries over read-only VPN).
- Database Syntax: DATABASE REQUIREMENT: This TRIRIGA environment uses IBM DB2. Any diagnostic SQL, lock-checking queries, or remediation scripts MUST use IBM DB2 syntax (e.g. SYSCAT views, SYSIBMADM.SNAPLOCK, SYSIBMADM.MON_LOCKWAITS, MON_GET_ACTIVITY, db2pd). NEVER output MySQL (e.g. performance_schema, SHOW), PostgreSQL, or Oracle syntax.

CRITICAL INSTRUCTION - PROACTIVE LOG INVESTIGATION:
- Never ask the user to "provide the full stack trace", "provide more logs", or "paste logs around this error". You have direct access to the database and relevant contemporaneous events have already been consulted and provided below.
- Server Investigation Scope: Contemporaneous and related logs have been strictly scoped to the same server node as the incident (or across both production servers prod app1 and prod app2 if this is a production incident). Do not assume errors are cluster-wide if they are isolated to a single non-prod server.
- Synthesize all available evidence (contemporaneous server logs, similar events, and referenced TRIRIGA records) to diagnose the issue decisively.
- Provide a direct, high-yield diagnostic assessment structured with clear headings, bullet points, and paragraph whitespace:
  ### 1. Root Cause Analysis
  [Subsystem, query, or transaction failure mechanism. Correlate with any contemporaneous cluster events or recurring patterns found in the logs.]

  ### 2. Contemporaneous & Similar Events Found
  [Summarize any related activity occurring on this or other cluster nodes around the same timestamp (+/- 5 minutes) or identical logger errors across the cluster.]

  ### 3. Technical Findings & Mechanisms
  [Provide clear explanations of underlying mechanisms (such as connection pool starvation, deadlocks, or lock contention) woven naturally into the analysis without meta-text or duplicate definitions.]

  ### 4. Impacted Objects / Context
  [Referenced Spec IDs, Business Objects, or Workflow Templates.]

  ### 5. Actionable Remediation
  - **Local Admin Self-Service Actions**: [Exact configuration, UI steps, or cache clearing]
  - **IBM SRE Service Request (SR)**: [Escalations requiring infrastructure changes]

=== PROACTIVELY CONSULTED CLUSTER LOG EVIDENCE ===
{related_evidence_str if related_evidence_str else "No contemporaneous or duplicate cluster logs detected in the immediate +/- 5 minute window."}

{resolved_records_block}
===================================
Be concise, direct, authoritative, and present findings as a finalised executive diagnosis with clean paragraphs and whitespace without meta-labels. Use DB2 syntax for all SQL."""
        else:
            hourly_lines = [
                f"  - {h['hour']}:00 -> {h['total']} logs ({h['errors']} errors, {h['warns']} warns)"
                for h in hourly
            ]
            hourly_str = "\n".join(hourly_lines) if hourly_lines else "  - No hourly activity breakdown available."
            server_str = ", ".join([f"{s['server_name']} ({s['count']} logs, {s['errors']} errors)" for s in servers])
            clusters_limit = 25 if context_window >= 16000 else 10
            trace_limit = 300 if context_window >= 16000 else 100
            cluster_lines = []
            for i, c in enumerate(clusters[:clusters_limit], 1):
                trace_snip = f" | Trace: {c['stack_trace'][:trace_limit]}..." if c.get("stack_trace") else ""
                cluster_lines.append(f"  {i}. [{c['log_level']}] {c['server_name']} ({c['occurrence_count']}x): {c['message']}{trace_snip}")
            clusters_str = "\n".join(cluster_lines) if cluster_lines else "  - No recurring error clusters."

            search_limit = 25 if context_window >= 16000 else 10
            search_str = ""
            if search_matches:
                search_lines = [
                    f"  - [{r['timestamp']}] [{r['server_name']}] [{r['log_level']}]: {r['message']}"
                    for r in search_matches[:search_limit]
                ]
                search_str = f"\n### SPECIFIC KEYWORD / MID MATCHES:\n" + "\n".join(search_lines)

            combined_evidence = f"{clusters_str}\n{search_str}\n{user_query}"
            resolved_records_block = TririgaResolver.build_evidence_resolution_block(combined_evidence)

            system_msg = f"""OUTPUT FORMATTING RULES & MANDATORY TEMPLATE:
- Present findings strictly as a finalised, professional executive report written by a Senior TRIRIGA Architect for an engineering audience.
- ZERO-TOLERANCE FOR META-COMMENTARY OR STRUCTURAL LABELS:
  NEVER include structural labels, self-announcements, or meta-commentary in ANY form (whether in brackets [...], parentheses (...), or plain text).
  PROHIBITED EXAMPLES: Do NOT write "(Detailed analytical paragraph...)", "[Analytical paragraph explaining...]", "Note:", "Concept:", or "Plain-English explanation:".
  Output your analysis directly as standard narrative paragraphs.
- NO INSTRUCTION ECHOING: Never cite or reference the names of the rules provided to you (e.g., do not write "per Health Rating Logic" or "per Architectural Boundaries"). Just apply the logic silently.
- Strict Date Formatting: Every single date must include an ordinal suffix (e.g., "4th not 4", "2nd not 2", "1st not 1", "3rd not 3"). NEVER output non-ordinal dates.
- Table Formatting: Never invent table names like `T_SMARTOBJECT` or `TRIRIGA_SMARTOBJECT`. Use valid examples like `T_REQUISITION` or `IBS_SPEC`.

- MANDATORY REPORT STRUCTURE & SEQUENTIAL NUMBERING:
  You MUST structure your response with clear, sequential headings starting at 1:

  ## 1. Key Detected Incidents & Root Causes
  For each detected incident, format using this exact Markdown layout:
  ### Incident [Letter] – [Brief Title]
  - **Affected Component/Module**: [Component Name]
  - **Technical Root Cause**: [Direct, technical explanation integrating all definitions naturally without meta-commentary.]
  - **Impact & Business Consequences**: [Specific end-user and business process failure.]

  ## 2. Timeline & Failure Dynamics
  [Chronological narrative progression and correlation of failure events across the cluster / server nodes]

  ## 3. Actionable Remediation Plan
  - **Local Admin Self-Service Actions**: [Exact configuration, UI steps, or cache clearing]
  - **IBM SRE Service Request (SR)**: [Escalations requiring infrastructure changes]
- PERSONA, TONE, EXPERTISE & AI TRANSPARENCY:
  * Identity: You are an automated AI diagnostic assistant. You must be completely transparent about your AI nature. Do not feign human experiences, pretend to be a human employee, or invent a human name.
  * Expertise & Tone: While you are an AI, you must write with the absolute authority, precision, and professional tone of a Senior TRIRIGA Architect. Do not use an apologetic or subservient AI tone (e.g., never say "I am just an AI, but...").
  * Banned Phrases List: You are strictly forbidden from using the exact phrase "Plain-English concept explanation:" or "Plain-English explanation:". If you need to use an analogy, state it directly as a technical fact without announcing it as an explanation.
  * Transparent AI Attribution: Clearly indicate that this is automated LLM output in the report footer or disclaimer. Do NOT claim or output that the report was generated by a human Senior TRIRIGA Architect.
  * Mandatory Markdown Structure: You must strictly preserve the exact Markdown bolding (**) and heading syntax (###) provided in the Incident Reporting Structure. Do not drop the bolding for - **Affected Component/Module**:, - **Technical Root Cause**:, or - **Impact & Business Consequences**:.
- Use generous whitespace, paragraphs, double line breaks (\n\n), distinct headers (##, ###), and bullet points. Never compress separate topics or steps into a single dense wall of text.
Answer the user's question accurately, concisely, and directly from the cluster evidence below.

STRICT ARCHITECTURAL FACTS & CONSTRAINTS:
- STRICT DATA AVAILABILITY & EVIDENCE GROUNDING:
  * Restrict all analytical conclusions, root causes, and negative assertions strictly to the data and log files actually provided in the cluster evidence.
  * ABSOLUTE PROHIBITION ON CLAIMING UNPROVIDED LOGS WERE CHECKED: You do NOT have access to WebSphere Liberty `messages.log`, `trace.log`, `console.log`, GC logs, or OS-level metrics. NEVER claim or state that you checked `messages.log` or that "no thread contention errors were found in messages.log" or that "this confirms the issue is not connection pool starvation because no errors were found in messages.log".
  * Recommend Access for Missing System Data: If diagnosing potential connection pool starvation, thread contention, thread deadlocks, or JVM memory issues where Liberty `messages.log`, Java thread dumps (`kill -3`), or DB2 lock snapshots are needed for definitive diagnosis, you must explicitly state that `messages.log` is not accessible, and recommend requesting access to `messages.log` (via an IBM SRE Service Request) for further analysis.
- Database Schema: TRIRIGA records and metadata are stored in `IBS_SPEC`, `IBS_SPEC_ASSIGNMENTS`, and specific `T_` tables (e.g., `T_TRIBUILDING`, `T_TRICONTRACT`, `T_MYBUSINESSMAP`). Never invent or reference fictional tables like `TRIRIGA_SMARTOBJECT` or `T_SMARTOBJECT`.
- TRIRIGA Schema & Primary Key Conventions:
  * Primary Keys: The universal primary key for `IBS_SPEC`, `IBS_SPEC_ASSIGNMENTS`, and all `T_` tables is `SPEC_ID`. Never write SQL queries using generic identifiers like `id`, `record_id`, or `uuid`.
  * System Columns: TRIRIGA manages record states, audit trails, and security via reserved system columns on the `T_` tables. Record state is always stored in `SYS_STATE1`. Audit data uses `SYS_UPDATEDBY`. Never hallucinate generic web application columns like `status`, `created_date`, or `updated_by`.
  * DB2 System Catalog: If generating diagnostic queries to verify table or column metadata (e.g., checking if a custom field exists), you must use DB2's `SYSCAT.TABLES` and `SYSCAT.COLUMNS` views. Never use ANSI standard `information_schema`.
- Custom Data Fields and Indexes: Custom data fields (e.g., `triCurrencyUO`) reside on specific business object `T_` tables (such as `T_REQUISITION`). `IBS_SPEC` only holds core system metadata. Direct any index creation or field-level queries to the appropriate `T_` table, never to `IBS_SPEC`.
- Data Manipulation Constraints: Never advise the manual execution of UPDATE, INSERT, or DELETE statements directly against `IBS_SPEC`, `IBS_SPEC_ASSIGNMENTS`, or `T_` tables. All data manipulation must occur via the TRIRIGA application UI, DataConnect, or OSLC APIs. Direct database writes corrupt the Object State.
- Record Associations: Recognise that TRIRIGA does not use standard relational foreign keys. All record-to-record links are stored in the `IBS_SPEC_ASSIGNMENTS` table. Diagnostic queries involving linked objects must query this table using the `SPEC_ID`.
- List Manager vs. Associations: List values are static metadata managed in the TRIRIGA List Manager. Never state that List Values (dropdown options) are stored in `IBS_SPEC_ASSIGNMENTS` or managed in the Data Modeler. `IBS_SPEC_ASSIGNMENTS` is strictly for linking distinct data records (e.g., linking a Requisition to a Location).
- Expanded Core Code Boundaries: You are strictly forbidden from recommending modifications to any core platform Java classes. This includes, but is not limited to, `CommonQuerySerializer`, `OslcRequestDispatcherImpl`, `OslcCreationHandler`, `ListServiceImpl`, and `ObjectSerializer` (e.g. classes within `tririga-ib.jar`). Limit customisation advice strictly to external OSLC wrappers or TRIRIGA workflow logic.
- Connection Pooling: Acknowledge that connection capacity is managed via Liberty `server.xml` (e.g., `maxPoolSize`) or `TRIRIGAWEB.properties`. If connection starvation or thread contention is suspected, note that `messages.log` is not ingested and recommend requesting Liberty `messages.log` and DB2 lock wait snapshots (`MON_LOCKWAITS`) from IBM SRE rather than suggesting superficial capacity increases.
- Database Isolation: TRIRIGA operates on `TRANSACTION_READ_COMMITTED` isolation level. Never recommend `READ UNCOMMITTED` or dirty reads, as this violates platform standards and risks severe data integrity issues.
- Health Rating Logic: Do not conflate incident severity with system health. If a platform is experiencing high-severity issues, deadlocks, or connection exhaustion, you must rate the overall system health as 'Critical' or 'Poor'. Never rate system health as 'High' or 'Healthy' under these conditions.
- Strict Component Isolation & Causation: Do not force correlation or invent causal links between unrelated system failures just because they occur in the same time window. Missing user profile data cannot cause OS-level file system failures or connection pool exhaustion. Treat distinct architectural errors as separate root causes unless they mathematically interact (e.g., long DB2 queries do cause pool exhaustion).
- Strict Subsystem Isolation (Do Not Conflate Components):
  * OSLC vs. Workflow Engine: Never conflate HTTP/OSLC integration errors with internal workflow logic. ObjectSerializer and IllegalArgumentException occur exclusively at the incoming HTTP/OSLC web request layer. Workflow Engine field mapping errors (e.g., SOFieldMapImpl, InvalidFieldRequestException) occur internally during execution. Do not state that the Workflow Engine uses ObjectSerializer to unmarshall data.
  * Filesystem vs. Workflow Agents: Temporary file cache errors (userfiles) are strictly OS-level filesystem, storage, or permission issues. Never instruct an admin to restart a Workflow Agent to fix userfiles or temporary file cache errors. Workflow Agents manage asynchronous database events (WF_EVENT), not local disk space or filesystem mounts.
  * Mail Preparation Boundaries: Mail preparation failures are caused strictly by SMTP configuration issues or userfiles attachment generation failures (the system cannot cache/write the physical file). Never link missing user profile metadata (e.g., LabeledObjectFactory lookups) to mail preparation failures.
- Workflow Event Queue Validation (WF_EVENT): Success in the `WF_EVENT` table is indicated by an empty queue (the absence of rows), as the Workflow Agent clears them upon completion. Do not search for a 'completed' status. The `WF_EVENT` table is exclusively used to monitor if an asynchronous workflow process is queued, executing, or stalled. Never advise querying `WF_EVENT` to check if a Smart Object or data record exists. Record existence must only be verified via standard OSLC lookups or querying `IBS_SPEC`. Differentiate between synchronous locking and asynchronous event queuing. If a process is stalled after a state transition, instruct the user to check the `WF_EVENT` table and the TRIRIGA Workflow Agent status before assuming a DB2 connection pool issue.
- Metadata & OSLC Configuration: When diagnosing missing custom fields in OSLC payloads or serializers, mandate checking if the Business Object (BO) was successfully 'Published' in the TRIRIGA Data Modeler. Additionally, instruct the user to verify that the OSLC Resource mapping was updated in the OSLC Manager.
- DB2 Lock Diagnostic Syntax: When querying `SYSIBMADM.MON_LOCKWAITS`, strictly use the `TABNAME` column to filter by table (e.g., `WHERE TABNAME = 'T_REQUISITION'`). Never use `object_name` or `table_name`. To retrieve lock holder details, use the `HLD_APPLICATION_HANDLE`, `HLD_USERID`, and `HLD_CURRENT_STMT_TEXT` columns.
- DB2 Lock Escalation: When addressing connection pool starvation linked to DB2 locks, instruct the user to check for Lock Escalation. Query `MON_LOCKWAITS` to check if the `LOCK_MODE` indicates a table-level lock (e.g., 'Z' or 'X' on a table rather than a row), which typically occurs during large data imports.
- File System & Content: Treat temporary file cache errors as TRIRIGA `userfiles` directory issues. Direct diagnostics to the storage path defined in `TRIRIGAWEB.properties` or the configured Content Management System, rather than generic web application temporary folders.
- STRICT FILESYSTEM VS. UI CACHE BOUNDARIES: The userfiles temporary file cache is a physical OS-level filesystem issue. You must NEVER suggest that clearing the JVM 'List Cache' or 'Object MetaData Cache' in the Administrator Console will resolve userfiles or Content cache errors. If userfiles errors are present, the only self-service mitigation is verifying the path in the properties view; the actual fix requires an IBM SRE Service Request (SR).
- User Profiles as Records: Recognise that usernames or IDs (e.g., 'farrellde' or '10095356') missing during lookups are tied to TRIRIGA 'My Profile' or 'Employee' records. Direct remediation toward user provisioning integrations rather than generic Smart Object creation.
- Cache Management & Boundaries: If metadata, list values, or object labels are stale, direct the user to clear the specific cache (e.g., 'List Cache' or 'Object MetaData Cache') via the TRIRIGA Administrator Console. Never recommend restarting the WebSphere Liberty server as a first step for cache issues. Do not suggest that clearing TRIRIGA Admin Console JVM caches will fix OS-level issues, filesystem errors (`userfiles`), or DB2 deadlocks; cache clearing only fixes stale metadata or UI dropdown display issues.
- Log Roles & Availability: Analysis is strictly confined to the ingested files in scope (typically `server.log` for OSLC payload exceptions, state transition errors, and platform logic; `performance.log` for slow workflow steps and DB2 queries). WebSphere Liberty `messages.log` is NOT ingested or accessible in this environment. Never claim `messages.log` was inspected or that absence of messages in it proves anything; recommend requesting `messages.log` if thread contention or connection pool starvation needs deeper investigation.
- Formatting and Localisation Requirements: You must strictly use traditional Irish/British English spellings (e.g., 'specialising', 'customisation', 'analyse') and standard date formats with ordinal indicators (e.g., '4th not 4', '2nd not 2', or 'dd/mm/yyyy'). Do not use ISO or US date formats.
- Operational Boundaries & Strict SaaS Constraints: Limit self-service remediation strictly to the TRIRIGA Administrator Console (clearing caches, reviewing logs, restarting Workflow Agents) and the application UI (Data Modeler, OSLC mapping). In an IBM SaaS environment, the local admin has zero OS-level visibility: do not instruct the local admin to check disk space, verify read/write file permissions, or directly modify backend configuration files like `TRIRIGAWEB.properties` or `server.xml`.
- Configuration Verification: The local admin can view active properties via the Administrator Console. You may instruct the admin to read `TRIRIGAWEB.properties` in the Admin Console to verify settings (such as directory paths or mail hosts), but any required modifications require an SR.
- IBM SRE Escalations (Service Requests): The local admin has zero OS-level visibility. Instruct the user to "Submit a Service Request (SR) ticket to the IBM SRE team" for modifications to `server.xml`, `TRIRIGAWEB.properties` (e.g., increasing connection pool sizes), WebSphere Liberty / JVM restarts, OS-level file permissions (`userfiles`), or killing DB2 locks / resolving database deadlocks.
- Prioritise Actionable Diagnostics & Missing Log Recommendations: When providing remediation steps, prioritise actionable diagnostics. If `messages.log`, Java thread dumps (`kill -3`), or DB2 diagnostic queries (`MON_LOCKWAITS`, `MON_GET_ACTIVITY`, `SYSIBMADM.SNAPLOCK`, `db2pd`) are needed for further analysis, explicitly recommend that the user request them via an IBM SRE Service Request (or run DB queries over read-only VPN).
- Database Syntax: DATABASE REQUIREMENT: This TRIRIGA environment uses IBM DB2. Any suggested SQL queries or diagnostic commands must strictly use IBM DB2 syntax (SYSCAT views, SYSIBMADM administrative views, db2pd) and NEVER MySQL, PostgreSQL, or Oracle syntax.

=== TRIRIGA CLUSTER LOG EVIDENCE ===
- Scope: {start_time or 'All records'} to {end_time or 'All records'} | Total Logs: {stats['total_logs']} ({stats['total_errors']} errors)
- Active Servers: {server_str}

### TOP RECURRING ERROR CLUSTERS:
{clusters_str}

### HOURLY ACTIVITY TIMELINE:
{hourly_str}
{search_str}
{resolved_records_block}
===================================
Provide a concise, structured executive summary with clean paragraphs and whitespace without meta-labels. Weave technical explanations naturally into the text."""

        chat_sent = False
        think_filter = ThinkingFilter()

        effective_model = await cls.resolve_active_model_name(provider, base_url, model_name)

        yield json.dumps({"status": f"Engaged {effective_model} in {provider.upper()}. Analyzing cluster logs ({context_window:,} token context)..."})

        # Estimate prompt tokens and calculate safe completion tokens
        est_prompt_tokens = (len(system_msg) + len(user_query)) // 4
        safe_max_tokens = max(2048, min(8192, context_window - est_prompt_tokens - 512))

        try:
            timeout_cfg = httpx.Timeout(600.0, connect=5.0, read=600.0)
            async with httpx.AsyncClient(timeout=timeout_cfg) as client:
                if provider == "ollama":
                    url = f"{base_url.rstrip('/')}/api/chat"
                    payload = {
                        "model": effective_model,
                        "messages": [
                            {"role": "system", "content": system_msg},
                            {"role": "user", "content": user_query}
                        ],
                        "options": {
                            "num_ctx": context_window,
                            "num_predict": safe_max_tokens
                        },
                        "stream": True
                    }
                    async with client.stream("POST", url, json=payload) as response:
                        if response.status_code == 200:
                            chat_sent = True
                            async for line in response.aiter_lines():
                                if not line:
                                    continue
                                try:
                                    data = json.loads(line)
                                    if "error" in data:
                                        err_msg = data["error"] if isinstance(data["error"], str) else data["error"].get("message", "Ollama error")
                                        yield json.dumps({"chunk": f"\n\n> [!WARNING]\n> **Ollama Notice**: {err_msg}\n"})
                                        break
                                    raw_msg = data.get("message", {}).get("content") or ""
                                    raw_thought = data.get("message", {}).get("reasoning_content") or data.get("thinking") or ""
                                    clean_msg, inline_thought = think_filter.process(raw_msg)
                                    final_thought = raw_thought + inline_thought
                                    if final_thought:
                                        yield json.dumps({"thought": final_thought})
                                    if clean_msg:
                                        yield json.dumps({"chunk": clean_msg})
                                    if data.get("done", False):
                                        break
                                except Exception:
                                    continue
                        else:
                            err_body = await response.aread()
                            err_text = err_body.decode("utf-8", errors="ignore")
                            yield json.dumps({"chunk": f"\n\n> [!WARNING]\n> **Ollama Error (HTTP {response.status_code})**: {err_text}\n"})
                            chat_sent = False
                else: # lm_studio / openai_compatible
                    norm_base = base_url.rstrip('/').replace("://localhost:", "://127.0.0.1:").replace("://localhost/", "://127.0.0.1/")
                    if norm_base.endswith("://localhost"):
                        norm_base = norm_base.replace("://localhost", "://127.0.0.1")
                    if not norm_base.endswith("/v1") and "/v1/" not in norm_base:
                        norm_base = f"{norm_base}/v1"
                    url = f"{norm_base}/chat/completions"
                    payload = {
                        "model": effective_model,
                        "messages": [
                            {"role": "system", "content": system_msg},
                            {"role": "user", "content": user_query}
                        ],
                        "max_tokens": safe_max_tokens,
                        "stream": True
                    }
                    async with client.stream("POST", url, json=payload) as response:
                        if response.status_code == 200:
                            chat_sent = True
                            async for line in response.aiter_lines():
                                if not line:
                                    continue
                                clean_line = line.strip()
                                if clean_line.startswith("data:"):
                                    payload_str = clean_line[5:].strip()
                                    if payload_str == "[DONE]":
                                        break
                                    try:
                                        data = json.loads(payload_str)
                                        if "error" in data:
                                            err_val = data["error"]
                                            err_msg = err_val.get("message") if isinstance(err_val, dict) else str(err_val)
                                            yield json.dumps({"chunk": f"\n\n> [!WARNING]\n> **LM Studio Notice**: {err_msg}\n"})
                                            break
                                        delta = data.get("choices", [{}])[0].get("delta", {})
                                        raw_msg = delta.get("content") or ""
                                        raw_thought = delta.get("reasoning_content") or delta.get("reasoning") or delta.get("thought") or ""
                                        clean_msg, inline_thought = think_filter.process(raw_msg)
                                        final_thought = raw_thought + inline_thought
                                        if final_thought:
                                            yield json.dumps({"thought": final_thought})
                                        if clean_msg:
                                            yield json.dumps({"chunk": clean_msg})
                                    except Exception:
                                        continue
                        else:
                            err_body = await response.aread()
                            err_text = err_body.decode("utf-8", errors="ignore")
                            yield json.dumps({"chunk": f"\n\n> [!WARNING]\n> **Local LLM Server (HTTP {response.status_code})**: {err_text}\n"})
                            chat_sent = False

            # Flush remaining tokens
            rem_content, rem_thought = think_filter.flush()
            if rem_thought:
                yield json.dumps({"thought": rem_thought})
            if rem_content:
                yield json.dumps({"chunk": rem_content})

        except Exception:
            chat_sent = False

        # If LLM offline, provide intelligent, full-day structured response
        if not chat_sent:
            target_date_str = latest_date if start_time else f"{stats['earliest_ts'][:10]} to {stats['latest_ts'][:10]}"
            fallback = f"### Summary of Logs for {target_date_str}\n\n"
            fallback += f"Across all TRIRIGA cluster nodes, a total of **{stats['total_logs']:,} log entries** were recorded (**{stats['total_errors']:,} errors**, **{stats['total_warns']:,} warnings**).\n\n"
            
            if hourly:
                fallback += "#### Hourly Activity Breakdown:\n"
                for h in hourly:
                    fallback += f"- **{h['hour']}:00**: {h['total']:,} entries ({h['errors']} errors, {h['warns']} warnings)\n"
                fallback += "\n"
            
            if clusters:
                fallback += "#### Key Error Clusters Detected:\n"
                for i, c in enumerate(clusters[:5], 1):
                    fallback += f"{i}. **[{c['log_level']}]** `{c['server_name']}` ({c['occurrence_count']}x): {c['message']}\n"
                fallback += "\n"

            if search_matches:
                fallback += f"#### Matching Search Records ({len(search_matches)}):\n"
                for r in search_matches[:5]:
                    fallback += f"- `[{r['timestamp']}]` [{r['server_name']}] **{r['log_level']}**: {r['message']}\n"

            yield json.dumps({"chunk": fallback})

        yield "[DONE]"
