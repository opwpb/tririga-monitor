from urllib.parse import urlparse
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
from ..db.database import db_session, db_read_session, dict_from_row, dict_list_from_rows
from ..services.tririga_collector import TririgaCollector

router = APIRouter(prefix="/api/servers", tags=["Servers"])

class ServerCreate(BaseModel):
    id: Optional[int] = None
    name: str
    host: str
    port: int = 8001
    protocol: str = "https" # 'https', 'http', 'ssh'
    admin_path: str = "/html/en/default/admin"
    username: Optional[str] = None
    password: Optional[str] = None
    auth_type: str = "form"
    ssh_key_path: Optional[str] = None
    remote_log_dir: str = "/opt/tririga/userfiles/log"
    cluster_name: Optional[str] = None

class ServerUpdate(BaseModel):
    name: Optional[str] = None
    host: Optional[str] = None
    port: Optional[int] = None
    protocol: Optional[str] = None
    admin_path: Optional[str] = None
    username: Optional[str] = None
    password: Optional[str] = None
    auth_type: Optional[str] = None
    ssh_key_path: Optional[str] = None
    remote_log_dir: Optional[str] = None
    cluster_name: Optional[str] = None

def normalize_server_dict(data: Dict[str, Any]) -> Dict[str, Any]:
    host = data.get("host", "").strip()
    if host.startswith("http://") or host.startswith("https://"):
        parsed = urlparse(host)
        data["protocol"] = parsed.scheme
        data["host"] = parsed.hostname or host
        if parsed.port:
            data["port"] = parsed.port
        else:
            data["port"] = 443 if parsed.scheme == "https" else 80
        if parsed.path and parsed.path not in ("", "/"):
            data["admin_path"] = parsed.path
    return data

@router.get("", response_model=List[Dict[str, Any]])
def list_servers():
    """Lists all configured TRIRIGA servers with log statistics and cluster assignments."""
    with db_read_session() as conn:
        cur = conn.cursor()
        cur.execute("""
            SELECT 
                s.id, s.name, s.host, s.port, s.protocol, s.admin_path,
                s.username, s.auth_type, s.remote_log_dir, s.status, s.last_sync_at, s.created_at,
                COALESCE(NULLIF(TRIM(s.cluster_name), ''), CASE WHEN LOWER(TRIM(s.name)) IN ('prod app1', 'prod app2') THEN 'Production Cluster' ELSE NULL END) as cluster_name,
                COUNT(DISTINCT lf.id) as files_count,
                COALESCE(SUM(lf.entry_count), 0) as total_entries,
                COALESCE(SUM(lf.error_count), 0) as total_errors,
                COALESCE(SUM(lf.warn_count), 0) as total_warns
            FROM servers s
            LEFT JOIN log_files lf ON s.id = lf.server_id
            GROUP BY s.id
            ORDER BY 
                CASE 
                    WHEN LOWER(TRIM(s.name)) = 'prod app1' THEN 1
                    WHEN LOWER(TRIM(s.name)) = 'prod app2' THEN 2
                    ELSE 3
                END ASC,
                LOWER(s.name) ASC;
        """)
        return dict_list_from_rows(cur.fetchall())

@router.post("", response_model=Dict[str, Any])
def create_server(server: ServerCreate):
    """Adds a new TRIRIGA server connection profile."""
    data = normalize_server_dict(server.model_dump())
    with db_session() as conn:
        cur = conn.cursor()
        cur.execute("""
            INSERT INTO servers (
                name, host, port, protocol, admin_path, username, password,
                auth_type, ssh_key_path, remote_log_dir, status, cluster_name
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'configured', ?);
        """, (
            data["name"], data["host"], data["port"], data["protocol"], data["admin_path"],
            data.get("username"), data.get("password"), data["auth_type"], data.get("ssh_key_path"),
            data["remote_log_dir"], data.get("cluster_name")
        ))
        server_id = cur.lastrowid
        cur.execute("SELECT * FROM servers WHERE id=?", (server_id,))
        return dict_from_row(cur.fetchone())

@router.put("/{server_id}", response_model=Dict[str, Any])
def update_server(server_id: int, server: ServerUpdate):
    """Updates an existing TRIRIGA server configuration (credentials, clustering, host, etc.)."""
    raw_data = server.model_dump(exclude_unset=True)
    if "host" in raw_data and raw_data["host"]:
        raw_data = normalize_server_dict(raw_data)

    with db_session() as conn:
        cur = conn.cursor()
        cur.execute("SELECT * FROM servers WHERE id=?", (server_id,))
        existing = cur.fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Server not found")

        updates = []
        params = []
        for k, v in raw_data.items():
            # If password is empty string, do not overwrite existing stored password
            if k == "password" and (v is None or v == ""):
                continue
            updates.append(f"{k}=?")
            params.append(v)

        if updates:
            params.append(server_id)
            cur.execute(f"UPDATE servers SET {', '.join(updates)} WHERE id=?", params)

        cur.execute("SELECT * FROM servers WHERE id=?", (server_id,))
        return dict_from_row(cur.fetchone())

@router.delete("/{server_id}")
def delete_server(server_id: int):
    """Deletes a TRIRIGA server and all its amalgamated log entries."""
    with db_session() as conn:
        cur = conn.cursor()
        cur.execute("DELETE FROM servers WHERE id=?", (server_id,))
        return {"success": True, "message": f"Server {server_id} and associated logs removed."}

@router.post("/test-connection")
async def test_connection(server: ServerCreate):
    """Tests connectivity to TRIRIGA server (HTTP Admin Console or SSH)."""
    data = normalize_server_dict(server.model_dump())
    host = data["host"]
    port = data["port"]
    protocol = data["protocol"]
    admin_path = data["admin_path"]
    username = data.get("username")
    password = data.get("password")

    # If testing existing server without re-entering password, fetch existing password
    if (not password or password.strip() == "") and server.id:
        with db_read_session() as conn:
            cur = conn.cursor()
            cur.execute("SELECT password FROM servers WHERE id=?", (server.id,))
            row = cur.fetchone()
            if row and row["password"]:
                password = row["password"]

    if host in ("mock", "mock-server", "localhost-mock", "demo"):
        return {"success": True, "message": "Synthetic Mock TRIRIGA Server is ready for instant simulation."}

    if protocol in ("http", "https"):
        return await TririgaCollector.test_http_connection(
            host, port, protocol, admin_path, username, password
        )
    elif protocol == "ssh":
        return TririgaCollector.test_ssh_connection(
            host, port, username or "root", password, data.get("ssh_key_path")
        )
    else:
        return {"success": False, "message": f"Unsupported protocol: {protocol}"}

@router.post("/seed-mock-cluster")
def seed_mock_cluster():
    """Seeds a realistic 3-node TRIRIGA cluster (App Server 1, App Server 2, Process Server) for testing."""
    mock_servers = [
        {"name": "TRIRIGA-App-Node-01 (UI/REST)", "host": "mock", "port": 8001, "protocol": "http", "username": "admin"},
        {"name": "TRIRIGA-App-Node-02 (UI/BIM)", "host": "mock", "port": 8002, "protocol": "http", "username": "admin"},
        {"name": "TRIRIGA-Process-Node-03 (WFE/OM)", "host": "mock", "port": 8003, "protocol": "http", "username": "admin"},
    ]
    created = []
    with db_session() as conn:
        cur = conn.cursor()
        for s in mock_servers:
            cur.execute("SELECT id FROM servers WHERE name=?", (s["name"],))
            existing = cur.fetchone()
            if not existing:
                cur.execute("""
                    INSERT INTO servers (name, host, port, protocol, admin_path, username, status)
                    VALUES (?, ?, ?, ?, '/html/en/default/admin', ?, 'configured');
                """, (s["name"], s["host"], s["port"], s["protocol"], s["username"]))
                created.append(cur.lastrowid)
    return {"success": True, "created_count": len(created), "message": f"Created {len(created)} mock TRIRIGA server nodes."}
