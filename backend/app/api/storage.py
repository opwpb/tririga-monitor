# -*- coding: utf-8 -*-
from fastapi import APIRouter, HTTPException, Query, Body
from fastapi.responses import FileResponse
from typing import Optional, List, Dict, Any
from pydantic import BaseModel

from ..services.log_storage_service import LogStorageService

router = APIRouter(prefix="/api/storage", tags=["Storage & Log Retention"])

class UpdateStorageSettingsRequest(BaseModel):
    retention_days: Optional[int] = None
    auto_prune_enabled: Optional[bool] = None
    compress_raw_logs: Optional[bool] = None

class ArchivePruneRequest(BaseModel):
    retention_days: Optional[int] = None
    compress_raw_logs: Optional[bool] = True

@router.get("/stats")
def get_storage_stats(retention_days: Optional[int] = Query(None, ge=1, le=365)):
    """Returns detailed statistics on Live SQLite database, cold archives, and offloadable records."""
    return LogStorageService.get_storage_stats(retention_days=retention_days)

@router.get("/settings")
def get_storage_settings():
    """Returns current log retention and storage settings."""
    return LogStorageService.get_settings()

@router.post("/settings")
def update_storage_settings(body: UpdateStorageSettingsRequest):
    """Updates log retention days and auto-prune policy."""
    return LogStorageService.update_settings(
        retention_days=body.retention_days,
        auto_prune_enabled=body.auto_prune_enabled,
        compress_raw_logs=body.compress_raw_logs
    )

@router.post("/archive-and-prune")
def run_archive_and_prune(body: Optional[ArchivePruneRequest] = None):
    """
    Offloads logs older than the retention window into a compressed .jsonl.gz archive,
    deletes them from live SQLite tables, and runs SQLite VACUUM to reclaim disk space.
    """
    ret_days = body.retention_days if body else None
    compress_raw = body.compress_raw_logs if body else True
    return LogStorageService.archive_and_prune(retention_days=ret_days, compress_raw_logs=compress_raw)

@router.get("/archives")
def list_archives():
    """Lists all historical cold archive files and their metadata."""
    return LogStorageService.list_archives()

@router.get("/archives/{filename}/download")
def download_archive(filename: str):
    """Downloads a historical compressed .jsonl.gz archive bundle."""
    target_path = LogStorageService.download_archive(filename)
    if not target_path or not target_path.exists():
        raise HTTPException(status_code=404, detail="Archive file not found.")
    return FileResponse(
        target_path,
        media_type="application/gzip",
        filename=filename
    )

@router.delete("/archives/{filename}")
def delete_archive(filename: str):
    """Permanently deletes a cold archive file."""
    res = LogStorageService.delete_archive(filename)
    if not res.get("success"):
        raise HTTPException(status_code=404, detail=res.get("message", "Archive not found."))
    return res

@router.post("/archives/{filename}/restore")
def restore_archive(filename: str):
    """Restores records from a cold archive back into live SQLite analysis tables."""
    res = LogStorageService.restore_archive_to_live(filename)
    if not res.get("success"):
        raise HTTPException(status_code=400, detail=res.get("message", "Failed to restore archive."))
    return res

@router.get("/search-archives")
def search_cold_archives(
    search: Optional[str] = None,
    server_ids: Optional[str] = None,
    log_level: Optional[str] = None,
    file_type: Optional[str] = None,
    filename: Optional[str] = None,
    start_time: Optional[str] = None,
    end_time: Optional[str] = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=500)
):
    """Fast sub-second stream search directly across cold compressed archive packages."""
    sids = [int(s.strip()) for s in server_ids.split(",") if s.strip().isdigit()] if server_ids else None
    offset = (page - 1) * page_size
    res = LogStorageService.search_archives(
        search=search,
        server_ids=sids,
        log_level=log_level,
        file_type=file_type,
        filename=filename,
        start_time=start_time,
        end_time=end_time,
        limit=page_size,
        offset=offset
    )
    total_count = res.get("total", 0)
    return {
        "items": res.get("items", []),
        "total": total_count,
        "page": page,
        "page_size": page_size,
        "total_pages": (total_count + page_size - 1) // page_size if total_count > 0 else 1,
        "archives_searched": res.get("archives_searched", 0),
        "duration_ms": res.get("duration_ms", 0)
    }
