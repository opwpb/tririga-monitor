import os
from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parent.parent.parent
DATA_DIR = BASE_DIR / "data"
LOGS_STORAGE_DIR = DATA_DIR / "logs"
ARCHIVES_STORAGE_DIR = DATA_DIR / "archives"
DB_PATH = DATA_DIR / "tririga_logs.db"

DATA_DIR.mkdir(parents=True, exist_ok=True)
LOGS_STORAGE_DIR.mkdir(parents=True, exist_ok=True)
ARCHIVES_STORAGE_DIR.mkdir(parents=True, exist_ok=True)

class Settings(BaseSettings):
    app_name: str = "TRIRIGA Log Forensics & Local LLM Amalgamator"
    app_version: str = "1.0.0"
    base_dir: Path = BASE_DIR
    data_dir: Path = DATA_DIR
    logs_storage_dir: Path = LOGS_STORAGE_DIR
    archives_storage_dir: Path = ARCHIVES_STORAGE_DIR
    db_path: Path = DB_PATH
    default_retention_days: int = 7
    default_ollama_url: str = "http://localhost:11434"
    default_lm_studio_url: str = "http://localhost:1234/v1"
    
    model_config = SettingsConfigDict(env_prefix="TRIRIGA_LOGS_")

settings = Settings()
