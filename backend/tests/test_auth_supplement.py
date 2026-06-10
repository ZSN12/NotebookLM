"""Supplemental tests for auth endpoints not covered by test_api_security."""

import os
import sys
from pathlib import Path
from io import BytesIO

BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))

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


class TestRefreshToken:
    def test_refresh_valid_token(self):
        with TestClient(app) as client:
            login_resp = client.post("/api/auth/login", json={"email": "admin", "password": "admin123"})
            refresh_token = login_resp.json()["refresh_token"]

            resp = client.post("/api/auth/refresh", json={"refresh_token": refresh_token})
            assert resp.status_code == 200
            data = resp.json()
            assert "access_token" in data
            assert data["token_type"] == "bearer"

    def test_refresh_invalid_token_rejected(self):
        with TestClient(app) as client:
            resp = client.post("/api/auth/refresh", json={"refresh_token": "bad-token"})
            assert resp.status_code == 401


class TestGetMe:
    def test_get_me_returns_user(self):
        with TestClient(app) as client:
            headers = auth_headers(client)
            resp = client.get("/api/auth/me", headers=headers)
            assert resp.status_code == 200
            data = resp.json()
            assert data["email"] == "admin"

    def test_get_me_without_auth_rejected(self):
        with TestClient(app) as client:
            resp = client.get("/api/auth/me")
            assert resp.status_code in (401, 403)


class TestUpdateProfile:
    def test_update_username(self):
        with TestClient(app) as client:
            headers = auth_headers(client)
            resp = client.put("/api/auth/profile", json={"username": "New Admin"}, headers=headers)
            assert resp.status_code == 200
            assert resp.json()["username"] == "New Admin"

    def test_update_profile_unauthorized(self):
        with TestClient(app) as client:
            resp = client.put("/api/auth/profile", json={"username": "x"})
            assert resp.status_code in (401, 403)


class TestChangePassword:
    def test_change_password_success(self):
        with TestClient(app) as client:
            headers = auth_headers(client)
            resp = client.put(
                "/api/auth/change-password",
                json={"old_password": "admin123", "new_password": "newpass456"},
                headers=headers,
            )
            assert resp.status_code == 200

            # Login with new password
            login = client.post("/api/auth/login", json={"email": "admin", "password": "newpass456"})
            assert login.status_code == 200

            # Reset back for other tests using the new-password token
            reset_headers = {
                "Authorization": f"Bearer {login.json()['access_token']}",
                "Origin": "http://localhost:5173",
            }
            client.put(
                "/api/auth/change-password",
                json={"old_password": "newpass456", "new_password": "admin123"},
                headers=reset_headers,
            )

    def test_change_password_wrong_old_password(self):
        with TestClient(app) as client:
            headers = auth_headers(client)
            resp = client.put(
                "/api/auth/change-password",
                json={"old_password": "wrong", "new_password": "newpass456"},
                headers=headers,
            )
            assert resp.status_code == 400


class TestAvatar:
    def test_upload_and_get_avatar(self):
        with TestClient(app) as client:
            headers = auth_headers(client)
            fake_image = BytesIO(b"fake-image-bytes")
            resp = client.post(
                "/api/auth/avatar",
                files={"file": ("test.png", fake_image, "image/png")},
                headers=headers,
            )
            assert resp.status_code == 200
            data = resp.json()
            assert "avatar_url" in data

            # Get user_id from /me
            me = client.get("/api/auth/me", headers=headers)
            user_id = me.json()["id"]

            # Fetch avatar
            avatar_resp = client.get(f"/api/auth/avatar/{user_id}")
            assert avatar_resp.status_code == 200
            assert avatar_resp.content == b"fake-image-bytes"

    def test_upload_unsupported_type_rejected(self):
        with TestClient(app) as client:
            headers = auth_headers(client)
            fake_file = BytesIO(b"text")
            resp = client.post(
                "/api/auth/avatar",
                files={"file": ("test.txt", fake_file, "text/plain")},
                headers=headers,
            )
            assert resp.status_code == 400

    def test_get_avatar_missing_user(self):
        with TestClient(app) as client:
            resp = client.get("/api/auth/avatar/00000000-0000-0000-0000-000000000000")
            assert resp.status_code == 404


class TestLoginRateLimit:
    def test_login_fails_multiple_times_then_locks(self):
        with TestClient(app) as client:
            # Register a new user first
            client.post(
                "/api/auth/register",
                json={
                    "username": "Rate User",
                    "email": "rate@example.com",
                    "password": "password123",
                    "security_question": "q",
                    "security_answer": "a",
                },
            )

            # Fail 4 times (1 remaining before lock)
            for _ in range(4):
                resp = client.post("/api/auth/login", json={"email": "rate@example.com", "password": "wrong"})
                assert resp.status_code == 401

            # 5th failure should trigger lock
            resp = client.post("/api/auth/login", json={"email": "rate@example.com", "password": "wrong"})
            assert resp.status_code == 429

            # Correct password should also be blocked
            resp = client.post("/api/auth/login", json={"email": "rate@example.com", "password": "password123"})
            assert resp.status_code == 429
