# -*- coding: utf-8 -*-
import asyncio
import time
from datetime import datetime, timezone, timedelta
from typing import Dict, Any, Optional, List
from ..db.database import db_session, db_read_session, dict_from_row, dict_list_from_rows
from .tririga_collector import TririgaCollector
from ..api.logs import invalidate_metrics_cache

class LogSchedulerService:
    """
    Automated background worker for recurring TRIRIGA log harvesting and amalgamation.
    Defaults to 15-minute intervals with persistent configuration and live re-arming.
    """
    _task: Optional[asyncio.Task] = None
    _wake_event: Optional[asyncio.Event] = None
    _lock: Optional[asyncio.Lock] = None
    _is_running: bool = False

    @classmethod
    def _get_wake_event(cls) -> asyncio.Event:
        if cls._wake_event is None:
            cls._wake_event = asyncio.Event()
        return cls._wake_event

    @classmethod
    def _get_lock(cls) -> asyncio.Lock:
        if cls._lock is None:
            cls._lock = asyncio.Lock()
        return cls._lock

    @classmethod
    def get_schedule(cls) -> Dict[str, Any]:
        """Reads current ingestion schedule configuration and live status from SQLite."""
        with db_read_session() as conn:
            cur = conn.cursor()
            cur.execute("SELECT * FROM ingestion_schedule WHERE id=1;")
            row = cur.fetchone()
            if not row:
                return {
                    "is_enabled": True,
                    "interval_minutes": 15,
                    "last_run_at": None,
                    "next_run_at": None,
                    "last_status": "pending",
                    "last_summary": "Automated 15-minute log ingestion enabled.",
                    "is_running": cls._is_running
                }
            data = dict_from_row(row)
            return {
                "is_enabled": bool(data.get("is_enabled", 1)),
                "interval_minutes": int(data.get("interval_minutes", 15)),
                "last_run_at": data.get("last_run_at"),
                "next_run_at": data.get("next_run_at"),
                "last_status": "running" if cls._is_running else data.get("last_status", "pending"),
                "last_summary": data.get("last_summary"),
                "is_running": cls._is_running,
                "updated_at": data.get("updated_at")
            }

    @classmethod
    def update_schedule(cls, is_enabled: Optional[bool] = None, interval_minutes: Optional[int] = None) -> Dict[str, Any]:
        """Updates schedule frequency and enabled status in SQLite, re-arming the scheduler loop."""
        current = cls.get_schedule()
        new_enabled = current["is_enabled"] if is_enabled is None else bool(is_enabled)
        new_interval = current["interval_minutes"] if interval_minutes is None else max(1, int(interval_minutes))

        now_utc = datetime.now(timezone.utc)
        next_run = (now_utc + timedelta(minutes=new_interval)).isoformat() if new_enabled else None

        with db_session() as conn:
            cur = conn.cursor()
            cur.execute("""
                UPDATE ingestion_schedule 
                SET is_enabled = ?, interval_minutes = ?, next_run_at = ?, updated_at = datetime('now', 'utc')
                WHERE id = 1;
            """, (1 if new_enabled else 0, new_interval, next_run))

        # Wake up the scheduler loop immediately
        wake = cls._get_wake_event()
        wake.set()

        return cls.get_schedule()

    @classmethod
    async def execute_ingestion_cycle(cls, triggered_by: str = "schedule") -> Dict[str, Any]:
        """
        Executes a harvest & amalgamation cycle across all configured TRIRIGA nodes.
        Guarantees non-overlapping execution with thread/coroutine lock.
        """
        lock = cls._get_lock()
        if lock.locked():
            return {
                "success": False,
                "message": "Log ingestion cycle is already in progress.",
                "is_running": True
            }

        async with lock:
            cls._is_running = True
            t0 = time.perf_counter()
            start_iso = datetime.now(timezone.utc).isoformat()

            # Mark running in DB
            with db_session() as conn:
                conn.execute("""
                    UPDATE ingestion_schedule 
                    SET last_status = 'running', updated_at = datetime('now', 'utc')
                    WHERE id = 1;
                """)

            try:
                with db_read_session() as conn:
                    cur = conn.cursor()
                    cur.execute("SELECT id, name FROM servers ORDER BY id ASC;")
                    servers = dict_list_from_rows(cur.fetchall())

                total_entries = 0
                total_errors = 0
                total_warns = 0
                server_results: List[Dict[str, Any]] = []

                print(f"[AUTO-INGESTION] Triggered ({triggered_by}) across {len(servers)} cluster nodes...", flush=True)

                for s in servers:
                    sid = s["id"]
                    sname = s.get("name") or f"Server #{sid}"
                    try:
                        res = await TririgaCollector.run_sync_job(sid)
                        e_count = res.get("total_entries", 0)
                        err_count = res.get("total_errors", 0)
                        warn_count = res.get("total_warns", 0)

                        total_entries += e_count
                        total_errors += err_count
                        total_warns += warn_count

                        server_results.append({
                            "server_id": sid,
                            "server_name": sname,
                            "success": res.get("success", False),
                            "entries": e_count,
                            "errors": err_count
                        })
                        print(f"[AUTO-INGESTION] Node '{sname}' synced: {e_count:,} entries ({err_count} errs, {warn_count} warns)", flush=True)
                    except Exception as exc:
                        server_results.append({
                            "server_id": sid,
                            "server_name": sname,
                            "success": False,
                            "error": str(exc)
                        })
                        print(f"[AUTO-INGESTION ERROR] Node '{sname}' failed: {exc}", flush=True)

                dur_s = round(time.perf_counter() - t0, 1)

                # Invalidate dashboard metrics cache
                try:
                    invalidate_metrics_cache()
                except Exception:
                    pass

                sched = cls.get_schedule()
                interval_min = sched.get("interval_minutes", 15)
                now_utc = datetime.now(timezone.utc)
                next_run_iso = (now_utc + timedelta(minutes=interval_min)).isoformat() if sched.get("is_enabled") else None

                summary = (
                    f"Harvested {total_entries:,} logs ({total_errors:,} errors) "
                    f"across {len(servers)} nodes in {dur_s}s. Next run in {interval_min}m."
                )

                with db_session() as conn:
                    cur = conn.cursor()
                    cur.execute("""
                        UPDATE ingestion_schedule 
                        SET last_run_at = ?, next_run_at = ?, last_status = 'success', last_summary = ?, updated_at = datetime('now', 'utc')
                        WHERE id = 1;
                    """, (start_iso, next_run_iso, summary))

                # Automated Rolling Retention Check (runs daily in background if enabled)
                try:
                    from .log_storage_service import LogStorageService
                    st_cfg = LogStorageService.get_settings()
                    if st_cfg.get("auto_prune_enabled", True):
                        last_pruned = st_cfg.get("last_pruned_at")
                        should_prune = False
                        if not last_pruned:
                            should_prune = True
                        else:
                            try:
                                lp_dt = datetime.fromisoformat(last_pruned.replace("Z", "+00:00"))
                                if lp_dt.tzinfo is None:
                                    lp_dt = lp_dt.replace(tzinfo=timezone.utc)
                                if (datetime.now(timezone.utc) - lp_dt).total_seconds() > 86400:
                                    should_prune = True
                            except Exception:
                                should_prune = True

                        if should_prune:
                            ret_days = st_cfg.get("retention_days", 7)
                            print(f"[AUTO-RETENTION] Running scheduled {ret_days}-day log offload & DB compaction...", flush=True)
                            LogStorageService.archive_and_prune(retention_days=ret_days)
                except Exception as prune_err:
                    print(f"[AUTO-RETENTION ERROR] {prune_err}", flush=True)

                print(f"[AUTO-INGESTION] Complete: {summary}", flush=True)

                return {
                    "success": True,
                    "duration_seconds": dur_s,
                    "total_entries": total_entries,
                    "total_errors": total_errors,
                    "servers_synced": len(servers),
                    "summary": summary,
                    "details": server_results,
                    "next_run_at": next_run_iso
                }

            except Exception as exc:
                dur_s = round(time.perf_counter() - t0, 1)
                err_msg = f"Scheduled ingestion error after {dur_s}s: {str(exc)}"
                print(f"[AUTO-INGESTION ERROR] {err_msg}", flush=True)

                with db_session() as conn:
                    conn.execute("""
                        UPDATE ingestion_schedule 
                        SET last_status = 'failed', last_summary = ?, updated_at = datetime('now', 'utc')
                        WHERE id = 1;
                    """, (err_msg,))

                return {
                    "success": False,
                    "error": err_msg
                }

            finally:
                cls._is_running = False

    @classmethod
    async def _scheduler_loop(cls):
        """Infinite asynchronous loop executing at the configured interval."""
        # Initial delay on application startup (10s) to allow FastAPI, DB, and network ports to settle
        await asyncio.sleep(10.0)

        wake = cls._get_wake_event()

        while True:
            try:
                sched = cls.get_schedule()
                if not sched.get("is_enabled"):
                    # Sleep until woken up by settings update
                    wake.clear()
                    try:
                        await asyncio.wait_for(wake.wait(), timeout=60.0)
                    except asyncio.TimeoutError:
                        pass
                    continue

                interval_min = max(1, sched.get("interval_minutes", 15))
                next_run_str = sched.get("next_run_at")
                now_utc = datetime.now(timezone.utc)

                should_run = False
                seconds_left = float(interval_min * 60)
                if not next_run_str:
                    should_run = True
                else:
                    try:
                        # Parse ISO string
                        clean_str = next_run_str.replace("Z", "+00:00")
                        next_run_dt = datetime.fromisoformat(clean_str)
                        if next_run_dt.tzinfo is None:
                            next_run_dt = next_run_dt.replace(tzinfo=timezone.utc)
                        
                        if now_utc >= next_run_dt:
                            should_run = True
                        else:
                            seconds_left = max(1.0, (next_run_dt - now_utc).total_seconds())
                    except Exception:
                        should_run = True

                if should_run:
                    await cls.execute_ingestion_cycle("15-minute-schedule")
                    continue

                # Wait until next run or until woken up early by user action
                wait_seconds = min(seconds_left, 15.0)
                wake.clear()
                try:
                    await asyncio.wait_for(wake.wait(), timeout=wait_seconds)
                except asyncio.TimeoutError:
                    pass

            except asyncio.CancelledError:
                break
            except Exception as exc:
                print(f"[AUTO-INGESTION LOOP ERROR] {exc}", flush=True)
                await asyncio.sleep(15.0)

    @classmethod
    def start(cls):
        """Starts the background worker task."""
        if cls._task is None or cls._task.done():
            cls._get_wake_event().clear()
            cls._task = asyncio.create_task(cls._scheduler_loop())
            print("[AUTO-INGESTION] Recurring 15-minute log ingestion worker started.", flush=True)

    @classmethod
    def stop(cls):
        """Cancels and stops the background worker task."""
        if cls._task and not cls._task.done():
            cls._task.cancel()
            cls._task = None
            print("[AUTO-INGESTION] Log ingestion worker stopped.", flush=True)
