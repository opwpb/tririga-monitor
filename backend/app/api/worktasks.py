# -*- coding: utf-8 -*-
"""
worktasks.py
FastAPI router for identifying specific TRIRIGA Work Tasks (triWorkTask)
and Workflow Tasks causing slow queries, heavy table scans, and lock contention / deadlocks.
"""

from fastapi import APIRouter, HTTPException, Query, Depends
from typing import Dict, Any, List, Optional
from ..db.database import db_read_session, dict_from_row
from ..services.worktask_service import WorkTaskQueryService

router = APIRouter(prefix="/api/worktasks", tags=["WorkTask Query & Contention Diagnostics"])

def _get_server(server_id: Optional[int]) -> Dict[str, Any]:
    with db_read_session() as conn:
        cur = conn.cursor()
        if server_id:
            cur.execute("SELECT * FROM servers WHERE id = ?", (server_id,))
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail=f"Server {server_id} not found.")
            return dict_from_row(row)
        else:
            cur.execute("""
                SELECT * FROM servers 
                ORDER BY 
                    CASE 
                        WHEN LOWER(TRIM(name)) = 'prod app1' THEN 0 
                        WHEN LOWER(TRIM(name)) = 'prod app2' THEN 1 
                        WHEN LOWER(TRIM(name)) LIKE 'prod%' THEN 2 
                        ELSE 3 
                    END, id ASC 
                LIMIT 1
            """)
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="No TRIRIGA servers configured.")
            return dict_from_row(row)


@router.get("/queries-and-contention")
def get_worktask_queries_and_contention(
    server_id: Optional[int] = Query(None),
    server_ids: Optional[str] = Query(None),
    issue_type: Optional[str] = Query(None, description="ALL, SLOW_QUERY, LOCK_CONTENTION, DEADLOCK, TABLE_SCAN"),
    min_duration_ms: int = Query(1000, ge=0),
    search: Optional[str] = Query(None),
    worktask_identifier: Optional[str] = Query(None),
    start_time: Optional[str] = Query(None),
    end_time: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200)
):
    """
    Returns amalgamated slow queries and lock contention events correlated to
    specific TRIRIGA Work Tasks and Workflow tasks.
    """
    return WorkTaskQueryService.get_queries_and_contention(
        server_id=server_id,
        server_ids=server_ids,
        issue_type=issue_type,
        min_duration_ms=min_duration_ms,
        search=search,
        worktask_identifier=worktask_identifier,
        start_time=start_time,
        end_time=end_time,
        page=page,
        page_size=page_size
    )


@router.get("/live-telemetry")
async def get_live_worktask_telemetry(server_id: Optional[int] = Query(None)):
    """
    Fetches real-time DB2 lock contention and dynamic SQL performance metrics
    targeting T_TRIWORKTASK and IBS_SPEC_ASSIGNMENTS.
    """
    server = _get_server(server_id)
    return await WorkTaskQueryService.get_live_telemetry(server)


@router.get("/record/{identifier}")
def get_worktask_record(identifier: str):
    """
    Resolves full details, associated workflows, and performance profile for a
    specific TRIRIGA Work Task (by Spec ID or Control Number e.g. WRK-149204).
    """
    return WorkTaskQueryService.resolve_worktask_record(identifier)


@router.get("/workflow-bottlenecks")
def get_worktask_workflow_bottlenecks(server_id: Optional[int] = Query(None)):
    """
    Returns real workflow engine bottlenecks, deadlocks, and failure patterns
    dynamically computed from ingested cluster logs.
    """
    return WorkTaskQueryService.get_workflow_bottlenecks(server_id=server_id)
