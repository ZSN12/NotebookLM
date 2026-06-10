import os
import sys
from pathlib import Path
from unittest.mock import patch

BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))

os.environ["SKIP_ASR_PRELOAD"] = "1"

from fastapi.testclient import TestClient

from app.core.auth import hash_password
from app.core.database import SessionLocal
from app.main import app
from app.models import User


def auth_headers(client: TestClient, email: str = "admin", password: str = "admin123") -> dict[str, str]:
    resp = client.post(
        "/api/auth/login",
        json={"email": email, "password": password},
    )
    assert resp.status_code == 200, resp.text
    return {
        "Authorization": f"Bearer {resp.json()['access_token']}",
        "Origin": "http://localhost:5173",
    }


def _create_user(email: str, username: str, password: str = "other1234") -> None:
    db = SessionLocal()
    try:
        if not db.query(User).filter(User.email == email).first():
            db.add(User(username=username, email=email, password_hash=hash_password(password)))
            db.commit()
    finally:
        db.close()


def _create_notebook_session(client: TestClient, headers: dict[str, str]) -> tuple[str, str]:
    nb = client.post("/api/notebooks", json={"title": "RAG Test Notebook"}, headers=headers)
    assert nb.status_code == 201, nb.text
    notebook_id = nb.json()["id"]

    sess = client.post(
        f"/api/sessions?notebook_id={notebook_id}",
        json={"title": "RAG Test Session", "summary": "RAG", "keywords": ["rag"]},
        headers=headers,
    )
    assert sess.status_code == 201, sess.text
    return notebook_id, sess.json()["id"]


def test_rag_session_scope_validates_owner_without_session_user_id():
    with TestClient(app) as client:
        headers = auth_headers(client)
        _, session_id = _create_notebook_session(client, headers)

        with patch("app.api.rag.vector_service.search_vectors", return_value=[]), patch(
            "app.api.rag._call_llm_stream",
            return_value=iter(()),
        ):
            resp = client.post(
                "/api/rag/ask",
                json={"query": "这节课讲了什么？", "session_id": session_id},
                headers=headers,
            )

        assert resp.status_code == 200, resp.text


def test_rag_rejects_other_users_session():
    with TestClient(app) as client:
        admin_headers = auth_headers(client)
        _, session_id = _create_notebook_session(client, admin_headers)

        _create_user("rag-other@example.com", "rag-other")
        other_headers = auth_headers(client, "rag-other@example.com", "other1234")

        resp = client.post(
            "/api/rag/ask",
            json={"query": "这节课讲了什么？", "session_id": session_id},
            headers=other_headers,
        )

        assert resp.status_code == 404
        assert resp.json()["detail"] == "Session not found"


def test_rag_rejects_other_users_notebook():
    with TestClient(app) as client:
        admin_headers = auth_headers(client)
        notebook_id, _ = _create_notebook_session(client, admin_headers)

        _create_user("rag-reader@example.com", "rag-reader")
        other_headers = auth_headers(client, "rag-reader@example.com", "other1234")

        resp = client.post(
            "/api/rag/ask",
            json={"query": "这门课有哪些重点？", "notebook_id": notebook_id},
            headers=other_headers,
        )

        assert resp.status_code == 404
        assert resp.json()["detail"] == "Notebook not found"
