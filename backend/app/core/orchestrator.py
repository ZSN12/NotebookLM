"""Lightweight workflow orchestrator for running agents in parallel.

Each agent gets its own Task row and runs in a daemon thread with a fresh
SQLAlchemy session so that agents do not share database state across threads.
"""

from __future__ import annotations

import logging
import threading
import uuid
from typing import Optional

from app.agents import AgentContext, get_agent, list_agents
from app.core.database import SessionLocal
from app.core.task_runner import run_agent_task
from app.models import Notebook, Note, Session as DBSession, Task, User

logger = logging.getLogger(__name__)


class ParallelWorkflow:
    """Run a set of agents in parallel for a single session."""

    def __init__(self, session_id: str, user: User, db, agent_roles: Optional[list[str]] = None):
        self.workflow_id = str(uuid.uuid4())
        self.session_id = session_id
        self.user_id = user.id
        self.db = db
        self.agent_roles = agent_roles or list_agents()

    def start(self) -> dict:
        """Create Task rows for each agent and launch daemon threads.

        Returns immediately with the initial status of all agents.
        """
        # Resolve related models in the caller's session.
        session = self._get_session()
        if not session:
            raise ValueError("Session not found or access denied")

        note = self._get_note()
        notebook = self._get_notebook(session)

        tasks_info: list[dict] = []
        for role in self.agent_roles:
            # Validate agent exists before creating a task.
            get_agent(role)

            task = Task(
                session_id=self.session_id,
                task_type=f"agent_{role}",
                status="pending",
                progress=0.0,
                error_message=None,
            )
            self.db.add(task)
            tasks_info.append({"role": role, "task": task})

        self.db.commit()

        # Refresh tasks to get generated IDs, then start threads.
        for info in tasks_info:
            self.db.refresh(info["task"])
            run_agent_task(
                target=lambda w=self.workflow_id, s=self.session_id, u=self.user_id, r=info["role"], t=info["task"].id: _run_agent_thread(w, s, u, r, t),
                daemon=True,
            )
            logger.info(
                "agent_task_started workflow_id=%s role=%s task_id=%s",
                self.workflow_id,
                info["role"],
                info["task"].id,
            )

        return {
            "workflow_id": self.workflow_id,
            "session_id": self.session_id,
            "agents": [
                {
                    "role": info["role"],
                    "task_id": info["task"].id,
                    "status": info["task"].status,
                    "progress": float(info["task"].progress or 0.0),
                    "error": info["task"].error_message,
                }
                for info in tasks_info
            ],
        }

    # ── Internal helpers ──

    def _get_session(self) -> Optional[DBSession]:
        return (
            self.db.query(DBSession)
            .filter(DBSession.id == self.session_id)
            .join(Notebook)
            .filter(Notebook.user_id == self.user_id)
            .first()
        )

    def _get_note(self) -> Optional[Note]:
        return self.db.query(Note).filter(Note.session_id == self.session_id).first()

    def _get_notebook(self, session: DBSession) -> Optional[Notebook]:
        return self.db.query(Notebook).filter(Notebook.id == session.notebook_id).first()


def _run_agent_thread(
    workflow_id: str,
    session_id: str,
    user_id: str,
    role: str,
    task_id: str,
) -> None:
    """Thread worker: owns a fresh DB session and runs one agent to completion."""
    db = SessionLocal()
    try:
        task = db.query(Task).filter(Task.id == task_id).first()
        user = db.query(User).filter(User.id == user_id).first()
        if not task or not user:
            logger.error("agent_thread_missing_prereqs task_id=%s user_id=%s", task_id, user_id)
            return

        task.status = "running"
        task.progress = 0.1
        task.error_message = None
        db.commit()

        session = (
            db.query(DBSession)
            .filter(DBSession.id == session_id)
            .join(Notebook)
            .filter(Notebook.user_id == user_id)
            .first()
        )
        if not session:
            raise ValueError("Session not found or access denied")

        note = db.query(Note).filter(Note.session_id == session_id).first()
        if not note:
            raise ValueError("No note found for session")

        notebook = db.query(Notebook).filter(Notebook.id == session.notebook_id).first()
        if not notebook:
            raise ValueError("Notebook not found")

        agent = get_agent(role)
        ctx = AgentContext(
            session_id=session_id,
            user=user,
            db=db,
            note=note,
            session=session,
            notebook=notebook,
            task=task,
        )
        result = agent.run(ctx)

        task = db.query(Task).filter(Task.id == task_id).first()
        if not task:
            return

        if result.success:
            task.status = "success"
            task.progress = 1.0
            task.error_message = None
            db.commit()
            logger.info(
                "agent_task_success workflow_id=%s role=%s task_id=%s",
                workflow_id,
                role,
                task_id,
            )
        else:
            task.status = "error"
            task.progress = 1.0
            task.error_message = result.error_message or "未知错误"
            db.commit()
            logger.warning(
                "agent_task_error workflow_id=%s role=%s task_id=%s error=%s",
                workflow_id,
                role,
                task_id,
                task.error_message,
            )
    except Exception as e:
        db.rollback()
        task = db.query(Task).filter(Task.id == task_id).first()
        if task:
            task.status = "error"
            task.progress = 1.0
            task.error_message = str(e)
            db.commit()
        logger.exception(
            "agent_thread_failed workflow_id=%s role=%s task_id=%s",
            workflow_id,
            role,
            task_id,
        )
    finally:
        db.close()
