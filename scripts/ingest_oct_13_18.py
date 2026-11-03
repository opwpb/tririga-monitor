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

async def process_server(server_info: dict):
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

    print(f"\n{'='*70}\n[SERVER {s_id}] {name} ({base_url})\n{'='*70}")

    trivis_server_dir = TRIVIS_DATA_DIR / "logs" / f"server_{s_id}"
    local_server_dir = LOCAL_DATA_DIR / "logs" / f"server_{s_id}"
    trivis_server_dir.mkdir(parents=True, exist_ok=True)
    local_server_dir.mkdir(parents=True, exist_ok=True)

    async with httpx.AsyncClient(timeout=60.0, verify=False, follow_redirects=True) as client:
        # 1. Authenticate
        auth = await TririgaAdminClient._authenticate_client(client, base_url, admin_path, user, pwd)
        if not auth:
            print(f"  [!] Failed to authenticate to {name}")
            return {"server": name, "success": False, "error": "Auth failed"}

        # 2. Scrape errorLogMain.jsp
        print(f"  [+] Inspecting Admin Console error logs page...")
        res = await client.get(f"{base_url}{admin_path}/errorLogMain.jsp")
        if res.status_code != 200:
            print(f"  [!] Failed to fetch errorLogMain.jsp (Status {res.status_code})")
            return {"server": name, "success": False, "error": f"HTTP {res.status_code}"}

        # Find all download links matching Oct 13-18
        found_links = re.findall(r'href=[\'"]([^\'"]*downloadLogFile\.jsp[^\'"]*)[\'"]', res.text, re.IGNORECASE)
        target_files = {}
        for link in found_links:
            m = re.search(r'file=([^&]+)', link)
            if m:
                fn = m.group(1)
                if is_oct_13_18(fn):
                    target_files[fn] = urljoin(base_url, link)

        print(f"  [+] Discovered {len(target_files)} target log files for Oct 13-18 on {name}.")
        if not target_files:
            return {"server": name, "success": True, "files": 0, "entries": 0}

        download_sem = asyncio.Semaphore(4)
        downloaded = []

        async def fetch_file(fn: str, url: str):
            async with download_sem:
                trivis_file = trivis_server_dir / fn
                local_file = local_server_dir / fn
                ft = get_file_type(fn)

                # Check if already downloaded on TRIVIS disk
                if trivis_file.exists() and trivis_file.stat().st_size > 0:
                    sz = trivis_file.stat().st_size
                    print(f"    [CACHED] {fn} ({sz/1024:.1f} KB on TRIVIS disk)")
                    return {"filename": fn, "file_type": ft, "trivis_path": str(trivis_file), "local_path": str(local_file), "size": sz}

                # Download
                try:
                    resp = await client.get(url)
                    if resp.status_code == 200 and len(resp.content) > 0 and "<html" not in resp.text[:100].lower():
                        content = resp.text
                        # Save to TRIVIS disk
                        with open(trivis_file, "w", encoding="utf-8", errors="replace") as f:
                            f.write(content)
                        # Save to local disk
                        try:
                            with open(local_file, "w", encoding="utf-8", errors="replace") as f:
                                f.write(content)
                        except Exception:
                            pass
                        sz = len(resp.content)
                        print(f"    [DOWNLOADED] {fn} ({sz/1024:.1f} KB)")
                        return {"filename": fn, "file_type": ft, "trivis_path": str(trivis_file), "local_path": str(local_file), "size": sz}
                    else:
                        print(f"    [SKIP] {fn} returned non-log payload (Status {resp.status_code})")
                except Exception as ex:
                    print(f"    [ERROR] Downloading {fn}: {ex}")
                return None

        tasks = [fetch_file(fn, url) for fn, url in target_files.items()]
        results = await asyncio.gather(*tasks)
        valid_files = [r for r in results if r is not None]

        # 3. Ingest into database
        conn = sqlite3.connect(str(DB_PATH), timeout=60.0)
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()

        server_total_entries = 0
        server_total_errors = 0
        server_total_warns = 0

        for f_info in valid_files:
            fn = f_info["filename"]
            ft = f_info["file_type"]
            sz = f_info["size"]
            trivis_path_str = f"C:\\Program Files\\Apache Software Foundation\\Tomcat 10.1\\webapps\\ROOT\\admindashboard\\backend\\data\\logs\\server_{s_id}\\{fn}"
            actual_read_path = f_info["trivis_path"]

            # Check existing file record
            cur.execute("SELECT id, entry_count, status FROM log_files WHERE server_id=? AND filename=?", (s_id, fn))
            row = cur.fetchone()
            if row:
                file_id = row["id"]
                if row["status"] == "parsed" and row["entry_count"] > 0:
                    # Check if log entries actually exist for this file
                    cur.execute("SELECT COUNT(*) FROM log_entries WHERE file_id=?", (file_id,))
                    actual_cnt = cur.fetchone()[0]
                    if actual_cnt > 0:
                        print(f"    [INDEXED] {fn} already indexed with {actual_cnt:,} entries.")
                        server_total_entries += actual_cnt
                        continue
                # If parsed is 0 or needs re-index, clean up and re-parse
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

            # Parse and ingest
            t0 = time.time()
            ingest_res = LogAmalgamator.ingest_file(conn, s_id, file_id, actual_read_path)
            conn.commit()
            dur = time.time() - t0

            server_total_entries += ingest_res["total"]
            server_total_errors += ingest_res["errors"]
            server_total_warns += ingest_res["warns"]
            print(f"    [PARSED] {fn} -> {ingest_res['total']:,} lines ({ingest_res['errors']:,} errs, {ingest_res['warns']:,} warns) in {dur:.2f}s")

        conn.close()
        return {
            "server": name,
            "success": True,
            "files": len(valid_files),
            "entries": server_total_entries,
            "errors": server_total_errors,
            "warns": server_total_warns
        }

async def main():
    print(f"Starting Oct 13-18 Log Retrieval & Amalgamation Pipeline...")
    print(f"Target Database: {DB_PATH}")

    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()
    cur.execute("SELECT id, name, host, port, protocol, admin_path, username, password FROM servers WHERE password IS NOT NULL AND length(password) > 0")
    servers = [dict(r) for r in cur.fetchall()]
    conn.close()

    print(f"Configured servers to process ({len(servers)}): {[s['name'] for s in servers]}")

    results = []
    for s in servers:
        try:
            res = await process_server(s)
            results.append(res)
        except Exception as e:
            print(f"[!] Server {s['name']} failed: {e}")
            results.append({"server": s["name"], "success": False, "error": str(e)})

    print("\n" + "="*70)
    print("PIPELINE SUMMARY - OCT 13-18 LOGS INGESTION")
    print("="*70)
    total_f = 0
    total_e = 0
    for r in results:
        status_str = "SUCCESS" if r.get("success") else "FAILED"
        files_cnt = r.get("files", 0)
        entries_cnt = r.get("entries", 0)
        total_f += files_cnt
        total_e += entries_cnt
        print(f"  * {r['server']:<15} | Status: {status_str:<7} | Files: {files_cnt:<3} | Entries: {entries_cnt:,}")
    print(f"\nTotal Oct 13-18 Files: {total_f} | Total Entries: {total_e:,}")
    print("="*70)

if __name__ == "__main__":
    asyncio.run(main())
