import sqlite3
import re
import time
from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, HTTPException, Query
from typing import List, Optional, Dict, Any
from ..db.database import db_session, db_read_session, dict_from_row, dict_list_from_rows

router = APIRouter(prefix="/api/logs", tags=["Amalgamated Logs"])

# In-memory dashboard metrics cache for sub-millisecond response times
_metrics_cache: Optional[Dict[str, Any]] = None
_metrics_cache_time: float = 0.0

# In-memory filter-options cache (changes only on ingestion, 30s TTL)
_filter_cache: Optional[Dict[str, Any]] = None
_filter_cache_time: float = 0.0
_FILTER_CACHE_TTL = 30.0

def invalidate_metrics_cache():
    global _metrics_cache, _metrics_cache_time, _filter_cache, _filter_cache_time
    _metrics_cache = None
    _metrics_cache_time = 0.0
    _filter_cache = None
    _filter_cache_time = 0.0

def parse_near_query(search_str: str):
    """Parses Near-Concurrency cross-entry queries with flexible window syntax and quoting."""
    if not search_str or not search_str.strip():
        return None
    cleaned = search_str.replace("“", '"').replace("”", '"').replace("‘", "'").replace("’", "'").strip()
    match = re.match(
        r"""^\s*(?:["']([^"']+)["']|(.+?))\s+NEAR(?:\s*/?\s*(\d+)\s*(?:s|sec|seconds)?)?\s+(?:["']([^"']+)["']|(.+?))\s*$""",
        cleaned,
        re.IGNORECASE
    )
    if match:
        term1 = (match.group(1) or match.group(2) or "").strip()
        window_sec = int(match.group(3)) if match.group(3) else 10
        window_sec = max(1, min(window_sec, 3600))
        term2 = (match.group(4) or match.group(5) or "").strip()
        if term1 and term2:
            return term1, window_sec, term2
    return None

@router.get("")
def query_logs(
    server_id: Optional[int] = None,
    server_ids: Optional[str] = None,
    log_level: Optional[str] = None,
    file_type: Optional[str] = None,
    filename: Optional[str] = None,
    file_id: Optional[int] = None,
    search: Optional[str] = None,
    start_time: Optional[str] = None,
    end_time: Optional[str] = None,
    include_archives: bool = True,
    page: int = 1,
    page_size: int = 50
):
    """Queries amalgamated logs across servers with FTS5 search, server multi-filtering, and log type filtering."""
    offset = (page - 1) * page_size
    conditions = []
    params: List[Any] = []

    # Server filtering (single ID or multiple comma-separated IDs)
    if server_ids and server_ids.strip():
        sids = [int(s.strip()) for s in server_ids.split(",") if s.strip().isdigit()]
        if sids:
            placeholders = ",".join("?" * len(sids))
            conditions.append(f"e.server_id IN ({placeholders})")
            params.extend(sids)
    elif server_id:
        conditions.append("e.server_id = ?")
        params.append(server_id)

    # Log Level filter
    if log_level and log_level.upper() != "ALL":
        levels = [l.strip().upper() for l in log_level.split(",")]
        placeholders = ",".join("?" * len(levels))
        conditions.append(f"e.log_level IN ({placeholders})")
        params.extend(levels)

    # Log File Type filter (e.g. server, security, workflow, datapool, gc, performance)
    if file_type and file_type.upper() != "ALL":
        types = [t.strip().lower() for t in file_type.split(",")]
        placeholders = ",".join("?" * len(types))
        conditions.append(f"lf.file_type IN ({placeholders})")
        params.extend(types)

    # Filename filter (e.g. server.log, security.log, ObjectMigration.log)
    if filename and filename.strip() and filename.upper() != "ALL":
        filenames = [fn.strip() for fn in filename.split(",")]
        placeholders = ",".join("?" * len(filenames))
        conditions.append(f"lf.filename IN ({placeholders})")
        params.extend(filenames)

    if file_id:
        conditions.append("e.file_id = ?")
        params.append(file_id)

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

    # Track whether any filter references log_files (lf.) — if not, COUNT can skip the JOIN
    needs_file_join = bool(
        (file_type and file_type.upper() != "ALL") or
        (filename and filename.strip() and filename.upper() != "ALL")
    )
    where_clause = "WHERE " + " AND ".join(conditions) if conditions else "WHERE 1=1"

    with db_read_session() as conn:
        cur = conn.cursor()

        if search and search.strip():
            search_str = search.strip()
            
            near_params = parse_near_query(search_str)

            if near_params:
                term1, window_sec, term2 = near_params

                # Build expanded time window for partner candidate search
                partner_time_conditions = []
                partner_time_params = []
                if start_time and start_time.strip():
                    st = start_time.strip()
                    if len(st) == 10 and re.match(r"^\d{4}-\d{2}-\d{2}$", st):
                        st = f"{st}T00:00:00.000Z"
                    try:
                        st_dt = datetime.fromisoformat(st.replace("Z", "+00:00"))
                        st_exp = (st_dt - timedelta(seconds=window_sec)).isoformat().replace("+00:00", "Z")
                        partner_time_conditions.append("e.timestamp >= ?")
                        partner_time_params.append(st_exp)
                    except Exception:
                        partner_time_conditions.append("e.timestamp >= ?")
                        partner_time_params.append(st)

                if end_time and end_time.strip():
                    et = end_time.strip()
                    if len(et) == 10 and re.match(r"^\d{4}-\d{2}-\d{2}$", et):
                        et = f"{et}T23:59:59.999Z"
                    try:
                        et_dt = datetime.fromisoformat(et.replace("Z", "+00:00"))
                        et_exp = (et_dt + timedelta(seconds=window_sec)).isoformat().replace("+00:00", "Z")
                        partner_time_conditions.append("e.timestamp <= ?")
                        partner_time_params.append(et_exp)
                    except Exception:
                        partner_time_conditions.append("e.timestamp <= ?")
                        partner_time_params.append(et)

                # Base server conditions (applied to both primary and partner searches)
                base_conditions = []
                base_params = []
                if server_ids and server_ids.strip():
                    sids = [int(s.strip()) for s in server_ids.split(",") if s.strip().isdigit()]
                    if sids:
                        placeholders = ",".join("?" * len(sids))
                        base_conditions.append(f"e.server_id IN ({placeholders})")
                        base_params.extend(sids)
                elif server_id:
                    base_conditions.append("e.server_id = ?")
                    base_params.append(server_id)

                if file_id:
                    base_conditions.append("e.file_id = ?")
                    base_params.append(file_id)

                # Partner search where clause (server + expanded time, unrestricted by log level/file type)
                partner_conds = base_conditions + partner_time_conditions
                partner_where = "WHERE " + " AND ".join(partner_conds) if partner_conds else "WHERE 1=1"
                partner_query_params = base_params + partner_time_params

                def get_fts_token(t: str) -> str:
                    words = re.findall(r"[a-zA-Z0-9_\-\.:]+", t)
                    return " ".join([f'"{w}"*' for w in words]) if words else f'"{t}"'

                def fetch_matching_entries(term: str, where_sql: str, q_params: list):
                    fts_tok = get_fts_token(term)
                    matched_items = []
                    try:
                        cur.execute(f"""
                            SELECT 
                                e.id, e.server_id, e.file_id, e.timestamp, e.log_level,
                                e.logger_name, e.thread_name, e.message, e.stack_trace,
                                e.error_hash, e.line_number, s.name as server_name, lf.filename, lf.file_type
                            FROM log_entries_fts fts
                            JOIN log_entries e ON fts.rowid = e.id
                            JOIN servers s ON e.server_id = s.id
                            JOIN log_files lf ON e.file_id = lf.id
                            {where_sql} AND log_entries_fts MATCH ?
                            ORDER BY e.timestamp DESC
                        """, q_params + [fts_tok])
                        matched_items = dict_list_from_rows(cur.fetchall())
                    except Exception:
                        matched_items = []

                    if not matched_items:
                        like_tok = f"%{term}%"
                        cur.execute(f"""
                            SELECT 
                                e.id, e.server_id, e.file_id, e.timestamp, e.log_level,
                                e.logger_name, e.thread_name, e.message, e.stack_trace,
                                e.error_hash, e.line_number, s.name as server_name, lf.filename, lf.file_type
                            FROM log_entries e
                            JOIN servers s ON e.server_id = s.id
                            JOIN log_files lf ON e.file_id = lf.id
                            {where_sql}
                              AND (e.message LIKE ? OR e.logger_name LIKE ? OR e.thread_name LIKE ? OR e.stack_trace LIKE ?)
                            ORDER BY e.timestamp DESC
                        """, q_params + [like_tok, like_tok, like_tok, like_tok])
                        matched_items = dict_list_from_rows(cur.fetchall())
                    return matched_items

                cand_a_primary = fetch_matching_entries(term1, where_clause, params)
                cand_b_primary = fetch_matching_entries(term2, where_clause, params)

                cand_a_partner = fetch_matching_entries(term1, partner_where, partner_query_params)
                cand_b_partner = fetch_matching_entries(term2, partner_where, partner_query_params)

                import bisect
                def _parse_epoch(ts_str: str) -> float:
                    try:
                        return datetime.fromisoformat(ts_str.replace("Z", "+00:00")).timestamp()
                    except Exception:
                        return 0.0

                def build_server_index(items):
                    index = {}
                    for it in items:
                        sid = it["server_id"]
                        if sid not in index:
                            index[sid] = {"epochs": [], "entries": []}
                        it["epoch"] = _parse_epoch(it["timestamp"])
                        index[sid]["entries"].append(it)
                    for sid in index:
                        index[sid]["entries"].sort(key=lambda x: x["epoch"])
                        index[sid]["epochs"] = [x["epoch"] for x in index[sid]["entries"]]
                    return index

                b_partner_index = build_server_index(cand_b_partner)
                a_partner_index = build_server_index(cand_a_partner)

                correlated_map = {}

                for a in cand_a_primary:
                    sid = a["server_id"]
                    if sid not in b_partner_index:
                        continue
                    a_epoch = _parse_epoch(a["timestamp"])
                    s_epochs = b_partner_index[sid]["epochs"]
                    s_entries = b_partner_index[sid]["entries"]

                    l_idx = bisect.bisect_left(s_epochs, a_epoch - window_sec)
                    r_idx = bisect.bisect_right(s_epochs, a_epoch + window_sec)

                    best_b = None
                    min_delta = float("inf")
                    for idx in range(l_idx, r_idx):
                        b_cand = s_entries[idx]
                        if b_cand["id"] == a["id"]:
                            continue
                        d = abs(b_cand["epoch"] - a_epoch)
                        if d < min_delta:
                            min_delta = d
                            best_b = b_cand

                    if best_b:
                        entry = dict(a)
                        entry["correlated_id"] = best_b["id"]
                        entry["correlated_message"] = best_b["message"]
                        entry["correlated_timestamp"] = best_b["timestamp"]
                        entry["correlated_level"] = best_b.get("log_level")
                        entry["correlated_logger"] = best_b.get("logger_name")
                        entry["correlated_thread"] = best_b.get("thread_name")
                        entry["delta_seconds"] = round(best_b["epoch"] - a_epoch, 2)
                        correlated_map[entry["id"]] = entry

                for b in cand_b_primary:
                    sid = b["server_id"]
                    if sid not in a_partner_index:
                        continue
                    b_epoch = _parse_epoch(b["timestamp"])
                    s_epochs = a_partner_index[sid]["epochs"]
                    s_entries = a_partner_index[sid]["entries"]

                    l_idx = bisect.bisect_left(s_epochs, b_epoch - window_sec)
                    r_idx = bisect.bisect_right(s_epochs, b_epoch + window_sec)

                    best_a = None
                    min_delta = float("inf")
                    for idx in range(l_idx, r_idx):
                        a_cand = s_entries[idx]
                        if a_cand["id"] == b["id"]:
                            continue
                        d = abs(a_cand["epoch"] - b_epoch)
                        if d < min_delta:
                            min_delta = d
                            best_a = a_cand

                    if best_a:
                        entry = dict(b)
                        entry["correlated_id"] = best_a["id"]
                        entry["correlated_message"] = best_a["message"]
                        entry["correlated_timestamp"] = best_a["timestamp"]
                        entry["correlated_level"] = best_a.get("log_level")
                        entry["correlated_logger"] = best_a.get("logger_name")
                        entry["correlated_thread"] = best_a.get("thread_name")
                        entry["delta_seconds"] = round(best_a["epoch"] - b_epoch, 2)
                        correlated_map[entry["id"]] = entry

                sorted_correlated = sorted(correlated_map.values(), key=lambda x: x["timestamp"], reverse=True)
                total_count = len(sorted_correlated)
                rows = sorted_correlated[offset : offset + page_size]
            else:
                # Fast FTS5 search pathway: format clean terms for FTS5 syntax
                words = re.findall(r"[a-zA-Z0-9_\-\.:]+", search_str)
                fts_query = " ".join([f'"{w}"*' for w in words]) if words else f'"{search_str}"'
                
                fts_success = False
                try:
                    fts_count_query = f"""
                        SELECT COUNT(*) 
                        FROM log_entries_fts fts
                        JOIN log_entries e ON fts.rowid = e.id
                        JOIN log_files lf ON e.file_id = lf.id
                        {where_clause} AND log_entries_fts MATCH ?;
                    """
                    cur.execute(fts_count_query, params + [fts_query])
                    total_count = cur.fetchone()[0]

                    fts_data_query = f"""
                        SELECT 
                            e.id, e.server_id, e.file_id, e.timestamp, e.log_level,
                            e.logger_name, e.thread_name, e.message, e.stack_trace,
                            e.error_hash, e.line_number, s.name as server_name, lf.filename, lf.file_type
                        FROM log_entries_fts fts
                        JOIN log_entries e ON fts.rowid = e.id
                        JOIN servers s ON e.server_id = s.id
                        JOIN log_files lf ON e.file_id = lf.id
                        {where_clause} AND log_entries_fts MATCH ?
                        ORDER BY e.timestamp DESC
                        LIMIT ? OFFSET ?;
                    """
                    cur.execute(fts_data_query, params + [fts_query, page_size, offset])
                    rows = dict_list_from_rows(cur.fetchall())
                    fts_success = True
                except Exception:
                    fts_success = False

                if not fts_success:
                    like_pattern = f"%{search_str}%"
                    search_where = f"{where_clause} AND (e.message LIKE ? OR e.logger_name LIKE ? OR e.thread_name LIKE ? OR e.stack_trace LIKE ?)"
                    search_params = params + [like_pattern, like_pattern, like_pattern, like_pattern]

                    count_query = f"""
                        SELECT COUNT(*) 
                        FROM log_entries e 
                        JOIN log_files lf ON e.file_id = lf.id
                        {search_where};
                    """
                    cur.execute(count_query, search_params)
                    total_count = cur.fetchone()[0]

                    data_query = f"""
                        SELECT 
                            e.id, e.server_id, e.file_id, e.timestamp, e.log_level,
                            e.logger_name, e.thread_name, e.message, e.stack_trace,
                            e.error_hash, e.line_number, s.name as server_name, lf.filename, lf.file_type
                        FROM log_entries e
                        JOIN servers s ON e.server_id = s.id
                        JOIN log_files lf ON e.file_id = lf.id
                        {search_where}
                        ORDER BY e.timestamp DESC
                        LIMIT ? OFFSET ?;
                    """
                    cur.execute(data_query, search_params + [page_size, offset])
                    rows = dict_list_from_rows(cur.fetchall())
        else:
            # Optimized COUNT: skip log_files JOIN when no file_type/filename filter is active
            if needs_file_join:
                count_query = f"""
                    SELECT COUNT(*) 
                    FROM log_entries e 
                    JOIN log_files lf ON e.file_id = lf.id
                    {where_clause};
                """
            else:
                count_query = f"""
                    SELECT COUNT(*) 
                    FROM log_entries e 
                    {where_clause};
                """
            cur.execute(count_query, params)
            total_count = cur.fetchone()[0]

            data_query = f"""
                SELECT 
                    e.id, e.server_id, e.file_id, e.timestamp, e.log_level,
                    e.logger_name, e.thread_name, e.message, e.stack_trace,
                    e.error_hash, e.line_number, s.name as server_name, lf.filename, lf.file_type
                FROM log_entries e
                JOIN servers s ON e.server_id = s.id
                JOIN log_files lf ON e.file_id = lf.id
                {where_clause}
                ORDER BY e.timestamp DESC
                LIMIT ? OFFSET ?;
            """
            cur.execute(data_query, params + [page_size, offset])
            rows = dict_list_from_rows(cur.fetchall())

    # Seamless Cold Archive Search Integration — only for queries with zero live results
    if include_archives and total_count == 0:
        try:
            from ..services.log_storage_service import LogStorageService
            sids = [int(s.strip()) for s in server_ids.split(",") if s.strip().isdigit()] if server_ids else ([server_id] if server_id else None)
            arch_res = LogStorageService.search_archives(
                search=search,
                server_ids=sids,
                log_level=log_level,
                file_type=file_type,
                filename=filename,
                start_time=start_time,
                end_time=end_time,
                limit=max(1, page_size - len(rows)),
                offset=max(0, offset - total_count)
            )
            arch_items = arch_res.get("items", [])
            if arch_items:
                rows.extend(arch_items)
                total_count += arch_res.get("total", 0)
        except Exception as e:
            print(f"[ARCHIVE SEARCH LOG ERROR] {e}", flush=True)

    return {
        "items": rows,
        "total": total_count,
        "page": page,
        "page_size": page_size,
        "total_pages": (total_count + page_size - 1) // page_size if total_count > 0 else 1
    }

@router.get("/{log_id}/context")
def get_log_context(
    log_id: int,
    window_seconds: int = Query(30, ge=1, le=300),
    limit: int = Query(25, ge=5, le=100)
):
    """Returns the surrounding log entries for a given anchor log entry within a time window on the same server."""
    with db_read_session() as conn:
        cur = conn.cursor()
        cur.execute("""
            SELECT e.*, s.name as server_name, lf.filename, lf.file_type
            FROM log_entries e
            JOIN servers s ON e.server_id = s.id
            JOIN log_files lf ON e.file_id = lf.id
            WHERE e.id = ?;
        """, (log_id,))
        anchor = cur.fetchone()
        if not anchor:
            raise HTTPException(status_code=404, detail="Log entry not found")
        anchor_dict = dict_from_row(anchor)

        server_id = anchor_dict["server_id"]
        anchor_time = anchor_dict["timestamp"]

        try:
            anchor_dt = datetime.fromisoformat(anchor_time.replace("Z", "+00:00"))
            start_iso = (anchor_dt - timedelta(seconds=window_seconds)).isoformat().replace("+00:00", "Z")
            end_iso = (anchor_dt + timedelta(seconds=window_seconds)).isoformat().replace("+00:00", "Z")
            anchor_epoch = anchor_dt.timestamp()
        except Exception:
            start_iso = anchor_time
            end_iso = anchor_time
            anchor_epoch = 0.0

        cur.execute("""
            SELECT 
                e.id, e.server_id, e.file_id, e.timestamp, e.log_level,
                e.logger_name, e.thread_name, e.message, e.stack_trace,
                e.error_hash, e.line_number, s.name as server_name, lf.filename, lf.file_type
            FROM log_entries e
            JOIN servers s ON e.server_id = s.id
            JOIN log_files lf ON e.file_id = lf.id
            WHERE e.server_id = ?
              AND e.timestamp >= ?
              AND e.timestamp <= ?
            ORDER BY e.timestamp ASC
            LIMIT ?;
        """, (server_id, start_iso, end_iso, limit))
        surrounding_rows = dict_list_from_rows(cur.fetchall())

        for row in surrounding_rows:
            try:
                row_dt = datetime.fromisoformat(row["timestamp"].replace("Z", "+00:00"))
                row["delta_seconds"] = round(row_dt.timestamp() - anchor_epoch, 2)
            except Exception:
                row["delta_seconds"] = 0.0

        return {
            "anchor": anchor_dict,
            "window_seconds": window_seconds,
            "surrounding": surrounding_rows
        }

@router.get("/filter-options")
def get_filter_options():
    """Returns available server filters, file types, filenames, and log levels for UI filters.
    Uses log_files pre-aggregated counters instead of scanning log_entries (844ms → <1ms)."""
    global _filter_cache, _filter_cache_time
    if _filter_cache is not None and (time.time() - _filter_cache_time) < _FILTER_CACHE_TTL:
        return _filter_cache

    with db_read_session() as conn:
        cur = conn.cursor()

        # Servers with log counts — pre-aggregated from log_files (was 53ms, now <1ms)
        cur.execute("""
            SELECT s.id, s.name, s.host, COALESCE(SUM(lf.entry_count), 0) as log_count
            FROM servers s
            LEFT JOIN log_files lf ON s.id = lf.server_id
            GROUP BY s.id
            ORDER BY 
                CASE 
                    WHEN LOWER(TRIM(s.name)) = 'prod app1' THEN 1
                    WHEN LOWER(TRIM(s.name)) = 'prod app2' THEN 2
                    ELSE 3
                END ASC,
                LOWER(s.name) ASC;
        """)
        servers = dict_list_from_rows(cur.fetchall())

        # File types (e.g. server, security, workflow, datapool, etc.)
        cur.execute("""
            SELECT DISTINCT file_type, COUNT(*) as file_count
            FROM log_files
            GROUP BY file_type
            ORDER BY file_type ASC;
        """)
        file_types = dict_list_from_rows(cur.fetchall())

        # Filenames — pre-aggregated from log_files (was 844ms, now <1ms)
        cur.execute("""
            SELECT filename, file_type, COALESCE(SUM(entry_count), 0) as entry_count
            FROM log_files
            GROUP BY filename
            ORDER BY entry_count DESC;
        """)
        filenames = dict_list_from_rows(cur.fetchall())

        # Log levels — computed from log_files counters (was 51ms, now <1ms)
        cur.execute("""
            SELECT 
                COALESCE(SUM(error_count), 0) as error_total,
                COALESCE(SUM(warn_count), 0) as warn_total,
                COALESCE(SUM(entry_count), 0) as all_total
            FROM log_files;
        """)
        row = cur.fetchone()
        error_total = row[0] if row else 0
        warn_total = row[1] if row else 0
        all_total = row[2] if row else 0
        info_total = max(0, all_total - error_total - warn_total)

        log_levels = []
        if info_total > 0:
            log_levels.append({"log_level": "INFO", "count": info_total})
        if warn_total > 0:
            log_levels.append({"log_level": "WARN", "count": warn_total})
        if error_total > 0:
            log_levels.append({"log_level": "ERROR", "count": error_total})
        log_levels.sort(key=lambda x: x["count"], reverse=True)

        result = {
            "servers": servers,
            "file_types": file_types,
            "filenames": filenames,
            "log_levels": log_levels
        }

        _filter_cache = result
        _filter_cache_time = time.time()

        return result

@router.get("/metrics")
def get_dashboard_metrics(
    server_ids: Optional[str] = None,
    file_type: Optional[str] = None,
    filename: Optional[str] = None,
    log_level: Optional[str] = None,
    severity: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    start_time: Optional[str] = None,
    end_time: Optional[str] = None,
):
    """Aggregates forensic statistics, timelines, and distributions for the dashboard with multi-server, file_type, severity, and date range filters."""
    conditions = []
    params: List[Any] = []

    if server_ids and server_ids.strip() and server_ids.upper() != "ALL":
        sids = [int(s.strip()) for s in server_ids.split(",") if s.strip().isdigit()]
        if sids:
            placeholders = ",".join("?" * len(sids))
            conditions.append(f"e.server_id IN ({placeholders})")
            params.extend(sids)

    if file_type and file_type.strip() and file_type.upper() != "ALL":
        types = [t.strip().lower() for t in file_type.split(",")]
        placeholders = ",".join("?" * len(types))
        conditions.append(f"lf.file_type IN ({placeholders})")
        params.extend(types)

    if filename and filename.strip() and filename.upper() != "ALL":
        fns = [fn.strip() for fn in filename.split(",")]
        placeholders = ",".join("?" * len(fns))
        conditions.append(f"lf.filename IN ({placeholders})")
        params.extend(fns)

    # Severity / Log Level filter
    lvl = log_level or severity
    if lvl and lvl.strip() and lvl.upper() != "ALL":
        levels = [l.strip().upper() for l in lvl.split(",")]
        placeholders = ",".join("?" * len(levels))
        conditions.append(f"e.log_level IN ({placeholders})")
        params.extend(levels)

    # Date / Time filter
    st = start_time or start_date
    if st and st.strip():
        if len(st) == 10 and re.match(r"^\d{4}-\d{2}-\d{2}$", st):
            st = f"{st}T00:00:00.000Z"
        conditions.append("e.timestamp >= ?")
        params.append(st)

    et = end_time or end_date
    if et and et.strip():
        if len(et) == 10 and re.match(r"^\d{4}-\d{2}-\d{2}$", et):
            et = f"{et}T23:59:59.999Z"
        conditions.append("e.timestamp <= ?")
        params.append(et)

    filter_clause = "WHERE " + " AND ".join(conditions) if conditions else ""
    needs_file_join = bool(file_type and file_type.strip() and file_type.upper() != "ALL") or bool(filename and filename.strip() and filename.upper() != "ALL")

    # Detect server-only filtering (no date/level/file filters) — enables log_files pre-aggregation
    has_server_filter = bool(server_ids and server_ids.strip() and server_ids.upper() != "ALL")
    lvl = log_level or severity
    has_level_filter = bool(lvl and lvl.strip() and lvl.upper() != "ALL")
    has_date_filter = bool((start_time or start_date) and (start_time or start_date).strip()) or bool((end_time or end_date) and (end_time or end_date).strip())
    server_only_filter = has_server_filter and not has_level_filter and not has_date_filter and not needs_file_join

    # Serve from in-memory cache if default unfiltered dashboard query
    global _metrics_cache, _metrics_cache_time
    if not conditions:
        if _metrics_cache is not None and (time.time() - _metrics_cache_time) < 8.0:
            return _metrics_cache

    with db_read_session() as conn:
        cur = conn.cursor()

        # Overall summary (instant pre-aggregated computation when unfiltered)
        if not conditions:
            cur.execute("""
                SELECT 
                    COALESCE(SUM(entry_count), 0) as total_entries,
                    COALESCE(SUM(error_count), 0) as total_errors,
                    COALESCE(SUM(warn_count), 0) as total_warns,
                    COALESCE(SUM(entry_count - error_count - warn_count), 0) as total_infos,
                    COUNT(DISTINCT server_id) as active_servers,
                    COUNT(DISTINCT id) as total_files
                FROM log_files;
            """)
            summary = dict_from_row(cur.fetchone())
        elif server_only_filter:
            # Server-only filter: use log_files pre-aggregation (was 465ms, now <1ms)
            sids = [int(s.strip()) for s in server_ids.split(",") if s.strip().isdigit()]
            placeholders = ",".join("?" * len(sids))
            cur.execute(f"""
                SELECT 
                    COALESCE(SUM(entry_count), 0) as total_entries,
                    COALESCE(SUM(error_count), 0) as total_errors,
                    COALESCE(SUM(warn_count), 0) as total_warns,
                    COALESCE(SUM(entry_count - error_count - warn_count), 0) as total_infos,
                    COUNT(DISTINCT server_id) as active_servers,
                    COUNT(DISTINCT id) as total_files
                FROM log_files
                WHERE server_id IN ({placeholders});
            """, sids)
            summary = dict_from_row(cur.fetchone())
        elif needs_file_join:
            summary_query = f"""
                SELECT 
                    COUNT(*) as total_entries,
                    COALESCE(SUM(CASE WHEN e.log_level IN ('FATAL', 'ERROR') THEN 1 ELSE 0 END), 0) as total_errors,
                    COALESCE(SUM(CASE WHEN e.log_level = 'WARN' THEN 1 ELSE 0 END), 0) as total_warns,
                    COALESCE(SUM(CASE WHEN e.log_level = 'INFO' THEN 1 ELSE 0 END), 0) as total_infos,
                    COUNT(DISTINCT e.server_id) as active_servers,
                    COUNT(DISTINCT e.file_id) as total_files
                FROM log_entries e
                JOIN log_files lf ON e.file_id = lf.id
                {filter_clause};
            """
            cur.execute(summary_query, params)
            summary = dict_from_row(cur.fetchone())
        else:
            summary_query = f"""
                SELECT 
                    COUNT(*) as total_entries,
                    COALESCE(SUM(CASE WHEN e.log_level IN ('FATAL', 'ERROR') THEN 1 ELSE 0 END), 0) as total_errors,
                    COALESCE(SUM(CASE WHEN e.log_level = 'WARN' THEN 1 ELSE 0 END), 0) as total_warns,
                    COALESCE(SUM(CASE WHEN e.log_level = 'INFO' THEN 1 ELSE 0 END), 0) as total_infos,
                    COUNT(DISTINCT e.server_id) as active_servers,
                    COUNT(DISTINCT e.file_id) as total_files
                FROM log_entries e
                {filter_clause};
            """
            cur.execute(summary_query, params)
            summary = dict_from_row(cur.fetchone())

        # Server breakdown - pre-aggregated in log_files for sub-millisecond execution
        cur.execute("""
            SELECT 
                s.id as server_id,
                s.name as server_name,
                COALESCE(SUM(lf.entry_count), 0) as total_entries,
                COALESCE(SUM(lf.error_count), 0) as error_count,
                COALESCE(SUM(lf.warn_count), 0) as warn_count
            FROM servers s
            LEFT JOIN log_files lf ON s.id = lf.server_id
            GROUP BY s.id
            ORDER BY 
                CASE 
                    WHEN LOWER(TRIM(s.name)) = 'prod app1' THEN 1
                    WHEN LOWER(TRIM(s.name)) = 'prod app2' THEN 2
                    ELSE 3
                END ASC,
                LOWER(s.name) ASC;
        """)
        server_stats = dict_list_from_rows(cur.fetchall())

        now_utc = datetime.now(timezone.utc)
        seven_days_ago_iso = (now_utc - timedelta(days=7)).strftime("%Y-%m-%dT%H:%M:%S.000Z")

        # Top Error Clusters - Optimized CTE
        if filter_clause:
            top_err_join = f"{filter_clause} AND e.log_level IN ('FATAL', 'ERROR', 'WARN')"
            top_err_params = list(params)
        else:
            top_err_join = "WHERE e.timestamp >= ? AND e.log_level IN ('FATAL', 'ERROR', 'WARN')"
            top_err_params = [seven_days_ago_iso]

        top_err_query = f"""
            WITH top_clusters AS (
                SELECT e.error_hash, COUNT(*) as count, MIN(e.timestamp) as first_seen, MAX(e.timestamp) as last_seen, MAX(e.id) as sample_id
                FROM log_entries e
                {'JOIN log_files lf ON e.file_id = lf.id' if needs_file_join else ''}
                {top_err_join} AND e.error_hash IS NOT NULL
                GROUP BY e.error_hash
                ORDER BY count DESC
                LIMIT 8
            )
            SELECT t.error_hash, e.log_level, e.logger_name, e.message, t.count, t.first_seen, t.last_seen, s.name as server_name, lf.filename, lf.file_type
            FROM top_clusters t
            JOIN log_entries e ON t.sample_id = e.id
            JOIN servers s ON e.server_id = s.id
            JOIN log_files lf ON e.file_id = lf.id
            ORDER BY t.count DESC;
        """
        cur.execute(top_err_query, top_err_params)
        top_errors = dict_list_from_rows(cur.fetchall())

        # Hourly Distribution for Timeline Chart (last 7 days when unfiltered for instant chart render)
        if filter_clause:
            tl_clause = filter_clause
            tl_params = list(params)
        else:
            tl_clause = "WHERE e.timestamp >= ?"
            tl_params = [seven_days_ago_iso]

        if needs_file_join:
            timeline_query = f"""
                SELECT 
                    substr(e.timestamp, 1, 13) || ':00:00Z' as time_bucket,
                    SUM(CASE WHEN e.log_level IN ('FATAL', 'ERROR') THEN 1 ELSE 0 END) as errors,
                    SUM(CASE WHEN e.log_level = 'WARN' THEN 1 ELSE 0 END) as warns,
                    SUM(CASE WHEN e.log_level = 'INFO' THEN 1 ELSE 0 END) as infos,
                    COUNT(*) as total
                FROM log_entries e
                JOIN log_files lf ON e.file_id = lf.id
                {tl_clause}
                GROUP BY time_bucket
                ORDER BY time_bucket ASC
                LIMIT 200;
            """
        else:
            timeline_query = f"""
                SELECT 
                    substr(e.timestamp, 1, 13) || ':00:00Z' as time_bucket,
                    SUM(CASE WHEN e.log_level IN ('FATAL', 'ERROR') THEN 1 ELSE 0 END) as errors,
                    SUM(CASE WHEN e.log_level = 'WARN' THEN 1 ELSE 0 END) as warns,
                    SUM(CASE WHEN e.log_level = 'INFO' THEN 1 ELSE 0 END) as infos,
                    COUNT(*) as total
                FROM log_entries e
                {tl_clause}
                GROUP BY time_bucket
                ORDER BY time_bucket ASC
                LIMIT 200;
            """
        cur.execute(timeline_query, tl_params)
        timeline = dict_list_from_rows(cur.fetchall())

        result = {
            "summary": summary,
            "server_stats": server_stats,
            "top_errors": top_errors,
            "timeline": timeline
        }

        # Cache default view
        if not conditions:
            _metrics_cache = result
            _metrics_cache_time = time.time()

        return result

@router.get("/{entry_id}")
def get_log_entry(entry_id: int):
    """Retrieves full details and stack trace for a single log entry."""
    with db_read_session() as conn:
        cur = conn.cursor()
        cur.execute("""
            SELECT 
                e.*, s.name as server_name, s.host, lf.filename, lf.file_type
            FROM log_entries e
            JOIN servers s ON e.server_id = s.id
            JOIN log_files lf ON e.file_id = lf.id
            WHERE e.id = ?;
        """, (entry_id,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Log entry not found")
        return dict_from_row(row)

@router.delete("/clear-all")
def clear_all_logs():
    """Wipes all log entries, files, and FTS tables from SQLite."""
    invalidate_metrics_cache()
    with db_session() as conn:
        conn.execute("DELETE FROM log_entries;")
        conn.execute("DELETE FROM log_files;")
        conn.execute("DELETE FROM analysis_reports;")
        conn.execute("UPDATE servers SET last_sync_at=NULL, status='configured';")
    return {"success": True, "message": "All log entries and index tables cleared successfully."}
