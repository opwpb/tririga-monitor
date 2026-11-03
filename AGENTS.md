# TRIVIS Operations & TRIRIGA Log Forensics Guidelines

## 1. Production Service Restarts
When instructed to restart the production server or backend:
- Always execute:
  ```powershell
  taskkill /s TRIVIS /f /im python.exe
  schtasks /end /s TRIVIS /tn "TRIRIGA_AdminDashboard_Backend"
  Start-Sleep -Seconds 2
  schtasks /run /s TRIVIS /tn "TRIRIGA_AdminDashboard_Backend"
  ```
- Always verify both endpoints:
  - API Health: `https://trivis.i.opw.ie/admindashboard/api/health` (HTTP 200 OK)
  - Web UI: `https://trivis.i.opw.ie/admindashboard/` (HTTP 200 OK)

## 2. TRIRIGA Admin Console Log Harvesting
- **URL Parameter Invariant**: Rolled log files (e.g. `server-YYYY-MM-DD-1.log`) CANNOT be downloaded with `log=<filename>`. TRIRIGA requires the base log name (`log=server.log`) and dynamic `cacheId` token.
- **Rule**: Always scrape exact download links from `errorLogMain.jsp` rather than synthesizing download URLs.

## 3. Database Concurrency & Large-Scale Ingestion
- **Local Execution on TRIVIS**: Never run high-volume log ingestion scripts targeting SQLite across the SMB network share (`\\trivis\c$\...`). SMB latency causes database locks and HTTP 500s on the live web API.
- For multi-day or bulk log backfills:
  1. Write the script to TRIVIS (`C:\Program Files\Apache Software Foundation\Tomcat 10.1\webapps\ROOT\admindashboard\backend`).
  2. Execute it locally on TRIVIS via a one-off scheduled task (`schtasks /create ... /ru SYSTEM` or `schtasks /run`).
- Ensure indexes `idx_log_entries_file_id` and `idx_log_files_srv_fn` exist prior to bulk ingestion.
