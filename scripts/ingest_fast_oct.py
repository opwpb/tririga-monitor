import asyncio
import os
import re
import sys
import time
import sqlite3
from pathlib import Path
from urllib.parse import urljoin
import httpx

# Add backend directory to sys.path
backend_dir = Path(__file__).resolve().parent.parent / "backend"
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))

from app.services.tririga_admin_client import TririgaAdminClient
from app.services.log_amalgamator import LogAmalgamator

TRIVIS_DATA_DIR = Path(r"\\trivis\c$\Program Files\Apache Software Foundation\Tomcat 10.1\webapps\ROOT\admindashboard\backend\data")
LOCAL_DATA_DIR = Path(__file__).resolve().parent.parent / "data"
DB_PATH = TRIVIS_DATA_DIR / "tririga_logs.db"

OCT_DATES = [f"2026-10-{d:02d}" for d in range(13, 19)]

def is_oct_13_18(filename: str) -> bool:
    fn = os.path.basename(filename)
    return any(d in fn for d in OCT_DATES)

def get_file_type(filename: str) -> str:
    fn_lower = filename.lower()
    if "security" in fn_lower:
        return "security"
    elif "workflow" in fn_lower:
        return "workflow"
    elif "migration" in fn_lower:
        return "workflow"
    elif "datapool" in fn_lower:
        return "datapool"
    elif "performance" in fn_lower:
        return "performance"
    elif "gc" in fn_lower:
        return "gc"
    return "server"

async def process_server(server_info: dict, conn: sqlite3.Connection):
    s_id = server_info["id"]
    name = server_info["name"]
    host = server_info["host"]
    port = server_info["port"]
    protocol = server_info["protocol"]
    admin_path = server_info["admin_path"] or "/html/en/default/admin"
    user = server_info["username"]
    pwd = server_info["password"]

    port_str = f":{port}" if (protocol == "http" and port != 80) or (protocol == "https" and port != 443) else ""
    base_url = f"{protocol}://{host}{port_str}"

    print(f"\n{'='*70}\n[SERVER {s_id}] {name} ({base_url})\n{'='*70}", flush=True)

    trivis_server_dir = TRIVIS_DATA_DIR / "logs" / f"server_{s_id}"
    local_server_dir = LOCAL_DATA_DIR / "logs" / f"server_{s_id}"
    trivis_server_dir.mkdir(parents=True, exist_ok=True)
    local_server_dir.mkdir(parents=True, exist_ok=True)

    async with httpx.AsyncClient(timeout=45.0, verify=False, follow_redirects=True) as client:
        # Clear cookie cache for a fresh session
        cache_key = f"{base_url}:{user}"
        TririgaAdminClient._session_cookie_cache.pop(cache_key, None)

        print(f"  [1/3] Authenticating as {user}...", flush=True)
        auth = await TririgaAdminClient._authenticate_client(client, base_url, admin_path, user, pwd)
        if not auth:
            print(f"  [!] Failed to authenticate to {name}", flush=True)
            return {"server": name, "success": False, "error": "Auth failed"}

        print(f"  [2/3] Fetching errorLogMain.jsp...", flush=True)
        res = await client.get(f"{base_url}{admin_path}/errorLogMain.jsp")
        if res.status_code != 200:
            print(f"  [!] HTTP {res.status_code} fetching errorLogMain.jsp", flush=True)
            return {"server": name, "success": False, "error": f"HTTP {res.status_code}"}

        found_links = re.findall(r'href=[\'"]([^\'"]*downloadLogFile\.jsp[^\'"]*)[\'"]', res.text, re.IGNORECASE)
        target_files = {}
        for link in found_links:
            m = re.search(r'file=([^&]+)', link)
            if m:
                fn = m.group(1)
                if is_oct_13_18(fn):
                    target_files[fn] = urljoin(base_url, link)

        print(f"  [+] Discovered {len(target_files)} target log files for Oct 13-18.", flush=True)
        if not target_files:
            return {"server": name, "success": True, "files": 0, "entries": 0}

        cur = conn.cursor()
        server_total_entries = 0
        server_total_errors = 0
        server_total_warns = 0
        processed_files_count = 0

        # Download sequentially to prevent TRIRIGA session locks
        print(f"  [3/3] Downloading and ingesting {len(target_files)} files sequentially...", flush=True)
        for idx, (fn, url) in enumerate(target_files.items(), 1):
            trivis_file = trivis_server_dir / fn
            local_file = local_server_dir / fn
            ft = get_file_type(fn)

            # Check if file exists and already parsed
            cur.execute("SELECT id, entry_count, status FROM log_files WHERE server_id=? AND filename=?", (s_id, fn))
            existing_row = cur.fetchone()
            if existing_row and existing_row[2] == "parsed" and existing_row[1] > 0 and trivis_file.exists():
                print(f"    ({idx}/{len(target_files)}) [CACHED] {fn}: {existing_row[1]:,} entries already indexed.", flush=True)
                server_total_entries += existing_row[1]
                processed_files_count += 1
                continue

            # Need to download if not on TRIVIS disk
            if not trivis_file.exists() or trivis_file.stat().st_size == 0:
                try:
                    resp = await client.get(url)
                    if resp.status_code == 200 and len(resp.content) > 0 and "<html" not in resp.text[:100].lower():
                        content = resp.text
                        with open(trivis_file, "w", encoding="utf-8", errors="replace") as f:
                            f.write(content)
                        try:
                            with open(local_file, "w", encoding="utf-8", errors="replace") as f:
                                f.write(content)
                        except Exception:
                            pass
                    else:
                        print(f"    ({idx}/{len(target_files)}) [SKIP] {fn} returned non-log payload (Status {resp.status_code})", flush=True)
                        continue
                except Exception as ex:
                    print(f"    ({idx}/{len(target_files)}) [ERROR] Downloading {fn}: {ex}", flush=True)
                    continue

            sz = trivis_file.stat().st_size
            trivis_path_str = f"C:\\Program Files\\Apache Software Foundation\\Tomcat 10.1\\webapps\\ROOT\\admindashboard\\backend\\data\\logs\\server_{s_id}\\{fn}"

            if existing_row:
                file_id = existing_row[0]
                cur.execute("DELETE FROM log_entries WHERE file_id=?", (file_id,))
                cur.execute("""
                    UPDATE log_files 
                    SET local_path=?, size_bytes=?, downloaded_at=datetime('now', 'utc'), status='parsing'
                    WHERE id=?
                """, (trivis_path_str, sz, file_id))
            else:
                cur.execute("""
                    INSERT INTO log_files (server_id, filename, file_type, local_path, size_bytes, downloaded_at, status)
                    VALUES (?, ?, ?, ?, ?, datetime('now', 'utc'), 'parsing')
                """, (s_id, fn, ft, trivis_path_str, sz))
                file_id = cur.lastrowid
            conn.commit()

            t0 = time.time()
            ingest_res = LogAmalgamator.ingest_file(conn, s_id, file_id, str(trivis_file))
            conn.commit()
            dur = time.time() - t0

            server_total_entries += ingest_res["total"]
            server_total_errors += ingest_res["errors"]
            server_total_warns += ingest_res["warns"]
            processed_files_count += 1
            print(f"    ({idx}/{len(target_files)}) [INGESTED] {fn} ({sz/1024:.1f} KB) -> {ingest_res['total']:,} lines in {dur:.2f}s", flush=True)

        return {
            "server": name,
            "success": True,
            "files": processed_files_count,
            "entries": server_total_entries,
            "errors": server_total_errors,
            "warns": server_total_warns
        }

async def main():
    print(f"Starting Robust Oct 13-18 Log Retrieval & Ingestion Pipeline...", flush=True)
    print(f"Target Database: {DB_PATH}", flush=True)

    conn = sqlite3.connect(str(DB_PATH), timeout=60.0)
    # Ensure indexes exist
    conn.execute("CREATE INDEX IF NOT EXISTS idx_log_entries_file_id ON log_entries(file_id);")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_log_files_srv_fn ON log_files(server_id, filename);")
    conn.commit()

    cur = conn.cursor()
    cur.execute("SELECT id, name, host, port, protocol, admin_path, username, password FROM servers WHERE password IS NOT NULL AND length(password) > 0 ORDER BY id ASC")
    rows = cur.fetchall()
    servers = [
        {"id": r[0], "name": r[1], "host": r[2], "port": r[3], "protocol": r[4], "admin_path": r[5], "username": r[6], "password": r[7]}
        for r in rows
    ]

    print(f"Processing servers: {[s['name'] for s in servers]}", flush=True)

    results = []
    for s in servers:
        try:
            res = await process_server(s, conn)
            results.append(res)
        except Exception as e:
            print(f"[!] Server {s['name']} failed with error: {e}", flush=True)
            results.append({"server": s["name"], "success": False, "error": str(e)})

    # Print final date breakdown from DB
    print("\n" + "="*70, flush=True)
    print("FINAL DATABASE LOG COUNTS BY DATE:", flush=True)
    print("="*70, flush=True)
    cur.execute("SELECT substr(timestamp, 1, 10) as dt, count(*) FROM log_entries GROUP BY dt ORDER BY dt DESC")
    for dt, cnt in cur.fetchall():
        print(f"  {dt}: {cnt:,} entries", flush=True)

    conn.close()

    print("\n" + "="*70, flush=True)
    print("PIPELINE COMPLETE!", flush=True)
    print("="*70, flush=True)

if __name__ == "__main__":
    asyncio.run(main())
