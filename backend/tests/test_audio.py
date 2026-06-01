import pytest
import requests
import wave
import io
import os

API_BASE = os.getenv("API_BASE", "http://127.0.0.1:8003")


def create_test_audio(duration_ms: int = 100) -> io.BytesIO:
    buf = io.BytesIO()
    with wave.open(buf, 'wb') as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(16000)
        wf.writeframes(b'\x00' * (16 * duration_ms))
    buf.seek(0)
    return buf


@pytest.fixture(scope="module")
def access_token():
    resp = requests.post(
        f"{API_BASE}/api/auth/login",
        json={"email": "admin", "password": "admin123"},
        timeout=5,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert "access_token" in data
    return data["access_token"]


def test_health():
    resp = requests.get(f"{API_BASE}/api/health", timeout=10)
    assert resp.status_code == 200
    data = resp.json()
    assert data.get("status") == "ok"


def test_login():
    resp = requests.post(
        f"{API_BASE}/api/auth/login",
        json={"email": "admin", "password": "admin123"},
        timeout=5,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert "access_token" in data
    assert "refresh_token" in data


def test_audio_stream(access_token: str):
    resp = requests.post(
        f"{API_BASE}/api/notebooks",
        headers={"Authorization": f"Bearer {access_token}"},
        json={"title": "Pytest Notebook"},
        timeout=5,
    )
    assert resp.status_code == 201
    notebook_id = resp.json()["id"]

    resp = requests.post(
        f"{API_BASE}/api/sessions",
        headers={"Authorization": f"Bearer {access_token}"},
        params={"notebook_id": notebook_id},
        json={"title": "Pytest Session"},
        timeout=5,
    )
    assert resp.status_code == 201
    session_id = resp.json()["id"]

    headers = {"Authorization": f"Bearer {access_token}"}
    files = {"file": ("test.webm", create_test_audio(), "audio/webm")}
    params = {"session_id": session_id, "chunk_index": 0}

    resp = requests.post(
        f"{API_BASE}/api/process/audio-stream",
        params=params,
        files=files,
        headers=headers,
        timeout=30,
    )
    assert resp.status_code == 200, f"Expected 200, got {resp.status_code}"
    data = resp.json()
    assert "text" in data, "Response missing 'text' field"
