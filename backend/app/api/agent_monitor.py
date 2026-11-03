from fastapi import APIRouter, HTTPException, Query
from typing import Dict, Any, Optional
from ..db.database import db_read_session, dict_from_row
from ..services.tririga_admin_client import TririgaAdminClient

router = APIRouter(prefix="/api/agent-monitor", tags=["Live Agent & Thread Monitor"])

@router.get("/live", response_model=Dict[str, Any])
async def get_live_agent_monitor(server_id: Optional[int] = Query(None, description="Target TRIRIGA Server ID")):
    """
    Fetches real-time JVM thread telemetry, DB2 lock wait states, and
    asynchronous WF_EVENT queue depth directly from the live TRIRIGA cluster node.
    Strictly live data only - no simulations.
    """
    server_info: Dict[str, Any] = {}

    with db_read_session() as conn:
        cur = conn.cursor()
        if server_id:
            cur.execute("SELECT * FROM servers WHERE id = ?", (server_id,))
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail=f"Server ID {server_id} not found.")
            server_info = dict_from_row(row)
        else:
            # Default to first online server or first production node
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
                return {
                    "success": False,
                    "is_online": False,
                    "error": "No TRIRIGA servers configured in Server Manager. Please add a server.",
                    "threads_summary": {"total": 0, "runnable": 0, "waiting": 0, "blocked": 0, "db_blocked": 0, "by_subsystem": {}},
                    "threads": [],
                    "wf_event_summary": {"total_queued": 0, "events": []},
                    "lock_waits": [],
                    "source": "no_servers_configured"
                }
            server_info = dict_from_row(row)

    # Fetch live agent monitor data directly from the server
    result = await TririgaAdminClient.fetch_live_agent_monitor(server_info)
    return result
