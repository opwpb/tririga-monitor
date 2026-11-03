"""
server_config.py
FastAPI router for per-server configuration and performance telemetry endpoints
based on TRIRIGA Admin Console:
- /html/en/default/admin/machineMain.jsp
- /html/en/default/admin/performanceMain.jsp
- /html/en/default/admin/viewProperties.jsp
- /html/en/default/admin/serverXml.jsp
"""

from fastapi import APIRouter, HTTPException, Query
from typing import Dict, Any, Optional
from ..db.database import db_read_session, dict_from_row
from ..services.server_config_service import ServerConfigService

router = APIRouter(prefix="/api/server-config", tags=["Server Configuration & Performance"])


def _get_server_by_id(server_id: int) -> Dict[str, Any]:
    with db_read_session() as conn:
        cur = conn.cursor()
        cur.execute("SELECT * FROM servers WHERE id = ?", (server_id,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail=f"Server {server_id} not found.")
        return dict_from_row(row)


@router.get("/compare")
async def compare_all_servers_config():
    """
    Fetches real-time machine configuration and performance metrics across all
    configured TRIRIGA servers, computing cluster KPIs and cross-node configuration drift.
    """
    return await ServerConfigService.compare_all_servers()


@router.get("/server/{server_id}")
async def get_single_server_config(server_id: int):
    """
    Fetches live machine configuration and performance metrics for a specific TRIRIGA server.
    """
    server = _get_server_by_id(server_id)
    return await ServerConfigService.fetch_single_server_config(server)


@router.get("/property-file")
async def get_server_property_file(
    server_id: int = Query(..., description="TRIRIGA Server ID"),
    property_name: str = Query("TRIRIGADB", description="Property file name (e.g. TRIRIGADB, TRIRIGAWEB, TRIRIGACRYSTAL, serverXml)")
):
    """
    Retrieves read-only configuration property file contents with passwords and sensitive tokens masked.
    """
    server = _get_server_by_id(server_id)
    return await ServerConfigService.get_sanitized_property_file(server, property_name)


@router.get("/cluster-property-file")
async def get_cluster_property_file(
    property_name: str = Query("TRIRIGADB", description="Property file name (e.g. TRIRIGADB, TRIRIGAWEB, TRIRIGACRYSTAL, serverXml)"),
    cluster_name: Optional[str] = Query(None, description="Optional cluster name filter")
):
    """
    Retrieves read-only configuration property file aligned across all cluster nodes
    in a side-by-side matrix with drift/difference detection.
    """
    return await ServerConfigService.get_clustered_property_file(property_name, cluster_name)

