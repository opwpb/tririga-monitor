# -*- coding: utf-8 -*-
import sqlite3
import os
from pathlib import Path
from contextlib import contextmanager
from typing import Generator, Any, List, Dict, Optional
from ..config import settings

def get_db_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(
        settings.db_path,
        check_same_thread=False,
        timeout=60.0
    )
    conn.row_factory = sqlite3.Row
    # Optimized PRAGMAs for high-speed concurrent ingestion and sub-millisecond reads
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA foreign_keys=ON;")
    conn.execute("PRAGMA synchronous=OFF;")
    conn.execute("PRAGMA busy_timeout=30000;")
    conn.execute("PRAGMA cache_size=-64000;") # 64MB memory cache for fast indexing & search
    conn.execute("PRAGMA mmap_size=268435456;") # 256MB memory-mapped I/O for zero-copy read speed
    conn.execute("PRAGMA temp_store=MEMORY;")
    conn.execute("PRAGMA wal_autocheckpoint=2000;")
    return conn

@contextmanager
def db_read_session() -> Generator[sqlite3.Connection, None, None]:
    """Read-only database session: zero transaction locks, concurrent reads in WAL mode."""
    conn = get_db_connection()
    try:
        yield conn
    finally:
        conn.close()

@contextmanager
def db_session() -> Generator[sqlite3.Connection, None, None]:
    """Write database session: commits modifications and guarantees connection cleanup."""
    conn = get_db_connection()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()

def init_db():
    """Initializes the database schema if not already present, and applies migrations."""
    conn = get_db_connection()
    servers_exist = False
    try:
        cur = conn.cursor()
        cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='servers';")
        if cur.fetchone():
            servers_exist = True
    except Exception:
        pass
    finally:
        conn.close()

    if servers_exist:
        # Run incremental migrations
        with db_session() as conn:
            cur = conn.cursor()
            cur.execute("PRAGMA table_info(servers);")
            cols = [r["name"] for r in cur.fetchall()]
            if "cluster_name" not in cols:
                cur.execute("ALTER TABLE servers ADD COLUMN cluster_name TEXT DEFAULT NULL;")
            # Default clustering for prod app1 and prod app2
            cur.execute("""
                UPDATE servers 
                SET cluster_name = 'Production Cluster' 
                WHERE LOWER(TRIM(name)) IN ('prod app1', 'prod app2') 
                  AND (cluster_name IS NULL OR cluster_name = '');
            """)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS ingestion_schedule (
                    id INTEGER PRIMARY KEY DEFAULT 1,
                    is_enabled INTEGER DEFAULT 1,
                    interval_minutes INTEGER DEFAULT 15,
                    last_run_at TEXT DEFAULT NULL,
                    next_run_at TEXT DEFAULT NULL,
                    last_status TEXT DEFAULT 'pending',
                    last_summary TEXT DEFAULT NULL,
                    updated_at TEXT DEFAULT (datetime('now', 'utc'))
                );
            """)
            cur.execute("SELECT COUNT(*) FROM ingestion_schedule WHERE id=1;")
            if cur.fetchone()[0] == 0:
                cur.execute("""
                    INSERT INTO ingestion_schedule (id, is_enabled, interval_minutes, last_status, last_summary)
                    VALUES (1, 1, 15, 'pending', 'Automated 15-minute log ingestion enabled.');
                """)

            cur.execute("""
                CREATE TABLE IF NOT EXISTS log_archives (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    filename TEXT NOT NULL UNIQUE,
                    filepath TEXT NOT NULL,
                    size_bytes INTEGER DEFAULT 0,
                    entry_count INTEGER DEFAULT 0,
                    error_count INTEGER DEFAULT 0,
                    warn_count INTEGER DEFAULT 0,
                    min_timestamp TEXT,
                    max_timestamp TEXT,
                    server_ids TEXT,
                    server_names TEXT,
                    retention_days INTEGER DEFAULT 7,
                    created_at TEXT DEFAULT (datetime('now', 'utc'))
                );
            """)
            cur.execute("CREATE INDEX IF NOT EXISTS idx_log_archives_timestamp ON log_archives(min_timestamp, max_timestamp);")

            cur.execute("""
                CREATE TABLE IF NOT EXISTS storage_settings (
                    id INTEGER PRIMARY KEY DEFAULT 1,
                    retention_days INTEGER DEFAULT 7,
                    auto_prune_enabled INTEGER DEFAULT 1,
                    compress_raw_logs INTEGER DEFAULT 1,
                    last_pruned_at TEXT,
                    last_prune_summary TEXT,
                    updated_at TEXT DEFAULT (datetime('now', 'utc'))
                );
            """)
            cur.execute("SELECT COUNT(*) FROM storage_settings WHERE id=1;")
            if cur.fetchone()[0] == 0:
                cur.execute("""
                    INSERT INTO storage_settings (id, retention_days, auto_prune_enabled, compress_raw_logs, last_pruned_at, last_prune_summary)
                    VALUES (1, 7, 1, 1, NULL, 'Tiered storage enabled. 7-day retention window configured.');
                """)

            # Composite indexes for sub-second timeline & metric aggregation on large clusters
            cur.execute("CREATE INDEX IF NOT EXISTS idx_log_entries_srv_ts ON log_entries(server_id, timestamp);")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_log_entries_ts_lvl ON log_entries(timestamp, log_level);")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_log_entries_ts_lvl_errhash ON log_entries(timestamp, log_level, error_hash);")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_log_entries_lvl_ts ON log_entries(log_level, timestamp);")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_log_entries_srv_ts_lvl ON log_entries(server_id, timestamp, log_level);")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_log_entries_errhash_ts ON log_entries(error_hash, timestamp);")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_log_entries_srv_lvl_hash ON log_entries(server_id, log_level, error_hash);")
        return

    schema_path = Path(__file__).resolve().parent / "schema.sql"
    with open(schema_path, "r", encoding="utf-8") as f:
        schema_sql = f.read()

    with db_session() as conn:
        conn.execute("PRAGMA journal_mode=WAL;")
        conn.executescript(schema_sql)
        # Ensure default LLM configs exist if empty
        cur = conn.cursor()
        cur.execute("SELECT COUNT(*) FROM llm_configs;")
        if cur.fetchone()[0] == 0:
            cur.execute("""
                INSERT INTO llm_configs (provider, base_url, model_name, temperature, context_window, is_active)
                VALUES (?, ?, ?, ?, ?, ?);
            """, ("ollama", settings.default_ollama_url, "llama3", 0.2, 32768, 1))
            cur.execute("""
                INSERT INTO llm_configs (provider, base_url, model_name, temperature, context_window, is_active)
                VALUES (?, ?, ?, ?, ?, ?);
            """, ("lm_studio", settings.default_lm_studio_url, "local-model", 0.2, 32768, 0))

        cur.execute("SELECT COUNT(*) FROM ingestion_schedule WHERE id=1;")
        if cur.fetchone()[0] == 0:
            cur.execute("""
                INSERT INTO ingestion_schedule (id, is_enabled, interval_minutes, last_status, last_summary)
                VALUES (1, 1, 15, 'pending', 'Automated 15-minute log ingestion enabled.');
            """)

        cur.execute("SELECT COUNT(*) FROM storage_settings WHERE id=1;")
        if cur.fetchone()[0] == 0:
            cur.execute("""
                INSERT INTO storage_settings (id, retention_days, auto_prune_enabled, compress_raw_logs, last_pruned_at, last_prune_summary)
                VALUES (1, 7, 1, 1, NULL, 'Tiered storage enabled. 7-day retention window configured.');
            """)

def dict_from_row(row: sqlite3.Row) -> Dict[str, Any]:
    return dict(row) if row else {}

def dict_list_from_rows(rows: List[sqlite3.Row]) -> List[Dict[str, Any]]:
    return [dict(r) for r in rows]
