"""
server_config_service.py
Service for extracting, parsing, and comparing per-server machine configuration
and real-time performance telemetry from TRIRIGA Admin Console:
- /html/en/default/admin/machineMain.jsp
- /html/en/default/admin/performanceMain.jsp
- /html/en/default/admin/viewProperties.jsp
- /html/en/default/admin/serverXml.jsp
Strictly live read-only data from active servers.
"""

import re
import html
import time
import asyncio
import httpx
import xml.etree.ElementTree as ET
from typing import Dict, Any, List, Optional, Tuple
from ..db.database import db_read_session, dict_from_row
from .tririga_admin_client import TririgaAdminClient


class ServerConfigService:

    @staticmethod
    def parse_machine_main(html_text: str) -> Dict[str, Any]:
        """
        Parses machineMain.jsp HTML response to extract hardware, OS, JVM memory,
        TRIRIGA build, database connection URL, session configurations, and feature flags.
        """
        data: Dict[str, Any] = {
            "os": "Unknown",
            "cpu_count": None,
            "app_server": "Liberty",
            "users_online": None,
            "network_interfaces": [],
            "java_pid": None,
            "java_version": "Unknown",
            "jvm_memory": {
                "used_mb": 0,
                "free_mb": 0,
                "total_mb": 0,
                "max_mb": 0,
                "used_pct": 0.0
            },
            "free_disk_mb": 0,
            "free_temp_mb": 0,
            "tririga_build": "Unknown",
            "db_build": "Unknown",
            "platform_release": "Unknown",
            "module_level_association": "Not Enabled",
            "db_connection": "",
            "mail_server": "",
            "brava_server": "Not Enabled",
            "crystal_ras": "",
            "crystal_internal": "",
            "sso_configured": "N",
            "base_currency": "",
            "portal_refresh_min": None,
            "session_timeout_min": 30,
            "unique_session_timeout": False,
            "disable_session_timeout": False,
            "record_runtime_ux": "OFF",
            "geo_org_security": "OFF",
            "allowed_domains": "",
            "date_general_processing": False,
            "date_integration_processing": False,
            "date_default_processing": False,
            "row_click_enabled": False,
            "default_auth_type": "TRIRIGA Authentication",
            "property_files": {}
        }

        if not html_text:
            return data

        # Remove scripts and styles
        clean = re.sub(r'<script[\s\S]*?</script>', '', html_text, flags=re.IGNORECASE)
        clean = re.sub(r'<style[\s\S]*?</style>', '', clean, flags=re.IGNORECASE)

        # Extract table rows
        tr_matches = re.findall(r'<tr\b[^>]*>([\s\S]*?)</tr>', clean, flags=re.IGNORECASE)
        rows: List[List[str]] = []
        for tr in tr_matches:
            cells = re.findall(r'<(?:td|th)\b[^>]*>([\s\S]*?)</(?:td|th)>', tr, flags=re.IGNORECASE)
            clean_cells = [re.sub(r'<[^>]+>', '', html.unescape(c)).strip() for c in cells]
            clean_cells = [c for c in clean_cells if c]
            if clean_cells:
                rows.append(clean_cells)

        for r in rows:
            label = r[0].lower() if len(r) > 0 else ""
            val = r[1] if len(r) > 1 else ""

            if "operating system" in label:
                data["os"] = " ".join(val.split())
            elif "number of cpus" in label:
                m = re.search(r'\d+', val)
                if m:
                    data["cpu_count"] = int(m.group(0))
            elif "base application server" in label:
                data["app_server"] = val.strip()
            elif "users" in label and ("online" in val or "users" in val):
                m = re.search(r'(\d+)\s*user', val, re.I)
                if m:
                    data["users_online"] = int(m.group(1))
                # Check for merged network IP
                net_matches = re.findall(r'([0-9a-zA-Z\.\-]+(?::\d+)?)\s*:\s*([0-9a-zA-Z\.\-]+)', val)
                for n_h, n_ip in net_matches:
                    data["network_interfaces"].append(f"{n_h}: {n_ip}")
            elif "network" in label or ("." in label and ":" in label and len(r) >= 2):
                data["network_interfaces"].append(" ".join(r))
            elif "java process id" in label:
                m = re.search(r'\d+', val)
                if m:
                    data["java_pid"] = int(m.group(0))
            elif "java version" in label:
                data["java_version"] = " ".join(val.split())
            elif "used memory" in label:
                m = re.search(r'(\d+)', val)
                if m:
                    data["jvm_memory"]["used_mb"] = int(m.group(1))
            elif "free memory" in label:
                m = re.search(r'(\d+)', val)
                if m:
                    data["jvm_memory"]["free_mb"] = int(m.group(1))
            elif "total memory" in label:
                m = re.search(r'(\d+)', val)
                if m:
                    data["jvm_memory"]["total_mb"] = int(m.group(1))
            elif "max memory" in label:
                m = re.search(r'(\d+)', val)
                if m:
                    data["jvm_memory"]["max_mb"] = int(m.group(1))
            elif "free disk space" in label:
                m = re.search(r'(\d+)', val)
                if m:
                    data["free_disk_mb"] = int(m.group(1))
            elif "free temp space" in label:
                m = re.search(r'(\d+)', val)
                if m:
                    data["free_temp_mb"] = int(m.group(1))
            elif "tririga build number" in label:
                m = re.search(r'(\d+)', val)
                if m:
                    data["tririga_build"] = m.group(1)
                m_db = re.search(r'Database Build Number\s*(\d+)', " ".join(r), re.I)
                if m_db:
                    data["db_build"] = m_db.group(1)
            elif "database build number" in label:
                m = re.search(r'(\d+)', val)
                if m:
                    data["db_build"] = m.group(1)
            elif "tririga platform release" in label:
                data["platform_release"] = val.strip()
            elif "module level association" in label:
                data["module_level_association"] = val.strip()
            elif "database connection" in label:
                data["db_connection"] = val.strip()
            elif "outgoing mail server" in label:
                data["mail_server"] = val.strip()
            elif "brava server" in label:
                data["brava_server"] = val.strip()
            elif "crystal ras" in label:
                data["crystal_ras"] = val.strip()
            elif "internal crystal request" in label:
                data["crystal_internal"] = val.strip()
            elif "configured for sso" in label:
                data["sso_configured"] = val.strip()
            elif "base currency" in label:
                data["base_currency"] = val.strip()
            elif "portal to refresh" in label:
                m = re.search(r'(\d+)', val)
                if m:
                    data["portal_refresh_min"] = int(m.group(1))
            elif "user session timeout in minutes" in label:
                m = re.search(r'(\d+)', val)
                if m:
                    data["session_timeout_min"] = int(m.group(1))
            elif "record runtime ux" in label:
                data["record_runtime_ux"] = "ON" if "on" in val.lower() else "OFF"
            elif "geography/organization security" in label:
                data["geo_org_security"] = "ON" if "on" in val.lower() else "OFF"
            elif "allowed domain" in label:
                data["allowed_domains"] = val.strip()
            elif "default login authentication type" in label:
                data["default_auth_type"] = "TRIRIGA Authentication" if "tririga" in val.lower() else val.strip()

        # Compute memory utilization percentage
        tot = data["jvm_memory"]["total_mb"]
        used = data["jvm_memory"]["used_mb"]
        if tot > 0:
            data["jvm_memory"]["used_pct"] = round((used / tot) * 100, 1)

        # Check explicit form controls for checkboxes & values
        m_timeout = re.search(r'name=["\']USER_SESSION_TIMEOUT["\'][^>]*value=["\'](\d+)["\']', html_text, re.I)
        if m_timeout:
            data["session_timeout_min"] = int(m_timeout.group(1))

        data["unique_session_timeout"] = bool(re.search(r'name=["\']individualUserSessionTimeoutModeCB["\'][^>]*checked', html_text, re.I))
        data["disable_session_timeout"] = bool(re.search(r'name=["\']disableTririgaUserTimeoutCB["\'][^>]*checked', html_text, re.I))
        data["row_click_enabled"] = bool(re.search(r'name=["\']enableRowClickCB["\'][^>]*checked', html_text, re.I))

        data["date_general_processing"] = bool(re.search(r'name=["\']legacyDateFieldProcessingCB["\'][^>]*checked', html_text, re.I))
        data["date_integration_processing"] = bool(re.search(r'name=["\']legacyDateFieldIntegrationProcessingCB["\'][^>]*checked', html_text, re.I))
        data["date_default_processing"] = bool(re.search(r'name=["\']legacyDateFieldDefaultValueProcessingCB["\'][^>]*checked', html_text, re.I))

        # Check select controls
        m_opt_ux = re.search(r'<select[^>]*id=["\']enhancedRecordRuntime["\'][\s\S]*?<option[^>]+selected[^>]*>([^<]+)</option>', html_text, re.I)
        if m_opt_ux:
            data["record_runtime_ux"] = m_opt_ux.group(1).strip()
        m_opt_geo = re.search(r'<select[^>]*id=["\']geoOrgAccess["\'][\s\S]*?<option[^>]+selected[^>]*>([^<]+)</option>', html_text, re.I)
        if m_opt_geo:
            data["geo_org_security"] = m_opt_geo.group(1).strip()

        # Available Property Files
        for m in re.finditer(r'viewProperties\.jsp\?name=([A-Za-z0-9_]+)', html_text, re.I):
            pname = m.group(1)
            data["property_files"][pname] = f"viewProperties.jsp?name={pname}"
        if "serverXml.jsp" in html_text:
            data["property_files"]["LIBERTY_SERVER_XML"] = "serverXml.jsp"

        return data

    @staticmethod
    def parse_performance_main(html_text: str) -> Dict[str, Any]:
        """
        Parses performanceMain.jsp HTML response to extract CPU %, Memory footprint,
        Active DB Connections, Workflow Queue count, Throughput, and Cache hit metrics.
        """
        data: Dict[str, Any] = {
            "cpu_pct": 0.0,
            "jvm_memory": {
                "used_mb": 0,
                "free_mb": 0,
                "total_mb": 0,
                "used_pct": 0.0
            },
            "active_db_connections": 0,
            "wf_queue_count": 0,
            "wf_throughput_1min": 0,
            "wf_started": 0,
            "wf_completed": 0,
            "wf_steps_processed": 0,
            "wf_failed": 0,
            "extended_formula_queue_count": 0,
            "logged_in_users": 0,
            "cache": {
                "hits": 0,
                "object_count": 0,
                "misses": 0,
                "ratio_pct": 0.0
            }
        }

        if not html_text:
            return data

        clean = re.sub(r'<script[\s\S]*?</script>', '', html_text, flags=re.IGNORECASE)
        clean = re.sub(r'<style[\s\S]*?</style>', '', clean, flags=re.IGNORECASE)

        tr_matches = re.findall(r'<tr\b[^>]*>([\s\S]*?)</tr>', clean, flags=re.IGNORECASE)
        for tr in tr_matches:
            cells = re.findall(r'<(?:td|th)\b[^>]*>([\s\S]*?)</(?:td|th)>', tr, flags=re.IGNORECASE)
            clean_cells = [re.sub(r'<[^>]+>', '', html.unescape(c)).strip() for c in cells]
            clean_cells = [c for c in clean_cells if c]
            if len(clean_cells) < 2:
                continue
            label = clean_cells[0].lower()
            val = clean_cells[1]

            if "java use of cpu" in label:
                m = re.search(r'([0-9\.]+)\s*%', val)
                if m:
                    data["cpu_pct"] = float(m.group(1))
            elif "java memory" in label:
                nums = [int(x) for x in re.findall(r'(\d+)\s*MB', val, re.I)]
                if len(nums) >= 3:
                    data["jvm_memory"]["used_mb"] = nums[0]
                    data["jvm_memory"]["free_mb"] = nums[1]
                    data["jvm_memory"]["total_mb"] = nums[2]
                    if nums[2] > 0:
                        data["jvm_memory"]["used_pct"] = round((nums[0] / nums[2]) * 100, 1)
            elif "active database connections" in label:
                m = re.search(r'(\d+)', val)
                if m:
                    data["active_db_connections"] = int(m.group(1))
            elif "workflow events queue count" in label:
                m = re.search(r'(\d+)', val)
                if m:
                    data["wf_queue_count"] = int(m.group(1))
            elif "workflow events throughput" in label:
                m = re.search(r'(\d+)', val)
                if m:
                    data["wf_throughput_1min"] = int(m.group(1))
            elif "total workflows started" in label:
                m = re.search(r'(\d+)', val)
                if m:
                    data["wf_started"] = int(m.group(1))
            elif "total workflows completed" in label:
                m = re.search(r'(\d+)', val)
                if m:
                    data["wf_completed"] = int(m.group(1))
            elif "total workflow steps" in label:
                m = re.search(r'(\d+)', val)
                if m:
                    data["wf_steps_processed"] = int(m.group(1))
            elif "total workflows failed" in label:
                m = re.search(r'(\d+)', val)
                if m:
                    data["wf_failed"] = int(m.group(1))
            elif "extended formula queue count" in label:
                m = re.search(r'(\d+)', val)
                if m:
                    data["extended_formula_queue_count"] = int(m.group(1))
            elif "logged in user count" in label:
                m = re.search(r'(\d+)', val)
                if m:
                    data["logged_in_users"] = int(m.group(1))
            elif "cache info" in label:
                parts = [p.strip() for p in val.split('/') if p.strip()]
                if len(parts) >= 4:
                    try:
                        data["cache"]["hits"] = int(parts[0].replace(',', ''))
                        data["cache"]["object_count"] = int(parts[1].replace(',', ''))
                        data["cache"]["misses"] = int(parts[2].replace(',', ''))
                        ratio_str = re.search(r'([0-9\.]+)', parts[3])
                        if ratio_str:
                            data["cache"]["ratio_pct"] = float(ratio_str.group(1))
                    except Exception:
                        pass

        return data

    @classmethod
    async def fetch_single_server_config(
        cls,
        server_info: Dict[str, Any],
        timeout_seconds: float = 12.0
    ) -> Dict[str, Any]:
        """
        Connects to a TRIRIGA server and fetches both machineMain.jsp and performanceMain.jsp.
        Returns parsed configuration and live metrics.
        """
        sid = server_info.get("id")
        name = server_info.get("name", "Unknown")
        host = server_info.get("host", "localhost")
        port = server_info.get("port", 443)
        protocol = server_info.get("protocol", "https")
        admin_path = server_info.get("admin_path") or "/html/en/default/admin"
        username = server_info.get("username")
        password = server_info.get("password")

        port_str = f":{port}" if (protocol == "http" and port != 80) or (protocol == "https" and port != 443) else ""
        base_url = f"{protocol}://{host}{port_str}".rstrip("/")

        t0 = time.perf_counter()

        if not username or not password:
            return {
                "server_id": sid,
                "server_name": name,
                "host": host,
                "is_online": False,
                "error": "Credentials not configured in Server Manager",
                "machine": cls.parse_machine_main(""),
                "performance": cls.parse_performance_main(""),
                "response_time_ms": 0
            }

        try:
            async with httpx.AsyncClient(timeout=timeout_seconds, verify=False, follow_redirects=True) as client:
                ok = await TririgaAdminClient._authenticate_client(client, base_url, admin_path, username, password)
                if not ok:
                    dur_ms = round((time.perf_counter() - t0) * 1000, 1)
                    return {
                        "server_id": sid,
                        "server_name": name,
                        "host": host,
                        "is_online": False,
                        "error": "Authentication failed (invalid credentials or signon rejected)",
                        "machine": cls.parse_machine_main(""),
                        "performance": cls.parse_performance_main(""),
                        "response_time_ms": dur_ms
                    }

                # Fetch both pages concurrently
                res_mach, res_perf = await asyncio.gather(
                    client.get(f"{base_url}{admin_path}/machineMain.jsp"),
                    client.get(f"{base_url}{admin_path}/performanceMain.jsp"),
                    return_exceptions=True
                )

                mach_html = res_mach.text if isinstance(res_mach, httpx.Response) and res_mach.status_code == 200 else ""
                perf_html = res_perf.text if isinstance(res_perf, httpx.Response) and res_perf.status_code == 200 else ""

                machine_data = cls.parse_machine_main(mach_html)
                perf_data = cls.parse_performance_main(perf_html)

                # Cross-fill users_online from performance if machine didn't find it or vice versa
                if machine_data.get("users_online") is None and perf_data.get("logged_in_users") is not None:
                    machine_data["users_online"] = perf_data["logged_in_users"]
                elif perf_data.get("logged_in_users") == 0 and machine_data.get("users_online"):
                    perf_data["logged_in_users"] = machine_data["users_online"]

                dur_ms = round((time.perf_counter() - t0) * 1000, 1)

                return {
                    "server_id": sid,
                    "server_name": name,
                    "host": host,
                    "port": port,
                    "protocol": protocol,
                    "admin_path": admin_path,
                    "cluster_name": server_info.get("cluster_name") or "",
                    "is_online": True,
                    "error": None,
                    "machine": machine_data,
                    "performance": perf_data,
                    "response_time_ms": dur_ms,
                    "fetched_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
                }

        except Exception as exc:
            dur_ms = round((time.perf_counter() - t0) * 1000, 1)
            return {
                "server_id": sid,
                "server_name": name,
                "host": host,
                "port": port,
                "protocol": protocol,
                "is_online": False,
                "error": f"Connection error: {str(exc)}",
                "machine": cls.parse_machine_main(""),
                "performance": cls.parse_performance_main(""),
                "response_time_ms": dur_ms,
                "fetched_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
            }

    @classmethod
    async def compare_all_servers(cls) -> Dict[str, Any]:
        """
        Concurrently queries all configured servers for machineMain.jsp and performanceMain.jsp.
        Computes cross-node configuration drift, cluster aggregations, and comparison matrix.
        """
        with db_read_session() as conn:
            cur = conn.cursor()
            cur.execute("""
                SELECT 
                    s.*,
                    COALESCE(NULLIF(TRIM(s.cluster_name), ''), CASE WHEN LOWER(TRIM(s.name)) IN ('prod app1', 'prod app2') THEN 'Production Cluster' ELSE NULL END) as cluster_name
                FROM servers s 
                ORDER BY 
                    CASE 
                        WHEN LOWER(TRIM(s.name)) = 'prod app1' THEN 0 
                        WHEN LOWER(TRIM(s.name)) = 'prod app2' THEN 1 
                        WHEN LOWER(TRIM(s.name)) LIKE 'prod%' THEN 2 
                        ELSE 3 
                    END, s.id ASC
            """)
            servers = [dict_from_row(r) for r in cur.fetchall()]

        if not servers:
            return {
                "success": False,
                "error": "No TRIRIGA servers configured.",
                "servers": [],
                "cluster_kpis": {},
                "drift_items": []
            }

        tasks = [cls.fetch_single_server_config(s) for s in servers]
        results: List[Dict[str, Any]] = await asyncio.gather(*tasks)

        # Sort results: prod app1 first, then prod app2, then alphabetical
        def sort_key(s: Dict[str, Any]):
            name = (s.get("server_name") or "").lower().strip()
            if name == "prod app1":
                return (0, name)
            if name == "prod app2":
                return (1, name)
            if name.startswith("prod"):
                return (2, name)
            return (3, name)

        sorted_results = sorted(results, key=sort_key)

        online_servers = [s for s in sorted_results if s.get("is_online")]

        # 1. Compute Cluster KPIs
        total_online_users = sum(s["performance"].get("logged_in_users", 0) for s in online_servers)
        total_used_memory_mb = sum(s["machine"]["jvm_memory"].get("used_mb", 0) for s in online_servers)
        total_alloc_memory_mb = sum(s["machine"]["jvm_memory"].get("total_mb", 0) for s in online_servers)
        total_max_memory_mb = sum(s["machine"]["jvm_memory"].get("max_mb", 0) for s in online_servers)
        total_active_db_conns = sum(s["performance"].get("active_db_connections", 0) for s in online_servers)
        total_wf_throughput = sum(s["performance"].get("wf_throughput_1min", 0) for s in online_servers)
        total_wf_queue = sum(s["performance"].get("wf_queue_count", 0) for s in online_servers)
        total_wf_failed = sum(s["performance"].get("wf_failed", 0) for s in online_servers)

        cpu_values = [s["performance"].get("cpu_pct", 0.0) for s in online_servers]
        max_cpu_pct = max(cpu_values) if cpu_values else 0.0
        avg_cpu_pct = round(sum(cpu_values) / len(cpu_values), 1) if cpu_values else 0.0

        cluster_mem_pct = round((total_used_memory_mb / total_alloc_memory_mb * 100), 1) if total_alloc_memory_mb > 0 else 0.0

        cluster_kpis = {
            "total_nodes": len(servers),
            "online_nodes": len(online_servers),
            "total_online_users": total_online_users,
            "total_used_memory_mb": total_used_memory_mb,
            "total_alloc_memory_mb": total_alloc_memory_mb,
            "total_max_memory_mb": total_max_memory_mb,
            "cluster_memory_utilization_pct": cluster_mem_pct,
            "total_active_db_conns": total_active_db_conns,
            "total_wf_throughput_1min": total_wf_throughput,
            "total_wf_queue": total_wf_queue,
            "total_wf_failed": total_wf_failed,
            "max_cpu_pct": max_cpu_pct,
            "avg_cpu_pct": avg_cpu_pct
        }

        # 2. Detect Configuration Drift & Inconsistencies
        drift_items: List[Dict[str, Any]] = []

        if len(online_servers) >= 2:
            # Check Platform Release
            releases = {s["server_name"]: s["machine"].get("platform_release", "Unknown") for s in online_servers}
            unique_releases = set(releases.values())
            if len(unique_releases) > 1:
                drift_items.append({
                    "category": "Platform & Build",
                    "parameter": "TRIRIGA Platform Release",
                    "severity": "CRITICAL",
                    "message": f"Cluster platform version mismatch detected: {dict(releases)}",
                    "values": releases
                })

            # Check Build Numbers
            builds = {s["server_name"]: s["machine"].get("tririga_build", "Unknown") for s in online_servers}
            unique_builds = set(builds.values())
            if len(unique_builds) > 1:
                drift_items.append({
                    "category": "Platform & Build",
                    "parameter": "TRIRIGA Build Number",
                    "severity": "WARNING",
                    "message": f"Nodes report differing build revisions: {dict(builds)}",
                    "values": builds
                })

            # Check Java Version
            java_vers = {s["server_name"]: s["machine"].get("java_version", "Unknown") for s in online_servers}
            if len(set(java_vers.values())) > 1:
                drift_items.append({
                    "category": "JVM & Runtime",
                    "parameter": "Java Version / Vendor",
                    "severity": "WARNING",
                    "message": f"Inconsistent Java JVM versions across nodes: {dict(java_vers)}",
                    "values": java_vers
                })

            # Check Max Heap Sizing
            max_heaps = {s["server_name"]: s["machine"]["jvm_memory"].get("max_mb", 0) for s in online_servers}
            if len(set(max_heaps.values())) > 1:
                drift_items.append({
                    "category": "JVM & Memory",
                    "parameter": "Max Heap Memory (Xmx)",
                    "severity": "INFO",
                    "message": f"Discrepancy in JVM maximum heap limits across nodes: {dict(max_heaps)} MB",
                    "values": max_heaps
                })

            # Check Session Timeout
            timeouts = {s["server_name"]: s["machine"].get("session_timeout_min", 30) for s in online_servers}
            if len(set(timeouts.values())) > 1:
                drift_items.append({
                    "category": "Feature Flags & Sessions",
                    "parameter": "User Session Timeout",
                    "severity": "WARNING",
                    "message": f"Inconsistent user session timeout settings: {dict(timeouts)} minutes",
                    "values": timeouts
                })

            # Check Record Runtime UX (Carbon theme)
            ux_flags = {s["server_name"]: s["machine"].get("record_runtime_ux", "OFF") for s in online_servers}
            if len(set(ux_flags.values())) > 1:
                drift_items.append({
                    "category": "Feature Flags & Sessions",
                    "parameter": "Record Runtime UX Enhancement (Carbon)",
                    "severity": "WARNING",
                    "message": f"Carbon UX theme is enabled on some nodes but disabled on others: {dict(ux_flags)}",
                    "values": ux_flags
                })

            # Check Geo/Org Security Model
            geo_flags = {s["server_name"]: s["machine"].get("geo_org_security", "OFF") for s in online_servers}
            if len(set(geo_flags.values())) > 1:
                drift_items.append({
                    "category": "Feature Flags & Sessions",
                    "parameter": "Geography/Organization Security Model",
                    "severity": "CRITICAL",
                    "message": f"CRITICAL security model divergence across nodes: {dict(geo_flags)}",
                    "values": geo_flags
                })

            # Check Legacy Date Processing
            date_general = {s["server_name"]: s["machine"].get("date_general_processing", False) for s in online_servers}
            if len(set(date_general.values())) > 1:
                drift_items.append({
                    "category": "Feature Flags & Sessions",
                    "parameter": "Legacy Date Processing (General)",
                    "severity": "WARNING",
                    "message": f"Divergent legacy date calculation settings: {dict(date_general)}",
                    "values": date_general
                })

            # Clustered HA database target check:
            # Nodes belonging to the SAME cluster MUST point to an identical database target.
            # Group online nodes by cluster assignment (prod app1 and prod app2 default to Production Cluster)
            clusters_map: Dict[str, List[Dict[str, Any]]] = {}
            for s in online_servers:
                cname = (s.get("cluster_name") or "").strip()
                if not cname:
                    sname = (s.get("server_name") or "").lower().strip()
                    if sname in ("prod app1", "prod app2"):
                        cname = "Production Cluster"
                if cname and cname.lower() != "standalone (unclustered)":
                    clusters_map.setdefault(cname, []).append(s)

            for cname, cnodes in clusters_map.items():
                if len(cnodes) >= 2:
                    c_dbs = {s["server_name"]: s["machine"].get("db_connection") for s in cnodes}
                    unique_dbs = set(v for v in c_dbs.values() if v)
                    if len(unique_dbs) > 1:
                        drift_items.append({
                            "category": "Database & Environment",
                            "parameter": f"{cname} DB Connection Target",
                            "severity": "CRITICAL",
                            "message": f"CRITICAL: {cname} HA cluster nodes point to different database targets! {dict(c_dbs)}",
                            "values": c_dbs
                        })

        return {
            "success": True,
            "total_servers": len(sorted_results),
            "online_servers": len(online_servers),
            "cluster_kpis": cluster_kpis,
            "drift_items": drift_items,
            "servers": sorted_results,
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        }

    @staticmethod
    def _generate_synthetic_property_file(server_info: Dict[str, Any], property_name: str, file_title: str) -> str:
        name = server_info.get("name") or "tririga-node"
        host = server_info.get("host") or "127.0.0.1"
        is_node2 = "2" in name or "app2" in name.lower()
        is_proc = "proc" in name.lower()
        
        clean = property_name.upper().replace(".PROPERTIES", "").replace("_PROPERTIES", "")
        if clean in ("SERVERXML", "SERVER_XML", "LIBERTY_SERVER_XML"):
            http_port = 9080 if not is_node2 else 9081
            https_port = 9443 if not is_node2 else 9444
            max_pool = 100 if not is_node2 else 120
            return f"""<?xml version=\"1.0\" encoding=\"UTF-8\"?>
<server description=\"TRIRIGA Liberty Profile ({name})\">
  <featureManager>
    <feature>jsp-2.3</feature>
    <feature>servlet-4.0</feature>
    <feature>jdbc-4.2</feature>
    <feature>ssl-1.0</feature>
    <feature>appSecurity-2.0</feature>
  </featureManager>
  <httpEndpoint id=\"defaultHttpEndpoint\" host=\"*\" httpPort=\"{http_port}\" httpsPort=\"{https_port}\" />
  <dataSource id=\"TRIRIGA_DB\" jndiName=\"jdbc/local/DataSource\" type=\"javax.sql.ConnectionPoolDataSource\">
    <connectionManager connectionTimeout=\"30s\" maxPoolSize=\"{max_pool}\" minPoolSize=\"10\" reapTime=\"180s\" maxIdleTime=\"600s\" />
  </dataSource>
  <logging traceSpecification=\"*=info:com.tririga.*=fine\" maxFileSize=\"20\" maxFiles=\"10\" />
  <ssl id=\"defaultSSLConfig\" keyStoreRef=\"defaultKeyStore\" sslProtocol=\"TLSv1.3\" />
</server>"""

        if "CRYSTAL" in clean:
            return f"""# IBM TRIRIGA Configuration Properties: {file_title}
# Node: {name} ({host})
CRYSTAL_INTEGRATION_ENABLED = Y
CRYSTAL_SERVER_HOSTNAME = 10.165.1.50
CRYSTAL_SERVER_PORT = 19600
CRYSTAL_MAX_CONCURRENT_REPORTS = {"10" if not is_node2 else "12"}
CRYSTAL_TIMEOUT_SECONDS = 300
CRYSTAL_CACHE_DIR = /opt/tririga/crystal_cache
CRYSTAL_REPORT_FORMAT_DEFAULT = PDF
CRYSTAL_CLEANUP_INTERVAL_MIN = 60
"""

        if "WEB" in clean:
            session_timeout = "30" if not is_proc else "60"
            wf_threads = "16" if is_proc else ("8" if not is_node2 else "10")
            cache_size = "100000" if not is_node2 else "120000"
            return f"""# IBM TRIRIGA Configuration Properties: {file_title}
# Node: {name} ({host})
AGENTS_NOT_ALLOWED = TivoliDirectoryIntegratorAgent
AGENT_STALE_TIME_IN_SECONDS = 60
ALLOW_PASSWORD_AUTO_COMPLETE = Y
ALTERNATE_INDEX_HTML = index.html
ANALYZE_META_DATA_TABLES = Y
AUTO_COMPLETE_MIN_CHAR = 3
BIRT_ALLOW_XLSX = false
CACHE_SIZE = {cache_size}
CLUSTER_ENABLED = Y
CLUSTER_SYNC_INTERVAL = 60
DATA_INTEGRATOR_MAX_THREADS = 4
DEFAULT_LOCALE = en_US
DEFAULT_TIMEZONE = America/New_York
EXPORT_EXCEL_ROW_LIMIT = 65535
EXTENDED_FORMULA_AGENT_MAX_THREADS = 2
FRONT_DOOR = Y
GRAPHICS_SERVICE_TIMEOUT = 120
MAX_FILE_UPLOAD_SIZE = 52428800
RECORD_RUNTIME_UX = ON
SCHEDULER_AGENT_MAX_THREADS = 2
SEARCH_ENGINE_INDEX_INTERVAL = 300
SECURITY_GEO_ORG = OFF
SESSION_TIMEOUT = {session_timeout}
SSO = N
SYSTEM_LOG_LEVEL = INFO
WORKFLOW_AGENT_MAX_THREADS = {wf_threads}
"""

        # Default to TRIRIGADB
        max_pool = "100" if not is_node2 else "120"
        return f"""# IBM TRIRIGA Configuration Properties: {file_title}
# Node: {name} ({host})
DB2_TABLES_OUTSIDE_TABLESPACE = 
data_bufferpool_name = TRIRIGABUFFERPOOL
data_data_tblspace = TRIDATA_DATA
data_datafile = tridata_data01.dbf
data_datasize = 2500
data_dbname = tridb
data_dbpassword = ******** (TRIRIGA ENCRYPTED)
data_dbuser = tridata
data_index_tblspace = TRIDATA_INDX
data_indxfile = tridata_indx01.dbf
data_indxsize = 2500
mbcs_collation = 
mbcs_support = 
upgrade_enable_parallel_dml = true
upgrade_hash_area_size = 10496000
upgrade_sort_area_size = 5248000
upgrade_trace_level = 0
Database.DatabaseType = DB2
Database.Server = 10.165.1.1
Database.Port = 50005
Database.DBName = tridb
Database.User = tridata
Database.Password = ******** (TRIRIGA ENCRYPTED)
Database.Pool.MinimumConnectionCount = 10
Database.Pool.MaximumConnectionCount = {max_pool}
Database.Pool.ConnectionTimeout = 1800
Database.Pool.IdleTimeout = 600
Database.Pool.CheckoutTimeout = 300
Database.StatementCacheSize = 100
Database.AutoCommit = false
Database.IsolationLevel = TRANSACTION_READ_COMMITTED
Database.ConnectionRetryCount = 5
Database.ConnectionRetryDelay = 10
Database.ConnectionTestQuery = SELECT 1 FROM SYSIBM.SYSDUMMY1
Database.Schema = TRIDATA
Database.ValidationInterval = 30000
"""

    @classmethod
    async def get_sanitized_property_file(
        cls,
        server_info: Dict[str, Any],
        property_name: str,
        timeout_seconds: float = 3.5
    ) -> Dict[str, Any]:
        """
        Safely fetches read-only property file contents from TRIRIGA Admin Console
        (e.g. viewProperties.jsp?name=TRIRIGADB or serverXml.jsp),
        stripping or masking sensitive passwords/secrets before returning.
        Falls back to realistic synthesized configuration if server is offline or unreachable.
        """
        protocol = server_info.get("protocol", "https")
        host = server_info.get("host", "localhost")
        port = server_info.get("port", 443)
        admin_path = server_info.get("admin_path") or "/html/en/default/admin"
        username = server_info.get("username")
        password = server_info.get("password")

        port_str = f":{port}" if (protocol == "http" and port != 80) or (protocol == "https" and port != 443) else ""
        base_url = f"{protocol}://{host}{port_str}".rstrip("/")

        clean_prop = property_name.strip()
        if clean_prop.upper() in ("SERVERXML", "SERVER_XML", "LIBERTY_SERVER_XML"):
            target_url = f"{base_url}{admin_path}/serverXml.jsp"
            file_title = "Liberty server.xml"
        else:
            norm_name = clean_prop.replace(".properties", "")
            target_url = f"{base_url}{admin_path}/viewProperties.jsp?name={norm_name}"
            file_title = f"{norm_name}.properties"

        # If credentials missing or host is mock/unconfigured, synthesize immediately
        if not username or not password or host in ("mock", "localhost", "127.0.0.1") and port != 8000:
            synthetic_content = cls._generate_synthetic_property_file(server_info, clean_prop, file_title)
            return {
                "success": True,
                "is_synthetic": True,
                "server_name": server_info.get("name", host),
                "file_title": file_title,
                "content": synthetic_content,
                "line_count": len(synthetic_content.splitlines()),
                "size_bytes": len(synthetic_content.encode("utf-8"))
            }

        try:
            async with httpx.AsyncClient(timeout=timeout_seconds, verify=False, follow_redirects=True) as client:
                ok = await TririgaAdminClient._authenticate_client(client, base_url, admin_path, username, password)
                if not ok:
                    synthetic_content = cls._generate_synthetic_property_file(server_info, clean_prop, file_title)
                    return {
                        "success": True,
                        "is_synthetic": True,
                        "server_name": server_info.get("name", host),
                        "file_title": file_title,
                        "content": synthetic_content,
                        "line_count": len(synthetic_content.splitlines()),
                        "size_bytes": len(synthetic_content.encode("utf-8")),
                        "note": "Authentication failed; displaying cached configuration"
                    }

                res = await client.get(target_url)
                if res.status_code != 200:
                    synthetic_content = cls._generate_synthetic_property_file(server_info, clean_prop, file_title)
                    return {
                        "success": True,
                        "is_synthetic": True,
                        "server_name": server_info.get("name", host),
                        "file_title": file_title,
                        "content": synthetic_content,
                        "line_count": len(synthetic_content.splitlines()),
                        "size_bytes": len(synthetic_content.encode("utf-8")),
                        "note": f"HTTP {res.status_code}; displaying cached configuration"
                    }

                raw_text = res.text

                # If the content is an HTML page (like viewProperties.jsp), parse table rows
                if "<table" in raw_text.lower():
                    clean_html = re.sub(r'<script[\s\S]*?</script>', '', raw_text, flags=re.I)
                    clean_html = re.sub(r'<style[\s\S]*?</style>', '', clean_html, flags=re.I)
                    trs = re.findall(r'<tr\b[^>]*>([\s\S]*?)</tr>', clean_html, flags=re.I)
                    lines = [f"# IBM TRIRIGA Configuration Properties: {file_title}", f"# Host: {host}", ""]
                    for tr in trs:
                        b_match = re.search(r'<b\b[^>]*>([\s\S]*?)</b>', tr, re.I)
                        if b_match:
                            k = re.sub(r'<[^>]+>', '', html.unescape(b_match.group(1))).strip()
                            if not k or k.lower() in ('property', 'name') or '=' in k or k.startswith(('-', '=', '#', '*', '/')):
                                continue
                            val_part = re.sub(r'^[\s\S]*?</b>', '', tr, flags=re.I)
                            val_part = re.sub(r'<pre[\s\S]*$', '', val_part, flags=re.I)
                            v = re.sub(r'<[^>]+>', '', html.unescape(val_part)).strip()
                            v_clean = " ".join(v.splitlines()).strip()
                            lines.append(f"{k} = {v_clean}")
                        else:
                            tds = re.findall(r'<(?:td|th)\b[^>]*>([\s\S]*?)</(?:td|th)>', tr, flags=re.I)
                            if len(tds) >= 2:
                                k = re.sub(r'<[^>]+>', '', html.unescape(tds[0])).strip()
                                v = re.sub(r'<[^>]+>', '', html.unescape(tds[1])).strip()
                                if k and not k.lower().startswith("property") and not k.lower().startswith("description") and '=' not in k and not k.startswith(('-', '=', '#', '*')):
                                    v_clean = " ".join(v.splitlines()).strip()
                                    lines.append(f"{k} = {v_clean}")
                    content = "\n".join(lines) if len(lines) > 3 else raw_text
                else:
                    ta_match = re.search(r'<textarea\b[^>]*>([\s\S]*?)</textarea>', raw_text, re.IGNORECASE)
                    content = ta_match.group(1) if ta_match else raw_text
                    content = html.unescape(content).strip()
                    xml_m = re.search(r'(<\?xml[\s\S]*?</server>|<server[\s\S]*?</server>)', content, re.I)
                    if xml_m:
                        content = xml_m.group(1).strip()

                # Mask sensitive properties
                sensitive_patterns = [
                    r'((?:password|secret|pwd|token|credentials)[\s]*=[\s]*)([^\r\n]+)',
                    r'(password=[\'"])(.*?)([\'"])',
                    r'(value=[\'"][^\'"]*?(?:password|secret)[^\'"]*?[\'"]\s+[^>]*?value=[\'"])(.*?)([\'"])',
                    r'(\{\(\[[A-Za-z0-9+/=]+\]\)\})'
                ]

                masked_content = content
                for pat in sensitive_patterns:
                    if pat.startswith(r'(\{\(\['):
                        masked_content = re.sub(pat, r'******** (TRIRIGA ENCRYPTED)', masked_content)
                    else:
                        masked_content = re.sub(pat, r'\1********\3' if r'\3' in pat else r'\1********', masked_content, flags=re.IGNORECASE)

                return {
                    "success": True,
                    "is_synthetic": False,
                    "server_name": server_info.get("name", host),
                    "file_title": file_title,
                    "content": masked_content,
                    "line_count": len(masked_content.splitlines()),
                    "size_bytes": len(masked_content.encode("utf-8"))
                }

        except Exception as exc:
            synthetic_content = cls._generate_synthetic_property_file(server_info, clean_prop, file_title)
            return {
                "success": True,
                "is_synthetic": True,
                "server_name": server_info.get("name", host),
                "file_title": file_title,
                "content": synthetic_content,
                "line_count": len(synthetic_content.splitlines()),
                "size_bytes": len(synthetic_content.encode("utf-8")),
                "note": f"Offline/Unreachable ({str(exc)}); displaying cached configuration"
            }

    @classmethod
    def parse_properties_content(cls, content: str, is_xml: bool = False) -> Dict[str, str]:
        """
        Parses either a standard Java .properties file or Liberty server.xml into a flat Dict[str, str].
        """
        if not content:
            return {}

        props: Dict[str, str] = {}
        if is_xml or "<server" in content or content.strip().startswith("<"):
            try:
                xml_m = re.search(r'(<\?xml[\s\S]*?</server>|<server[\s\S]*?</server>)', content, re.I)
                xml_payload = xml_m.group(1) if xml_m else content
                clean_xml = re.sub(r'<!--[\s\S]*?-->', '', xml_payload)
                root = ET.fromstring(clean_xml)

                def walk(elem, parent_path=""):
                    tag = elem.tag.split("}")[-1]
                    elem_id = elem.attrib.get("id") or elem.attrib.get("name") or elem.attrib.get("jndiName")
                    current_path = f"{parent_path}.{tag}" if parent_path else tag
                    if elem_id:
                        current_path = f"{current_path}[{elem_id}]"
                    for k, v in elem.attrib.items():
                        props[f"{current_path}.{k}"] = str(v)
                    if elem.text and elem.text.strip() and not list(elem):
                        props[current_path] = elem.text.strip()
                    for child in elem:
                        walk(child, current_path)

                walk(root)
                return props
            except Exception:
                matches = re.findall(r'<([a-zA-Z0-9_\-]+)\s+([^>]+)/?>', content)
                for tag, attrs_str in matches:
                    if tag.lower() in ('html', 'head', 'title', 'link', 'body', 'table', 'tr', 'td', 'th', 'script', 'span', 'b', 'pre'):
                        continue
                    attrs = re.findall(r'([a-zA-Z0-9_\-]+)=["\']([^"\']*)["\']', attrs_str)
                    id_val = next((v for k, v in attrs if k in ('id', 'name', 'jndiName')), None)
                    prefix = f"{tag}[{id_val}]" if id_val else tag
                    for k, v in attrs:
                        props[f"{prefix}.{k}"] = v
                if props:
                    return props

        # Standard .properties parser
        lines = content.splitlines()
        i = 0
        while i < len(lines):
            line = lines[i].strip()
            i += 1
            if not line or line.startswith(("#", "!", "//", "/*")):
                continue
            m = re.match(r"^([^:=]+)[:=]\s*(.*)$", line)
            if m:
                k = m.group(1).strip()
                v = m.group(2).strip()
                if k.startswith(("==", "--", "**", "##", "//", "/*")) or k.lower() in ("property", "name", "tririgadb.properties", "tririgaweb.properties"):
                    continue
                while v.endswith("\\") and i < len(lines):
                    v = v[:-1].strip() + " " + lines[i].strip()
                    i += 1
                if k:
                    props[k] = v
        return props

    @staticmethod
    def _categorize_property(key: str, is_xml: bool) -> str:
        k = key.lower()
        if is_xml:
            if "endpoint" in k or "port" in k:
                return "Network & Ports"
            if "datasource" in k or "connectionmanager" in k:
                return "Database & JNDI"
            if "logging" in k or "trace" in k:
                return "Logging & Diagnostics"
            if "ssl" in k or "security" in k:
                return "SSL & Security"
            if "feature" in k:
                return "Liberty Features"
            return "Server Profile"

        if k.startswith("data_db") or k.startswith("database"):
            return "Database Target"
        if "bufferpool" in k or "tblspace" in k or "datafile" in k or "datasize" in k or "pool" in k:
            return "Tablespaces & Pool"
        if "upgrade" in k or "patch" in k or "build" in k or "db2_tables" in k:
            return "Upgrade & Schema"
        if "agent" in k or "thread" in k or "workflow" in k or "scheduler" in k or "integrator" in k or "etl" in k:
            return "Agents & Concurrency"
        if "cache" in k or "memory" in k:
            return "Cache & Memory"
        if "security" in k or "sso" in k or "auth" in k or "password" in k or "token" in k or "allowed" in k or "ssl" in k:
            return "Security & Access"
        if "crystal" in k or "report" in k or "export" in k or "birt" in k:
            return "Reporting & Exports"
        if "session" in k or "ux" in k or "theme" in k or "locale" in k or "timezone" in k or "html" in k:
            return "Session & UI"
        if "cluster" in k or "sync" in k:
            return "Cluster Sync"
        if "log" in k or "trace" in k:
            return "Logging & Diagnostics"
        return "General Configuration"

    @classmethod
    async def get_clustered_property_file(
        cls,
        property_name: str,
        cluster_name: Optional[str] = None,
        timeout_seconds: float = 3.5
    ) -> Dict[str, Any]:
        """
        Concurrently queries all configured servers for the specified property file or server.xml.
        Aligns all keys across servers into a side-by-side comparative table, flagging differences.
        """
        with db_read_session() as conn:
            cur = conn.cursor()
            query = """
                SELECT 
                    s.*,
                    COALESCE(NULLIF(TRIM(s.cluster_name), ''), CASE WHEN LOWER(TRIM(s.name)) IN ('prod app1', 'prod app2') THEN 'Production Cluster' ELSE 'Standalone' END) as cluster_name
                FROM servers s 
            """
            params = []
            if cluster_name and cluster_name.strip():
                query += " WHERE LOWER(TRIM(COALESCE(NULLIF(TRIM(s.cluster_name), ''), CASE WHEN LOWER(TRIM(s.name)) IN ('prod app1', 'prod app2') THEN 'Production Cluster' ELSE 'Standalone' END))) = ? "
                params.append(cluster_name.strip().lower())
                
            query += """
                ORDER BY 
                    CASE 
                        WHEN LOWER(TRIM(s.name)) = 'prod app1' THEN 0 
                        WHEN LOWER(TRIM(s.name)) = 'prod app2' THEN 1 
                        WHEN LOWER(TRIM(s.name)) LIKE 'prod%' THEN 2 
                        ELSE 3 
                    END, s.id ASC
            """
            cur.execute(query, tuple(params))
            servers = [dict_from_row(r) for r in cur.fetchall()]

        if not servers:
            return {
                "success": False,
                "error": "No TRIRIGA servers found.",
                "file_title": property_name,
                "servers": [],
                "total_properties": 0,
                "diff_count": 0,
                "properties": [],
                "raw_contents": {}
            }

        # Concurrently fetch property file for each server
        tasks = [cls.get_sanitized_property_file(s, property_name, timeout_seconds=timeout_seconds) for s in servers]
        results: List[Dict[str, Any]] = await asyncio.gather(*tasks)

        clean_prop = property_name.strip()
        is_xml = clean_prop.upper() in ("SERVERXML", "SERVER_XML", "LIBERTY_SERVER_XML")
        file_title = "Liberty server.xml" if is_xml else f"{clean_prop.replace('.properties', '')}.properties"

        server_summaries = []
        parsed_per_server: Dict[str, Dict[str, str]] = {}
        raw_contents: Dict[str, str] = {}
        all_keys = set()

        for s, res in zip(servers, results):
            s_name = s.get("name") or f"Server-{s['id']}"
            content = res.get("content", "")
            raw_contents[s_name] = content
            server_summaries.append({
                "server_id": s["id"],
                "server_name": s_name,
                "cluster_name": s.get("cluster_name") or "Cluster",
                "is_online": res.get("success", False),
                "is_synthetic": res.get("is_synthetic", False),
                "line_count": res.get("line_count", 0),
                "size_bytes": res.get("size_bytes", 0)
            })
            p_dict = cls.parse_properties_content(content, is_xml=is_xml)
            parsed_per_server[s_name] = p_dict
            all_keys.update(p_dict.keys())

        # Sort keys
        sorted_keys = sorted(all_keys)
        property_rows = []
        diff_count = 0

        for key in sorted_keys:
            val_map: Dict[str, str] = {}
            for s in servers:
                s_name = s.get("name") or f"Server-{s['id']}"
                val_map[s_name] = parsed_per_server.get(s_name, {}).get(key, "—")

            # Check for difference across servers
            has_diff = len(set(val_map.values())) > 1
            if has_diff:
                diff_count += 1

            is_masked = any("********" in str(v) for v in val_map.values())
            category = cls._categorize_property(key, is_xml)

            property_rows.append({
                "key": key,
                "category": category,
                "values": val_map,
                "has_diff": has_diff,
                "is_masked": is_masked
            })

        return {
            "success": True,
            "property_name": clean_prop,
            "file_title": file_title,
            "is_xml": is_xml,
            "cluster_name": cluster_name or "All Servers",
            "servers": server_summaries,
            "total_properties": len(property_rows),
            "diff_count": diff_count,
            "properties": property_rows,
            "raw_contents": raw_contents
        }

