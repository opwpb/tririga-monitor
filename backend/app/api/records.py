from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
from ..services.tririga_resolver import TririgaResolver

router = APIRouter(prefix="/api/tririga", tags=["TRIRIGA Record Resolution"])

class ExtractRequest(BaseModel):
    text: str

@router.get("/resolve-spec/{spec_id}")
def get_resolved_spec(spec_id: int):
    """Resolves a TRIRIGA Spec ID to human-readable record details (BO, name, status, control number)."""
    rec = TririgaResolver.resolve_spec(spec_id)
    if not rec:
        raise HTTPException(status_code=404, detail=f"Spec ID {spec_id} could not be resolved.")
    return rec

@router.get("/resolve-workflow/{wf_id}")
def get_resolved_workflow(wf_id: int):
    """Resolves a TRIRIGA Workflow Template ID to workflow metadata."""
    wf = TririgaResolver.resolve_workflow(wf_id)
    if not wf:
        raise HTTPException(status_code=404, detail=f"Workflow ID {wf_id} could not be resolved.")
    return wf

@router.get("/resolve/{identifier}")
def get_resolved_identifier(
    identifier: str, 
    include_logs: bool = Query(False, description="Scan cluster logs for occurrences (optional)")
):
    """Resolves any TRIRIGA identifier (Spec ID, Control Number, Workflow ID, User ID) to its name and metadata instantly."""
    rec = TririgaResolver.resolve_identifier(identifier, include_logs=include_logs)
    if not rec:
        raise HTTPException(status_code=404, detail=f"Record '{identifier}' could not be resolved.")
    return rec

@router.get("/resolve/{identifier}/logs")
def get_record_associated_logs(
    identifier: str, 
    limit: int = Query(15, ge=1, le=100, description="Max logs to return")
):
    """Explicitly scans cluster logs for occurrences of this TRIRIGA record or identifier on demand."""
    logs = TririgaResolver.find_associated_logs(identifier, limit=limit)
    return {
        "identifier": identifier,
        "count": len(logs),
        "logs": logs
    }

@router.post("/extract-and-resolve")
def extract_and_resolve_records(req: ExtractRequest):
    """Extracts all Spec IDs, Control Numbers, Workflow IDs, and BO Types from a log message or stack trace, and returns resolved records."""
    ids = TririgaResolver.extract_identifiers(req.text)
    resolved_specs = [TririgaResolver.resolve_spec(sid) for sid in ids.get("spec_ids", [])[:10]]
    resolved_ctrls = [TririgaResolver.resolve_identifier(ctrl) for ctrl in ids.get("control_numbers", [])[:10]]
    resolved_wfs = [TririgaResolver.resolve_workflow(wfid) for wfid in ids.get("wf_ids", [])[:5]]
    
    return {
        "extracted_ids": ids,
        "resolved_specs": resolved_specs,
        "resolved_control_numbers": resolved_ctrls,
        "resolved_workflows": resolved_wfs,
        "formatted_summary": TririgaResolver.build_evidence_resolution_block(req.text)
    }

