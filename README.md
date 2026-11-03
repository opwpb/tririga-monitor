# TRIRIGA Monitor & Log Forensics Platform

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Python: 3.10+](https://img.shields.io/badge/Python-3.10+-brightgreen.svg)](https://python.org)
[![FastAPI: 0.115+](https://img.shields.io/badge/FastAPI-0.115+-009688.svg)](https://fastapi.tiangolo.com)
[![React: 18.3](https://img.shields.io/badge/React-18.3-61DAFB.svg)](https://react.dev)
[![TypeScript: 5.7](https://img.shields.io/badge/TypeScript-5.7-3178C6.svg)](https://www.typescriptlang.org)
[![TailwindCSS: 3.4](https://img.shields.io/badge/TailwindCSS-3.4-38B2AC.svg)](https://tailwindcss.com)

A unified, high-performance operational monitoring, multi-node log harvesting, real-time agent/thread telemetry, user & license analytics, and air-gapped offline AI root-cause diagnostics suite built specifically for **IBM TRIRIGA Application Platform** enterprise clusters.

---

## 🌟 Executive Overview

In large-scale enterprise IBM TRIRIGA deployments, application servers run in multi-node clusters behind hardware load balancers (F5 BIG-IP, Citrix NetScaler, HAProxy). Triage of critical production incidents—such as database deadlocks, connection pool exhaustion, memory leaks (OOM), long-running workflow queues, and agent thread starvation—is notoriously difficult due to fragmented log streams across disparate virtual machines.

**TRIRIGA Monitor** bridges this gap:
1. **Bypasses Load Balancers**: Directly connects to each cluster node using individual node IP addresses or hostnames.
2. **Automates Log Harvesting**: Authenticates using modern TRIRIGA 4.x/11.x REST or Classic Form signon, scrapes active and rolled log files, and indexes them chronologically into an optimized SQLite full-text search (FTS5) engine.
3. **Cluster-Wide Observability**: Provides live JVM thread pool monitoring (`threads.jsp`, `connectionManager.jsp`), real-time cluster health baselines, configuration drift comparisons, and database query profiling.
4. **License & User Activity Governance**: Delivers real-time active user sessions, seat entitlement visual charts, dormant account detection, and complete directory export.
5. **Air-Gapped Offline AI Forensics**: Integrates with local, offline LLMs (Ollama, LM Studio, LocalAI) to generate comprehensive Root Cause Analysis (RCA) audits and remediation plans without transmitting sensitive corporate data outside the firewall.

---

## 🏗️ Architecture

```
                                  +---------------------------------------+
                                  |     IBM TRIRIGA Enterprise Cluster    |
                                  |  [Node 103]  [Node 104]  [Node 106]   |
                                  |  [Node 107]  [Node 108]  [Node 115]   |
                                  +---------------------------------------+
                                         |              |              |
                    Admin Console (HTTP/S)   REST Signon   SFTP / SSH
                                         |              |              |
                                         v              v              v
+-----------------------------------------------------------------------------------------+
|                                    TRIRIGA MONITOR                                      |
|                                                                                         |
|  +-----------------------------------------------------------------------------------+  |
|  |                              FastAPI Backend Engine                               |  |
|  |  * Automated Log Harvester & Scheduler      * Thread Pool & Agent Telemetry       |  |
|  |  * SQLite FTS5 Full-Text Amalgamator        * Database Query Tool (scriptRunner)  |  |
|  |  * Tiered Cold Storage Archiver             * Offline Local LLM Orchestrator      |  |
|  +-----------------------------------------------------------------------------------+  |
|                                           |                                             |
|                                           v                                             |
|  +-----------------------------------------------------------------------------------+  |
|  |                             Persistent Storage Layer                              |  |
|  |  * SQLite WAL Database (tririga_logs.db)    * Compressed Cold Archives (.jsonl.gz)|  |
|  |  * Sub-millisecond composite indexing       * Raw log cache by server node        |  |
|  +-----------------------------------------------------------------------------------+  |
|                                           |                                             |
|                                           v                                             |
|  +-----------------------------------------------------------------------------------+  |
|  |                           React 18 + TypeScript SPA UI                            |  |
|  |  [Cluster Dashboard]      [Log Explorer (FTS5)]    [Agent & Thread Monitor]       |  |
|  |  [User & License Hub]     [DB Query Studio]        [WorkTask & Record Inspector]  |  |
|  |  [Server Config Diff]     [Offline AI Forensics]   [Tiered Storage & Settings]    |  |
|  +-----------------------------------------------------------------------------------+  |
+-----------------------------------------------------------------------------------------+
                                           |
                                           v
                              +--------------------------+
                              | Local Offline AI Engine  |
                              | (Ollama / LM Studio)     |
                              | * 100% On-Prem & Private |
                              +--------------------------+
```

---

## 🚀 Key Functional Capabilities

### 1. Multi-Server Log Harvesting & Full-Text Search (FTS5)
- **Direct Node Discovery**: Configures individual server profiles with discrete IP, port, protocol, and admin paths behind load balancers.
- **Dual Authentication Handshake**:
  - Modern TRIRIGA 4.x / 11.x JSON REST Signon (`/p/websignon/tririga-admin-login`).
  - Classic TRIRIGA Form Signon (`/j_security_check`).
- **Comprehensive Stream Harvesting**:
  - Ingests active live log streams (`server.log`, `security.log`, `ObjectMigration.log`, `performance.log`, `systemmetrics.log`, `datapool.log`, `gc.log`).
  - Dynamically scrapes `errorLogMain.jsp` to extract exact rollover download URLs with dynamic `cacheId` tokens to eliminate HTTP 500 errors.
  - Supports direct SSH/SFTP download from `/opt/tririga/userfiles/log` or Liberty profile paths.
- **SQLite FTS5 Amalgamation Engine**:
  - Chronologically merges millions of log entries across all nodes.
  - Uses SQLite in WAL (Write-Ahead Logging) mode with memory-mapped I/O and custom FTS5 triggers for sub-second keyword and phrase searches (e.g. `deadlock`, `OutOfMemoryError`, `ConnectionTimeoutException`).
  - Automatic error signature normalization (`error_hash`) for deduplicating repeated stack traces.

### 2. Cluster Observability & Telemetry Dashboard
- **KPI Metrics**: Real-time calculation of total cluster events, error rates, cluster health status, and active server nodes.
- **Timeline Activity Visualization**: Interactive Recharts timeline displaying log frequency and error spikes broken down by server node.
- **Dual Time Display**: Toggle between Server Time (UTC) and Local Workstation Time with persistent timezone badges.
- **Error Clustering**: Automatically aggregates top error clusters across nodes, surfacing line numbers, thread names, logger classes, and deep-dive triage filters with one click.

### 3. Log Explorer
- **Multi-Dimensional Filtering**:
  - Filter by Server Node (single or multi-node selection).
  - Filter by Stream Type (`server`, `security`, `workflow`, `datapool`, `performance`, `gc`).
  - Filter by Log Level (`FATAL`, `ERROR`, `WARN`, `INFO`, `DEBUG`).
  - Filter by Date/Time Window presets: `30M`, `1H`, `6H`, `24H`, `Today`, `Last 7 Days`, `Last 30 Days`, or Custom Date/Time ranges down to the second.
- **Deep-Dive Stack Inspection**: Expandable stack traces with syntax highlighting and direct links to affected TRIRIGA smart object records.
- **Real-Time Stream Terminal**: Server-Sent Events (SSE) streaming progress bar displaying live harvest and ingestion progress directly from remote nodes.

### 4. Agent & Thread Monitor
- **Live JVM Thread Pool Telemetry**: Queries TRIRIGA Admin Console endpoints (`threads.jsp` and `connectionManager.jsp`) in real time.
- **Thread Allocation Tracking**: Inspects active and max thread allocations across:
  - Workflow Agents (WFA).
  - Background Agents (Cleaner Agent, DataConnect Agent, Extended Formula Agent, Notification Agent).
  - Event Queue Workers.
- **Thread Saturation Detection**: Alerts on hung threads, transaction deadlocks, and thread pool exhaustion before users experience latency.

### 5. User Activity & License Management
- **Active User Sessions**: Displays currently authenticated users, login timestamps, and idle durations.
- **License Entitlement Analytics**: Maps TRIRIGA license metrics (e.g. Workplace Operations, Real Estate Manager, Capital Projects, Facilities Manager) against active seats with interactive visual charts.
- **Dormant Account Reclamation**: Automatically flags user accounts with no activity in 30, 60, or 90+ days to assist with license compliance and harvesting.
- **Directory Export**: Complete user directory browser with instant CSV report generation.

### 6. Database Query Studio (`scriptRunner.jsp`)
- **Direct SQL Execution**: Runs queries against the underlying enterprise database (IBM DB2, Oracle Database, Microsoft SQL Server) via TRIRIGA's Admin Console query runner.
- **Safety Validator**: Strict, built-in safety guardrails that enforce read-only execution (`SELECT` only) and automatically block destructive DDL/DML statements (`DROP`, `DELETE`, `UPDATE`, `ALTER`, `TRUNCATE`).
- **Curated Diagnostic Presets**: Ready-to-use verified queries for:
  - Database Lock Waits & Blocked Sessions.
  - Active Workflow Execution Queues.
  - Table Storage Sizing & High-Volume Smart Object Growth.
  - Slow Database Queries & Index Tuning.
- **Results Explorer**: Sortable, paginated data grid with one-click CSV export.

### 7. WorkTask & OSLC Query Performance Analyzer
- **OSLC Resource Profiler**: Direct profiling of TRIRIGA OSLC REST services (`/oslc/sp/WorkTask`) to diagnose mobile integration latency.
- **TRIRIGA Record Inspector**: Interactive modal to inspect business object specifications, smart object records, and linked associations directly from stack traces or query results.

### 8. Server Configuration Drift Comparison
- **Cross-Node Comparison**: Compares system settings (`systemConfig.jsp`), JVM memory arguments (`-Xmx`, `-Xms`, garbage collection policies), database pool configurations, and patch levels across all cluster nodes.
- **Drift Highlighting**: Visual diff identifying node inconsistencies that often cause intermittent load-balancer bugs.

### 9. Air-Gapped Offline AI Forensics Engine
- **100% Private & Air-Gapped**: Directly interfaces with local LLM providers (**Ollama**, **LM Studio**, or **LocalAI**). No logs, code, or internal IP addresses ever leave the organization's network.
- **Automated Root Cause Audits**: One-click prompt templates for:
  - High-Severity Error Triaging.
  - Database Transaction Deadlock Resolution.
  - Memory Leak & OutOfMemory (OOM) Remediation.
  - Workflow Performance Bottlenecks.
- **Interactive AI Chat Assistant**: Log-aware conversational assistant that answers queries in real time regarding cluster incidents.
- **Multi-Format Export**: Export comprehensive forensic incident reports to styled Microsoft Word (`.docx`) or Markdown (`.md`).

### 10. Tiered Storage & Archival Management
- **Hot vs. Cold Storage**: Keeps recent logs (< 7 days by default) in the active SQLite database for sub-second search.
- **Automated Cold Archival**: Offloads older records into compressed GZip JSONL archives (`data/archives/*.jsonl.gz`), reclaiming disk space while maintaining historic audibility.
- **Automated Background Scheduler**: Built-in background worker with configurable recurring sync intervals (e.g., every 15, 30, or 60 minutes).

---

## 💻 Tech Stack

| Layer | Technologies |
| :--- | :--- |
| **Backend API** | Python 3.10+, FastAPI, Uvicorn, Pydantic v2, Starlette |
| **Database & Search**| SQLite 3 (WAL Mode, Memory-Mapped I/O, FTS5 Full-Text Search) |
| **Networking & Scraping**| HTTPX (Async HTTP/2, connection pooling), Paramiko (SFTP/SSH), SSE-Starlette |
| **Frontend Framework** | React 18, TypeScript, Vite, Tailwind CSS |
| **UI Components & Icons**| Lucide React, Recharts (Responsive SVG charts), React Markdown, Remark GFM |
| **Local AI Providers** | Ollama (REST API), LM Studio (OpenAI-compatible v1 endpoint), LocalAI |

---

## 📦 Directory Structure

```
tririga-monitor/
├── backend/                        # FastAPI Backend Application
│   ├── app/
│   │   ├── api/                    # Modular API route controllers
│   │   │   ├── agent_monitor.py    # JVM thread and agent status endpoints
│   │   │   ├── analysis.py         # AI report generation and export endpoints
│   │   │   ├── auth.py             # User authentication and session endpoints
│   │   │   ├── collector.py        # Log sync triggers and SSE streaming
│   │   │   ├── db_query.py         # Safe SQL query runner endpoints
│   │   │   ├── llm_config.py       # Local LLM connectivity and model discovery
│   │   │   ├── logs.py             # FTS5 search, metrics, and log filtering
│   │   │   ├── operations.py       # User activity and license entitlement endpoints
│   │   │   ├── server_config.py    # Cross-node configuration diff endpoints
│   │   │   ├── servers.py          # TRIRIGA cluster node management
│   │   │   ├── storage.py          # Tiered retention and archival endpoints
│   │   │   └── worktasks.py        # OSLC work task and record inspection
│   │   ├── db/
│   │   │   └── database.py         # SQLite connection manager, WAL tuning, FTS5 schema
│   │   ├── services/
│   │   │   ├── docx_exporter.py    # Formatted Word (.docx) report generator
│   │   │   ├── local_llm.py        # Ollama / LM Studio streaming client
│   │   │   ├── log_amalgamator.py  # Streaming log parser & FTS5 batch indexer
│   │   │   ├── log_scheduler.py    # Background recurring log harvesting worker
│   │   │   ├── log_storage_service.py # Tiered storage pruning & cold archiver
│   │   │   ├── tririga_admin_client.py # HTTP/JSON signon & JSP scraper
│   │   │   └── tririga_collector.py   # Multi-protocol log downloader
│   │   └── config.py               # Application settings and directory paths
│   └── main.py                     # FastAPI server initialization and SPA routing
├── frontend/                       # React 18 + TypeScript + Vite SPA
│   ├── src/
│   │   ├── components/             # Core UI views
│   │   │   ├── common/             # Reusable modal, skeleton, and chip components
│   │   │   ├── user_activity/      # License charts, active users, session tables
│   │   │   ├── AgentThreadMonitor.tsx # Live JVM thread and agent pool monitor
│   │   │   ├── Dashboard.tsx       # Cluster baseline KPIs and activity charts
│   │   │   ├── DBQueryTool.tsx     # scriptRunner SQL console and query presets
│   │   │   ├── LLMAnalysis.tsx     # Offline AI forensic report generator & chat
│   │   │   ├── LogExplorer.tsx     # FTS5 search, filter bar, and stream viewer
│   │   │   ├── OperationsHub.tsx   # System health and operational diagnostic center
│   │   │   ├── ServerConfigComparison.tsx # Cross-node JVM and config diff tool
│   │   │   ├── Settings.tsx        # Cluster nodes, retention, and AI setup
│   │   │   └── WorkTaskQueryAnalyzer.tsx # OSLC profiler and record inspector
│   │   ├── context/
│   │   │   └── TimeContext.tsx     # Server UTC vs Local time toggle provider
│   │   ├── services/
│   │   │   └── api.ts              # Typed Axios/Fetch client for backend endpoints
│   │   └── types/
│   │       └── index.ts            # TypeScript interfaces and data models
│   ├── dist/                       # Pre-compiled production UI bundle
│   └── package.json                # Frontend dependencies and Vite build scripts
├── scripts/                        # Operational and diagnostic utilities
│   ├── export_users_csv.py         # Standalone TRIRIGA user directory exporter
│   ├── ingest_fast_oct.py          # High-speed batch log ingestion utility
│   └── restore_backup.ps1          # Database restoration script
├── AGENTS.md                       # Operational rules and concurrency guardrails
├── TRIVIS_DEPLOYMENT_GUIDE.md      # Apache Tomcat production deployment runbook
├── requirements.txt                # Python backend dependencies
├── run.py                          # Cross-platform interactive launcher
├── start_app.bat                   # One-click Windows batch launcher
├── stop_app.bat                    # Graceful application shutdown script
├── deploy_to_trivis.ps1            # Production automated deployment script
└── restart_trivis_service.bat      # TRIVIS production service restart utility
```

---

## 🛠️ Installation & Setup

### Prerequisites
- **Python**: Version 3.10 or higher.
- **Node.js**: Version 18+ (only required if building frontend source code; the repository includes a pre-compiled `frontend/dist/` bundle for instant zero-dependency execution).
- **Local AI (Optional)**: [Ollama](https://ollama.com) or [LM Studio](https://lmstudio.ai) running locally for AI diagnostics.

### 1. Clone the Repository
```bash
git clone https://github.com/opwpb/tririga-monitor.git
cd tririga-monitor
```

### 2. Set Up Python Environment
```bash
# Create virtual environment
python -m venv venv

# Activate virtual environment
# Windows:
.\venv\Scripts\activate
# Linux/macOS:
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt
```

### 3. Launch Application
#### Option A: One-Click Windows Launcher
Double-click `start_app.bat` or run:
```cmd
start_app.bat
```

#### Option B: Python Launcher (Cross-Platform)
```bash
python run.py
```
*The launcher will automatically start the FastAPI server on `http://127.0.0.1:8000` and open your default web browser.*

#### Option C: Stop the Application
```cmd
stop_app.bat
```

---

## 🤖 Configuring Local Offline AI

TRIRIGA Monitor works seamlessly with popular offline LLM engines without requiring external internet access:

### Using Ollama
1. Download and install Ollama from [ollama.com](https://ollama.com).
2. Pull your preferred model:
   ```bash
   ollama run llama3.1
   # or
   ollama run qwen2.5-coder
   ```
3. In TRIRIGA Monitor, open **Settings ➔ Local AI Configuration**.
4. Select **Ollama**, verify URL `http://localhost:11434`, and click **Test Connection & Discover Models**.

### Using LM Studio
1. Download and install LM Studio from [lmstudio.ai](https://lmstudio.ai).
2. Load any GGUF model and navigate to the **Local Server** tab.
3. Start the server on port `1234` (`http://localhost:1234/v1`).
4. In TRIRIGA Monitor, select **LM Studio** under AI settings and click **Test Connection**.

---

## 🏭 Production Deployment (Apache Tomcat)

The application can run as an enterprise service on a shared Windows/Tomcat application server (e.g. TRIVIS):
1. **Automated Deployment**: Run [`deploy_to_trivis.ps1`](file:///c:/Users/bradyp/Documents/Antigravity/Autologanalysis/deploy_to_trivis.ps1) to build the frontend and deploy the backend service into Tomcat's `webapps/ROOT/admindashboard/`.
2. **Service Management**: Controlled via Windows Scheduled Tasks (`TRIRIGA_AdminDashboard_Backend`) running under `SYSTEM` credentials for automatic startup on boot.
3. **Health Verification**:
   - Backend API: `https://<server>/admindashboard/api/health`
   - Web Interface: `https://<server>/admindashboard/`

Detailed instructions are available in [`TRIVIS_DEPLOYMENT_GUIDE.md`](file:///c:/Users/bradyp/Documents/Antigravity/Autologanalysis/TRIVIS_DEPLOYMENT_GUIDE.md) and operational rules in [`AGENTS.md`](file:///c:/Users/bradyp/Documents/Antigravity/Autologanalysis/AGENTS.md).

---

## 🔒 Security & Privacy

- **Air-Gapped Privacy**: No telemetry, log text, or user data is ever sent to third-party cloud services.
- **Credential Protection**: Passwords configured in Server Manager are stored locally and never exposed in API responses or git repositories.
- **SQL Guardrails**: The Database Query tool parses all incoming SQL statements and blocks data-modifying commands (`DROP`, `DELETE`, `UPDATE`, `INSERT`, `ALTER`, `TRUNCATE`).
- **Session Locking**: Includes an optional pin-protected Lock Screen for unattended monitoring stations.

---

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
