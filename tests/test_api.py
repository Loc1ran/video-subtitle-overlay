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
