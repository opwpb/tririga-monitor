import os
from pathlib import Path
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

import time
from starlette.middleware.gzip import GZipMiddleware
from .app.config import settings
from .app.db.database import init_db
from .app.api import servers, collector, logs, analysis, llm_config, auth, records, perf, db_query, agent_monitor, operations, server_config, storage, worktasks
from fastapi import Request
from fastapi.responses import JSONResponse
from contextlib import asynccontextmanager

# Initialize Database
init_db()

@asynccontextmanager
async def lifespan(app: FastAPI):
    from .app.services.log_scheduler import LogSchedulerService
    LogSchedulerService.start()
    yield
    LogSchedulerService.stop()

root_path = os.getenv("FASTAPI_ROOT_PATH", os.getenv("ROOT_PATH", ""))

app = FastAPI(
    title=settings.app_name,
    version=settings.app_version,
    description="IBM TRIRIGA Log Amalgamator, SQLite FTS5 Search, and Local LLM Forensic Diagnostics",
    lifespan=lifespan,
    root_path=root_path
)

# GZip compression for responses over 1KB (compresses JS bundle from 838KB down to ~230KB)
app.add_middleware(GZipMiddleware, minimum_size=1000)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Performance Monitoring, Authentication, and Smart Cache Middleware
@app.middleware("http")
async def auth_and_perf_middleware(request: Request, call_next):
    t0 = time.perf_counter()
    path = request.url.path

    # Check authentication for protected API routes (handling both root /api and subpath /<prefix>/api)
    is_api_route = "/api/" in path or path.endswith("/api")
    is_exempt = "/api/auth/" in path or path.endswith("/api/health") or "/api/perf" in path
    if is_api_route and not is_exempt and request.method != "OPTIONS":
        try:
            cfg = auth.get_auth_config()
            if cfg.get("is_enabled", 0):
                auth_header = request.headers.get("Authorization")
                x_auth_token = request.headers.get("X-Auth-Token")
                token_param = request.query_params.get("token")
                auth.verify_token(authorization=auth_header, x_auth_token=x_auth_token, token_query=token_param)
        except Exception:
            return JSONResponse(status_code=401, content={"detail": "Authentication required. Please unlock console."})

    try:
        response = await call_next(request)
    except Exception as exc:
        dur_ms = (time.perf_counter() - t0) * 1000
        perf.record_request_perf(request.method, path, 500, dur_ms)
        import traceback
        traceback.print_exc()
        return JSONResponse(
            status_code=500,
            content={"detail": f"Server error: {str(exc)}", "error_type": exc.__class__.__name__}
        )
    dur_ms = (time.perf_counter() - t0) * 1000

    # Record performance sample
    perf.record_request_perf(request.method, path, response.status_code, dur_ms)
    response.headers["X-Response-Time-ms"] = f"{dur_ms:.2f}"
    response.headers["Server-Timing"] = f"total;dur={dur_ms:.2f}"

    # High-performance structured console logging for API endpoints (excludes static assets)
    if is_api_route or path.endswith("/health"):
        query_str = f"?{request.url.query}" if request.url.query else ""
        display_path = f"{path}{query_str}"
        if len(display_path) > 90:
            display_path = display_path[:87] + "..."

        if response.status_code >= 400:
            print(f"[API ERROR] {request.method:<6} {display_path} -> {response.status_code} ({dur_ms:.1f}ms)", flush=True)
        elif dur_ms > 200:
            print(f"[API SLOW]  {request.method:<6} {display_path} -> {response.status_code} ({dur_ms:.1f}ms)", flush=True)
        else:
            print(f"[API]       {request.method:<6} {display_path} -> {response.status_code} ({dur_ms:.1f}ms)", flush=True)

    # Smart Caching:
    # 1. Vite hashed static assets in /assets/ are immutable: cache for 1 year
    if "/assets/" in path:
        response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
    else:
        # 2. Dynamic API endpoints and index.html: no-cache to always receive fresh data
        response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"

    return response

# Include API Routers
app.include_router(perf.router)
app.include_router(auth.router)
app.include_router(servers.router)
app.include_router(collector.router)
app.include_router(logs.router)
app.include_router(analysis.router)
app.include_router(llm_config.router)
app.include_router(records.router)
app.include_router(db_query.router)
app.include_router(agent_monitor.router)
app.include_router(operations.router)
app.include_router(server_config.router)
app.include_router(storage.router)
app.include_router(worktasks.router)

@app.get("/api/health")
def health_check():
    return {
        "status": "healthy",
        "app": settings.app_name,
        "version": settings.app_version,
        "db_path": str(settings.db_path)
    }

# Serve Frontend static assets in production if built
frontend_dist = settings.base_dir / "frontend" / "dist"
if frontend_dist.exists():
    app.mount("/assets", StaticFiles(directory=frontend_dist / "assets"), name="assets")

    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        # Don't intercept API routes
        if "/api/" in full_path or full_path.endswith("/api") or full_path.startswith("api"):
            from fastapi import HTTPException
            raise HTTPException(status_code=404, detail="API route not found")

        # Directly serve matched static files in dist (e.g. favicon, images)
        direct_file = (frontend_dist / full_path).resolve()
        if direct_file.is_file() and str(direct_file).startswith(str(frontend_dist)):
            # Never cache service worker or manifest
            if full_path in ("sw.js", "manifest.webmanifest"):
                return FileResponse(
                    direct_file,
                    headers={
                        "Cache-Control": "no-cache, no-store, must-revalidate",
                        "Pragma": "no-cache",
                        "Expires": "0"
                    }
                )
            return FileResponse(direct_file)

        # Fallback for assets under subpaths (e.g. admindashboard/assets/...)
        if "assets/" in full_path:
            asset_rel = full_path[full_path.index("assets/"):]
            target_asset = (frontend_dist / asset_rel).resolve()
            if target_asset.is_file() and str(target_asset).startswith(str(frontend_dist)):
                return FileResponse(target_asset)

        index_file = frontend_dist / "index.html"
        if index_file.exists():
            return FileResponse(
                index_file,
                headers={
                    "Cache-Control": "no-cache, no-store, must-revalidate",
                    "Pragma": "no-cache",
                    "Expires": "0"
                }
            )
        return {"message": "Frontend build not found. Please build the frontend."}
