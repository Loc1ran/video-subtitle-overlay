import os
import pytest
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)

def test_extraction_progress_idle():
    res = client.get("/api/extraction-progress/nonexistent_file_id")
    assert res.status_code == 200
    data = res.json()
    assert data["success"] is True
    assert data["progress"]["status"] == "idle"

def test_video_not_found():
    res = client.get("/api/video/nonexistent_id")
    assert res.status_code == 404

def test_state_not_found():
    res = client.get("/api/state/nonexistent_id")
    assert res.status_code == 404

def test_transcript_not_found():
    res = client.get("/api/transcript/nonexistent_id")
    assert res.status_code == 404

def test_translate_empty_segments():
    res = client.post("/api/translate", json={
        "segments": [],
        "target_lang": "vi"
    })
    assert res.status_code == 200
    data = res.json()
    assert data["success"] is True
    assert data["segments"] == []

def test_save_state_with_reframe():
    test_id = "test_reframe_id"
    state_file = os.path.join("uploads", f"{test_id}_state.json")
    try:
        res = client.post(f"/api/save-state/{test_id}", json={
            "segments": [],
            "reframe_target": "tiktok",
            "reframe_mode": "blur"
        })
        assert res.status_code == 200
        data = res.json()
        assert data["success"] is True

        # Retrieve state
        state_res = client.get(f"/api/state/{test_id}")
        assert state_res.status_code == 200
        s_data = state_res.json()["data"]
        assert s_data["reframe_target"] == "tiktok"
        assert s_data["reframe_mode"] == "blur"
    finally:
        if os.path.exists(state_file):
            os.remove(state_file)

def test_save_state_with_flip():
    test_id = "test_flip_id"
    state_file = os.path.join("uploads", f"{test_id}_state.json")
    try:
        res = client.post(f"/api/save-state/{test_id}", json={
            "segments": [
                {
                    "id": 1,
                    "start": 0.0,
                    "end": 2.0,
                    "text": "Hello",
                    "custom_text": "Xin chao",
                    "x_pct": 30.0,
                    "y_pct": 80.0
                }
            ],
            "flip_horizontal": True
        })
        assert res.status_code == 200
        data = res.json()
        assert data["success"] is True

        # Retrieve state
        state_res = client.get(f"/api/state/{test_id}")
        assert state_res.status_code == 200
        s_data = state_res.json()["data"]
        assert s_data["flip_horizontal"] is True
        assert len(s_data["segments"]) == 1
        assert s_data["segments"][0]["text"] == "Hello"
        assert s_data["segments"][0]["custom_text"] == "Xin chao"
    finally:
        if os.path.exists(state_file):
            os.remove(state_file)

def test_index_route_cache_headers():
    res = client.get("/")
    assert res.status_code == 200
    # Verify Cache-Control header prevents stale browser cache
    assert "no-cache" in res.headers.get("cache-control", "").lower()
    assert "no-store" in res.headers.get("cache-control", "").lower()


