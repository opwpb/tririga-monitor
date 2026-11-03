# -*- coding: utf-8 -*-
import pytest
from fastapi.testclient import TestClient
from backend.main import app
from backend.app.services.log_storage_service import LogStorageService

client = TestClient(app)

def get_auth_headers():
    login_res = client.post("/api/auth/login", json={"password": "admin2026!"})
    if login_res.status_code == 200:
        token = login_res.json().get("token")
        return {"X-Auth-Token": token}
    return {}

def test_storage_stats_endpoint():
    headers = get_auth_headers()
    response = client.get("/api/storage/stats", headers=headers)
    assert response.status_code == 200
    data = response.json()
    assert "retention_days" in data
    assert "live_db_size_mb" in data
    assert "total_live_entries" in data
    assert "settings" in data
    assert "server_breakdown" in data

def test_storage_settings_endpoint():
    headers = get_auth_headers()
    response = client.get("/api/storage/settings", headers=headers)
    assert response.status_code == 200
    data = response.json()
    assert "retention_days" in data
    assert "auto_prune_enabled" in data

    # Test update
    update_res = client.post("/api/storage/settings", json={"retention_days": 7, "auto_prune_enabled": True}, headers=headers)
    assert update_res.status_code == 200
    updated = update_res.json()
    assert updated["retention_days"] == 7
    assert updated["auto_prune_enabled"] is True

def test_list_and_search_archives():
    headers = get_auth_headers()
    archives_res = client.get("/api/storage/archives", headers=headers)
    assert archives_res.status_code == 200
    archives = archives_res.json()
    assert isinstance(archives, list)

    # Search cold archives endpoint
    search_res = client.get("/api/storage/search-archives?search=error&page=1&page_size=10", headers=headers)
    assert search_res.status_code == 200
    search_data = search_res.json()
    assert "items" in search_data
    assert "total" in search_data
    assert "duration_ms" in search_data

def test_logs_query_with_archives():
    headers = get_auth_headers()
    # Test query_logs seamlessly returns live logs and checks cold archives
    res = client.get("/api/logs?page=1&page_size=20&include_archives=true", headers=headers)
    assert res.status_code == 200
    data = res.json()
    assert "items" in data
    assert "total" in data

def test_storage_service_direct():
    stats = LogStorageService.get_storage_stats()
    assert stats["retention_days"] >= 1
    assert stats["live_db_size_mb"] > 0
    assert stats["total_live_entries"] > 0
