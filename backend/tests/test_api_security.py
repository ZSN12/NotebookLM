import os
import sys
import tempfile
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))

TEST_DB = Path(tempfile.gettempdir()) / "nootbook_test_api_security.db"
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
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


def test_health_and_login():
    with TestClient(app) as client:
        resp = client.get("/api/health")
        assert resp.status_code == 200
        assert resp.json()["status"] == "ok"

        resp = client.post(
            "/api/auth/login",
            json={"email": "admin", "password": "admin123"},
        )
        assert resp.status_code == 200
        assert "access_token" in resp.json()
        assert "refresh_token" in resp.json()


def test_password_reset_allows_account_only_reset():
    with TestClient(app) as client:
        resp = client.post(
            "/api/auth/register",
            json={"username": "Reset User", "email": "reset@example.com", "password": "oldpass123"},
        )
        assert resp.status_code == 201

        resp = client.post(
            "/api/auth/reset-password",
            json={
                "email": "reset@example.com",
                "new_password": "newpass123",
            },
        )
        assert resp.status_code == 200

        resp = client.post(
            "/api/auth/login",
            json={"email": "reset@example.com", "password": "newpass123"},
        )
        assert resp.status_code == 200


def test_media_routes_require_authentication():
    with TestClient(app) as client:
        resp = client.get("/api/media/audio/example.wav")
        assert resp.status_code in (401, 403)


def test_ppt_align_requires_owned_session():
    with TestClient(app) as client:
        headers = auth_headers(client)
        resp = client.post(
            "/api/process/ppt-align",
            params={"session_id": "missing-session", "text": "hello"},
            headers=headers,
        )
        assert resp.status_code == 404
