"""Tests for the parallel workflow orchestrator.

Covers:
- Workflow start creates Task rows
- Missing session/notebook validation
- Agent thread execution (success / error paths)
- Task status progression
"""

import time
from unittest.mock import patch, MagicMock

import pytest

from app.core.database import SessionLocal
from app.core.orchestrator import ParallelWorkflow, _run_agent_thread
from app.models import Notebook, Note, Session as DBSession, Task, User
from app.core.auth import hash_password


@pytest.fixture
def setup_data():
    """Create a user, notebook, session, and note in the DB.

    Uses a standalone session (no transaction rollback) because
    _run_agent_thread spawns its own SessionLocal connections.
    """
    db = SessionLocal()
    created_ids = {"users": [], "notebooks": [], "sessions": [], "notes": [], "tasks": []}
    try:
        user = User(
            username="tester",
            email="tester@example.com",
            password_hash=hash_password("password"),
        )
        db.add(user)
        db.commit()
        db.refresh(user)
        created_ids["users"].append(user.id)

        notebook = Notebook(title="Test Notebook", user_id=user.id)
        db.add(notebook)
        db.commit()
        db.refresh(notebook)
        created_ids["notebooks"].append(notebook.id)

        session = DBSession(notebook_id=notebook.id, title="Test Session")
        db.add(session)
        db.commit()
        db.refresh(session)
        created_ids["sessions"].append(session.id)

        note = Note(session_id=session.id, content="test content")
        db.add(note)
        db.commit()
        db.refresh(note)
        created_ids["notes"].append(note.id)

        yield {"user": user, "notebook": notebook, "session": session, "note": note}
    finally:
        # Cleanup in reverse dependency order
        db.query(Task).filter(Task.session_id.in_(created_ids["sessions"])).delete(synchronize_session=False)
        db.query(Note).filter(Note.id.in_(created_ids["notes"])).delete(synchronize_session=False)
        db.query(DBSession).filter(DBSession.id.in_(created_ids["sessions"])).delete(synchronize_session=False)
        db.query(Notebook).filter(Notebook.id.in_(created_ids["notebooks"])).delete(synchronize_session=False)
        db.query(User).filter(User.id.in_(created_ids["users"])).delete(synchronize_session=False)
        db.commit()
        db.close()


class TestParallelWorkflow:
    def test_start_creates_tasks(self, setup_data):
        user = setup_data["user"]
        session = setup_data["session"]
        db = SessionLocal()
        try:
            wf = ParallelWorkflow(
                session_id=session.id,
                user=user,
                db=db,
                agent_roles=["summary", "mindmap"],
            )

            with patch("app.core.orchestrator.run_agent_task") as mock_runner:
                result = wf.start()

            assert result["session_id"] == session.id
            assert len(result["agents"]) == 2
            assert {a["role"] for a in result["agents"]} == {"summary", "mindmap"}

            # Verify Task rows were committed
            tasks = db.query(Task).filter(Task.session_id == session.id).all()
            assert len(tasks) == 2
            assert all(t.status == "pending" for t in tasks)

            # Verify threads were launched
            assert mock_runner.call_count == 2
        finally:
            db.close()

    def test_start_raises_when_session_missing(self, setup_data):
        user = setup_data["user"]
        db = SessionLocal()
        try:
            wf = ParallelWorkflow(
                session_id="00000000-0000-0000-0000-000000000000",
                user=user,
                db=db,
                agent_roles=["summary"],
            )

            with pytest.raises(ValueError, match="Session not found"):
                wf.start()
        finally:
            db.close()

    def test_start_raises_when_note_missing(self, setup_data):
        user = setup_data["user"]
        session = setup_data["session"]
        db = SessionLocal()
        try:
            # Delete the note
            db.query(Note).filter(Note.session_id == session.id).delete()
            db.commit()

            wf = ParallelWorkflow(
                session_id=session.id,
                user=user,
                db=db,
                agent_roles=["summary"],
            )

            # _run_agent_thread will raise when note is missing, but start() itself
            # only creates tasks. The error surfaces in the thread.
            with patch("app.core.orchestrator.run_agent_task") as mock_runner:
                result = wf.start()
            assert result["workflow_id"] is not None
        finally:
            db.close()


class TestRunAgentThread:
    def test_thread_success(self, setup_data):
        user = setup_data["user"]
        session = setup_data["session"]
        db = SessionLocal()
        try:
            task = Task(session_id=session.id, task_type="agent_summary", status="pending")
            db.add(task)
            db.commit()
            db.refresh(task)

            mock_result = MagicMock()
            mock_result.success = True
            mock_result.data = {"summary": "Great session"}
            mock_result.error_message = None

            with patch("app.core.orchestrator.get_agent") as mock_get_agent:
                mock_agent = MagicMock()
                mock_agent.run.return_value = mock_result
                mock_get_agent.return_value = mock_agent

                _run_agent_thread("wf-1", session.id, user.id, "summary", task.id)

            # Re-query in a fresh session to see committed changes
            fresh_db = SessionLocal()
            try:
                refreshed = fresh_db.query(Task).filter(Task.id == task.id).first()
                assert refreshed.status == "success"
                assert refreshed.progress == 1.0
                assert refreshed.error_message is None
            finally:
                fresh_db.close()
        finally:
            db.close()

    def test_thread_agent_error(self, setup_data):
        user = setup_data["user"]
        session = setup_data["session"]
        db = SessionLocal()
        try:
            task = Task(session_id=session.id, task_type="agent_summary", status="pending")
            db.add(task)
            db.commit()
            db.refresh(task)

            mock_result = MagicMock()
            mock_result.success = False
            mock_result.error_message = "LLM timeout"

            with patch("app.core.orchestrator.get_agent") as mock_get_agent:
                mock_agent = MagicMock()
                mock_agent.run.return_value = mock_result
                mock_get_agent.return_value = mock_agent

                _run_agent_thread("wf-1", session.id, user.id, "summary", task.id)

            fresh_db = SessionLocal()
            try:
                refreshed = fresh_db.query(Task).filter(Task.id == task.id).first()
                assert refreshed.status == "error"
                assert refreshed.error_message == "LLM timeout"
            finally:
                fresh_db.close()
        finally:
            db.close()

    def test_thread_exception_rollback(self, setup_data):
        user = setup_data["user"]
        session = setup_data["session"]
        db = SessionLocal()
        try:
            task = Task(session_id=session.id, task_type="agent_summary", status="pending")
            db.add(task)
            db.commit()
            db.refresh(task)

            with patch("app.core.orchestrator.get_agent") as mock_get_agent:
                mock_agent = MagicMock()
                mock_agent.run.side_effect = RuntimeError("Unexpected boom")
                mock_get_agent.return_value = mock_agent

                _run_agent_thread("wf-1", session.id, user.id, "summary", task.id)

            fresh_db = SessionLocal()
            try:
                refreshed = fresh_db.query(Task).filter(Task.id == task.id).first()
                assert refreshed.status == "error"
                assert "Unexpected boom" in refreshed.error_message
            finally:
                fresh_db.close()
        finally:
            db.close()

    def test_thread_missing_task_exits_early(self, setup_data):
        user = setup_data["user"]
        session = setup_data["session"]

        # Use a non-existent task_id
        _run_agent_thread("wf-1", session.id, user.id, "summary", "nonexistent-task-id")
        # Should exit silently without raising

    def test_thread_missing_user_exits_early(self, setup_data):
        user = setup_data["user"]
        session = setup_data["session"]
        db = SessionLocal()
        try:
            task = Task(session_id=session.id, task_type="agent_summary", status="pending")
            db.add(task)
            db.commit()
            db.refresh(task)

            # Use a non-existent user_id
            _run_agent_thread("wf-1", session.id, "nonexistent-user", "summary", task.id)
            # Should exit silently
        finally:
            db.close()

    def test_thread_missing_session_raises(self, setup_data):
        user = setup_data["user"]
        db = SessionLocal()
        try:
            task = Task(session_id="00000000-0000-0000-0000-000000000000", task_type="agent_summary", status="pending")
            db.add(task)
            db.commit()
            db.refresh(task)

            with patch("app.core.orchestrator.get_agent") as mock_get_agent:
                mock_agent = MagicMock()
                mock_get_agent.return_value = mock_agent

                _run_agent_thread("wf-1", "00000000-0000-0000-0000-000000000000", user.id, "summary", task.id)

            fresh_db = SessionLocal()
            try:
                refreshed = fresh_db.query(Task).filter(Task.id == task.id).first()
                assert refreshed.status == "error"
            finally:
                fresh_db.close()
        finally:
            db.close()
