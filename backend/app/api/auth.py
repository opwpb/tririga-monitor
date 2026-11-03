# -*- coding: utf-8 -*-
import hashlib
import os
import secrets
import time
from typing import Dict, Any, Optional
from fastapi import APIRouter, HTTPException, Header, Depends
from pydantic import BaseModel
from ..db.database import db_session, db_read_session, dict_from_row

router = APIRouter(prefix="/api/auth", tags=["Authentication & Access Control"])

class LoginRequest(BaseModel):
    password: str

class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str

class ToggleAuthRequest(BaseModel):
    is_enabled: bool
    password: str

# Session TTL: 7 days
SESSION_TTL_SECONDS = 86400 * 7
_cached_auth_config: Optional[Dict[str, Any]] = None

def hash_password(password: str, salt: str) -> str:
    return hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        salt.encode("utf-8"),
        100000
    ).hex()

def ensure_auth_table():
    with db_session() as conn:
        cur = conn.cursor()
        cur.execute("""
            CREATE TABLE IF NOT EXISTS auth_config (
                id INTEGER PRIMARY KEY DEFAULT 1,
                is_enabled INTEGER DEFAULT 1,
                password_hash TEXT NOT NULL,
                salt TEXT NOT NULL,
                session_secret TEXT NOT NULL,
                updated_at TEXT DEFAULT (datetime('now', 'utc'))
            );
        """)
        # Persistent sessions table in SQLite
        cur.execute("""
            CREATE TABLE IF NOT EXISTS auth_sessions (
                token TEXT PRIMARY KEY,
                created_at REAL NOT NULL,
                expires_at REAL NOT NULL
            );
        """)
        cur.execute("SELECT * FROM auth_config WHERE id=1;")
        row = cur.fetchone()
        if not row:
            # Default password: admin2026!
            default_salt = secrets.token_hex(16)
            default_hash = hash_password("admin2026!", default_salt)
            session_secret = secrets.token_hex(32)
            cur.execute("""
                INSERT INTO auth_config (id, is_enabled, password_hash, salt, session_secret)
                VALUES (1, 1, ?, ?, ?);
            """, (default_hash, default_salt, session_secret))

# Initialize table immediately
ensure_auth_table()

def invalidate_auth_cache():
    global _cached_auth_config
    _cached_auth_config = None

def get_auth_config() -> Dict[str, Any]:
    global _cached_auth_config
    if _cached_auth_config is not None:
        return _cached_auth_config
    with db_read_session() as conn:
        cur = conn.cursor()
        cur.execute("SELECT * FROM auth_config WHERE id=1;")
        row = cur.fetchone()
        _cached_auth_config = dict_from_row(row) if row else {"is_enabled": 0}
        return _cached_auth_config

# Fast in-memory session cache to avoid SQLite lookups on every single API request
_session_cache: Dict[str, float] = {}

def is_valid_session(token: str) -> bool:
    if not token:
        return False
    now = time.time()
    
    # Fast in-memory cache hit
    cached_exp = _session_cache.get(token)
    if cached_exp and now < cached_exp:
        return True

    with db_read_session() as conn:
        cur = conn.cursor()
        cur.execute("SELECT expires_at FROM auth_sessions WHERE token=?;", (token,))
        row = cur.fetchone()
        if not row:
            _session_cache.pop(token, None)
            return False
        expires_at = row[0]
        if now > expires_at:
            _session_cache.pop(token, None)
            return False
        _session_cache[token] = expires_at
        return True

def store_session(token: str):
    now = time.time()
    expires_at = now + SESSION_TTL_SECONDS
    _session_cache[token] = expires_at
    with db_session() as conn:
        cur = conn.cursor()
        # Clean expired sessions periodically
        cur.execute("DELETE FROM auth_sessions WHERE expires_at < ?;", (now,))
        cur.execute("INSERT OR REPLACE INTO auth_sessions (token, created_at, expires_at) VALUES (?, ?, ?);", (token, now, expires_at))

def remove_session(token: str):
    if not token:
        return
    _session_cache.pop(token, None)
    with db_session() as conn:
        conn.execute("DELETE FROM auth_sessions WHERE token=?;", (token,))

def verify_token(
    authorization: Optional[str] = Header(default=None), 
    x_auth_token: Optional[str] = Header(default=None),
    token_query: Optional[str] = None
) -> bool:
    config = get_auth_config()
    if not config.get("is_enabled", 1):
        return True
        
    token = None
    if isinstance(authorization, str) and authorization.startswith("Bearer "):
        token = authorization[7:].strip()
    elif isinstance(x_auth_token, str) and x_auth_token.strip():
        token = x_auth_token.strip()
    elif isinstance(token_query, str) and token_query.strip():
        token = token_query.strip()
        
    if not token:
        raise HTTPException(status_code=401, detail="Authentication required. Please unlock console.")
        
    if not is_valid_session(token):
        raise HTTPException(status_code=401, detail="Session expired or invalid. Please log in again.")
        
    return True

@router.get("/status")
def get_auth_status(
    authorization: Optional[str] = Header(default=None), 
    x_auth_token: Optional[str] = Header(default=None),
    token: Optional[str] = None
):
    config = get_auth_config()
    is_enabled = bool(config.get("is_enabled", 1))
    
    if not is_enabled:
        return {"is_enabled": False, "authenticated": True}
        
    session_token = None
    if isinstance(authorization, str) and authorization.startswith("Bearer "):
        session_token = authorization[7:].strip()
    elif isinstance(x_auth_token, str) and x_auth_token.strip():
        session_token = x_auth_token.strip()
    elif isinstance(token, str) and token.strip():
        session_token = token.strip()
        
    authenticated = False
    if session_token and is_valid_session(session_token):
        authenticated = True
            
    return {
        "is_enabled": True,
        "authenticated": authenticated
    }

@router.post("/login")
def login(req: LoginRequest):
    config = get_auth_config()
    if not config.get("is_enabled", 1):
        token = secrets.token_urlsafe(32)
        store_session(token)
        return {"success": True, "token": token, "message": "Authentication disabled"}
        
    salt = config.get("salt", "")
    expected_hash = config.get("password_hash", "")
    computed_hash = hash_password(req.password, salt)
    
    if not secrets.compare_digest(expected_hash, computed_hash):
        print("[AUTH FAILED] Invalid master password attempt.", flush=True)
        raise HTTPException(status_code=401, detail="Invalid master password")
        
    token = secrets.token_urlsafe(32)
    store_session(token)
    print("[AUTH] User authenticated successfully. New session token issued.", flush=True)
    return {
        "success": True,
        "token": token,
        "message": "Access granted"
    }

@router.post("/logout")
def logout(authorization: Optional[str] = Header(default=None), x_auth_token: Optional[str] = Header(default=None)):
    token = None
    if isinstance(authorization, str) and authorization.startswith("Bearer "):
        token = authorization[7:].strip()
    elif isinstance(x_auth_token, str) and x_auth_token.strip():
        token = x_auth_token.strip()
        
    if token:
        remove_session(token)
        print("[AUTH] Session terminated (logout).", flush=True)
        
    return {"success": True, "message": "Logged out successfully"}

@router.post("/change-password")
def change_password(req: ChangePasswordRequest, authenticated: bool = Depends(verify_token)):
    config = get_auth_config()
    salt = config.get("salt", "")
    expected_hash = config.get("password_hash", "")
    computed_hash = hash_password(req.current_password, salt)
    
    if not secrets.compare_digest(expected_hash, computed_hash):
        print("[AUTH] Password change failed: Current master password incorrect.", flush=True)
        raise HTTPException(status_code=400, detail="Current master password is incorrect")
        
    if len(req.new_password) < 4:
        raise HTTPException(status_code=400, detail="New password must be at least 4 characters")
        
    new_salt = secrets.token_hex(16)
    new_hash = hash_password(req.new_password, new_salt)
    
    with db_session() as conn:
        cur = conn.cursor()
        cur.execute("""
            UPDATE auth_config
            SET password_hash=?, salt=?, updated_at=datetime('now', 'utc')
            WHERE id=1;
        """, (new_hash, new_salt))
        
    invalidate_auth_cache()
    print("[AUTH] Master password changed successfully.", flush=True)
    return {"success": True, "message": "Master password updated successfully"}

@router.post("/toggle")
def toggle_auth(req: ToggleAuthRequest, authenticated: bool = Depends(verify_token)):
    config = get_auth_config()
    salt = config.get("salt", "")
    expected_hash = config.get("password_hash", "")
    computed_hash = hash_password(req.password, salt)
    
    if not secrets.compare_digest(expected_hash, computed_hash):
        print("[AUTH] Toggle auth failed: Incorrect password.", flush=True)
        raise HTTPException(status_code=400, detail="Password verification failed")
        
    with db_session() as conn:
        cur = conn.cursor()
        cur.execute("""
            UPDATE auth_config
            SET is_enabled=?, updated_at=datetime('now', 'utc')
            WHERE id=1;
        """, (1 if req.is_enabled else 0,))
        
    invalidate_auth_cache()
    state_str = 'enabled' if req.is_enabled else 'disabled'
    print(f"[AUTH] Authentication {state_str}.", flush=True)
    return {"success": True, "is_enabled": req.is_enabled, "message": f"Authentication {state_str}"}
