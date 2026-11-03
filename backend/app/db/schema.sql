-- TRIRIGA Server Connections
CREATE TABLE IF NOT EXISTS servers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    host TEXT NOT NULL,
    port INTEGER NOT NULL DEFAULT 8001,
    protocol TEXT NOT NULL DEFAULT 'http', -- 'http', 'https', 'ssh'
    admin_path TEXT DEFAULT '/html/en/default/admin',
    username TEXT,
    password TEXT,
    auth_type TEXT DEFAULT 'form', -- 'form', 'basic', 'ssh_key', 'ssh_password'
    ssh_key_path TEXT,
    remote_log_dir TEXT DEFAULT '/opt/tririga/userfiles/log',
    status TEXT DEFAULT 'configured', -- 'configured', 'online', 'error', 'syncing'
    cluster_name TEXT DEFAULT NULL, -- Cluster assignment e.g. 'Production Cluster'
    last_sync_at TEXT,
    created_at TEXT DEFAULT (datetime('now', 'utc'))
);

-- Ingested Log Files
CREATE TABLE IF NOT EXISTS log_files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    server_id INTEGER NOT NULL,
    filename TEXT NOT NULL,
    file_type TEXT NOT NULL, -- 'server', 'security', 'workflow', 'gc', 'datapool', 'custom', 'other'
    local_path TEXT NOT NULL,
    size_bytes INTEGER DEFAULT 0,
    downloaded_at TEXT DEFAULT (datetime('now', 'utc')),
    status TEXT DEFAULT 'pending', -- 'pending', 'parsed', 'error'
    entry_count INTEGER DEFAULT 0,
    error_count INTEGER DEFAULT 0,
    warn_count INTEGER DEFAULT 0,
    FOREIGN KEY (server_id) REFERENCES servers(id) ON DELETE CASCADE
);

-- Parsed Log Entries
CREATE TABLE IF NOT EXISTS log_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    server_id INTEGER NOT NULL,
    file_id INTEGER NOT NULL,
    timestamp TEXT NOT NULL, -- Normalized ISO8601 UTC string (YYYY-MM-DDTHH:MM:SS.sssZ)
    log_level TEXT NOT NULL, -- 'FATAL', 'ERROR', 'WARN', 'INFO', 'DEBUG', 'TRACE', 'SYSTEM'
    logger_name TEXT,
    thread_name TEXT,
    message TEXT NOT NULL,
    stack_trace TEXT,
    error_hash TEXT, -- MD5 of normalized error signature for clustering
    line_number INTEGER,
    raw_content TEXT,
    FOREIGN KEY (server_id) REFERENCES servers(id) ON DELETE CASCADE,
    FOREIGN KEY (file_id) REFERENCES log_files(id) ON DELETE CASCADE
);

-- Indices for fast filtering and chronological amalgamations
CREATE INDEX IF NOT EXISTS idx_log_entries_timestamp ON log_entries(timestamp);
CREATE INDEX IF NOT EXISTS idx_log_entries_level ON log_entries(log_level);
CREATE INDEX IF NOT EXISTS idx_log_entries_server ON log_entries(server_id);
CREATE INDEX IF NOT EXISTS idx_log_entries_file ON log_entries(file_id);
CREATE INDEX IF NOT EXISTS idx_log_entries_error_hash ON log_entries(error_hash);
CREATE INDEX IF NOT EXISTS idx_log_entries_srv_ts ON log_entries(server_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_log_entries_ts_lvl ON log_entries(timestamp, log_level);
CREATE INDEX IF NOT EXISTS idx_log_entries_srv_ts_lvl ON log_entries(server_id, timestamp, log_level);
CREATE INDEX IF NOT EXISTS idx_log_entries_errhash_ts ON log_entries(error_hash, timestamp);
CREATE INDEX IF NOT EXISTS idx_log_entries_srv_lvl_hash ON log_entries(server_id, log_level, error_hash);

-- Full Text Search Table (FTS5) using external content table
CREATE VIRTUAL TABLE IF NOT EXISTS log_entries_fts USING fts5(
    message,
    stack_trace,
    logger_name,
    content='log_entries',
    content_rowid='id'
);

-- FTS Triggers to keep FTS index synced with log_entries
CREATE TRIGGER IF NOT EXISTS log_entries_ai AFTER INSERT ON log_entries BEGIN
  INSERT INTO log_entries_fts(rowid, message, stack_trace, logger_name)
  VALUES (new.id, new.message, new.stack_trace, new.logger_name);
END;

CREATE TRIGGER IF NOT EXISTS log_entries_ad AFTER DELETE ON log_entries BEGIN
  INSERT INTO log_entries_fts(log_entries_fts, rowid, message, stack_trace, logger_name)
  VALUES ('delete', old.id, old.message, old.stack_trace, old.logger_name);
END;

CREATE TRIGGER IF NOT EXISTS log_entries_au AFTER UPDATE ON log_entries BEGIN
  INSERT INTO log_entries_fts(log_entries_fts, rowid, message, stack_trace, logger_name)
  VALUES ('delete', old.id, old.message, old.stack_trace, old.logger_name);
  INSERT INTO log_entries_fts(rowid, message, stack_trace, logger_name)
  VALUES (new.id, new.message, new.stack_trace, new.logger_name);
END;

-- LLM Generated Forensic Reports
CREATE TABLE IF NOT EXISTS analysis_reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now', 'utc')),
    model_used TEXT NOT NULL,
    provider TEXT NOT NULL,
    severity TEXT NOT NULL DEFAULT 'medium', -- 'critical', 'high', 'medium', 'low', 'info'
    summary TEXT NOT NULL,
    issues_json TEXT, -- JSON array of detected issues with root cause, affected components, remediation
    raw_report TEXT NOT NULL,
    server_ids TEXT, -- JSON array or comma-separated server IDs
    time_window_start TEXT,
    time_window_end TEXT,
    total_logs_analyzed INTEGER DEFAULT 0,
    total_errors_analyzed INTEGER DEFAULT 0
);

-- LLM Configuration Profiles
CREATE TABLE IF NOT EXISTS llm_configs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    provider TEXT NOT NULL, -- 'ollama', 'lm_studio', 'openai_compatible'
    base_url TEXT NOT NULL,
    model_name TEXT NOT NULL,
    temperature REAL DEFAULT 0.2,
    context_window INTEGER DEFAULT 32768,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now', 'utc'))
);

-- Automated Log Ingestion Schedule
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

-- Cold Log Archives Catalog
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
    server_ids TEXT, -- JSON array of server IDs
    server_names TEXT, -- Comma-separated server names
    retention_days INTEGER DEFAULT 7,
    created_at TEXT DEFAULT (datetime('now', 'utc'))
);

CREATE INDEX IF NOT EXISTS idx_log_archives_timestamp ON log_archives(min_timestamp, max_timestamp);

-- Storage and Retention Settings
CREATE TABLE IF NOT EXISTS storage_settings (
    id INTEGER PRIMARY KEY DEFAULT 1,
    retention_days INTEGER DEFAULT 7,
    auto_prune_enabled INTEGER DEFAULT 1,
    compress_raw_logs INTEGER DEFAULT 1,
    last_pruned_at TEXT,
    last_prune_summary TEXT,
    updated_at TEXT DEFAULT (datetime('now', 'utc'))
);

