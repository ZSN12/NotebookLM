"""Tests for the multi-agent API endpoints."""

import json
import os
import sys
import time
from pathlib import Path
from unittest.mock import patch, MagicMock

BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))

os.environ["SKIP_ASR_PRELOAD"] = "1"
os.environ["DEEPSEEK_API_KEY"] = "test-key-for-agents"

from fastapi.testclient import TestClient
from app.main import app
from app.core.database import SessionLocal
from app.models import Note, User
from app.core.auth import hash_password


def auth_headers(client: TestClient) -> dict[str, str]:
    resp = client.post(
        "/api/auth/login",
        json={"email": "admin", "password": "admin123"},
    )
    assert resp.status_code == 200, resp.text
    return {
        "Authorization": f"Bearer {resp.json()['access_token']}",
        "Origin": "http://localhost:5173",
    }


def _create_notebook_session_note(client: TestClient, headers: dict):
    """Create notebook + session + note with content."""
    nb = client.post("/api/notebooks", json={"title": "Agent Test NB"}, headers=headers)
    assert nb.status_code == 201
    notebook_id = nb.json()["id"]

    sess = client.post(
        f"/api/sessions?notebook_id={notebook_id}",
        json={"title": "Agent Test Session", "summary": "Testing agents", "keywords": ["test"]},
        headers=headers,
    )
    assert sess.status_code == 201
    session_id = sess.json()["id"]

    client.put(
        f"/api/notes/session/{session_id}",
        json={
            "content": "今天我们学习了单例模式和工厂模式。单例模式确保一个类只有一个实例。",
        },
        headers=headers,
    )

    return notebook_id, session_id


def _mock_openai_response(data: dict):
    mock_client = MagicMock()
    mock_response = MagicMock()
    mock_response.choices = [MagicMock()]
    mock_response.choices[0].message.content = json.dumps(data)
    mock_client.chat.completions.create.return_value = mock_response
    return mock_client


# ── _maybe_return_ready_or_stale unit tests ──

def test_legacy_output_without_content_hash_is_stale():
    """When an existing agent output lacks content_hash, it must be treated as stale
    and trigger regeneration instead of returning ready old data."""
    with patch("app.agents.base.OpenAI") as mock_cls:
        mock_client = _mock_openai_response({
            "title": "测试知识导图",
            "summary": "测试摘要",
            "nodes": [
                {
                    "id": "n1",
                    "title": "单例模式",
                    "description": "确保一个类只有一个实例",
                    "type": "concept",
                    "importance": "high",
                    "sources": [{"source_type": "transcript", "snippet": "单例模式"}],
                    "children": []
                }
            ],
            "relations": []
        })
        mock_cls.return_value = mock_client

        with TestClient(app) as client:
            headers = auth_headers(client)
            _, session_id = _create_notebook_session_note(client, headers)

            # Directly inject a legacy agent output that has NO content_hash.
            db = SessionLocal()
            try:
                note = db.query(Note).filter(Note.session_id == session_id).first()
                assert note is not None
                note.vocabulary = [
                    {
                        "kind": "agent_summary",
                        "data": {"summary": "旧摘要内容"},
                        # Intentionally NO content_hash — this is legacy data.
                    }
                ]
                db.commit()
            finally:
                db.close()

            # Call the single-agent endpoint.
            resp = client.post(
                f"/api/agents/session/{session_id}/run/summary",
                headers=headers,
            )

            # Must NOT return ready with the stale old data.
            # Since the agent runs synchronously in this path (with mock),
            # we expect success with the newly generated data.
            assert resp.status_code == 200, resp.text
            body = resp.json()
            assert body["status"] != "ready", (
                f"Expected regeneration for legacy data without content_hash, "
                f"but got ready with old data: {body}"
            )
            assert body["status"] == "success"


# ── Integration: run single agent with fresh hash returns ready ──

def test_fresh_output_with_matching_hash_returns_ready():
    """When an existing agent output has a content_hash that matches the current
    note content, the endpoint should return ready without calling the LLM."""
    with patch("app.agents.base.OpenAI") as mock_cls:
        mock_client = _mock_openai_response({"summary": "新摘要"})
        mock_cls.return_value = mock_client

        with TestClient(app) as client:
            headers = auth_headers(client)
            _, session_id = _create_notebook_session_note(client, headers)

            # Generate once to create a valid output with content_hash.
            resp = client.post(
                f"/api/agents/session/{session_id}/run/summary",
                headers=headers,
            )
            assert resp.status_code == 200, resp.text
            assert resp.json()["status"] == "success"

            # Second call without force should return ready (no LLM call).
            resp2 = client.post(
                f"/api/agents/session/{session_id}/run/summary",
                headers=headers,
            )
            assert resp2.status_code == 200, resp2.text
            body = resp2.json()
            assert body["status"] == "ready", (
                f"Expected ready for fresh matching hash, got: {body}"
            )
            # Ensure the LLM was only called once (first generation).
            assert mock_client.chat.completions.create.call_count == 1
