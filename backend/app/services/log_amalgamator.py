# -*- coding: utf-8 -*-
import re
import hashlib
import os
from pathlib import Path
from datetime import datetime, timezone
from typing import List, Dict, Any, Optional, Tuple, Generator, Iterable
import sqlite3

# Regex patterns for various TRIRIGA / Java / Liberty log line headers

# 1. Standard TRIRIGA Log4j: 2026-08-31 10:15:23,456 ERROR [com.tririga.ws.TririgaWS](thread) Message or [thread] Message
PATTERN_TRIRIGA_LOG4J = re.compile(
    r"^\s*(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}(?:[,\.]\d{3})?)\s+([A-Za-z]+)\s+\[([^\]]+)\](?:\s*[\(\[]([^\)\]]+)[\)\]])?\s*(.*)$"
)

# 2. ISO timestamp format: 2026-08-31T10:15:23.456Z [ERROR] com.tririga.service: Message
PATTERN_ISO = re.compile(
    r"^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:[,\.]\d{3})?(?:Z|[+-]\d{2}:?\d{2})?)\s+(?:\[([A-Z]+)\]|([A-Z]+))\s*(?:\[([^\]]+)\])?\s*(?:- )?(.*)$"
)

# 3. WebSphere / Open Liberty format: [8/31/26 10:15:23:456 UTC] 0000003a SystemErr R java.lang...
PATTERN_LIBERTY = re.compile(
    r"^\[(\d{1,2}/\d{1,2}/\d{2,4}\s+\d{1,2}:\d{2}:\d{2}(?::\d{3})?\s+[A-Z]+)\]\s+([0-9a-fA-F]+)\s+([A-Za-z0-9_]+)\s+([A-Z])\s+(.*)$"
)

# 4. Generic Date Time Level: 31-Aug-2026 10:15:23.456 ERROR [thread] logger - message
PATTERN_GENERIC = re.compile(
    r"^(\d{1,2}-[A-Za-z]{3}-\d{4}\s+\d{2}:\d{2}:\d{2}(?:[,\.]\d{3})?)\s+([A-Z]+)\s+(?:\[([^\]]+)\])?\s*(.*)$"
)

# 5. GC Log: 2026-08-31T10:15:23.456+0000: [GC ...
PATTERN_GC = re.compile(
    r"^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:[,\.]\d{3})?(?:[+-]\d{4})?):\s+(\[.*\])"
)

RE_STD_MS = re.compile(r"^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}[,\.]\d{3}$")
RE_STD_NOMS = re.compile(r"^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}$")
RE_LIBERTY = re.compile(r"^(\d{1,2})/(\d{1,2})/(\d{2,4})\s+(\d{1,2}):(\d{2}):(\d{2}):(\d{3})\s+([A-Z]+)$")

def normalize_timestamp(ts_str: str) -> str:
    """Normalizes a wide variety of log timestamp formats to ISO8601 UTC string: YYYY-MM-DDTHH:MM:SS.sssZ"""
    ts_str = ts_str.strip()
    try:
        # 1. Standard YYYY-MM-DD HH:MM:SS,sss or YYYY-MM-DD HH:MM:SS.sss
        if RE_STD_MS.match(ts_str):
            clean = ts_str.replace(",", ".")
            dt = datetime.strptime(clean, "%Y-%m-%d %H:%M:%S.%f")
            return dt.replace(tzinfo=timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"
        
        # Standard YYYY-MM-DD HH:MM:SS without ms
        if RE_STD_NOMS.match(ts_str):
            dt = datetime.strptime(ts_str, "%Y-%m-%d %H:%M:%S")
            return dt.replace(tzinfo=timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")

        # 2. Liberty format: M/D/YY HH:MM:SS:sss TZ or MM/DD/YYYY HH:MM:SS:sss TZ
        liberty_match = RE_LIBERTY.match(ts_str)
        if liberty_match:
            m, d, y, hh, mm, ss, ms, tz = liberty_match.groups()
            year = int(y)
            if year < 100:
                year += 2000
            dt = datetime(year, int(m), int(d), int(hh), int(mm), int(ss), int(ms) * 1000, tzinfo=timezone.utc)
            return dt.strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"

        # 3. ISO format with T
        if "T" in ts_str:
            clean = ts_str.replace("+0000", "Z").replace("+00:00", "Z")
            if clean.endswith("Z"):
                clean = clean[:-1]
                if "." in clean:
                    dt = datetime.strptime(clean, "%Y-%m-%dT%H:%M:%S.%f")
                else:
                    dt = datetime.strptime(clean, "%Y-%m-%dT%H:%M:%S")
                return dt.replace(tzinfo=timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"

        # Fallback to general parsing
        dt = datetime.fromisoformat(ts_str)
        return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"
    except Exception:
        # Fallback default UTC now if unparseable
        return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")

def normalize_level(raw_level: Optional[str]) -> str:
    if not raw_level:
        return "INFO"
    l = raw_level.strip().upper()
    if l in ("SEVERE", "FATAL", "CRITICAL", "EMERGENCY"):
        return "FATAL"
    if l in ("ERROR", "ERR", "EXCEPTION", "SystemErr"):
        return "ERROR"
    if l in ("WARNING", "WARN"):
        return "WARN"
    if l in ("INFO", "INFORMATIONAL", "SystemOut", "STATUS"):
        return "INFO"
    if l in ("DEBUG", "FINE", "FINER", "FINEST"):
        return "DEBUG"
    if l in ("TRACE",):
        return "TRACE"
    return "INFO"

def compute_error_hash(message: str, stack_trace: Optional[str]) -> str:
    """Computes a normalized hash for clustering similar exceptions together."""
    combined = (message or "").strip()
    if stack_trace:
        # Take first 3 lines of stack trace for signature
        trace_lines = [line.strip() for line in stack_trace.splitlines() if line.strip()]
        first_few = " ".join(trace_lines[:3])
        # Strip specific line numbers to cluster generic errors across invocations
        first_few = re.sub(r":\d+", "", first_few)
        combined += " " + first_few
    return hashlib.md5(combined.encode("utf-8", errors="ignore")).hexdigest()

class ParsedEntry:
    def __init__(
        self,
        server_id: int,
        file_id: int,
        timestamp: str,
        log_level: str,
        logger_name: Optional[str],
        thread_name: Optional[str],
        message: str,
        line_number: int,
        raw_content: str
    ):
        self.server_id = server_id
        self.file_id = file_id
        self.timestamp = timestamp
        self.log_level = log_level
        self.logger_name = logger_name
        self.thread_name = thread_name
        self.message = message
        self.line_number = line_number
        self.raw_content = raw_content
        self.stack_trace_lines: List[str] = []

    def append_trace_line(self, line: str):
        self.stack_trace_lines.append(line)

    def to_dict(self) -> Dict[str, Any]:
        stack_trace = "\n".join(self.stack_trace_lines) if self.stack_trace_lines else None
        full_raw = self.raw_content
        if self.stack_trace_lines:
            full_raw += "\n" + "\n".join(self.stack_trace_lines)
            
        error_hash = None
        if self.log_level in ("ERROR", "FATAL", "WARN"):
            error_hash = compute_error_hash(self.message, stack_trace)

        return {
            "server_id": self.server_id,
            "file_id": self.file_id,
            "timestamp": self.timestamp,
            "log_level": self.log_level,
            "logger_name": self.logger_name,
            "thread_name": self.thread_name,
            "message": self.message,
            "stack_trace": stack_trace,
            "error_hash": error_hash,
            "line_number": self.line_number,
            "raw_content": full_raw
        }

class LogAmalgamator:
    """Parses raw TRIRIGA log files and amalgamates them into normalized SQLite entries."""

    @staticmethod
    def parse_line_header(line: str) -> Optional[Tuple[str, str, Optional[str], Optional[str], str]]:
        """
        Attempts to parse a line as a new log entry header.
        Returns (timestamp, level, logger_name, thread_name, message) or None if it's a continuation line.
        """
        # Check TRIRIGA Log4j
        m = PATTERN_TRIRIGA_LOG4J.match(line)
        if m:
            ts, lvl, logger, thread, msg = m.groups()
            return normalize_timestamp(ts), normalize_level(lvl), logger, thread, msg

        # Check ISO
        m = PATTERN_ISO.match(line)
        if m:
            ts, lvl1, lvl2, logger, msg = m.groups()
            lvl = lvl1 or lvl2 or "INFO"
            return normalize_timestamp(ts), normalize_level(lvl), logger, None, msg

        # Check WebSphere / Liberty
        m = PATTERN_LIBERTY.match(line)
        if m:
            ts, thread, src, typ, msg = m.groups()
            lvl = "ERROR" if src == "SystemErr" else "INFO"
            return normalize_timestamp(ts), lvl, src, thread, msg

        # Check Generic
        m = PATTERN_GENERIC.match(line)
        if m:
            ts, lvl, logger, msg = m.groups()
            return normalize_timestamp(ts), normalize_level(lvl), logger, None, msg

        # Check GC
        m = PATTERN_GC.match(line)
        if m:
            ts, msg = m.groups()
            return normalize_timestamp(ts), "INFO", "GarbageCollector", "GC", msg

        return None

    @classmethod
    def stream_parsed_entries(
        cls,
        line_iterable: Iterable[str],
        server_id: int,
        file_id: int
    ) -> Generator[Dict[str, Any], None, None]:
        """Streams parsed log entries one by one from an iterable of lines without loading all into memory."""
        current_entry: Optional[ParsedEntry] = None

        for idx, line in enumerate(line_iterable, start=1):
            line_str = line.rstrip("\r\n")
            if not line_str.strip():
                continue

            header = cls.parse_line_header(line_str)
            if header:
                if current_entry:
                    yield current_entry.to_dict()
                ts, lvl, logger, thread, msg = header
                current_entry = ParsedEntry(
                    server_id=server_id,
                    file_id=file_id,
                    timestamp=ts,
                    log_level=lvl,
                    logger_name=logger,
                    thread_name=thread,
                    message=msg,
                    line_number=idx,
                    raw_content=line_str
                )
            else:
                if current_entry:
                    current_entry.append_trace_line(line_str)
                else:
                    # Orphan line at start of file
                    ts = normalize_timestamp(datetime.now(timezone.utc).isoformat())
                    current_entry = ParsedEntry(
                        server_id=server_id,
                        file_id=file_id,
                        timestamp=ts,
                        log_level="INFO",
                        logger_name="System",
                        thread_name=None,
                        message=line_str,
                        line_number=idx,
                        raw_content=line_str
                    )

        if current_entry:
            yield current_entry.to_dict()

    @classmethod
    def parse_log_text(cls, text: str, server_id: int, file_id: int) -> List[Dict[str, Any]]:
        """Parses full log text, handling multiline exceptions and stack traces."""
        return list(cls.stream_parsed_entries(text.splitlines(), server_id, file_id))

    @classmethod
    def ingest_file(
        cls,
        conn: sqlite3.Connection,
        server_id: int,
        file_id: int,
        text_or_path: Any,
        batch_size: int = 2000
    ) -> Dict[str, int]:
        """
        Ingests and indexes a log file into SQLite using streaming batch inserts.
        Accepts either a raw text string or a local file Path/path string for zero-memory footprint.
        """
        cur = conn.cursor()
        total_count = 0
        error_count = 0
        warn_count = 0
        batch: List[Tuple] = []

        def get_line_stream():
            if isinstance(text_or_path, (str, Path)) and os.path.exists(str(text_or_path)):
                with open(str(text_or_path), "r", encoding="utf-8", errors="replace") as f:
                    for line in f:
                        yield line
            elif isinstance(text_or_path, str):
                for line in text_or_path.splitlines():
                    yield line
            else:
                for line in text_or_path:
                    yield line

        for entry in cls.stream_parsed_entries(get_line_stream(), server_id, file_id):
            total_count += 1
            if entry["log_level"] in ("ERROR", "FATAL"):
                error_count += 1
            elif entry["log_level"] == "WARN":
                warn_count += 1

            batch.append((
                entry["server_id"],
                entry["file_id"],
                entry["timestamp"],
                entry["log_level"],
                entry["logger_name"],
                entry["thread_name"],
                entry["message"],
                entry["stack_trace"],
                entry["error_hash"],
                entry["line_number"],
                entry["raw_content"]
            ))

            if len(batch) >= batch_size:
                cur.executemany("""
                    INSERT INTO log_entries (
                        server_id, file_id, timestamp, log_level, logger_name,
                        thread_name, message, stack_trace, error_hash, line_number, raw_content
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
                """, batch)
                batch.clear()

        if batch:
            cur.executemany("""
                INSERT INTO log_entries (
                    server_id, file_id, timestamp, log_level, logger_name,
                    thread_name, message, stack_trace, error_hash, line_number, raw_content
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
            """, batch)
            batch.clear()

        cur.execute("""
            UPDATE log_files
            SET status='parsed', entry_count=?, error_count=?, warn_count=?
            WHERE id=?;
        """, (total_count, error_count, warn_count, file_id))

        return {"total": total_count, "errors": error_count, "warns": warn_count}
