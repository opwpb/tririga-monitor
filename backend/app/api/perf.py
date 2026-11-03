# -*- coding: utf-8 -*-
import time
import os
import sqlite3
from collections import deque
from typing import Dict, Any, List
from fastapi import APIRouter
from ..db.database import get_db_connection, db_read_session
from ..config import settings

router = APIRouter(prefix="/api/perf", tags=["Performance Monitoring"])

# Ring buffer storing recent request performance samples (up to 200)
_recent_requests = deque(maxlen=200)
_endpoint_stats: Dict[str, Dict[str, Any]] = {}
_server_start_time = time.time()

def record_request_perf(method: str, path: str, status_code: int, duration_ms: float):
    """Records a single request's timing for performance analytics."""
    sample = {
        "timestamp": time.time(),
        "method": method,
        "path": path,
        "status_code": status_code,
        "duration_ms": round(duration_ms, 2)
    }
    _recent_requests.append(sample)

    # Normalize path for aggregation (remove numeric IDs)
    normalized = path
    parts = path.strip("/").split("/")
    if len(parts) > 1 and parts[-1].isdigit():
        normalized = "/" + "/".join(parts[:-1]) + "/:id"

    key = f"{method} {normalized}"
    if key not in _endpoint_stats:
        _endpoint_stats[key] = {
            "endpoint": key,
            "count": 0,
            "total_ms": 0.0,
            "min_ms": float("inf"),
            "max_ms": 0.0,
            "slow_count": 0,
            "recent_ms": round(duration_ms, 2),
            "recent_history": deque(maxlen=10)
        }

    stat = _endpoint_stats[key]
    stat["count"] += 1
    stat["total_ms"] += duration_ms
    stat["min_ms"] = min(stat["min_ms"], round(duration_ms, 2))
    stat["max_ms"] = max(stat["max_ms"], round(duration_ms, 2))
    stat["recent_ms"] = round(duration_ms, 2)
    if "recent_history" not in stat:
        stat["recent_history"] = deque(maxlen=10)
    stat["recent_history"].append(duration_ms)
    if duration_ms > 300:
        stat["slow_count"] += 1

@router.post("/reset")
def reset_perf_metrics() -> Dict[str, Any]:
    """Resets all recorded latency statistics, ring buffers, and counters."""
    _endpoint_stats.clear()
    _recent_requests.clear()
    return {"success": True, "message": "Performance metrics have been reset."}

@router.get("/metrics")
def get_perf_metrics() -> Dict[str, Any]:
    """Returns comprehensive real-time performance diagnostics across server, database, and endpoints."""
    uptime_sec = round(time.time() - _server_start_time, 1)

    # Process Memory
    mem_mb = 0.0
    try:
        import psutil
        process = psutil.Process(os.getpid())
        mem_mb = round(process.memory_info().rss / (1024 * 1024), 1)
    except Exception:
        # Fallback for Windows without psutil
        try:
            import ctypes
            from ctypes import wintypes
            class PROCESS_MEMORY_COUNTERS(ctypes.Structure):
                _fields_ = [
                    ("cb", wintypes.DWORD),
                    ("PageFaultCount", wintypes.DWORD),
                    ("PeakWorkingSetSize", ctypes.c_size_t),
                    ("WorkingSetSize", ctypes.c_size_t),
                    ("QuotaPeakPagedPoolUsage", ctypes.c_size_t),
                    ("QuotaPagedPoolUsage", ctypes.c_size_t),
                    ("QuotaPeakNonPagedPoolUsage", ctypes.c_size_t),
                    ("QuotaNonPagedPoolUsage", ctypes.c_size_t),
                    ("PagefileUsage", ctypes.c_size_t),
                    ("PeakPagefileUsage", ctypes.c_size_t)
                ]
            counters = PROCESS_MEMORY_COUNTERS()
            counters.cb = ctypes.sizeof(PROCESS_MEMORY_COUNTERS)
            handle = ctypes.windll.kernel32.GetCurrentProcess()
            if ctypes.windll.psapi.GetProcessMemoryInfo(handle, ctypes.byref(counters), counters.cb):
                mem_mb = round(counters.WorkingSetSize / (1024 * 1024), 1)
        except Exception:
            mem_mb = 0.0

    # DB File Stats & Fast Benchmark
    db_size_mb = 0.0
    db_benchmark = {}
    total_entries = 0
    try:
        if settings.db_path.exists():
            db_size_mb = round(settings.db_path.stat().st_size / (1024 * 1024), 2)

        with db_read_session() as conn:
            # 1. Count query benchmark
            t0 = time.perf_counter()
            count_res = conn.execute("SELECT COUNT(*) FROM log_entries").fetchone()
            total_entries = count_res[0] if count_res else 0
            count_ms = round((time.perf_counter() - t0) * 1000, 2)

            # 2. Filtered summary benchmark
            t0 = time.perf_counter()
            conn.execute("""
                SELECT 
                    COUNT(*),
                    COALESCE(SUM(CASE WHEN log_level IN ('FATAL', 'ERROR') THEN 1 ELSE 0 END), 0)
                FROM log_entries
            """).fetchone()
            summary_ms = round((time.perf_counter() - t0) * 1000, 2)

            # 3. Time-window query benchmark (indexed)
            t0 = time.perf_counter()
            conn.execute("SELECT id, timestamp, log_level FROM log_entries ORDER BY id DESC LIMIT 50").fetchall()
            recent_ms = round((time.perf_counter() - t0) * 1000, 2)

            db_benchmark = {
                "count_query_ms": count_ms,
                "summary_query_ms": summary_ms,
                "indexed_read_ms": recent_ms,
                "total_entries": total_entries,
                "db_size_mb": db_size_mb
            }
    except Exception as e:
        db_benchmark = {"error": str(e)}

    # Aggregated endpoint performance list
    endpoints = []
    total_reqs = 0
    total_latency = 0.0
    slow_reqs = 0

    for ep, data in _endpoint_stats.items():
        avg_ms = round(data["total_ms"] / data["count"], 2) if data["count"] > 0 else 0
        hist = list(data.get("recent_history", []))
        recent_avg = round(sum(hist) / len(hist), 2) if hist else avg_ms
        endpoints.append({
            "endpoint": ep,
            "requests": data["count"],
            "avg_ms": avg_ms,
            "recent_ms": data.get("recent_ms", avg_ms),
            "recent_avg_ms": recent_avg,
            "min_ms": data["min_ms"],
            "max_ms": data["max_ms"],
            "slow_count": data["slow_count"]
        })
        total_reqs += data["count"]
        total_latency += data["total_ms"]
        slow_reqs += data["slow_count"]

    endpoints.sort(key=lambda x: x["avg_ms"], reverse=True)
    overall_avg_ms = round(total_latency / total_reqs, 2) if total_reqs > 0 else 0.0

    # Bottleneck analysis
    bottlenecks = []
    if db_size_mb > 500:
        bottlenecks.append(f"Large database size ({db_size_mb} MB). VACUUM or log retention purge recommended.")
    if db_benchmark.get("summary_query_ms", 0) > 150:
        bottlenecks.append(f"Full table scan is taking {db_benchmark['summary_query_ms']}ms. Consider narrowing date filters.")
    if slow_reqs > 0:
        bottlenecks.append(f"{slow_reqs} request(s) took over 300ms to complete.")
    if not bottlenecks:
        bottlenecks.append("No active bottlenecks detected. SQLite memory-mapped I/O and caching are optimal.")

    return {
        "status": "healthy",
        "uptime_seconds": uptime_sec,
        "memory_rss_mb": mem_mb,
        "overall": {
            "total_requests": total_reqs,
            "avg_latency_ms": overall_avg_ms,
            "slow_requests_count": slow_reqs
        },
        "database": db_benchmark,
        "endpoints": endpoints,
        "bottlenecks": bottlenecks,
        "recent_samples": list(_recent_requests)[-30:]
    }
