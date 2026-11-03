import os
import re
import time
import asyncio
import httpx
import paramiko
from pathlib import Path
from datetime import datetime, timezone, timedelta
from typing import List, Dict, Any, Optional, AsyncGenerator
from urllib.parse import urljoin
from ..config import settings
from ..db.database import db_session, db_read_session, dict_from_row
from .log_amalgamator import LogAmalgamator

class TririgaCollector:
    """Handles automated login, file discovery, and downloading from TRIRIGA servers."""

    @staticmethod
    async def test_http_connection(
        host: str,
        port: int,
        protocol: str,
        admin_path: str,
        username: Optional[str],
        password: Optional[str]
    ) -> Dict[str, Any]:
        """Tests connectivity and login against a TRIRIGA Admin Console endpoint."""
        port_str = f":{port}" if (protocol == "http" and port != 80) or (protocol == "https" and port != 443) else ""
        base_url = f"{protocol}://{host}{port_str}"
        admin_url = f"{base_url}{admin_path or '/html/en/default/admin'}"

        try:
            async with httpx.AsyncClient(timeout=15.0, verify=False, follow_redirects=True) as client:
                # 1. Access admin page to initiate session
                init_res = await client.get(f"{base_url}/html/en/default/admin/index.jsp")
                if init_res.status_code not in (200, 302, 401, 403):
                    return {"success": False, "message": f"Admin Console unreachable (HTTP {init_res.status_code})"}

                if username and password:
                    # 2. Try Modern TRIRIGA 4.x / 11.x JSON login endpoint
                    login_url_json = f"{base_url}/p/websignon/tririga-admin-login?screenWidth=1920&screenHeight=1080&contentType=3&languageId=1"
                    try:
                        json_res = await client.post(
                            login_url_json,
                            json={"userName": username, "password": password},
                            headers={"Content-Type": "application/json"}
                        )
                        if json_res.status_code == 200 and "url" in json_res.text and "unauthorized" not in json_res.text.lower():
                            probe = await client.get(f"{base_url}/html/en/default/admin/adminLeftMenu.jsp")
                            if probe.status_code == 200 and "sign in required" not in probe.text.lower() and len(probe.text) > 500:
                                return {"success": True, "message": f"Successfully authenticated to TRIRIGA Admin Console at {base_url}!"}
                    except Exception:
                        pass

                    # 3. Fallback to Classic TRIRIGA Form login
                    try:
                        login_url_form = f"{base_url}/html/en/default/admin/j_security_check"
                        form_res = await client.post(
                            login_url_form,
                            data={"j_username": username, "j_password": password},
                            headers={"Content-Type": "application/x-www-form-urlencoded"}
                        )
                        probe = await client.get(f"{base_url}/html/en/default/admin/adminLeftMenu.jsp")
                        if probe.status_code == 200 and "sign in required" not in probe.text.lower() and len(probe.text) > 500:
                            return {"success": True, "message": f"Successfully authenticated via classic form to TRIRIGA Admin Console at {base_url}!"}
                    except Exception:
                        pass

                    return {"success": False, "message": f"Admin Console reachable at {base_url}, but authentication failed for user '{username}'. Please verify password."}

                return {"success": True, "message": f"Admin Console reachable at {admin_url} (Authentication pending credentials)"}
        except Exception as e:
            return {"success": False, "message": f"Connection failed: {str(e)}"}

    @staticmethod
    def test_ssh_connection(host: str, port: int, username: str, password: Optional[str] = None, key_path: Optional[str] = None) -> Dict[str, Any]:
        """Tests SSH/SFTP connection to remote TRIRIGA host."""
        ssh = paramiko.SSHClient()
        ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        try:
            ssh.connect(
                hostname=host,
                port=port or 22,
                username=username,
                password=password,
                key_filename=key_path if key_path and os.path.exists(key_path) else None,
                timeout=10.0
            )
            sftp = ssh.open_sftp()
            sftp.close()
            ssh.close()
            return {"success": True, "message": f"SSH connection established successfully to {host}:{port}"}
        except Exception as e:
            return {"success": False, "message": f"SSH connection error: {str(e)}"}

    @staticmethod
    def is_current_date_log(filename: str, file_mtime: Optional[float] = None) -> bool:
        """
        Determines whether a log file is dated with the current date or is a live active log for today.
        Files dated with older/past dates are strictly excluded from refresh.
        """
        now_utc = datetime.now(timezone.utc)
        now_local = datetime.now()

        today_patterns = {
            now_utc.strftime("%Y-%m-%d"),
            now_utc.strftime("%Y_%m_%d"),
            now_utc.strftime("%Y%m%d"),
            now_utc.strftime("%y.%m.%d"),
            now_utc.strftime("%d-%m-%Y"),
            now_local.strftime("%Y-%m-%d"),
            now_local.strftime("%Y_%m_%d"),
            now_local.strftime("%Y%m%d"),
            now_local.strftime("%y.%m.%d"),
            now_local.strftime("%d-%m-%Y"),
        }

        fn_base = os.path.basename(filename)

        # 1. Check for standard YYYY-MM-DD or YYYY_MM_DD (e.g. server-2026-09-24_10-59-30-692.log)
        m_iso = re.search(r'(\d{4})[-_](\d{2})[-_](\d{2})', fn_base)
        if m_iso:
            file_date = f"{m_iso.group(1)}-{m_iso.group(2)}-{m_iso.group(3)}"
            file_date_alt = f"{m_iso.group(1)}_{m_iso.group(2)}_{m_iso.group(3)}"
            return file_date in today_patterns or file_date_alt in today_patterns

        # 2. Check for Liberty / Websphere date in filename: YY.MM.DD (e.g. messages_26.09.24.log)
        m_wlp = re.search(r'(\d{2})\.(\d{2})\.(\d{2})', fn_base)
        if m_wlp:
            file_date = f"{m_wlp.group(1)}.{m_wlp.group(2)}.{m_wlp.group(3)}"
            return file_date in today_patterns

        # 3. Check for compact YYYYMMDD (e.g. server20260924.log)
        m_comp = re.search(r'(\d{4})(\d{2})(\d{2})', fn_base)
        if m_comp:
            y, m, d = int(m_comp.group(1)), int(m_comp.group(2)), int(m_comp.group(3))
            if 2020 <= y <= 2040 and 1 <= m <= 12 and 1 <= d <= 31:
                file_date = f"{m_comp.group(1)}{m_comp.group(2)}{m_comp.group(3)}"
                return file_date in today_patterns

        # 4. If file_mtime is provided for an undated file (e.g. SFTP), verify modification timestamp is today
        if file_mtime is not None:
            file_dt = datetime.fromtimestamp(file_mtime, tz=timezone.utc)
            return file_dt.strftime("%Y-%m-%d") in today_patterns or (now_utc - file_dt).total_seconds() < 86400

        # 5. Live active log files without any date in filename (e.g. server.log, workflow.log, security.log)
        # These represent the active log stream currently being appended to today.
        return True

    @staticmethod
    def is_active_live_log(filename: str) -> bool:
        """
        Returns True if the file is an active, continuously written-to live log stream
        (e.g., server.log, security.log, workflow.log) rather than an immutable rolled/dated archive.
        """
        fn_base = os.path.basename(filename).lower()
        active_names = {
            "server.log", "security.log", "workflow.log", "datapool.log",
            "objectmigration.log", "performance.log", "systemmetrics.log",
            "messages.log", "trace.log", "console.log"
        }
        return fn_base in active_names

    @classmethod
    async def fetch_admin_console_logs(cls, server: Dict[str, Any], status_callback=None) -> List[Dict[str, Any]]:
        """Authenticates and dynamically retrieves log files dated with the current date from TRIRIGA Admin Console."""
        protocol = server.get("protocol", "https")
        host = server["host"]
        port = server.get("port", 443 if protocol == "https" else 8001)
        port_str = f":{port}" if (protocol == "http" and port != 80) or (protocol == "https" and port != 443) else ""
        base_url = f"{protocol}://{host}{port_str}"
        username = server.get("username")
        password = server.get("password")

        downloaded_files = []
        server_dir = settings.logs_storage_dir / f"server_{server['id']}"
        server_dir.mkdir(parents=True, exist_ok=True)

        async with httpx.AsyncClient(timeout=120.0, verify=False, follow_redirects=True) as client:
            if status_callback:
                await status_callback(f"Connecting to TRIRIGA server at {base_url}...")

            # Authenticate reusing cached session if active
            from .tririga_admin_client import TririgaAdminClient
            admin_path = server.get("admin_path") or "/html/en/default/admin"
            authenticated = False

            if username and password:
                if status_callback:
                    await status_callback(f"Authenticating as '{username}'...")
                authenticated = await TririgaAdminClient._authenticate_client(
                    client, base_url, admin_path, username, password
                )
                if not authenticated:
                    err_msg = f"Authentication rejected on {host}. Please verify username/password in Server Manager."
                    if status_callback:
                        await status_callback(f"ERROR: {err_msg}")
                    return []
                elif status_callback:
                    await status_callback(f"Session established / reused for {username}.")

            # 3. Scrape Error Logs Page (`errorLogMain.jsp`)
            if status_callback:
                await status_callback("Inspecting TRIRIGA Admin Console Error Logs page for today's logs...")

            error_log_page = await client.get(f"{base_url}/html/en/default/admin/errorLogMain.jsp")
            
            # Extract all downloadLogFile.jsp links
            found_links = re.findall(r'href=["\']([^"\']*downloadLogFile\.jsp[^"\']*)["\']', error_log_page.text, re.IGNORECASE)
            
            # Parse unique target log files (FILTER: only files dated with current date or live active files)
            target_files = {}
            total_discovered = 0
            for link in found_links:
                file_match = re.search(r'file=([^&]+)', link)
                if file_match:
                    fn = file_match.group(1)
                    total_discovered += 1
                    # Filter strictly by current date
                    if cls.is_current_date_log(fn):
                        full_link = urljoin(base_url, link)
                        if fn not in target_files:
                            target_files[fn] = full_link

            # If no dynamic links found in errorLogMain, fallback to known core log endpoints
            if not target_files:
                core_logs = ["server.log", "security.log", "workflow.log", "datapool.log", "ObjectMigration.log", "performance.log", "systemmetrics.log"]
                for fn in core_logs:
                    target_files[fn] = f"{base_url}/html/en/default/admin/downloadLogFile.jsp?file={fn}&log={fn}"

            skipped_count = total_discovered - len(target_files) if total_discovered > len(target_files) else 0
            if status_callback:
                msg = f"Discovered {len(target_files)} current-date log targets"
                if skipped_count > 0:
                    msg += f" (skipped {skipped_count} older historical files)"
                await status_callback(f"{msg}. Beginning download...")

            # 4. Download files (prioritize active logs)
            priority_names = ["server.log", "security.log", "workflow.log", "datapool.log", "ObjectMigration.log", "performance.log", "systemmetrics.log"]
            
            sorted_files = []
            for p in priority_names:
                if p in target_files:
                    sorted_files.append((p, target_files[p]))
            for fn, link in target_files.items():
                if fn not in priority_names:
                    sorted_files.append((fn, link))

            total_count = len(sorted_files)
            download_semaphore = asyncio.Semaphore(4)

            async def download_single_file(filename: str, download_url: str, idx: int):
                async with download_semaphore:
                    try:
                        local_path = server_dir / filename
                        is_active = cls.is_active_live_log(filename)

                        # Determine file type
                        ft = "server"
                        fn_lower = filename.lower()
                        if "security" in fn_lower:
                            ft = "security"
                        elif "workflow" in fn_lower:
                            ft = "workflow"
                        elif "datapool" in fn_lower:
                            ft = "datapool"
                        elif "migration" in fn_lower:
                            ft = "workflow"
                        elif "gc" in fn_lower:
                            ft = "gc"

                        # Check local cache: If already downloaded and not an active stream, reuse existing local file
                        if not is_active and local_path.exists() and local_path.stat().st_size > 0:
                            file_size = local_path.stat().st_size
                            if status_callback:
                                await status_callback(f"[CACHED] {filename} already retrieved ({file_size / 1024:.1f} KB), skipping re-download.")
                            return {
                                "filename": filename,
                                "file_type": ft,
                                "local_path": str(local_path),
                                "size_bytes": file_size,
                                "content": ""
                            }

                        if status_callback:
                            await status_callback(f"[FETCH] Downloading {filename} ({idx}/{total_count})...")

                        res = await client.get(download_url)
                        
                        if res.status_code == 200 and len(res.content) > 0 and "<html" not in res.text[:80].lower():
                            with open(local_path, "w", encoding="utf-8", errors="replace") as f:
                                f.write(res.text)

                            if status_callback:
                                size_kb = len(res.content) / 1024
                                await status_callback(f"[SAVED] {filename} ({size_kb:.1f} KB downloaded from console)")

                            return {
                                "filename": filename,
                                "file_type": ft,
                                "local_path": str(local_path),
                                "size_bytes": len(res.content),
                                "content": res.text
                            }
                        else:
                            if status_callback:
                                await status_callback(f"[SKIP] {filename} returned empty or non-log payload (Status: {res.status_code})")
                    except Exception as e:
                        if status_callback:
                            await status_callback(f"[WARN] Error fetching {filename}: {str(e)}")
                    return None

            download_tasks = [download_single_file(fn, url, i) for i, (fn, url) in enumerate(sorted_files, 1)]
            results = await asyncio.gather(*download_tasks)
            downloaded_files = [r for r in results if r is not None]

        return downloaded_files

    @classmethod
    async def fetch_ssh_logs(cls, server: Dict[str, Any], status_callback=None) -> List[Dict[str, Any]]:
        """Downloads logs from TRIRIGA Linux/Unix server via SFTP, filtered to current date."""
        host = server["host"]
        port = server.get("port") or 22
        username = server.get("username")
        password = server.get("password")
        key_path = server.get("ssh_key_path")
        remote_dir = server.get("remote_log_dir") or "/opt/tririga/userfiles/log"

        if status_callback:
            await status_callback(f"Connecting via SFTP to {username}@{host}:{remote_dir}...")

        downloaded_files = []
        server_dir = settings.logs_storage_dir / f"server_{server['id']}"
        server_dir.mkdir(parents=True, exist_ok=True)

        loop = asyncio.get_event_loop()

        def _sftp_download():
            ssh = paramiko.SSHClient()
            ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
            ssh.connect(
                hostname=host,
                port=port,
                username=username,
                password=password,
                key_filename=key_path if key_path and os.path.exists(key_path) else None,
                timeout=20.0
            )
            sftp = ssh.open_sftp()
            
            try:
                file_attrs = sftp.listdir_attr(remote_dir)
            except Exception:
                # Fallback standard Liberty directory
                fallback_dir = "/wlp/usr/servers/tririgaServer/logs"
                file_attrs = sftp.listdir_attr(fallback_dir)
                remote_dir = fallback_dir

            results = []
            for attr in file_attrs:
                fn = attr.filename
                if fn.endswith(".log") or ".log." in fn or fn.endswith(".out") or fn.endswith(".err"):
                    # Filter strictly by current date / modification time
                    if not cls.is_current_date_log(fn, attr.st_mtime):
                        continue

                    remote_file_path = f"{remote_dir}/{fn}"
                    local_path = server_dir / fn
                    is_active = cls.is_active_live_log(fn)

                    ft = "server"
                    fn_lower = fn.lower()
                    if "security" in fn_lower:
                        ft = "security"
                    elif "workflow" in fn_lower:
                        ft = "workflow"
                    elif "gc" in fn_lower:
                        ft = "gc"
                    elif "datapool" in fn_lower:
                        ft = "datapool"
                    elif "migration" in fn_lower:
                        ft = "workflow"

                    # Skip download if static rolled file is already downloaded with identical size
                    if not is_active and local_path.exists() and local_path.stat().st_size == attr.st_size and attr.st_size > 0:
                        results.append({
                            "filename": fn,
                            "file_type": ft,
                            "local_path": str(local_path),
                            "size_bytes": attr.st_size,
                            "content": ""
                        })
                        continue

                    sftp.get(remote_file_path, str(local_path))
                    
                    with open(local_path, "r", encoding="utf-8", errors="replace") as lf:
                        content = lf.read()

                    results.append({
                        "filename": fn,
                        "file_type": ft,
                        "local_path": str(local_path),
                        "size_bytes": attr.st_size,
                        "content": content
                    })

            sftp.close()
            ssh.close()
            return results

        downloaded_files = await loop.run_in_executor(None, _sftp_download)
        if status_callback:
            await status_callback(f"Successfully retrieved {len(downloaded_files)} current-date log files over SFTP.")

        return downloaded_files

    @classmethod
    def generate_mock_tririga_logs(cls, server_id: int, server_name: str) -> List[Dict[str, Any]]:
        """Generates synthetic TRIRIGA log files ONLY when explicitly using a demo/mock server."""
        now = datetime.now(timezone.utc)
        base_time = now - timedelta(hours=2)
        
        server_dir = settings.logs_storage_dir / f"server_{server_id}"
        server_dir.mkdir(parents=True, exist_ok=True)

        def t(minutes_offset: int, sec_offset: int = 0) -> str:
            dt = base_time + timedelta(minutes=minutes_offset, seconds=sec_offset)
            return dt.strftime("%Y-%m-%d %H:%M:%S,%f")[:-3]

        server_log_lines = [
            f"{t(0, 10)} INFO  [com.tririga.platform.bootstrap.TririgaBootstrap] [main] Starting IBM TRIRIGA Application Platform 4.5.0 on node {server_name}",
            f"{t(0, 15)} INFO  [com.tririga.architecture.data.datapool.DataPool] [main] Initializing connection pool 'TririgaPool' (Max: 100, Min: 10, Timeout: 30000ms)",
            f"{t(1, 0)} INFO  [com.tririga.platform.workflow.engine.WorkflowEngine] [WFE-Worker-1] Workflow engine initialized and listening for event queue",
            f"{t(10, 22)} INFO  [com.tririga.ws.TririgaWS] [Thread-14] Incoming SOAP Request 'runNamedMetricQuery' from client IP 192.168.1.105",
            f"{t(15, 30)} WARN  [com.tririga.architecture.data.datapool.DataPool] [Thread-22] Active connections (94/100) nearing capacity limit",
            f"{t(16, 45)} ERROR [com.tririga.architecture.data.datapool.DataPool] [Thread-28] Connection wait timeout exceeded (30000ms). Unable to acquire DB connection from pool 'TririgaPool'.",
            f"com.tririga.architecture.data.datapool.ConnectionTimeoutException: Connection pool exhausted. 100 active connections in use.",
            f"\tat com.tririga.architecture.data.datapool.DataPool.getConnection(DataPool.java:412)",
            f"\tat com.tririga.platform.workflow.runtime.action.QueryTask.execute(QueryTask.java:189)",
            f"{t(20, 12)} WARN  [com.tririga.platform.workflow.engine.WorkflowEngine] [WFE-Worker-4] Workflow ID 99482 exceeded execution threshold (Duration: 320s > Max: 180s)",
            f"{t(22, 5)} ERROR [com.tririga.platform.workflow.engine.WorkflowEngine] [WFE-Worker-4] Workflow 99482 aborted due to transaction deadlock",
            f"com.tririga.platform.error.PlatformException: Deadlock detected in database transaction while updating table 'triContract_U_284'",
            f"\tat com.tririga.platform.workflow.runtime.action.ModifyTask.execute(ModifyTask.java:245)",
            f"Caused by: java.sql.SQLException: ORA-00060: deadlock detected while waiting for resource",
            f"{t(48, 15)} ERROR [com.tririga.platform.runtime.MemoryMonitor] [Monitor-Thread] java.lang.OutOfMemoryError: Java heap space",
            f"java.lang.OutOfMemoryError: Java heap space",
            f"\tat com.tririga.platform.graphics.cad.BimModelCache.loadGeometry(BimModelCache.java:512)"
        ]

        security_log_lines = [
            f"{t(2, 0)} INFO  [com.tririga.platform.security.AuthenticationFilter] [HTTP-8001-1] User 'system_admin' successfully logged in",
            f"{t(12, 16)} ERROR [com.tririga.platform.security.AuthenticationFilter] [HTTP-8001-3] Security Alert: IP locked out after failed authentication attempts"
        ]

        files_data = [
            ("server.log", "server", "\n".join(server_log_lines)),
            ("security.log", "security", "\n".join(security_log_lines)),
        ]

        results = []
        for filename, file_type, content in files_data:
            local_path = server_dir / filename
            with open(local_path, "w", encoding="utf-8") as f:
                f.write(content)

            results.append({
                "filename": filename,
                "file_type": file_type,
                "local_path": str(local_path),
                "size_bytes": len(content.encode("utf-8")),
                "content": content
            })

        return results

    @classmethod
    async def run_sync_job(cls, server_id: int, status_callback=None) -> Dict[str, Any]:
        """Runs the complete collection and amalgamation pipeline for a server."""
        with db_session() as conn:
            cur = conn.cursor()
            cur.execute("SELECT * FROM servers WHERE id=?", (server_id,))
            row = cur.fetchone()
            if not row:
                return {
                    "success": False,
                    "server_id": server_id,
                    "error": f"Server with ID {server_id} not found"
                }
            server = dict_from_row(row)
            cur.execute("UPDATE servers SET status='syncing' WHERE id=?", (server_id,))

        try:
            if status_callback:
                await status_callback(f"Starting log collection for server '{server['name']}' ({server['host']})...")

            downloaded_files: List[Dict[str, Any]] = []

            # Check protocol
            is_mock = server["host"].lower() in ("mock", "mock-server", "localhost-mock", "demo")

            if is_mock:
                if status_callback:
                    await status_callback("Using synthetic TRIRIGA mock cluster log generator...")
                downloaded_files = cls.generate_mock_tririga_logs(server_id, server["name"])
            elif server["protocol"] in ("http", "https"):
                downloaded_files = await cls.fetch_admin_console_logs(server, status_callback)
            elif server["protocol"] == "ssh":
                downloaded_files = await cls.fetch_ssh_logs(server, status_callback)

            if not downloaded_files:
                if is_mock:
                    downloaded_files = cls.generate_mock_tririga_logs(server_id, server["name"])
                else:
                    err_msg = f"No log files could be downloaded from {server['host']}. Check credentials or network connectivity."
                    if status_callback:
                        await status_callback(f"ERROR: {err_msg}")
                    with db_session() as conn:
                        conn.execute("UPDATE servers SET status='error' WHERE id=?", (server_id,))
                    return {"success": False, "server_id": server_id, "error": err_msg}

            total_entries = 0
            total_errors = 0
            total_warns = 0

            # Query existing parsed files metadata to skip redundant parsing of unchanged files
            existing_files_map = {}
            with db_read_session() as conn:
                cur = conn.cursor()
                cur.execute(
                    "SELECT id, filename, size_bytes, status, entry_count, error_count, warn_count FROM log_files WHERE server_id=?",
                    (server_id,)
                )
                for r in cur.fetchall():
                    existing_files_map[r["filename"]] = dict(r)

            def ingest_single_file(s_id: int, f_info: Dict[str, Any]):
                f_name = f_info['filename']
                with db_session() as conn:
                    cur = conn.cursor()
                    cur.execute(
                        "SELECT id FROM log_files WHERE server_id=? AND filename=?",
                        (s_id, f_name)
                    )
                    existing = cur.fetchone()
                    if existing:
                        file_id = existing[0]
                        cur.execute("DELETE FROM log_entries WHERE file_id=?", (file_id,))
                        cur.execute("""
                            UPDATE log_files
                            SET local_path=?, size_bytes=?, downloaded_at=datetime('now', 'utc'), status='parsing'
                            WHERE id=?
                        """, (f_info["local_path"], f_info["size_bytes"], file_id))
                    else:
                        cur.execute("""
                            INSERT INTO log_files (server_id, filename, file_type, local_path, size_bytes, downloaded_at, status)
                            VALUES (?, ?, ?, ?, ?, datetime('now', 'utc'), 'parsing')
                        """, (s_id, f_name, f_info["file_type"], f_info["local_path"], f_info["size_bytes"]))
                        file_id = cur.lastrowid

                    file_source = f_info.get("local_path") or f_info.get("content", "")
                    return LogAmalgamator.ingest_file(conn, s_id, file_id, file_source)

            for idx, file_info in enumerate(downloaded_files, 1):
                fn = file_info['filename']
                size_kb = file_info['size_bytes'] / 1024
                cached = existing_files_map.get(fn)

                # Smart Cache: If file was already parsed and size matches, reuse index and skip re-parsing
                if cached and cached.get("status") == "parsed" and cached.get("size_bytes") == file_info["size_bytes"] and file_info["size_bytes"] > 0:
                    c_total = cached.get("entry_count") or 0
                    c_errors = cached.get("error_count") or 0
                    c_warns = cached.get("warn_count") or 0
                    total_entries += c_total
                    total_errors += c_errors
                    total_warns += c_warns
                    if status_callback:
                        await status_callback(f"[CACHED] {fn}: {c_total:,} entries unchanged ({idx}/{len(downloaded_files)}). Reusing index.")
                    continue

                if status_callback:
                    await status_callback(f"[PARSE] Ingesting {fn} ({size_kb:.1f} KB, file {idx}/{len(downloaded_files)})...")

                # Offload heavy CPU parsing & SQLite ingestion to thread pool to keep asyncio event loop responsive
                ingest_res = await asyncio.to_thread(ingest_single_file, server_id, file_info)
                total_entries += ingest_res["total"]
                total_errors += ingest_res["errors"]
                total_warns += ingest_res["warns"]
                print(f"[COLLECTOR] {server['name']} -> Indexed {fn}: {ingest_res['total']:,} lines ({ingest_res['errors']:,} errs, {ingest_res['warns']:,} warns)", flush=True)

                if status_callback:
                    await status_callback(f"[INDEXED] {fn}: {ingest_res['total']:,} lines indexed ({ingest_res['errors']:,} errors, {ingest_res['warns']:,} warns)")

            with db_session() as conn:
                conn.execute("""
                    UPDATE servers
                    SET status='online', last_sync_at=datetime('now', 'utc')
                    WHERE id=?;
                """, (server_id,))

            print(f"[COLLECTOR] Ingestion finished for {server['name']}: {total_entries:,} total entries ({total_errors:,} errs, {total_warns:,} warns) across {len(downloaded_files)} files.", flush=True)

            if status_callback:
                await status_callback(f"[COMPLETE] Ingestion finished for {server['name']}: {total_entries:,} total lines ({total_errors:,} errors, {total_warns:,} warns) across {len(downloaded_files)} log files.")

            return {
                "success": True,
                "server_id": server_id,
                "files_count": len(downloaded_files),
                "total_entries": total_entries,
                "total_errors": total_errors,
                "total_warns": total_warns
            }

        except Exception as e:
            try:
                with db_session() as conn:
                    conn.execute("UPDATE servers SET status='error' WHERE id=?", (server_id,))
            except Exception:
                pass
            if status_callback:
                await status_callback(f"Sync failed with error: {str(e)}")
            return {"success": False, "server_id": server_id, "error": str(e)}
