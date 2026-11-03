from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
from ..db.database import db_read_session, dict_from_row
from ..services.tririga_admin_client import TririgaAdminClient

router = APIRouter(prefix="/api/db-query", tags=["DB2 Query Tool"])

class QueryExecuteRequest(BaseModel):
    server_id: Optional[int] = None
    custom_host: Optional[str] = None
    custom_port: Optional[int] = 443
    custom_protocol: Optional[str] = "https"
    custom_admin_path: Optional[str] = "/html/en/default/admin"
    custom_username: Optional[str] = None
    custom_password: Optional[str] = None
    sql: str

class QueryValidationRequest(BaseModel):
    sql: str

@router.get("/presets", response_model=List[Dict[str, Any]])
def get_query_presets():
    """Returns curated TRIRIGA DB2 diagnostic query presets."""
    return TririgaAdminClient.PRESET_QUERIES

@router.post("/validate", response_model=Dict[str, Any])
def validate_sql(req: QueryValidationRequest):
    """Checks if SQL query passes strict read-only safety rules."""
    is_valid, err_msg = TririgaAdminClient.validate_readonly_query(req.sql)
    return {
        "is_valid": is_valid,
        "error": err_msg
    }

@router.post("/execute", response_model=Dict[str, Any])
async def execute_query(req: QueryExecuteRequest):
    """
    Executes a read-only SQL query against the TRIRIGA Administrator Console
    over standard HTTPS (Port 443) using WebSphere Liberty's internal JDBC DataSource.
    """
    server_info: Dict[str, Any] = {}

    if req.server_id:
        with db_read_session() as conn:
            cur = conn.cursor()
            cur.execute("SELECT * FROM servers WHERE id = ?", (req.server_id,))
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail=f"Server ID {req.server_id} not found.")
            server_info = dict_from_row(row)
    elif req.custom_host:
        server_info = {
            "host": req.custom_host,
            "port": req.custom_port or (443 if req.custom_protocol == "https" else 80),
            "protocol": req.custom_protocol or "https",
            "admin_path": req.custom_admin_path or "/html/en/default/admin",
            "username": req.custom_username,
            "password": req.custom_password,
        }
    else:
        # Default to first configured server or mock simulation
        with db_read_session() as conn:
            cur = conn.cursor()
            cur.execute("SELECT * FROM servers ORDER BY id ASC LIMIT 1")
            row = cur.fetchone()
            if row:
                server_info = dict_from_row(row)
            else:
                server_info = {
                    "host": "prod-app1.internal",
                    "port": 443,
                    "protocol": "https",
                    "admin_path": "/html/en/default/admin",
                    "username": "admin",
                    "password": ""
                }

    res = await TririgaAdminClient.execute_query_via_admin_console(server_info, req.sql)
    return res
