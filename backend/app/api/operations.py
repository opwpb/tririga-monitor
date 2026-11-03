"""
operations.py
FastAPI router for TRIRIGA Operations, Observability & Forensics Console.
Strictly live data only - no simulations.
"""

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse, Response
from typing import Dict, Any, Optional
from ..db.database import db_read_session, dict_from_row
from ..services.operations_service import OperationsService
from ..services.mas_sizing_service import MasSizingService

router = APIRouter(prefix="/api/operations", tags=["TRIRIGA Operations Hub"])

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
                WHERE password IS NOT NULL AND password != ''
                ORDER BY 
                    CASE 
                        WHEN host = '169.50.115.221' THEN 0
                        WHEN LOWER(TRIM(name)) = 'prod app1' THEN 1
                        WHEN LOWER(TRIM(name)) = 'prod app2' THEN 2 
                        WHEN LOWER(TRIM(name)) LIKE 'prod%' THEN 3 
                        ELSE 4 
                    END, id DESC 
                LIMIT 1
            """)
            row = cur.fetchone()
            if not row:
                cur.execute("SELECT * FROM servers ORDER BY id ASC LIMIT 1")
                row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="No TRIRIGA servers configured.")
            return dict_from_row(row)


@router.get("/workflow-telemetry")
async def get_workflow_telemetry(server_id: Optional[int] = Query(None)):
    server = _get_server(server_id)
    return await OperationsService.get_workflow_telemetry(server)


@router.get("/gc-telemetry")
def get_gc_telemetry(server_id: Optional[int] = Query(None)):
    server = _get_server(server_id)
    return OperationsService.get_gc_telemetry(server["id"])


@router.get("/lock-contention")
async def get_lock_contention(server_id: Optional[int] = Query(None)):
    server = _get_server(server_id)
    return await OperationsService.get_lock_contention(server)


@router.get("/table-bloat")
async def get_table_bloat(server_id: Optional[int] = Query(None)):
    server = _get_server(server_id)
    return await OperationsService.get_table_bloat(server)


@router.get("/dataconnect-om")
async def get_dataconnect_om(server_id: Optional[int] = Query(None)):
    server = _get_server(server_id)
    return await OperationsService.get_dataconnect_om(server, server["id"])


@router.get("/license-usage")
async def get_license_usage(server_id: Optional[int] = Query(None), cluster_mode: Optional[bool] = Query(False)):
    server = _get_server(server_id)
    server["_is_cluster_wide"] = bool(cluster_mode or server_id is None)
    return await OperationsService.get_license_usage(server)


@router.get("/cluster-parity")
def get_cluster_parity():
    return OperationsService.get_cluster_parity()


@router.get("/health-scorecard")
async def get_health_scorecard(server_id: Optional[int] = Query(None)):
    server = _get_server(server_id)
    return await OperationsService.get_health_scorecard(server, server["id"])


@router.get("/diagnostic-bundle")
async def get_diagnostic_bundle(server_id: Optional[int] = Query(None)):
    server = _get_server(server_id)
    zip_buffer = await OperationsService.generate_diagnostic_bundle(server, server["id"])
    server_name_safe = server.get("name", "server").replace(" ", "_")
    filename = f"TRIRIGA_Diagnostic_Bundle_{server_name_safe}.zip"
    return StreamingResponse(
        zip_buffer,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'}
    )


@router.get("/users-directory")
async def get_users_directory(
    server_id: Optional[int] = Query(None),
    status: str = Query("all", description="Filter by status: 'all' | 'active' | 'inactive'"),
    account_type: str = Query("all", description="Filter by account type: 'all' | 'internal' | 'external' | 'oslc'"),
    org: Optional[str] = Query(None, description="Filter by organisation name"),
    search: Optional[str] = Query(None, description="Search query across name, username, email, organisation")
):
    """
    Returns a comprehensive list of TRIRIGA users with names, organisations, email addresses,
    account types, and active/inactive statuses.
    """
    server = _get_server(server_id)
    return await OperationsService.get_users_directory(
        server_info=server,
        status_filter=status,
        account_type_filter=account_type,
        org_filter=org,
        search_query=search
    )


@router.get("/users-export.csv")
async def export_users_csv(
    server_id: Optional[int] = Query(None),
    status: str = Query("all", description="Filter by status: 'all' | 'active' | 'inactive'"),
    account_type: str = Query("all", description="Filter by account type: 'all' | 'internal' | 'external' | 'oslc'"),
    org: Optional[str] = Query(None, description="Filter by organisation name"),
    search: Optional[str] = Query(None, description="Search query across name, username, email, organisation")
):
    """
    Generates and downloads a CSV of TRIRIGA users with names, organisations, email addresses,
    account types, and active statuses, formatted for Excel compatibility.
    """
    import datetime
    server = _get_server(server_id)
    result = await OperationsService.get_users_directory(
        server_info=server,
        status_filter=status,
        account_type_filter=account_type,
        org_filter=org,
        search_query=search
    )
    users = result.get("users", [])
    csv_text = OperationsService.generate_users_csv(users)

    timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    status_suffix = f"_{status}" if status != "all" else ""
    type_suffix = f"_{account_type}" if account_type != "all" else ""
    filename = f"TRIRIGA_Users{status_suffix}{type_suffix}_{timestamp}.csv"

    return Response(
        content=csv_text.encode("utf-8"),
        media_type="text/csv; charset=utf-8",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Content-Type": "text/csv; charset=utf-8"
        }
    )


@router.get("/mas-sizing")
async def get_mas_sizing(
    server_id: Optional[int] = Query(None),
    buffer_pct: float = Query(20.0, description="Buffer percentage for safety headroom (e.g. 20.0)"),
    include_reserve: bool = Query(True, description="Whether to include Reserve add-on module tier points"),
    reserve_users: int = Query(4000, description="Estimated total user population accessing reservation desks/rooms")
):
    """
    Computes IBM Maximo Application Suite (MAS) and Maximo Real Estate and Facilities (MREF)
    AppPoints sizing, license conversion modeling, and audited utilization forecasting.
    """
    server = _get_server(server_id)
    server_copy = dict(server)
    server_copy["_is_cluster_wide"] = True
    license_data = await OperationsService.get_license_usage(server_copy)
    return MasSizingService.calculate_sizing(
        license_usage_data=license_data,
        buffer_percent=buffer_pct,
        include_reserve_addon=include_reserve,
        reserve_user_population=reserve_users
    )
