import asyncio
import json
from fastapi import APIRouter, HTTPException, UploadFile, File, Form, BackgroundTasks
from sse_starlette.sse import EventSourceResponse
from typing import List, Optional, Dict, Any
from pydantic import BaseModel
from ..db.database import db_session, dict_from_row, dict_list_from_rows
from ..services.tririga_collector import TririgaCollector
from ..services.log_amalgamator import LogAmalgamator
from ..config import settings
from .logs import invalidate_metrics_cache

router = APIRouter(prefix="/api/collector", tags=["Log Collector"])

@router.post("/sync/{server_id}")
async def trigger_sync(server_id: int):
    """Triggers an asynchronous log download and amalgamation sync job for a single server."""
    try:
        result = await TririgaCollector.run_sync_job(server_id)
        invalidate_metrics_cache()
        if not result.get("success", False):
            err = result.get("error", "Sync failed")
            status_code = 404 if "not found" in err.lower() else 400
            raise HTTPException(status_code=status_code, detail=err)
        return result
    except HTTPException:
        raise
    except Exception as exc:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Sync execution error: {str(exc)}")

@router.post("/sync-all")
async def trigger_sync_all():
    """Triggers log collection and amalgamation across all configured TRIRIGA servers."""
    with db_session() as conn:
        cur = conn.cursor()
        cur.execute("SELECT id, name FROM servers;")
        servers = dict_list_from_rows(cur.fetchall())

    results = []
    for s in servers:
        res = await TririgaCollector.run_sync_job(s["id"])
        results.append({"server_id": s["id"], "server_name": s["name"], "result": res})
    invalidate_metrics_cache()
    return {"success": True, "servers_synced": len(results), "details": results}

@router.get("/stream-sync/{server_id}")
async def stream_sync(server_id: int):
    """Streams real-time log ingestion terminal progress via Server-Sent Events."""
    with db_session() as conn:
        cur = conn.cursor()
        cur.execute("SELECT id FROM servers WHERE id=?", (server_id,))
        if not cur.fetchone():
            raise HTTPException(status_code=404, detail=f"Server with ID {server_id} not found")

    async def event_generator():
        queue = asyncio.Queue()

        async def status_callback(msg: str):
            await queue.put(msg)

        async def run_pipeline():
            try:
                await TririgaCollector.run_sync_job(server_id, status_callback=status_callback)
            except Exception as e:
                await queue.put(f"ERROR: {str(e)}")
            finally:
                await queue.put("[DONE]")

        asyncio.create_task(run_pipeline())

        while True:
            msg = await queue.get()
            if msg == "[DONE]":
                yield {"data": json.dumps({"status": "complete", "message": "Log extraction and amalgamation completed."})}
                break
            yield {"data": json.dumps({"status": "progress", "message": msg})}

    return EventSourceResponse(event_generator())

@router.post("/upload-log")
async def upload_log(
    server_id: int = Form(...),
    file_type: str = Form("server"),
    file: UploadFile = File(...)
):
    """Allows manual upload of a TRIRIGA log file directly from user disk."""
    content_bytes = await file.read()
    content_str = content_bytes.decode("utf-8", errors="replace")

    server_dir = settings.logs_storage_dir / f"server_{server_id}"
    server_dir.mkdir(parents=True, exist_ok=True)
    local_path = server_dir / file.filename

    with open(local_path, "w", encoding="utf-8") as f:
        f.write(content_str)

    with db_session() as conn:
        cur = conn.cursor()
        cur.execute("SELECT id FROM servers WHERE id=?", (server_id,))
        if not cur.fetchone():
            raise HTTPException(status_code=404, detail="Server not found")

        cur.execute("SELECT id FROM log_files WHERE server_id=? AND filename=?", (server_id, file.filename))
        existing = cur.fetchone()
        if existing:
            file_id = existing[0]
            cur.execute("DELETE FROM log_entries WHERE file_id=?", (file_id,))
            cur.execute("""
                UPDATE log_files
                SET local_path=?, size_bytes=?, downloaded_at=datetime('now', 'utc'), status='parsing'
                WHERE id=?
            """, (str(local_path), len(content_bytes), file_id))
        else:
            cur.execute("""
                INSERT INTO log_files (server_id, filename, file_type, local_path, size_bytes, downloaded_at, status)
                VALUES (?, ?, ?, ?, ?, datetime('now', 'utc'), 'parsing')
            """, (server_id, file.filename, file_type, str(local_path), len(content_bytes)))
            file_id = cur.lastrowid

        ingest_res = LogAmalgamator.ingest_file(conn, server_id, file_id, content_str)
        cur.execute("UPDATE servers SET last_sync_at=datetime('now', 'utc') WHERE id=?", (server_id,))

    invalidate_metrics_cache()
    return {
        "success": True,
        "filename": file.filename,
        "entries_ingested": ingest_res["total"],
        "errors": ingest_res["errors"],
        "warns": ingest_res["warns"]
    }

@router.get("/files")
def get_ingested_files():
    """Returns a list of all ingested log files across servers with entry counts, error counts, sizes, and timestamps."""
    with db_session() as conn:
        cur = conn.cursor()
        cur.execute("""
            SELECT 
                lf.id, lf.server_id, lf.filename, lf.file_type, lf.local_path,
                lf.size_bytes, lf.downloaded_at, lf.status, lf.entry_count,
                lf.error_count, lf.warn_count,
                s.name as server_name, s.host, s.port
            FROM log_files lf
            JOIN servers s ON lf.server_id = s.id
            ORDER BY lf.downloaded_at DESC, lf.id DESC;
        """)
        return dict_list_from_rows(cur.fetchall())


class ScheduleUpdateRequest(BaseModel):
    is_enabled: Optional[bool] = None
    interval_minutes: Optional[int] = None


@router.get("/schedule")
def get_ingestion_schedule():
    """Returns the persistent 15-minute automated log ingestion schedule and execution status."""
    from ..services.log_scheduler import LogSchedulerService
    return LogSchedulerService.get_schedule()


@router.post("/schedule")
def update_ingestion_schedule(req: ScheduleUpdateRequest):
    """Updates automated ingestion schedule enabled status or frequency (in minutes)."""
    from ..services.log_scheduler import LogSchedulerService
    return LogSchedulerService.update_schedule(
        is_enabled=req.is_enabled,
        interval_minutes=req.interval_minutes
    )


@router.post("/schedule/run-now")
async def trigger_schedule_run_now():
    """Triggers an immediate scheduled log harvest across all nodes."""
    from ..services.log_scheduler import LogSchedulerService
    result = await LogSchedulerService.execute_ingestion_cycle(triggered_by="manual_override")
    return {
        "result": result,
        "schedule": LogSchedulerService.get_schedule()
    }

