import time
_startup_t0 = time.perf_counter()

import os
import sys
from pathlib import Path
import uvicorn
import webbrowser
import threading

# Set working directory to project root
app_dir = Path(__file__).resolve().parent
os.chdir(app_dir)
if str(app_dir) not in sys.path:
    sys.path.insert(0, str(app_dir))

def open_browser(url: str):
    time.sleep(0.8)
    try:
        webbrowser.open(url)
    except Exception:
        pass

if __name__ == "__main__":
    import socket
    port = 8000
    host = "0.0.0.0"
    
    # Detect local LAN IP
    try:
        hostname = socket.gethostname()
        lan_ip = socket.gethostbyname(hostname)
    except Exception:
        lan_ip = "127.0.0.1"
        
    local_url = f"http://127.0.0.1:{port}"
    lan_url = f"http://{lan_ip}:{port}"
    
    # Pre-load FastAPI backend
    from backend.main import app
    _ready_ms = (time.perf_counter() - _startup_t0) * 1000

    print("=" * 65, flush=True)
    print("  TRIRIGA Multi-Server Log Analysis & Forensics SPA", flush=True)
    print(f"  Local Access:   {local_url}", flush=True)
    print(f"  LAN / Network:  {lan_url}", flush=True)
    print(f"  Database:       {app_dir / 'data' / 'tririga_logs.db'}", flush=True)
    print(f"  Backend Ready:  {_ready_ms:.0f}ms (Startup milestone)", flush=True)
    print(f"  Perf Metrics:   {local_url}/api/perf/metrics", flush=True)
    print("=" * 65, flush=True)
    
    # Auto-open browser in background thread
    threading.Thread(target=open_browser, args=(local_url,), daemon=True).start()
    
    try:
        config = uvicorn.Config(
            app,
            host=host,
            port=port,
            reload=False,
            log_level="info",
            timeout_keep_alive=300,
            limit_concurrency=100
        )
        server = uvicorn.Server(config)
        server.run()
    except Exception as e:
        import traceback
        traceback.print_exc()

