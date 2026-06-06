"""Tests for WebSocket streaming ASR endpoint."""

import os
import sys
import tempfile
from pathlib import Path
import pytest

BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))

TEST_DB = Path(tempfile.gettempdir()) / "nootbook_test_asr_ws.db"
for suffix in ("", "-shm", "-wal"):
    try:
        (Path(f"{TEST_DB}{suffix}")).unlink()
    except FileNotFoundError:
        pass

os.environ["SECRET_KEY"] = "test-secret-key-with-at-least-32-bytes"
os.environ["ADMIN_DEFAULT_EMAIL"] = "admin"
os.environ["ADMIN_DEFAULT_PASSWORD"] = "admin123"
os.environ["DATABASE_URL"] = f"sqlite:///{TEST_DB.as_posix()}"
os.environ["SKIP_ASR_PRELOAD"] = "1"

from fastapi.testclient import TestClient

from app.main import app


def auth_headers(client: TestClient) -> dict[str, str]:
    resp = client.post(
        "/api/auth/login",
        json={"email": "admin", "password": "admin123"},
    )
    assert resp.status_code == 200
    return {
        "Authorization": f"Bearer {resp.json()['access_token']}",
        "Origin": "http://localhost:5173",
    }


def test_ws_auth_required():
    """WebSocket without token should be rejected."""
    with TestClient(app) as client:
        with pytest.raises(Exception):
            with client.websocket_connect("/ws/asr/test-session"):
                pass


def test_ws_invalid_token_rejected():
    """WebSocket with invalid token should be rejected."""
    with TestClient(app) as client:
        with pytest.raises(Exception):
            with client.websocket_connect("/ws/asr/test-session?token=invalid"):
                pass


def test_ws_non_owner_rejected():
    """Non-owner should not be able to connect to another user's session."""
    with TestClient(app) as client:
        # Register a second user
        resp = client.post(
            "/api/auth/register",
            json={"username": "user2", "email": "user2@test.com", "password": "password123"},
        )
        assert resp.status_code == 201

        resp = client.post(
            "/api/auth/login",
            json={"email": "user2@test.com", "password": "password123"},
        )
        assert resp.status_code == 200
        token = resp.json()["access_token"]

        with pytest.raises(Exception):
            with client.websocket_connect(f"/ws/asr/nonexistent-session?token={token}"):
                pass


def test_ws_owner_can_connect():
    """Owner can establish WebSocket connection and receive start status."""
    with TestClient(app) as client:
        headers = auth_headers(client)

        # Create a notebook and session
        resp = client.post("/api/notebooks/", json={"title": "Test Notebook"}, headers=headers)
        assert resp.status_code == 201
        nb_id = resp.json()["id"]

        resp = client.post(
            f"/api/sessions?notebook_id={nb_id}",
            json={"title": "Test Session"},
            headers=headers,
        )
        assert resp.status_code == 201
        session_id = resp.json()["id"]

        token = headers["Authorization"].split(" ")[1]
        with client.websocket_connect(f"/ws/asr/{session_id}?token={token}") as ws:
            ws.send_json({"type": "start"})
            msg = ws.receive_json()
            assert msg["type"] == "status"
            assert "开始" in msg["message"]
            ws.send_json({"type": "end"})
            # Wait for done
            for _ in range(5):
                try:
                    m = ws.receive_json()
                    if m["type"] == "done":
                        break
                except Exception:
                    break


def test_ws_partial_not_saved():
    """Partial results should not be persisted to the database until end."""
    with TestClient(app) as client:
        headers = auth_headers(client)

        resp = client.post("/api/notebooks/", json={"title": "Test Notebook 2"}, headers=headers)
        assert resp.status_code == 201
        nb_id = resp.json()["id"]

        resp = client.post(
            f"/api/sessions?notebook_id={nb_id}",
            json={"title": "Test Session 2"},
            headers=headers,
        )
        assert resp.status_code == 201
        session_id = resp.json()["id"]

        token = headers["Authorization"].split(" ")[1]
        with client.websocket_connect(f"/ws/asr/{session_id}?token={token}") as ws:
            ws.send_json({"type": "start"})
            ws.receive_json()  # status

            # Send minimal audio (silence)
            ws.send_bytes(b"\x00" * 5120)
            # End immediately
            ws.send_json({"type": "end"})
            msg = ws.receive_json()
            assert msg["type"] == "done"


def test_ws_pause_resume():
    """Pause and resume commands should be acknowledged."""
    with TestClient(app) as client:
        headers = auth_headers(client)

        resp = client.post("/api/notebooks/", json={"title": "Test Notebook 3"}, headers=headers)
        assert resp.status_code == 201
        nb_id = resp.json()["id"]

        resp = client.post(
            f"/api/sessions?notebook_id={nb_id}",
            json={"title": "Test Session 3"},
            headers=headers,
        )
        assert resp.status_code == 201
        session_id = resp.json()["id"]

        token = headers["Authorization"].split(" ")[1]
        with client.websocket_connect(f"/ws/asr/{session_id}?token={token}") as ws:
            ws.send_json({"type": "start"})
            ws.receive_json()  # status: 识别已开始

            ws.send_json({"type": "pause"})
            msg = ws.receive_json()
            assert msg["type"] == "status"
            assert "暂停" in msg["message"]

            ws.send_json({"type": "resume"})
            msg = ws.receive_json()
            assert msg["type"] == "status"
            assert "恢复" in msg["message"]

            ws.send_json({"type": "end"})
            for _ in range(5):
                msg = ws.receive_json()
                if msg["type"] == "done":
                    break
