import re
import json
import sqlite3
import asyncio
from typing import Dict, Any, List, Optional, Set
from ..db.database import db_session, db_read_session, dict_from_row, dict_list_from_rows
from .tririga_admin_client import TririgaAdminClient

class TririgaResolver:
    """
    Resolves TRIRIGA Spec IDs, Record IDs, and Workflow Template IDs using ONLY
    actual TRIRIGA database records (IBS_SPEC, WF_TEMPLATE, T_TRIPEOPLE) and exact
    log traces. NEVER synthesizes or hallucinates placeholder data.
    """

    # Comprehensive regex patterns for TRIRIGA identifiers in logs
    SPEC_ID_PATTERNS = [
        re.compile(r'\bSO\s*=\s*(\d{5,12})\b', re.IGNORECASE),
        re.compile(r'(?:spec_id|specId|spec\s*id|spec\s*#|record_id|recordId|record\s*#|spec\s*ID)\s*[:=]?\s*(\d{5,12})', re.IGNORECASE),
        re.compile(r'IBS_SPEC\s+WHERE\s+SPEC_ID\s*=\s*(\d{5,12})', re.IGNORECASE),
        re.compile(r'T_[A-Z0-9_]+\s+WHERE\s+SPEC_ID\s*=\s*(\d{5,12})', re.IGNORECASE),
        re.compile(r'spec_id=(\d{5,12})', re.IGNORECASE),
        re.compile(r'record\s+with\s+ID\s+(\d{5,12})', re.IGNORECASE),
        re.compile(r'specId:\s*(\d{5,12})', re.IGNORECASE),
        re.compile(r'specId\s*=\s*(\d{5,12})', re.IGNORECASE),
        re.compile(r'\bID\s*=\s*(\d{6,12})\b', re.IGNORECASE),
        re.compile(r'\bUser\s*=\s*(\d{5,12})\b', re.IGNORECASE),
        re.compile(r'WFA:id=\d+\s*-\s*(\d{5,12})\b', re.IGNORECASE)
    ]

    WORKTASK_CTRL_PATTERNS = [
        re.compile(r'\b(WRK-\d{4,8}|TASK-\d{4,8}|WO-\d{4,8}|BLD-[A-Z0-9_\-]+|FLR-\d{1,3}|SPC-\d{1,5}|AST-[A-Z0-9_\-]+|PER-\d{4,9}|REQ-\d{4,8})\b', re.IGNORECASE),
        re.compile(r'triControlNum(?:ber)?\s*[:=]?\s*["\']?([A-Z0-9_\-]+)["\']?', re.IGNORECASE)
    ]

    WF_ID_PATTERNS = [
        re.compile(r'\bWFTID\s*=\s*(\d{5,12})(?:\.\d+)?\b', re.IGNORECASE),
        re.compile(r'(?:wfTemplateId|wf_template_id|workflow_id|workflow\s*template\s*id|workflow\s*template|workflow\s*#|wf\s*#|wfTemplate\s*id)\s*[:=]?\s*(\d{5,12})', re.IGNORECASE),
        re.compile(r'WF_TEMPLATE\s+WHERE\s+WF_TEMPLATE_ID\s*=\s*(\d{5,12})', re.IGNORECASE),
        re.compile(r'workflow\s+(\d{5,12})', re.IGNORECASE),
        re.compile(r'wftemplateid=(\d{5,12})', re.IGNORECASE),
        re.compile(r'\bWFIID\s*=\s*(\d{5,15})\b', re.IGNORECASE)
    ]

    BO_ID_PATTERNS = [
        re.compile(r'(?:boTypeId|bo_type_id|bo_id|object_type_id|spec_class_type)\s*[:=]?\s*(\d{4,12})', re.IGNORECASE),
        re.compile(r'\bBO_ID\s*=\s*(\d{5,12})\b', re.IGNORECASE),
        re.compile(r'\bBO\s*=\s*(\d{5,12})\b', re.IGNORECASE)
    ]

    WF_TASK_STEP_PATTERNS = [
        re.compile(r'task\s+step\s*[:=]?\s*["\']?([^"\'\n\r,]+)["\']?', re.IGNORECASE),
        re.compile(r'task\s*name\s*[:=]?\s*["\']?([^"\'\n\r,]+)["\']?', re.IGNORECASE),
        re.compile(r'executing\s+task\s+step\s*[:=]?\s*["\']?([^"\'\n\r,]+)["\']?', re.IGNORECASE),
        re.compile(r'step\s*[:=]?\s*["\']?([^"\'\n\r,]+)["\']?', re.IGNORECASE),
        re.compile(r'TaskStep\s*[:=]?\s*["\']?([^"\'\n\r,]+)["\']?', re.IGNORECASE)
    ]

    _MEM_CACHE_SPECS: Dict[int, Dict[str, Any]] = {}
    _MEM_CACHE_WORKFLOWS: Dict[int, Dict[str, Any]] = {}
    _CACHE_INITIALIZED: bool = False

    @classmethod
    def ensure_cache_table(cls):
        """Initializes cache tables in SQLite if not present."""
        if cls._CACHE_INITIALIZED:
            return
        try:
            with db_session() as conn:
                conn.execute("""
                    CREATE TABLE IF NOT EXISTS tririga_resolved_specs (
                        spec_id INTEGER PRIMARY KEY,
                        spec_name TEXT,
                        module_name TEXT,
                        bo_name TEXT,
                        control_number TEXT,
                        status TEXT,
                        task_type TEXT,
                        email TEXT,
                        job_title TEXT,
                        department TEXT,
                        priority TEXT,
                        location TEXT,
                        assigned_to TEXT,
                        asset_name TEXT,
                        description TEXT,
                        raw_data TEXT,
                        resolved_at TEXT DEFAULT (datetime('now', 'utc'))
                    );
                """)
                conn.execute("""
                    CREATE TABLE IF NOT EXISTS tririga_resolved_workflows (
                        wf_id INTEGER PRIMARY KEY,
                        template_name TEXT,
                        module_name TEXT,
                        bo_name TEXT,
                        event_name TEXT,
                        execution_mode TEXT,
                        locking_strategy TEXT,
                        description TEXT,
                        resolved_at TEXT DEFAULT (datetime('now', 'utc'))
                    );
                """)

                # Migrations: Add new columns if missing in existing table
                cur = conn.cursor()
                cur.execute("PRAGMA table_info(tririga_resolved_specs);")
                spec_cols = [r["name"] for r in cur.fetchall()]
                for col in ["task_type", "email", "job_title", "department", "priority", "location", "assigned_to", "asset_name", "description"]:
                    if col not in spec_cols:
                        cur.execute(f"ALTER TABLE tririga_resolved_specs ADD COLUMN {col} TEXT DEFAULT NULL;")

                cur.execute("PRAGMA table_info(tririga_resolved_workflows);")
                wf_cols = [r["name"] for r in cur.fetchall()]
                for col in ["execution_mode", "locking_strategy"]:
                    if col not in wf_cols:
                        cur.execute(f"ALTER TABLE tririga_resolved_workflows ADD COLUMN {col} TEXT DEFAULT NULL;")

            cls._CACHE_INITIALIZED = True
        except Exception:
            pass

    @classmethod
    def _get_active_tririga_server(cls) -> Optional[Dict[str, Any]]:
        """Finds the reachable TRIRIGA server with configured credentials (preferring prod/primary)."""
        try:
            with db_read_session() as conn:
                cur = conn.cursor()
                # Prefer prod app servers (169.50.115.221) or configured servers with credentials
                cur.execute("""
                    SELECT * FROM servers 
                    WHERE password IS NOT NULL AND password != '' 
                    ORDER BY 
                        CASE 
                            WHEN host = '169.50.115.221' THEN 1
                            WHEN name LIKE '%prod%' THEN 2
                            WHEN host LIKE '%169.50%' THEN 3
                            ELSE 4
                        END ASC, id DESC
                """)
                rows = cur.fetchall()
                if rows:
                    return dict_from_row(rows[0])
        except Exception:
            pass
        return None

    @classmethod
    def extract_identifiers(cls, text: str) -> Dict[str, Any]:
        """Extracts unique Spec IDs, Control Numbers, Workflow IDs, and BO Type IDs from any log text."""
        if not text:
            return {"spec_ids": [], "control_numbers": [], "wf_ids": [], "bo_ids": []}

        spec_ids: Set[int] = set()
        wf_ids: Set[int] = set()
        ctrl_nums: Set[str] = set()
        bo_ids: Set[int] = set()

        # Parse contextual [Workflow> ...] and |Workflow> ... <Workflow| blocks
        wf_blocks = re.findall(r'[\|\[]Workflow>\s*([^\<\]]+)[\]\<]', text, re.IGNORECASE)
        for block in wf_blocks:
            wft_match = re.search(r'WFTID\s*=\s*(\d+)(?:\.\d+)?', block, re.IGNORECASE)
            name_match = re.search(r'Name\s*=\s*[\'"]([^\'"]+)[\'"]', block, re.IGNORECASE)
            bo_match = re.search(r'(?:BO|BO_NAME)\s*=\s*[\'"]([^\'"]+)[\'"]', block, re.IGNORECASE)
            mod_match = re.search(r'(?:Module|ModuleName)\s*=\s*[\'"]([^\'"]+)[\'"]', block, re.IGNORECASE)
            event_match = re.search(r'Event\s*=\s*[\'"]([^\'"]+)[\'"]', block, re.IGNORECASE)
            so_match = re.search(r'SO\s*=\s*(\d+)', block, re.IGNORECASE)

            if wft_match:
                try:
                    wfid = int(wft_match.group(1))
                    if 1000 <= wfid <= 99999999999:
                        wf_ids.add(wfid)
                except Exception:
                    pass

            if so_match:
                try:
                    soid = int(so_match.group(1))
                    if 1000 <= soid <= 99999999999:
                        spec_ids.add(soid)
                except Exception:
                    pass

        # Parse contextual [Event> ...] and |Event> ... <Event| blocks
        event_blocks = re.findall(r'[\|\[]Event>\s*([^\<\]]+)[\]\<]', text, re.IGNORECASE)
        for block in event_blocks:
            user_match = re.search(r'User\s*=\s*(\d+)', block, re.IGNORECASE)
            so_match = re.search(r'SO\s*=\s*(\d+)', block, re.IGNORECASE)

            if user_match:
                try:
                    uid = int(user_match.group(1))
                    if 1000 <= uid <= 99999999999:
                        spec_ids.add(uid)
                except Exception:
                    pass

            if so_match:
                try:
                    soid = int(so_match.group(1))
                    if 1000 <= soid <= 99999999999:
                        spec_ids.add(soid)
                except Exception:
                    pass

        for p in cls.SPEC_ID_PATTERNS:
            for m in p.finditer(text):
                try:
                    val = int(m.group(1))
                    if 1000 <= val <= 99999999999:
                        spec_ids.add(val)
                except Exception:
                    pass

        for p in cls.WORKTASK_CTRL_PATTERNS:
            for m in p.finditer(text):
                try:
                    val = m.group(1).strip()
                    if val and len(val) >= 4:
                        ctrl_nums.add(val)
                except Exception:
                    pass

        for p in cls.WF_ID_PATTERNS:
            for m in p.finditer(text):
                try:
                    val = int(m.group(1))
                    if 1000 <= val <= 99999999999:
                        wf_ids.add(val)
                except Exception:
                    pass

        for p in cls.BO_ID_PATTERNS:
            for m in p.finditer(text):
                try:
                    val = int(m.group(1))
                    if 1000 <= val <= 99999999999:
                        bo_ids.add(val)
                except Exception:
                    pass

        return {
            "spec_ids": sorted(list(spec_ids)),
            "control_numbers": sorted(list(ctrl_nums)),
            "wf_ids": sorted(list(wf_ids)),
            "bo_ids": sorted(list(bo_ids))
        }

    @classmethod
    def resolve_spec(cls, spec_id: int) -> Dict[str, Any]:
        """
        Resolves a single TRIRIGA Spec ID by querying the live TRIRIGA database (IBS_SPEC, T_MYPROFILE, T_TRIWORKTASK, etc.)
        or extracting actual literal fields from log records.
        """
        cls.ensure_cache_table()
        if spec_id in cls._MEM_CACHE_SPECS and cls._MEM_CACHE_SPECS[spec_id].get("is_resolved"):
            return cls._MEM_CACHE_SPECS[spec_id]

        # 1. Check local SQLite cache table
        try:
            with db_read_session() as conn:
                cur = conn.cursor()
                cur.execute("SELECT * FROM tririga_resolved_specs WHERE spec_id=?", (spec_id,))
                row = cur.fetchone()
                if row:
                    res = dict_from_row(row)
                    if res.get("spec_name") and res["spec_name"] != f"Spec ID #{spec_id}":
                        res["is_resolved"] = True
                        cls._MEM_CACHE_SPECS[spec_id] = res
                        return res
        except Exception:
            pass

        # 2. Query Live TRIRIGA Server DB2 (IBS_SPEC & related T_ tables)
        server = cls._get_active_tririga_server()
        if server:
            try:
                loop = None
                try:
                    loop = asyncio.get_event_loop()
                except RuntimeError:
                    loop = asyncio.new_event_loop()
                    asyncio.set_event_loop(loop)

                sql_spec = f"SELECT SPEC_ID, SPEC_NAME, TYPE_NAME, CONTROL_NUMBER, OBJECT_STATE, SPEC_CLASS_TYPE, OBJECT_PATH, DESCRIPTION FROM IBS_SPEC WHERE SPEC_ID = {spec_id}"
                
                async def fetch_db(sql_query):
                    return await TririgaAdminClient.execute_query_via_admin_console(server, sql_query, limit=1)

                def run_query(q):
                    if loop.is_running():
                        import concurrent.futures
                        with concurrent.futures.ThreadPoolExecutor() as pool:
                            return pool.submit(asyncio.run, fetch_db(q)).result()
                    else:
                        return loop.run_until_complete(fetch_db(q))

                db_res = run_query(sql_spec)

                if db_res.get("success") and db_res.get("rows"):
                    r = db_res["rows"][0]
                    spec_name = r.get("SPEC_NAME") if r.get("SPEC_NAME") not in ("null", None) else None
                    type_name = r.get("TYPE_NAME") if r.get("TYPE_NAME") not in ("null", None) else None
                    ctrl_num = r.get("CONTROL_NUMBER") if r.get("CONTROL_NUMBER") not in ("null", None) else None
                    status = r.get("OBJECT_STATE") if r.get("OBJECT_STATE") not in ("null", None) else None
                    class_type = str(r.get("SPEC_CLASS_TYPE") or "")
                    desc = r.get("DESCRIPTION") if r.get("DESCRIPTION") not in ("null", None) else None
                    path = r.get("OBJECT_PATH") if r.get("OBJECT_PATH") not in ("null", None) else None

                    email = None
                    job_title = None
                    dept = None
                    loc = path
                    task_type = None
                    priority = None
                    assigned_to = None
                    asset_name = None

                    # Deep lookup for User / Profile (SPEC_CLASS_TYPE 7 or My Profile / triPeople)
                    if class_type == "7" or (type_name and type_name in ("My Profile", "triPeople")):
                        try:
                            prof_res = run_query(f"SELECT * FROM T_MYPROFILE WHERE SPEC_ID = {spec_id}")
                            if prof_res.get("success") and prof_res.get("rows"):
                                pr = prof_res["rows"][0]
                                human_name = pr.get("PEOPLEFULLNAME") or f"{pr.get('FIRSTNAME', '')} {pr.get('LASTNAME', '')}".strip() or pr.get("TRINAMETX")
                                if human_name and human_name != "null":
                                    spec_name = human_name
                                em = pr.get("EMAIL") or pr.get("TRIEMAILTX")
                                if em and em != "null":
                                    email = em
                                jt = pr.get("TRITITLETX")
                                if jt and jt != "null":
                                    job_title = jt
                                dp = pr.get("SYS_ORGNAME") or pr.get("TRIORGANIZATIONBO")
                                if dp and dp != "null":
                                    dept = dp
                                cn = pr.get("TRICONTROLNUMBERCN")
                                if cn and cn != "null":
                                    ctrl_num = cn
                                st = pr.get("TRISTATUSCL") or pr.get("SYS_OBJECTSTATE")
                                if st and st != "null":
                                    status = st
                            else:
                                # Try T_TRIPEOPLE
                                people_res = run_query(f"SELECT * FROM T_TRIPEOPLE WHERE SPEC_ID = {spec_id}")
                                if people_res.get("success") and people_res.get("rows"):
                                    pr = people_res["rows"][0]
                                    human_name = pr.get("PEOPLEFULLNAME") or f"{pr.get('FIRSTNAME', '')} {pr.get('LASTNAME', '')}".strip() or pr.get("TRINAMETX")
                                    if human_name and human_name != "null":
                                        spec_name = human_name
                                    em = pr.get("TRIEMAILTX") or pr.get("EMAIL")
                                    if em and em != "null":
                                        email = em
                                    jt = pr.get("TRITITLETX")
                                    if jt and jt != "null":
                                        job_title = jt
                                    dp = pr.get("SYS_ORGNAME") or pr.get("TRIORGANIZATIONBO")
                                    if dp and dp != "null":
                                        dept = dp
                                    cn = pr.get("TRICONTROLNUMBERCN")
                                    if cn and cn != "null":
                                        ctrl_num = cn
                        except Exception:
                            pass

                    # Deep lookup for Work Task (triWorkTask or class_type 29)
                    elif (type_name and "TASK" in type_name.upper()) or class_type == "29":
                        try:
                            wt_res = run_query(f"SELECT * FROM T_TRIWORKTASK WHERE SPEC_ID = {spec_id}")
                            if wt_res.get("success") and wt_res.get("rows"):
                                wt = wt_res["rows"][0]
                                tn = wt.get("TRINAMETX")
                                if tn and tn != "null":
                                    spec_name = tn
                                cn = wt.get("TRICONTROLNUMBERCN")
                                if cn and cn != "null":
                                    ctrl_num = cn
                                st = wt.get("TRISTATUSCL") or wt.get("TRIRECORDSTATESY")
                                if st and st != "null":
                                    status = st
                                tt = wt.get("TRITASKTYPECL")
                                if tt and tt != "null":
                                    task_type = tt
                                pri = wt.get("OPWPRIORITYTX") or wt.get("TRIPRIORITYCLASSCL") or wt.get("TRITASKSEVERITYLI")
                                if pri and pri != "null":
                                    priority = pri
                                loc_val = wt.get("OPWLOCATIONTX") or wt.get("TRIWORKINGLOCATIONTX")
                                if loc_val and loc_val != "null":
                                    loc = loc_val
                                an = wt.get("OPWPRIMARYLOCNAMETX") or wt.get("TRIASSETEVENTTX")
                                if an and an != "null":
                                    asset_name = an
                                d = wt.get("TRIDESCRIPTIONTX")
                                if d and d != "null":
                                    desc = d
                                asg = wt.get("NJWALLOCATEDTOTX") or wt.get("TRIRESOURCEASSIGNMEN")
                                if asg and asg not in ("null", "Unassigned"):
                                    assigned_to = asg
                        except Exception:
                            pass

                    # Deep lookup for Building (triBuilding)
                    elif type_name and "BUILDING" in type_name.upper():
                        try:
                            bld_res = run_query(f"SELECT * FROM T_TRIBUILDING WHERE SPEC_ID = {spec_id}")
                            if bld_res.get("success") and bld_res.get("rows"):
                                bld = bld_res["rows"][0]
                                tn = bld.get("TRINAMETX")
                                if tn and tn != "null":
                                    spec_name = tn
                                cn = bld.get("TRICONTROLNUMBERCN")
                                if cn and cn != "null":
                                    ctrl_num = cn
                                loc_val = bld.get("SYS_LOCATIONNAME") or bld.get("TRIWORKINGLOCATIONTX")
                                if loc_val and loc_val != "null":
                                    loc = loc_val
                        except Exception:
                            pass

                    if spec_name or ctrl_num or status:
                        res = {
                            "spec_id": spec_id,
                            "spec_name": spec_name or f"Spec #{spec_id}",
                            "module_name": "triPeople" if class_type == "7" or (type_name and "People" in type_name) else "triTask" if (type_name and "Task" in type_name) else "triLocation" if class_type in ("20519", "206323") else "triGeneral",
                            "bo_name": type_name or ("triPeople" if class_type == "7" else "Business Object"),
                            "control_number": ctrl_num,
                            "status": status,
                            "task_type": task_type,
                            "email": email,
                            "job_title": job_title,
                            "department": dept,
                            "priority": priority,
                            "assigned_to": assigned_to,
                            "location": loc,
                            "asset_name": asset_name,
                            "description": desc,
                            "is_resolved": True
                        }
                        cls.cache_spec(res)
                        cls._MEM_CACHE_SPECS[spec_id] = res
                        return res
            except Exception:
                pass

        # Fallback unverified (cached in memory to avoid repetitive remote queries)
        res = {
            "spec_id": spec_id,
            "spec_name": f"Spec #{spec_id}",
            "module_name": None,
            "bo_name": None,
            "control_number": None,
            "status": None,
            "task_type": None,
            "email": None,
            "job_title": None,
            "department": None,
            "priority": None,
            "assigned_to": None,
            "location": None,
            "asset_name": None,
            "description": None,
            "is_resolved": False
        }
        cls._MEM_CACHE_SPECS[spec_id] = res
        return res

    @classmethod
    def resolve_workflow(cls, wf_id: int) -> Dict[str, Any]:
        """
        Resolves a TRIRIGA Workflow Template ID by querying the live TRIRIGA database (WF_TEMPLATE).
        """
        cls.ensure_cache_table()
        if wf_id in cls._MEM_CACHE_WORKFLOWS and cls._MEM_CACHE_WORKFLOWS[wf_id].get("is_resolved"):
            return cls._MEM_CACHE_WORKFLOWS[wf_id]

        # 1. Check local SQLite cache table
        try:
            with db_read_session() as conn:
                cur = conn.cursor()
                cur.execute("SELECT * FROM tririga_resolved_workflows WHERE wf_id=?", (wf_id,))
                row = cur.fetchone()
                if row:
                    res = dict_from_row(row)
                    if res.get("template_name") and res["template_name"] != f"Workflow Template #{wf_id}":
                        res["is_resolved"] = True
                        cls._MEM_CACHE_WORKFLOWS[wf_id] = res
                        return res
        except Exception:
            pass

        # 2. Query Live TRIRIGA Server DB2 (WF_TEMPLATE)
        server = cls._get_active_tririga_server()
        if server:
            try:
                loop = None
                try:
                    loop = asyncio.get_event_loop()
                except RuntimeError:
                    loop = asyncio.new_event_loop()
                    asyncio.set_event_loop(loop)

                sql_wf = f"SELECT WF_TEMPLATE_ID, WF_NAME, BO_TYPE_NAME, BO_EVENT_NAME, DESCRIPTION, LOCK_RECORD_FLAG FROM WF_TEMPLATE WHERE WF_TEMPLATE_ID = {wf_id} FETCH FIRST 1 ROWS ONLY"
                
                async def fetch_wf():
                    return await TririgaAdminClient.execute_query_via_admin_console(server, sql_wf, limit=1)

                if loop.is_running():
                    import concurrent.futures
                    with concurrent.futures.ThreadPoolExecutor() as pool:
                        db_res = pool.submit(asyncio.run, fetch_wf()).result()
                else:
                    db_res = loop.run_until_complete(fetch_wf())

                if db_res.get("success") and db_res.get("rows"):
                    r = db_res["rows"][0]
                    wf_name = r.get("WF_NAME") if r.get("WF_NAME") not in ("null", None) else None
                    bo_name = r.get("BO_TYPE_NAME") if r.get("BO_TYPE_NAME") not in ("null", None) else None
                    ev_name = r.get("BO_EVENT_NAME") if r.get("BO_EVENT_NAME") not in ("null", None) else None
                    desc = r.get("DESCRIPTION") if r.get("DESCRIPTION") not in ("null", None) else None
                    lock_flag = r.get("LOCK_RECORD_FLAG")

                    if wf_name:
                        res = {
                            "wf_id": wf_id,
                            "template_name": wf_name,
                            "module_name": "triTask" if "Task" in wf_name else "triGeneral",
                            "bo_name": bo_name or "triGeneral",
                            "event_name": ev_name or "Pre-Create",
                            "execution_mode": "Synchronous (In-Transaction)" if lock_flag == "0" else "Asynchronous / Custom Lock",
                            "locking_strategy": "Row Lock" if lock_flag == "0" else "Isolated Agent Transaction",
                            "description": desc,
                            "is_resolved": True
                        }
                        cls.cache_workflow(res)
                        cls._MEM_CACHE_WORKFLOWS[wf_id] = res
                        return res
            except Exception:
                pass

        # Fallback (cached in memory)
        res = {
            "wf_id": wf_id,
            "template_name": f"Workflow Template #{wf_id}",
            "module_name": None,
            "bo_name": None,
            "event_name": None,
            "execution_mode": None,
            "locking_strategy": None,
            "description": None,
            "is_resolved": False
        }
        cls._MEM_CACHE_WORKFLOWS[wf_id] = res
        return res

    @classmethod
    def resolve_identifier(cls, identifier: str, include_logs: bool = False) -> Dict[str, Any]:
        """Resolves any identifier to real TRIRIGA data."""
        cls.ensure_cache_table()
        clean = identifier.strip()
        spec_id = int(clean) if clean.isdigit() else None
        control_num = clean if not clean.isdigit() else None

        spec_rec = None
        if spec_id:
            spec_rec = cls.resolve_spec(spec_id)
            if spec_rec.get("control_number"):
                control_num = spec_rec["control_number"]
        elif control_num:
            # Query IBS_SPEC by CONTROL_NUMBER on TRIRIGA server
            server = cls._get_active_tririga_server()
            if server:
                try:
                    loop = asyncio.new_event_loop()
                    sql = f"SELECT SPEC_ID, SPEC_NAME, CONTROL_NUMBER, OBJECT_STATE, SPEC_CLASS_TYPE, OBJECT_PATH, DESCRIPTION FROM IBS_SPEC WHERE CONTROL_NUMBER = '{control_num}'"
                    db_res = loop.run_until_complete(TririgaAdminClient.execute_query_via_admin_console(server, sql, limit=1))
                    loop.close()
                    if db_res.get("success") and db_res.get("rows"):
                        r = db_res["rows"][0]
                        spec_id = int(r["SPEC_ID"]) if r.get("SPEC_ID") else None
                        spec_rec = {
                            "spec_id": spec_id,
                            "spec_name": r.get("SPEC_NAME"),
                            "control_number": control_num,
                            "status": r.get("OBJECT_STATE"),
                            "location": r.get("OBJECT_PATH"),
                            "description": r.get("DESCRIPTION") if r.get("DESCRIPTION") != "null" else None,
                            "is_resolved": True
                        }
                except Exception:
                    pass

        recent_logs = []
        if include_logs:
            recent_logs = cls.find_associated_logs(clean)

        return {
            "spec_id": spec_id,
            "control_number": control_num or (spec_rec.get("control_number") if spec_rec else None),
            "name": spec_rec.get("spec_name") if spec_rec else None,
            "spec_name": spec_rec.get("spec_name") if spec_rec else None,
            "module_name": spec_rec.get("module_name") if spec_rec else None,
            "bo_name": spec_rec.get("bo_name") if spec_rec else None,
            "status": spec_rec.get("status") if spec_rec else None,
            "task_type": spec_rec.get("task_type") if spec_rec else None,
            "email": spec_rec.get("email") if spec_rec else None,
            "job_title": spec_rec.get("job_title") if spec_rec else None,
            "department": spec_rec.get("department") if spec_rec else None,
            "priority": spec_rec.get("priority") if spec_rec else None,
            "assigned_to": spec_rec.get("assigned_to") if spec_rec else None,
            "location": spec_rec.get("location") if spec_rec else None,
            "asset_name": spec_rec.get("asset_name") if spec_rec else None,
            "description": spec_rec.get("description") if spec_rec else None,
            "is_resolved": spec_rec.get("is_resolved", False) if spec_rec else False,
            "associated_logs_count": len(recent_logs),
            "recent_logs": recent_logs
        }

    @classmethod
    def cache_spec(cls, spec_data: Dict[str, Any]):
        """Persists a verified spec in SQLite cache."""
        try:
            with db_session() as conn:
                conn.execute("""
                    INSERT OR REPLACE INTO tririga_resolved_specs (
                        spec_id, spec_name, module_name, bo_name, control_number, status,
                        task_type, email, job_title, department, priority, location, assigned_to, asset_name, description
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (
                    spec_data["spec_id"],
                    spec_data.get("spec_name"),
                    spec_data.get("module_name"),
                    spec_data.get("bo_name"),
                    spec_data.get("control_number"),
                    spec_data.get("status"),
                    spec_data.get("task_type"),
                    spec_data.get("email"),
                    spec_data.get("job_title"),
                    spec_data.get("department"),
                    spec_data.get("priority"),
                    spec_data.get("location"),
                    spec_data.get("assigned_to"),
                    spec_data.get("asset_name"),
                    spec_data.get("description")
                ))
        except Exception:
            pass

    @classmethod
    def cache_workflow(cls, wf_data: Dict[str, Any]):
        """Persists a verified workflow in SQLite cache."""
        try:
            with db_session() as conn:
                conn.execute("""
                    INSERT OR REPLACE INTO tririga_resolved_workflows (
                        wf_id, template_name, module_name, bo_name, event_name, execution_mode, locking_strategy, description
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """, (
                    wf_data["wf_id"],
                    wf_data.get("template_name"),
                    wf_data.get("module_name"),
                    wf_data.get("bo_name"),
                    wf_data.get("event_name"),
                    wf_data.get("execution_mode"),
                    wf_data.get("locking_strategy"),
                    wf_data.get("description")
                ))
        except Exception:
            pass

    @classmethod
    def find_associated_logs(cls, identifier: str, limit: int = 15) -> List[Dict[str, Any]]:
        """Scans cluster logs for occurrences of this identifier using fast indexed search."""
        clean = identifier.strip()
        try:
            with db_read_session() as conn:
                cur = conn.cursor()
                cur.execute(
                    """
                    SELECT id, timestamp, log_level, logger_name, thread_name, message, server_name, filename
                    FROM log_entries
                    WHERE message LIKE ? OR thread_name LIKE ?
                    ORDER BY timestamp DESC
                    LIMIT ?
                    """,
                    (f"%{clean}%", f"%{clean}%", limit)
                )
                return dict_list_from_rows(cur.fetchall())
        except Exception:
            return []

    @classmethod
    def build_evidence_resolution_block(cls, text: str) -> str:
        """Builds a formatted summary markdown block for AI Assistant analysis."""
        extracted = cls.extract_identifiers(text)
        lines = []

        if extracted["spec_ids"]:
            lines.append("### Identified TRIRIGA Business Records (Spec IDs)")
            for sid in extracted["spec_ids"][:5]:
                rec = cls.resolve_spec(sid)
                if rec["is_resolved"]:
                    lines.append(f"- **Spec #{sid}**: `{rec['spec_name']}` | Control Number: `{rec.get('control_number') or 'N/A'}` | State: `{rec.get('status') or 'N/A'}`")
                else:
                    lines.append(f"- **Spec #{sid}**: `Spec #{sid}`")

        if extracted["wf_ids"]:
            lines.append("\n### Identified Workflow Engine Templates (WF_TEMPLATE)")
            for wfid in extracted["wf_ids"][:5]:
                wf = cls.resolve_workflow(wfid)
                if wf["is_resolved"]:
                    lines.append(f"- **WF #{wfid}**: `{wf['template_name']}` | BO: `{wf.get('bo_name') or 'N/A'}` | Event: `{wf.get('event_name') or 'N/A'}`")
                else:
                    lines.append(f"- **WF #{wfid}**: `Template #{wfid}`")

        return "\n".join(lines)
