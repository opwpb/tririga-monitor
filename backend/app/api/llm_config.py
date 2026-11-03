import time
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Optional, Dict, Any, Tuple
from ..db.database import db_session, db_read_session, dict_from_row, dict_list_from_rows
from ..services.local_llm import LocalLLMService

router = APIRouter(prefix="/api/llm-config", tags=["LLM Configuration"])

# Model discovery in-memory cache (30s TTL)
_model_cache: Dict[str, Tuple[float, List[Dict[str, Any]]]] = {}

class LLMConfigUpdate(BaseModel):
    provider: str # 'ollama', 'lm_studio', 'openai_compatible'
    base_url: str
    model_name: str
    temperature: float = 0.2
    context_window: int = 32768

class LLMTestRequest(BaseModel):
    provider: str
    base_url: str
    model_name: str

@router.get("", response_model=List[Dict[str, Any]])
def list_llm_configs():
    """Lists saved LLM configurations."""
    with db_read_session() as conn:
        cur = conn.cursor()
        cur.execute("SELECT * FROM llm_configs ORDER BY is_active DESC, id ASC;")
        return dict_list_from_rows(cur.fetchall())

@router.get("/active", response_model=Dict[str, Any])
def get_active_config():
    """Returns the currently active LLM configuration profile."""
    with db_read_session() as conn:
        cur = conn.cursor()
        cur.execute("SELECT * FROM llm_configs WHERE is_active=1 LIMIT 1;")
        row = cur.fetchone()
        if not row:
            cur.execute("SELECT * FROM llm_configs LIMIT 1;")
            row = cur.fetchone()
        return dict_from_row(row)

@router.post("/set-active/{config_id}")
def set_active_config(config_id: int):
    """Sets a specific configuration as active."""
    with db_session() as conn:
        conn.execute("UPDATE llm_configs SET is_active=0;")
        conn.execute("UPDATE llm_configs SET is_active=1 WHERE id=?;", (config_id,))
    return {"success": True, "active_id": config_id}

@router.post("/save", response_model=Dict[str, Any])
def save_config(cfg: LLMConfigUpdate):
    """Saves or updates LLM configuration and sets it active."""
    with db_session() as conn:
        conn.execute("UPDATE llm_configs SET is_active=0;")
        cur = conn.cursor()
        cur.execute("""
            INSERT INTO llm_configs (provider, base_url, model_name, temperature, context_window, is_active)
            VALUES (?, ?, ?, ?, ?, 1);
        """, (cfg.provider, cfg.base_url, cfg.model_name, cfg.temperature, cfg.context_window))
        new_id = cur.lastrowid
        cur.execute("SELECT * FROM llm_configs WHERE id=?", (new_id,))
        return dict_from_row(cur.fetchone())

@router.post("/test")
async def test_llm(req: LLMTestRequest):
    """Tests connectivity to a local LLM endpoint."""
    return await LocalLLMService.test_llm_connection(req.provider, req.base_url, req.model_name)

@router.get("/discover-models")
async def discover_models(provider: Optional[str] = None, base_url: Optional[str] = None):
    """Discovers available models running on the local Ollama or LM Studio instance with 30s in-memory caching."""
    if not provider or provider == "undefined":
        provider = "lm_studio"
    if not base_url or base_url == "undefined":
        base_url = "http://127.0.0.1:1234/v1" if provider == "lm_studio" else "http://127.0.0.1:11434"

    cache_key = f"{provider}:{base_url}"
    now = time.time()
    if cache_key in _model_cache:
        cached_time, cached_models = _model_cache[cache_key]
        if now - cached_time < 30.0:
            return {"provider": provider, "base_url": base_url, "models": cached_models, "cached": True}

    models = await LocalLLMService.list_available_models(provider, base_url)
    _model_cache[cache_key] = (now, models)
    return {"provider": provider, "base_url": base_url, "models": models, "cached": False}

