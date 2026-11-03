import re
from datetime import datetime, timezone

def is_current_date_log(fn: str, file_mtime: float = None) -> bool:
    now_utc = datetime.now(timezone.utc)
    now_local = datetime.now()

    today_patterns = {
        now_utc.strftime('%Y-%m-%d'),
        now_utc.strftime('%Y_%m_%d'),
        now_utc.strftime('%Y%m%d'),
        now_utc.strftime('%y.%m.%d'),
        now_local.strftime('%Y-%m-%d'),
        now_local.strftime('%Y_%m_%d'),
        now_local.strftime('%Y%m%d'),
        now_local.strftime('%y.%m.%d'),
    }

    # 1. Check for standard YYYY-MM-DD or YYYY_MM_DD
    m_iso = re.search(r'(\d{4})[-_](\d{2})[-_](\d{2})', fn)
    if m_iso:
        file_date = f"{m_iso.group(1)}-{m_iso.group(2)}-{m_iso.group(3)}"
        file_date_alt = f"{m_iso.group(1)}_{m_iso.group(2)}_{m_iso.group(3)}"
        return file_date in today_patterns or file_date_alt in today_patterns

    # 2. Check for YY.MM.DD (e.g. messages_26.09.24.log)
    m_wlp = re.search(r'(\d{2})\.(\d{2})\.(\d{2})', fn)
    if m_wlp:
        file_date = f"{m_wlp.group(1)}.{m_wlp.group(2)}.{m_wlp.group(3)}"
        return file_date in today_patterns

    # 3. Check for YYYYMMDD (e.g. server20260924.log)
    m_comp = re.search(r'(\d{4})(\d{2})(\d{2})', fn)
    if m_comp:
        y, m, d = int(m_comp.group(1)), int(m_comp.group(2)), int(m_comp.group(3))
        if 2020 <= y <= 2040 and 1 <= m <= 12 and 1 <= d <= 31:
            file_date = f"{m_comp.group(1)}{m_comp.group(2)}{m_comp.group(3)}"
            return file_date in today_patterns

    # 4. If file_mtime is provided for undated file, verify it was modified today (within 24h)
    if file_mtime is not None:
        file_dt = datetime.fromtimestamp(file_mtime, tz=timezone.utc)
        return file_dt.strftime('%Y-%m-%d') in today_patterns or (now_utc - file_dt).total_seconds() < 86400

    # 5. If no date is in the filename at all (e.g. server.log, workflow.log, security.log), it is the active live log
    return True

test_files = [
    'server.log',
    'server-2026-09-24_10-59-30-692.log',
    'server-2026-09-23-1.log',
    'server-2026-09-23_13-14-32-675.log',
    'server-2026-09-22-1.log',
    'security.log',
    'security-2026-09-24.log',
    'security-2026-09-20.log',
    'workflow.log',
    'workflow-2026-09-24_08-00-00.log',
    'workflow-2026-09-18.log',
    'messages_26.09.24.log',
    'messages_26.09.23.log'
]

if __name__ == '__main__':
    for f in test_files:
        inc = is_current_date_log(f)
        status = "INCLUDE (Current Date / Active)" if inc else "SKIP (Older Date)"
        print(f"{f:40} -> {status}")
