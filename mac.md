# macOS Setup & Compatibility Guide

Yes! This codebase is **100% cross-platform** and runs natively on macOS (both **Apple Silicon M1/M2/M3/M4** and **Intel Macs**).

---

## 1. Full Stack Overview

| Layer | Component | macOS Requirement | Purpose |
|---|---|---|---|
| **Runtime** | Python 3.10, 3.11, 3.12, or 3.13 | Native macOS / Homebrew | Runs FastAPI server, collectors, amalgamator, background scheduler |
| **Database** | SQLite 3 with FTS5 | Standard in macOS Python | High-speed log storage, full-text search, WAL mode |
| **Backend Framework** | FastAPI + Uvicorn | `pip install -r requirements.txt` | REST API, SSE streaming, static asset serving |
| **Frontend Runtime** | Node.js 18+ & npm *(Optional for dev)* | Native / Homebrew / NVM | Compiles React SPA (Vite + TypeScript + Tailwind) |
| **Frontend Assets** | Pre-built SPA in `frontend/dist/` | None (served by FastAPI) | Zero-build production UI execution |
| **Local LLM Engine** | Ollama / LM Studio *(Optional)* | Native macOS (Metal GPU) | Offline AI forensic diagnostics & log reasoning |

---

## 2. Quick Prerequisites for macOS

### Step A: Install Homebrew (if not already installed)
Open **Terminal.app** and run:
```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

### Step B: Install Python & Node.js
```bash
brew install python node
```
*Verify versions:*
```bash
python3 --version   # Python 3.10+
node -v             # v18+
npm -v              # v9+
```

---

## 3. Step-by-Step Installation on Mac

### 1. Navigate to Project Directory
```bash
cd /path/to/autologanalysis
```

### 2. Create and Activate Virtual Environment
```bash
python3 -m venv venv
source venv/bin/activate
```

### 3. Install Python Dependencies
```bash
pip install --upgrade pip
pip install -r requirements.txt
```

### 4. (Optional) Install Frontend Dependencies
> **Note:** The `frontend/dist` directory is already pre-compiled and served directly by FastAPI. If you wish to modify UI components or rebuild:
```bash
cd frontend
npm install
npm run build
cd ..
```

---

## 4. Running the Application

### Option A: Using the Launcher Script
```bash
python3 run.py
```
This starts the server on `http://127.0.0.1:8000` and automatically opens your default Mac browser (Safari, Chrome, Arc, etc.).

### Option B: Using Uvicorn Directly
```bash
uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload
```

### Option C: Standalone Shell Script (`start_app.sh`)
```bash
chmod +x start_app.sh
./start_app.sh
```

---

## 5. Running Local LLMs with Apple Silicon GPU Acceleration

MacBooks with Apple Silicon (M1/M2/M3/M4) offer unified memory and fast GPU inference via Apple Metal.

### Using Ollama (Recommended on Mac):
1. Install Ollama:
   ```bash
   brew install --cask ollama
   ```
   *(Or download from [ollama.com](https://ollama.com))*
2. Pull and start your preferred model:
   ```bash
   ollama run llama3
   # or
   ollama run mistral
   # or
   ollama run deepseek-r1:8b
   ```
3. In the Web UI **AI Analysis** or **Settings** tab:
   - Provider: **Ollama**
   - Base URL: `http://localhost:11434`
   - Click **Test Ping & Discover Models**

### Using LM Studio on Mac:
1. Download from [lmstudio.ai](https://lmstudio.ai).
2. Load any GGUF model (e.g., Llama 3.1 8B, Qwen 2.5 Coder).
3. Start the Local Server on port `1234`.
4. In the Web UI, select **LM Studio** (`http://localhost:1234/v1`).

---

## 6. macOS-Specific Notes & Troubleshooting

1. **Port 8000 Conflict (macOS AirPlay Receiver)**:
   - On macOS Monterey/Ventura/Sonoma, AirPlay Receiver sometimes uses port `5000` or `7000`. Port `8000` is default for this app and does not conflict.
   - If port 8000 is occupied, you can change the port in `run.py` or run `uvicorn backend.main:app --port 8080`.
2. **SQLite FTS5 Support**:
   - macOS system Python and Homebrew Python come with SQLite FTS5 extension compiled in by default.
3. **File Permissions**:
   - Ensure the user account has read/write permissions to `data/` and `data/logs/`.
