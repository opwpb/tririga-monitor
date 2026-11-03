# -*- coding: utf-8 -*-
import os
import re
import json
import gzip
import time
import shutil
from pathlib import Path
from datetime import datetime, timezone, timedelta
from typing import List, Dict, Any, Optional, Tuple, Generator
import sqlite3

from ..config import settings
from ..db.database import get_db_connection, db_session, db_read_session, dict_from_row, dict_list_from_rows
from ..api.logs import invalidate_metrics_cache

class LogStorageService:
    """
    Tiered Log Storage & Retention Service.
    - Manages live SQLite hot analysis tier (< 7 days).
    - Offloads older logs to compressed cold storage (.jsonl.gz) in data/archives/.
    - Provides fast sub-second automated retrieval across cold archives.
    - Reclaims disk space and compacts SQLite database via VACUUM and FTS5 optimization.
    """

    @classmethod
    def get_settings(cls) -> Dict[str, Any]:
        """Reads current retention policy and storage settings."""
        with db_read_session() as conn:
            cur = conn.cursor()
            cur.execute("SELECT * FROM storage_settings WHERE id = 1;")
            row = cur.fetchone()
            if not row:
                return {
                    "retention_days": 7,
                    "auto_prune_enabled": True,
                    "compress_raw_logs": True,
                    "last_pruned_at": None,
                    "last_prune_summary": "Tiered storage enabled. 7-day retention window configured."
                }
            data = dict_from_row(row)
            return {
                "retention_days": int(data.get("retention_days", 7)),
                "auto_prune_enabled": bool(data.get("auto_prune_enabled", 1)),
                "compress_raw_logs": bool(data.get("compress_raw_logs", 1)),
                "last_pruned_at": data.get("last_pruned_at"),
                "last_prune_summary": data.get("last_prune_summary"),
                "updated_at": data.get("updated_at")
            }

    @classmethod
    def update_settings(
        cls,
        retention_days: Optional[int] = None,
        auto_prune_enabled: Optional[bool] = None,
        compress_raw_logs: Optional[bool] = None
    ) -> Dict[str, Any]:
        """Updates storage and retention settings."""
        current = cls.get_settings()
        new_retention = current["retention_days"] if retention_days is None else max(1, int(retention_days))
        new_auto = current["auto_prune_enabled"] if auto_prune_enabled is None else bool(auto_prune_enabled)
        new_compress = current["compress_raw_logs"] if compress_raw_logs is None else bool(compress_raw_logs)

        with db_session() as conn:
            conn.execute("""
                UPDATE storage_settings
                SET retention_days = ?, auto_prune_enabled = ?, compress_raw_logs = ?, updated_at = datetime('now', 'utc')
                WHERE id = 1;
            """, (new_retention, 1 if new_auto else 0, 1 if new_compress else 0))

        return cls.get_settings()

    @classmethod
    def get_storage_stats(cls, retention_days: Optional[int] = None) -> Dict[str, Any]:
        """Calculates live DB file size, cold archive stats, live entries vs offloadable entries."""
        cfg = cls.get_settings()
        eff_retention = retention_days if retention_days is not None else cfg["retention_days"]

        cutoff_dt = datetime.now(timezone.utc) - timedelta(days=eff_retention)
        cutoff_iso = cutoff_dt.strftime("%Y-%m-%dT%H:%M:%S.000Z")

        # Database File metrics
        db_path = settings.db_path
        db_size_bytes = db_path.stat().st_size if db_path.exists() else 0
        wal_path = Path(f"{db_path}-wal")
        wal_size_bytes = wal_path.stat().st_size if wal_path.exists() else 0
        total_live_db_bytes = db_size_bytes + wal_size_bytes

        # Archives folder metrics
        archives_dir = settings.archives_storage_dir
        archives_dir.mkdir(parents=True, exist_ok=True)
        archive_files = list(archives_dir.glob("*.jsonl.gz"))
        total_archive_bytes = sum(f.stat().st_size for f in archive_files)

        # Raw Logs folder metrics
        raw_logs_dir = settings.logs_storage_dir
        raw_log_files = list(raw_logs_dir.rglob("*")) if raw_logs_dir.exists() else []
        total_raw_bytes = sum(f.stat().st_size for f in raw_log_files if f.is_file())

        with db_read_session() as conn:
            cur = conn.cursor()

            # Entry counts
            cur.execute("SELECT COUNT(*) FROM log_entries;")
            total_live_entries = cur.fetchone()[0]

            cur.execute("SELECT COUNT(*) FROM log_entries WHERE timestamp < ?;", (cutoff_iso,))
            offloadable_entries = cur.fetchone()[0]

            live_active_entries = total_live_entries - offloadable_entries

            # Timestamps
            cur.execute("SELECT MIN(timestamp), MAX(timestamp) FROM log_entries;")
            row_ts = cur.fetchone()
            oldest_live_log = row_ts[0] if row_ts else None
            newest_live_log = row_ts[1] if row_ts else None

            # Server breakdown
            cur.execute("""
                SELECT 
                    s.id, s.name,
                    COUNT(e.id) as total_entries,
                    SUM(CASE WHEN e.timestamp < ? THEN 1 ELSE 0 END) as offloadable_entries
                FROM servers s
                LEFT JOIN log_entries e ON s.id = e.server_id
                GROUP BY s.id
                ORDER BY s.id ASC;
            """, (cutoff_iso,))
            server_breakdown = [
                {
                    "server_id": r["id"],
                    "server_name": r["name"],
                    "total_entries": r["total_entries"],
                    "offloadable_entries": r["offloadable_entries"] or 0,
                    "live_active_entries": (r["total_entries"] or 0) - (r["offloadable_entries"] or 0)
                }
                for r in dict_list_from_rows(cur.fetchall())
            ]

            # Archives catalog count
            cur.execute("SELECT COUNT(*), COALESCE(SUM(entry_count), 0), COALESCE(SUM(size_bytes), 0) FROM log_archives;")
            arch_row = cur.fetchone()
            archived_total_count = arch_row[0] if arch_row else 0
            archived_records_count = arch_row[1] if arch_row else 0

        return {
            "retention_days": eff_retention,
            "cutoff_timestamp": cutoff_iso,
            "live_db_size_bytes": total_live_db_bytes,
            "live_db_size_mb": round(total_live_db_bytes / (1024 * 1024), 2),
            "cold_archives_size_bytes": total_archive_bytes,
            "cold_archives_size_mb": round(total_archive_bytes / (1024 * 1024), 2),
            "raw_logs_size_bytes": total_raw_bytes,
            "raw_logs_size_mb": round(total_raw_bytes / (1024 * 1024), 2),
            "total_live_entries": total_live_entries,
            "live_active_entries": live_active_entries,
            "offloadable_entries": offloadable_entries,
            "oldest_live_log": oldest_live_log,
            "newest_live_log": newest_live_log,
            "archive_packages_count": archived_total_count,
            "archived_records_total": archived_records_count,
            "server_breakdown": server_breakdown,
            "settings": cfg
        }

    @classmethod
    def archive_and_prune(
        cls,
        retention_days: Optional[int] = None,
        compress_raw_logs: Optional[bool] = None,
        status_callback = None
    ) -> Dict[str, Any]:
        """
        Offloads logs older than retention_days into a compressed .jsonl.gz archive,
        purges them from live SQLite DB, optimizes FTS5 index, and runs VACUUM to reclaim disk space.
        """
        t0 = time.perf_counter()
        cfg = cls.get_settings()
        eff_retention = retention_days if retention_days is not None else cfg["retention_days"]
        do_compress_raw = compress_raw_logs if compress_raw_logs is not None else cfg["compress_raw_logs"]

        cutoff_dt = datetime.now(timezone.utc) - timedelta(days=eff_retention)
        cutoff_iso = cutoff_dt.strftime("%Y-%m-%dT%H:%M:%S.000Z")

        db_path = settings.db_path
        initial_db_bytes = db_path.stat().st_size if db_path.exists() else 0

        # 1. Check count of aged entries first
        with db_read_session() as conn:
            cur = conn.cursor()
            cur.execute("SELECT COUNT(*) FROM log_entries WHERE timestamp < ?", (cutoff_iso,))
            aged_count = cur.fetchone()[0]

        if aged_count == 0:
            return {
                "success": True,
                "archived_entries": 0,
                "message": f"No logs older than {eff_retention} days found. Live database is already optimal.",
                "initial_db_size_mb": round(initial_db_bytes / (1024 * 1024), 2),
                "final_db_size_mb": round(initial_db_bytes / (1024 * 1024), 2),
                "bytes_freed_mb": 0.0,
                "duration_seconds": round(time.perf_counter() - t0, 2)
            }

        # 2. Stream to compressed Gzip JSON Lines in chunks (constant ~10MB RAM footprint)
        archives_dir = settings.archives_storage_dir
        archives_dir.mkdir(parents=True, exist_ok=True)
        ts_tag = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
        archive_filename = f"tririga_logs_archive_{ts_tag}_{eff_retention}d.jsonl.gz"
        archive_filepath = archives_dir / archive_filename

        min_ts = None
        max_ts = None
        error_count = 0
        warn_count = 0
        server_ids_set = set()
        server_names_set = set()
        total_archived = 0

        with gzip.open(archive_filepath, "wt", encoding="utf-8", compresslevel=4) as gz_out:
            with db_read_session() as conn:
                cur = conn.cursor()
                cur.execute("""
                    SELECT 
                        e.id, e.server_id, e.file_id, e.timestamp, e.log_level,
                        e.logger_name, e.thread_name, e.message, e.stack_trace,
                        e.error_hash, e.line_number, e.raw_content,
                        s.name as server_name, lf.filename, lf.file_type
                    FROM log_entries e
                    JOIN servers s ON e.server_id = s.id
                    JOIN log_files lf ON e.file_id = lf.id
                    WHERE e.timestamp < ?
                    ORDER BY e.timestamp ASC;
                """, (cutoff_iso,))

                while True:
                    chunk = cur.fetchmany(5000)
                    if not chunk:
                        break
                    for r in chunk:
                        row = dict_from_row(r)
                        if min_ts is None:
                            min_ts = row["timestamp"]
                        max_ts = row["timestamp"]
                        if row.get("log_level") in ("FATAL", "ERROR"):
                            error_count += 1
                        elif row.get("log_level") == "WARN":
                            warn_count += 1
                        server_ids_set.add(row["server_id"])
                        if row.get("server_name"):
                            server_names_set.add(row["server_name"])
                        gz_out.write(json.dumps(row, ensure_ascii=False) + "\n")
                        total_archived += 1

        archive_size_bytes = archive_filepath.stat().st_size

        # 3. Delete offloaded rows from live DB & record archive manifest in DB
        with db_session() as conn:
            cur = conn.cursor()

            # Record archive manifest
            cur.execute("""
                INSERT INTO log_archives (
                    filename, filepath, size_bytes, entry_count, error_count, warn_count,
                    min_timestamp, max_timestamp, server_ids, server_names, retention_days, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', 'utc'));
            """, (
                archive_filename,
                str(archive_filepath),
                archive_size_bytes,
                total_archived,
                error_count,
                warn_count,
                min_ts or cutoff_iso,
                max_ts or cutoff_iso,
                json.dumps(sorted(list(server_ids_set))),
                ", ".join(sorted(list(server_names_set))),
                eff_retention
            ))

            # Delete aged entries (FTS5 shadow tables auto-update via AFTER DELETE trigger)
            cur.execute("DELETE FROM log_entries WHERE timestamp < ?;", (cutoff_iso,))

            # Update entry_count on log_files
            cur.execute("""
                UPDATE log_files
                SET entry_count = (
                    SELECT COUNT(*) FROM log_entries WHERE log_entries.file_id = log_files.id
                ),
                error_count = (
                    SELECT COUNT(*) FROM log_entries WHERE log_entries.file_id = log_files.id AND log_level IN ('FATAL', 'ERROR')
                ),
                warn_count = (
                    SELECT COUNT(*) FROM log_entries WHERE log_entries.file_id = log_files.id AND log_level = 'WARN'
                );
            """)

            # Optimize FTS5 table
            try:
                cur.execute("INSERT INTO log_entries_fts(log_entries_fts) VALUES('optimize');")
            except Exception:
                pass

        # 4. Rotate / Compress raw log files if requested
        if do_compress_raw:
            cls._compress_raw_historical_files(cutoff_dt)

        # 5. Execute VACUUM outside active transaction to compact SQLite database on disk
        try:
            vac_conn = get_db_connection()
            vac_conn.isolation_level = None
            vac_conn.execute("VACUUM;")
            vac_conn.close()
        except Exception as e:
            print(f"[STORAGE] VACUUM error (non-fatal): {e}", flush=True)

        # Invalidate dashboard metrics cache
        invalidate_metrics_cache()

        final_db_bytes = db_path.stat().st_size if db_path.exists() else 0
        freed_bytes = max(0, initial_db_bytes - final_db_bytes)
        dur_s = round(time.perf_counter() - t0, 2)

        summary_msg = (
            f"Offloaded {len(rows):,} entries ({error_count:,} errors) older than {eff_retention} days into "
            f"{archive_filename} ({round(archive_size_bytes/1024, 1)} KB). "
            f"Database compacted from {round(initial_db_bytes/(1024*1024), 1)} MB to {round(final_db_bytes/(1024*1024), 1)} MB "
            f"(reclaimed {round(freed_bytes/(1024*1024), 1)} MB) in {dur_s}s."
        )

        with db_session() as conn:
            conn.execute("""
                UPDATE storage_settings
                SET last_pruned_at = datetime('now', 'utc'), last_prune_summary = ?, updated_at = datetime('now', 'utc')
                WHERE id = 1;
            """, (summary_msg,))

        print(f"[STORAGE] {summary_msg}", flush=True)

        return {
            "success": True,
            "archived_entries": len(rows),
            "errors_archived": error_count,
            "warns_archived": warn_count,
            "archive_filename": archive_filename,
            "archive_size_kb": round(archive_size_bytes / 1024, 1),
            "initial_db_size_mb": round(initial_db_bytes / (1024 * 1024), 2),
            "final_db_size_mb": round(final_db_bytes / (1024 * 1024), 2),
            "bytes_freed_mb": round(freed_bytes / (1024 * 1024), 2),
            "min_timestamp": min_ts,
            "max_timestamp": max_ts,
            "duration_seconds": dur_s,
            "summary": summary_msg
        }

    @classmethod
    def _compress_raw_historical_files(cls, cutoff_dt: datetime):
        """Gzip compresses historical raw log files older than cutoff."""
        try:
            raw_logs_dir = settings.logs_storage_dir
            if not raw_logs_dir.exists():
                return

            cutoff_ts = cutoff_dt.timestamp()
            for log_file in raw_logs_dir.rglob("*.log"):
                try:
                    if log_file.name in ("server.log", "security.log", "workflow.log", "datapool.log", "ObjectMigration.log"):
                        continue
                    mtime = log_file.stat().st_mtime
                    if mtime < cutoff_ts:
                        gz_target = log_file.with_suffix(".log.gz")
                        if not gz_target.exists():
                            with open(log_file, "rb") as f_in, gzip.open(gz_target, "wb", compresslevel=6) as f_out:
                                shutil.copyfileobj(f_in, f_out)
                            log_file.unlink()
                except Exception:
                    pass
        except Exception:
            pass

    @classmethod
    def search_archives(
        cls,
        search: Optional[str] = None,
        server_ids: Optional[List[int]] = None,
        log_level: Optional[str] = None,
        file_type: Optional[str] = None,
        filename: Optional[str] = None,
        start_time: Optional[str] = None,
        end_time: Optional[str] = None,
        limit: int = 50,
        offset: int = 0
    ) -> Dict[str, Any]:
        """
        Fast sub-second stream decompression and search across cold archives matching filters.
        Automatically searches all relevant .jsonl.gz packages.
        """
        t0 = time.perf_counter()
        archives_dir = settings.archives_storage_dir
        if not archives_dir.exists():
            return {"items": [], "total": 0, "duration_ms": 0.0}

        # 1. Query archive catalog for files overlapping date range and server IDs
        with db_read_session() as conn:
            cur = conn.cursor()
            cur.execute("SELECT * FROM log_archives ORDER BY max_timestamp DESC;")
            archives = dict_list_from_rows(cur.fetchall())

        target_archives: List[Dict[str, Any]] = []
        for a in archives:
            # Check server_ids overlap
            if server_ids:
                try:
                    a_sids = json.loads(a.get("server_ids") or "[]")
                    if not any(sid in server_ids for sid in a_sids):
                        continue
                except Exception:
                    pass

            # Check timestamp overlap
            if start_time and a.get("max_timestamp") and a["max_timestamp"] < start_time:
                continue
            if end_time and a.get("min_timestamp") and a["min_timestamp"] > end_time:
                continue

            target_archives.append(a)

        # 2. Search matching archive files
        matched_entries: List[Dict[str, Any]] = []
        total_matched = 0

        search_lower = search.strip().lower() if search and search.strip() else None
        level_filter = [l.strip().upper() for l in log_level.split(",")] if log_level and log_level.upper() != "ALL" else None
        file_type_filter = [t.strip().lower() for t in file_type.split(",")] if file_type and file_type.upper() != "ALL" else None
        filename_filter = [fn.strip().lower() for fn in filename.split(",")] if filename and filename.upper() != "ALL" else None

        for arch in target_archives:
            f_path = Path(arch["filepath"])
            if not f_path.exists():
                f_path = archives_dir / arch["filename"]
                if not f_path.exists():
                    continue

            try:
                with gzip.open(f_path, "rt", encoding="utf-8", errors="replace") as gz_in:
                    for line in gz_in:
                        if not line.strip():
                            continue
                        entry = json.loads(line)

                        # Filter timestamp
                        ts = entry.get("timestamp", "")
                        if start_time and ts < start_time:
                            continue
                        if end_time and ts > end_time:
                            continue

                        # Filter server_id
                        if server_ids and entry.get("server_id") not in server_ids:
                            continue

                        # Filter level
                        if level_filter and entry.get("log_level") not in level_filter:
                            continue

                        # Filter file_type
                        if file_type_filter and entry.get("file_type", "").lower() not in file_type_filter:
                            continue

                        # Filter filename
                        if filename_filter and entry.get("filename", "").lower() not in filename_filter:
                            continue

                        # Filter text query
                        if search_lower:
                            msg = (entry.get("message") or "").lower()
                            logger = (entry.get("logger_name") or "").lower()
                            thread = (entry.get("thread_name") or "").lower()
                            trace = (entry.get("stack_trace") or "").lower()
                            if search_lower not in msg and search_lower not in logger and search_lower not in thread and search_lower not in trace:
                                continue

                        total_matched += 1
                        # Collect results within pagination window
                        if len(matched_entries) < limit and total_matched > offset:
                            entry["is_archived"] = True
                            entry["archive_source"] = arch["filename"]
                            matched_entries.append(entry)

            except Exception as e:
                print(f"[STORAGE ARCHIVE SEARCH ERROR] Error reading {f_path.name}: {e}", flush=True)

        dur_ms = round((time.perf_counter() - t0) * 1000, 2)
        return {
            "items": matched_entries,
            "total": total_matched,
            "archives_searched": len(target_archives),
            "duration_ms": dur_ms
        }

    @classmethod
    def list_archives(cls) -> List[Dict[str, Any]]:
        """Returns list of cold archive files recorded in DB."""
        with db_read_session() as conn:
            cur = conn.cursor()
            cur.execute("""
                SELECT 
                    id, filename, filepath, size_bytes, entry_count, error_count, warn_count,
                    min_timestamp, max_timestamp, server_ids, server_names, retention_days, created_at
                FROM log_archives
                ORDER BY created_at DESC;
            """)
            archives = dict_list_from_rows(cur.fetchall())

            for a in archives:
                a["size_mb"] = round((a.get("size_bytes") or 0) / (1024 * 1024), 3)
                a["size_kb"] = round((a.get("size_bytes") or 0) / 1024, 1)

            return archives

    @classmethod
    def download_archive(cls, filename: str) -> Optional[Path]:
        """Returns the Path to an archive file for download."""
        archives_dir = settings.archives_storage_dir
        target = (archives_dir / filename).resolve()
        if target.exists() and str(target).startswith(str(archives_dir)):
            return target
        return None

    @classmethod
    def delete_archive(cls, filename_or_id: str) -> Dict[str, Any]:
        """Deletes a cold archive from disk and removes its catalog entry."""
        with db_session() as conn:
            cur = conn.cursor()
            if filename_or_id.isdigit():
                cur.execute("SELECT id, filename, filepath FROM log_archives WHERE id = ?;", (int(filename_or_id),))
            else:
                cur.execute("SELECT id, filename, filepath FROM log_archives WHERE filename = ?;", (filename_or_id,))
            row = cur.fetchone()
            if not row:
                return {"success": False, "message": "Archive not found."}

            arch_id = row["id"]
            arch_filename = row["filename"]
            arch_filepath = Path(row["filepath"])

            cur.execute("DELETE FROM log_archives WHERE id = ?;", (arch_id,))

        if arch_filepath.exists():
            try:
                arch_filepath.unlink()
            except Exception:
                pass
        else:
            fallback = settings.archives_storage_dir / arch_filename
            if fallback.exists():
                try:
                    fallback.unlink()
                except Exception:
                    pass

        return {"success": True, "message": f"Archive {arch_filename} deleted successfully."}

    @classmethod
    def restore_archive_to_live(cls, filename_or_id: str) -> Dict[str, Any]:
        """
        Restores entries from a cold archive back into live SQLite DB
        for detailed interactive live investigation or AI reporting.
        """
        t0 = time.perf_counter()
        with db_read_session() as conn:
            cur = conn.cursor()
            if filename_or_id.isdigit():
                cur.execute("SELECT * FROM log_archives WHERE id = ?;", (int(filename_or_id),))
            else:
                cur.execute("SELECT * FROM log_archives WHERE filename = ?;", (filename_or_id,))
            row = cur.fetchone()
            if not row:
                return {"success": False, "message": "Archive not found."}
            arch = dict_from_row(row)

        f_path = Path(arch["filepath"])
        if not f_path.exists():
            f_path = settings.archives_storage_dir / arch["filename"]
            if not f_path.exists():
                return {"success": False, "message": f"Archive file {arch['filename']} not found on disk."}

        restored_count = 0
        batch: List[Tuple] = []
        batch_size = 2000

        with db_session() as conn:
            cur = conn.cursor()
            with gzip.open(f_path, "rt", encoding="utf-8", errors="replace") as gz_in:
                for line in gz_in:
                    if not line.strip():
                        continue
                    entry = json.loads(line)
                    restored_count += 1
                    batch.append((
                        entry["server_id"],
                        entry["file_id"],
                        entry["timestamp"],
                        entry["log_level"],
                        entry.get("logger_name"),
                        entry.get("thread_name"),
                        entry["message"],
                        entry.get("stack_trace"),
                        entry.get("error_hash"),
                        entry.get("line_number"),
                        entry.get("raw_content")
                    ))

                    if len(batch) >= batch_size:
                        cur.executemany("""
                            INSERT INTO log_entries (
                                server_id, file_id, timestamp, log_level, logger_name,
                                thread_name, message, stack_trace, error_hash, line_number, raw_content
                            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
                        """, batch)
                        batch.clear()

                if batch:
                    cur.executemany("""
                        INSERT INTO log_entries (
                            server_id, file_id, timestamp, log_level, logger_name,
                            thread_name, message, stack_trace, error_hash, line_number, raw_content
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
                    """, batch)
                    batch.clear()

        invalidate_metrics_cache()
        dur_s = round(time.perf_counter() - t0, 2)
        summary = f"Restored {restored_count:,} log entries from {arch['filename']} into live analysis table in {dur_s}s."
        print(f"[STORAGE RESTORE] {summary}", flush=True)

        return {
            "success": True,
            "restored_entries": restored_count,
            "archive_filename": arch["filename"],
            "duration_seconds": dur_s,
            "message": summary
        }
