import json
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from sse_starlette.sse import EventSourceResponse
from typing import List, Optional, Dict, Any
from ..db.database import db_session, dict_from_row, dict_list_from_rows
from ..services.local_llm import LocalLLMService

router = APIRouter(prefix="/api/analysis", tags=["LLM Analysis & Diagnostics"])

class AnalysisRequest(BaseModel):
    provider: Optional[str] = None
    base_url: Optional[str] = None
    model_name: Optional[str] = None
    temperature: float = 0.2
    server_ids: Optional[List[int]] = None
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    date_preset: Optional[str] = None
    context_window: Optional[int] = None

class ChatRequest(BaseModel):
    query: str
    provider: Optional[str] = None
    base_url: Optional[str] = None
    model_name: Optional[str] = None
    server_ids: Optional[List[int]] = None
    density: Optional[str] = "concise" # 'concise' (fast) or 'comprehensive' (deep forensic audit)
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    date_preset: Optional[str] = None
    context_window: Optional[int] = None

class SaveReportRequest(BaseModel):
    title: str
    model_used: str
    provider: str
    severity: str
    summary: str
    raw_report: str
    server_ids: Optional[List[int]] = None

def get_active_llm_config() -> Dict[str, Any]:
    with db_session() as conn:
        cur = conn.cursor()
        cur.execute("SELECT * FROM llm_configs WHERE is_active=1 LIMIT 1;")
        row = cur.fetchone()
        if row:
            return dict_from_row(row)
        return {
            "provider": "lm_studio",
            "base_url": "http://localhost:1234/v1",
            "model_name": "qwen/qwen3.5-9b",
            "temperature": 0.1,
            "context_window": 32768
        }

from fastapi.responses import StreamingResponse
import asyncio

async def sse_heartbeat_stream(async_gen, ping_interval: float = 8.0):
    """
    Wraps an async generator with periodic SSE keep-alive comments (': keepalive-ping\\n\\n')
    every `ping_interval` seconds whenever upstream token generation or thinking is ongoing.
    This prevents browser fetch timeouts, intermediate proxy drops, and TCP RST resets.
    """
    queue = asyncio.Queue()
    done_sentinel = object()

    async def producer():
        try:
            async for item in async_gen:
                await queue.put(item)
        except Exception as e:
            await queue.put(e)
        finally:
            await queue.put(done_sentinel)

    producer_task = asyncio.create_task(producer())

    try:
        while True:
            try:
                item = await asyncio.wait_for(queue.get(), timeout=ping_interval)
                if item is done_sentinel:
                    break
                if isinstance(item, Exception):
                    # Yield error format rather than unhandled exception
                    yield f"data: {{\"chunk\": \"\\n\\n*(Inference interrupted: {str(item)})*\"}}\n\n"
                    break
                yield f"data: {item}\n\n"
            except asyncio.TimeoutError:
                # Send SSE comment to keep TCP connection alive
                yield ": keepalive-ping\n\n"
    finally:
        if not producer_task.done():
            producer_task.cancel()

@router.post("/stream-report")
async def stream_report(req: AnalysisRequest):
    """Streams a Production Log AI analysis focused on prod app1 and prod app2 logs."""
    cfg = get_active_llm_config()
    provider = req.provider or cfg["provider"]
    base_url = req.base_url or cfg["base_url"]
    model_name = req.model_name or cfg["model_name"]
    temperature = req.temperature if req.temperature is not None else cfg.get("temperature", 0.2)
    context_window = req.context_window or cfg.get("context_window", 32768)

    # If server_ids provided, use them; otherwise None implies all cluster nodes
    server_ids = req.server_ids if req.server_ids else None

    return StreamingResponse(
        sse_heartbeat_stream(
            LocalLLMService.stream_analysis(
                provider=provider,
                base_url=base_url,
                model_name=model_name,
                temperature=temperature,
                server_ids=server_ids,
                start_time=req.start_time,
                end_time=req.end_time,
                date_preset=req.date_preset,
                context_window=context_window,
            ),
            ping_interval=8.0
        ),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"
        }
    )

@router.post("/stream-chat")
async def stream_chat(req: ChatRequest):
    """Streams interactive answers to questions asked against the amalgamated log database."""
    cfg = get_active_llm_config()
    provider = req.provider or cfg["provider"]
    base_url = req.base_url or cfg["base_url"]
    model_name = req.model_name or cfg["model_name"]
    context_window = req.context_window or cfg.get("context_window", 32768)

    return StreamingResponse(
        sse_heartbeat_stream(
            LocalLLMService.chat_with_logs(
                provider=provider,
                base_url=base_url,
                model_name=model_name,
                user_query=req.query,
                server_ids=req.server_ids,
                density=req.density or "concise",
                start_time=req.start_time,
                end_time=req.end_time,
                date_preset=req.date_preset,
                context_window=context_window,
            ),
            ping_interval=8.0
        ),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"
        }
    )

@router.get("/reports", response_model=List[Dict[str, Any]])
def list_reports():
    """Lists previously saved AI forensic reports."""
    with db_session() as conn:
        cur = conn.cursor()
        cur.execute("SELECT * FROM analysis_reports ORDER BY created_at DESC;")
        return dict_list_from_rows(cur.fetchall())

@router.post("/reports", response_model=Dict[str, Any])
def save_report(report: SaveReportRequest):
    """Saves a generated analysis report for persistent audit records."""
    with db_session() as conn:
        cur = conn.cursor()
        server_ids_str = json.dumps(report.server_ids) if report.server_ids else None
        cur.execute("""
            INSERT INTO analysis_reports (
                title, model_used, provider, severity, summary, raw_report, server_ids
            ) VALUES (?, ?, ?, ?, ?, ?, ?);
        """, (
            report.title, report.model_used, report.provider, report.severity,
            report.summary, report.raw_report, server_ids_str
        ))
        report_id = cur.lastrowid
        cur.execute("SELECT * FROM analysis_reports WHERE id=?", (report_id,))
        return dict_from_row(cur.fetchone())

class ExportDocxRequest(BaseModel):
    title: Optional[str] = "IBM TRIRIGA Forensic Audit Report"
    markdown_content: str

from ..services.docx_exporter import DocxReportExporter
import re

@router.post("/export-docx")
def export_docx(req: ExportDocxRequest):
    """Generates and downloads a styled Word document (.docx) from Markdown report content."""
    if not req.markdown_content or not req.markdown_content.strip():
        raise HTTPException(status_code=400, detail="Markdown content cannot be empty.")
    
    stream = DocxReportExporter.generate_docx(req.markdown_content, title=req.title or "TRIRIGA Log Audit Report")
    safe_title = re.sub(r'[^a-zA-Z0-9_\-\s]', '', req.title or 'tririga_log_audit_report').strip().replace(' ', '_')
    filename = f"{safe_title}.docx"
    
    return StreamingResponse(
        stream,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Cache-Control": "no-cache",
        }
    )

@router.get("/reports/{report_id}/export-docx")
def export_saved_report_docx(report_id: int):
    """Generates and downloads a styled Word document (.docx) for a saved report."""
    with db_session() as conn:
        cur = conn.cursor()
        cur.execute("SELECT * FROM analysis_reports WHERE id=?", (report_id,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Report not found")
        report = dict_from_row(row)
    
    stream = DocxReportExporter.generate_docx(report["raw_report"], title=report["title"])
    safe_title = re.sub(r'[^a-zA-Z0-9_\-\s]', '', report['title']).strip().replace(' ', '_')
    filename = f"{safe_title}.docx"
    
    return StreamingResponse(
        stream,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Cache-Control": "no-cache",
        }
    )

@router.delete("/reports/{report_id}")
def delete_report(report_id: int):
    """Deletes a saved forensic report."""
    with db_session() as conn:
        cur = conn.cursor()
        cur.execute("DELETE FROM analysis_reports WHERE id=?", (report_id,))
        return {"success": True, "message": f"Report {report_id} deleted."}
