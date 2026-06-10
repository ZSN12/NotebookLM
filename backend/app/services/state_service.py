"""Unified session processing state service.

Provides CRUD for session_processing_states and aggregation for UI recovery.
"""

import logging
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy.orm import Session

from app.models import SessionProcessingState

logger = logging.getLogger(__name__)

VALID_STAGES = {
    "upload_transcribe",
    "recording_finalize",
    "transcript_finalize",
    "vector_index",
    "summary",
    "mindmap",
    "quiz_bank",
}

VALID_STATUSES = {"idle", "running", "ready", "error", "stale", "fallback"}


def _get_or_create_state(
    db: Session, session_id: str, stage: str
) -> SessionProcessingState:
    if stage not in VALID_STAGES:
        raise ValueError(f"Invalid stage: {stage}")
    state = (
        db.query(SessionProcessingState)
        .filter(
            SessionProcessingState.session_id == session_id,
            SessionProcessingState.stage == stage,
        )
        .first()
    )
    if not state:
        state = SessionProcessingState(
            session_id=session_id,
            stage=stage,
            status="idle",
            progress=0.0,
        )
        db.add(state)
        db.flush()
    return state


def set_running(
    db: Session,
    session_id: str,
    stage: str,
    progress: float = 0.0,
    message: Optional[str] = None,
    commit: bool = True,
) -> SessionProcessingState:
    state = _get_or_create_state(db, session_id, stage)
    state.status = "running"
    state.progress = progress
    state.message = message
    state.error_message = None
    state.started_at = datetime.now(timezone.utc)
    state.finished_at = None
    if commit:
        db.commit()
    logger.info("state_running session_id=%s stage=%s progress=%s", session_id, stage, progress)
    return state


def set_ready(
    db: Session,
    session_id: str,
    stage: str,
    content_hash: Optional[str] = None,
    commit: bool = True,
) -> SessionProcessingState:
    state = _get_or_create_state(db, session_id, stage)
    state.status = "ready"
    state.progress = 1.0
    state.message = None
    state.error_message = None
    state.content_hash = content_hash
    state.finished_at = datetime.now(timezone.utc)
    if commit:
        db.commit()
    logger.info("state_ready session_id=%s stage=%s", session_id, stage)
    return state


def set_error(
    db: Session,
    session_id: str,
    stage: str,
    error_message: str,
    commit: bool = True,
) -> SessionProcessingState:
    state = _get_or_create_state(db, session_id, stage)
    state.status = "error"
    state.progress = 1.0
    state.error_message = error_message
    state.finished_at = datetime.now(timezone.utc)
    if commit:
        db.commit()
    logger.info("state_error session_id=%s stage=%s error=%s", session_id, stage, error_message)
    return state


def set_fallback(
    db: Session,
    session_id: str,
    stage: str,
    message: Optional[str] = None,
    error_message: Optional[str] = None,
    commit: bool = True,
) -> SessionProcessingState:
    state = _get_or_create_state(db, session_id, stage)
    state.status = "fallback"
    state.progress = 1.0
    state.message = message
    state.error_message = error_message
    state.finished_at = datetime.now(timezone.utc)
    if commit:
        db.commit()
    logger.info("state_fallback session_id=%s stage=%s", session_id, stage)
    return state


def set_stale(
    db: Session,
    session_id: str,
    stage: str,
    content_hash: Optional[str] = None,
    commit: bool = True,
) -> SessionProcessingState:
    state = _get_or_create_state(db, session_id, stage)
    state.status = "stale"
    state.progress = 0.0
    state.message = None
    state.error_message = None
    state.content_hash = content_hash
    state.finished_at = None
    if commit:
        db.commit()
    logger.info("state_stale session_id=%s stage=%s", session_id, stage)
    return state


def set_idle(
    db: Session,
    session_id: str,
    stage: str,
    commit: bool = True,
) -> SessionProcessingState:
    state = _get_or_create_state(db, session_id, stage)
    state.status = "idle"
    state.progress = 0.0
    state.message = None
    state.error_message = None
    state.finished_at = None
    if commit:
        db.commit()
    return state


def get_state(
    db: Session,
    session_id: str,
    stage: str,
) -> Optional[SessionProcessingState]:
    if stage not in VALID_STAGES:
        return None
    return (
        db.query(SessionProcessingState)
        .filter(
            SessionProcessingState.session_id == session_id,
            SessionProcessingState.stage == stage,
        )
        .first()
    )


def _stage_to_dict(state: Optional[SessionProcessingState]) -> dict:
    if not state:
        return {
            "status": "idle",
            "progress": 0.0,
            "message": None,
            "error_message": None,
            "content_hash": None,
            "started_at": None,
            "finished_at": None,
        }
    return {
        "status": state.status,
        "progress": float(state.progress or 0.0),
        "message": state.message,
        "error_message": state.error_message,
        "content_hash": state.content_hash,
        "started_at": state.started_at.isoformat() if state.started_at else None,
        "finished_at": state.finished_at.isoformat() if state.finished_at else None,
    }


def get_session_processing_status(db: Session, session_id: str) -> dict:
    """Aggregate processing status for a session.

    Returns:
        {
            "session_id": str,
            "overall_status": "idle" | "running" | "ready" | "error" | "fallback" | "stale",
            "stages": {stage: {...}},
            "can_auto_generate": bool,
            "can_ask_rag": bool,
            "needs_user_action": bool,
        }
    """
    states = (
        db.query(SessionProcessingState)
        .filter(SessionProcessingState.session_id == session_id)
        .all()
    )

    stage_map = {s.stage: s for s in states}

    stages = {}
    for stage in VALID_STAGES:
        stages[stage] = _stage_to_dict(stage_map.get(stage))

    # overall_status logic
    statuses = [s.status for s in stage_map.values()]
    if "running" in statuses:
        overall_status = "running"
    elif "error" in statuses:
        overall_status = "error"
    elif "fallback" in statuses:
        overall_status = "fallback"
    elif all(s in ("ready", "idle") for s in statuses):
        overall_status = "ready"
    else:
        overall_status = "idle"

    vector_stage = stages.get("vector_index", {})
    transcript_stage = stages.get("transcript_finalize", {})

    can_ask_rag = vector_stage.get("status") == "ready"
    can_auto_generate = (
        vector_stage.get("status") == "ready"
        and transcript_stage.get("status") == "ready"
    )
    needs_user_action = any(
        stages[s].get("status") in ("error", "fallback") for s in VALID_STAGES
    )

    return {
        "session_id": session_id,
        "overall_status": overall_status,
        "stages": stages,
        "can_auto_generate": can_auto_generate,
        "can_ask_rag": can_ask_rag,
        "needs_user_action": needs_user_action,
    }
