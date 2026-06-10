"""Tests for auto-triggering agents after transcription completes."""

import json
import os
import sys
from pathlib import Path
from unittest.mock import patch, MagicMock

BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))

os.environ["SKIP_ASR_PRELOAD"] = "1"
os.environ["DEEPSEEK_API_KEY"] = "test-key-for-auto-agents"

from fastapi.testclient import TestClient
from app.main import app
from app.core.database import SessionLocal
from app.models import Note, Task, User
from app.api.agents import _should_auto_trigger_agents, auto_run_agents


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


def _create_notebook_session_note(client: TestClient, headers: dict, content: str = ""):
    nb = client.post("/api/notebooks", json={"title": "Auto Agent Test NB"}, headers=headers)
    assert nb.status_code == 201
    notebook_id = nb.json()["id"]

    sess = client.post(
        f"/api/sessions?notebook_id={notebook_id}",
        json={"title": "Auto Agent Test Session", "summary": "Testing auto agents", "keywords": ["test"]},
        headers=headers,
    )
    assert sess.status_code == 201
    session_id = sess.json()["id"]

    if content:
        client.put(
            f"/api/notes/session/{session_id}",
            json={"content": content},
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


# ── _should_auto_trigger_agents unit tests ──

def test_should_auto_trigger_with_final_ai_corrected():
    note = Note(
        session_id="s1",
        transcript=[{
            "chunk_index": 0,
            "text": "hello",
            "correction_stage": "final",
            "is_ai_corrected": True,
        }],
    )
    assert _should_auto_trigger_agents(note) is True


def test_should_not_auto_trigger_without_final():
    note = Note(
        session_id="s1",
        transcript=[{
            "chunk_index": 0,
            "text": "hello",
            "correction_stage": "rolling",
            "is_ai_corrected": True,
        }],
    )
    assert _should_auto_trigger_agents(note) is False


def test_should_not_auto_trigger_without_ai_corrected():
    note = Note(
        session_id="s1",
        transcript=[{
            "chunk_index": 0,
            "text": "hello",
            "correction_stage": "final",
            "is_ai_corrected": False,
        }],
    )
    assert _should_auto_trigger_agents(note) is False


def test_should_not_auto_trigger_with_empty_transcript():
    note = Note(session_id="s1", transcript=[])
    assert _should_auto_trigger_agents(note) is False

    note2 = Note(session_id="s1", transcript=None)
    assert _should_auto_trigger_agents(note2) is False


# ── auto_run_agents integration tests ──

def test_auto_run_agents_skips_when_not_ai_corrected():
    with TestClient(app) as client:
        headers = auth_headers(client)
        _, session_id = _create_notebook_session_note(client, headers, content="raw text")

        # Inject a transcript that is NOT AI-corrected
        db = SessionLocal()
        try:
            note = db.query(Note).filter(Note.session_id == session_id).first()
            assert note is not None
            note.transcript = [{
                "chunk_index": 0,
                "text": "raw text",
                "correction_stage": "final",
                "is_ai_corrected": False,
            }]
            db.commit()
        finally:
            db.close()

        user = db.query(User).filter(User.email == "admin").first()
        result = auto_run_agents(session_id, user.id, roles=["summary", "mindmap", "quiz"])
        assert result is None

        # No tasks should have been created
        db = SessionLocal()
        try:
            tasks = db.query(Task).filter(Task.session_id == session_id).all()
            assert len(tasks) == 0
        finally:
            db.close()


def test_auto_run_agents_creates_tasks_when_final_and_ai_corrected():
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
            _, session_id = _create_notebook_session_note(
                client, headers,
                content="今天我们学习了单例模式和工厂模式。"
            )

            # Inject a final AI-corrected transcript
            db = SessionLocal()
            try:
                note = db.query(Note).filter(Note.session_id == session_id).first()
                note.transcript = [{
                    "chunk_index": 0,
                    "text": "今天我们学习了单例模式和工厂模式。",
                    "display_text": "今天我们学习了单例模式和工厂模式。",
                    "correction_stage": "final",
                    "is_ai_corrected": True,
                }]
                db.commit()
            finally:
                db.close()

            user = db.query(User).filter(User.email == "admin").first()
            result = auto_run_agents(session_id, user.id, roles=["summary", "mindmap", "quiz"])
            assert result is not None
            assert result["session_id"] == session_id
            assert len(result["agents"]) > 0

            # Verify tasks were created in DB
            db = SessionLocal()
            try:
                tasks = db.query(Task).filter(Task.session_id == session_id).all()
                assert len(tasks) >= 3  # summary, mindmap, quiz
                roles = {t.task_type.removeprefix("agent_") for t in tasks}
                assert "summary" in roles
                assert "mindmap" in roles
                assert "quiz" in roles
            finally:
                db.close()


def test_auto_run_agents_does_not_duplicate_active_tasks():
    with patch("app.agents.base.OpenAI") as mock_cls:
        mock_client = _mock_openai_response({"summary": "测试摘要"})
        mock_cls.return_value = mock_client

        with TestClient(app) as client:
            headers = auth_headers(client)
            _, session_id = _create_notebook_session_note(
                client, headers,
                content="测试内容"
            )

            db = SessionLocal()
            try:
                note = db.query(Note).filter(Note.session_id == session_id).first()
                note.transcript = [{
                    "chunk_index": 0,
                    "text": "测试内容",
                    "display_text": "测试内容",
                    "correction_stage": "final",
                    "is_ai_corrected": True,
                }]
                db.commit()
            finally:
                db.close()

            user = db.query(User).filter(User.email == "admin").first()

            # First call
            result1 = auto_run_agents(session_id, user.id, roles=["summary"])
            assert result1 is not None
            assert result1.get("reused") is not True

            # Second call immediately — should reuse active tasks
            result2 = auto_run_agents(session_id, user.id, roles=["summary"])
            assert result2 is not None
            assert result2.get("reused") is True

            # Only one task should exist for summary
            db = SessionLocal()
            try:
                tasks = (
                    db.query(Task)
                    .filter(Task.session_id == session_id, Task.task_type == "agent_summary")
                    .all()
                )
                assert len(tasks) == 1
            finally:
                db.close()
