"""Mind map generation service using DeepSeek.

Generates structured knowledge maps from session notes.
Stores results in Note.vocabulary with kind="mind_map".
"""

import json
import logging
import threading
import time
from datetime import datetime, timezone
from typing import Optional

from openai import OpenAI

from app.config import DEEPSEEK_API_KEY, DEEPSEEK_BASE_URL, DEEPSEEK_MODEL
from app.core.database import SessionLocal
from app.models import Note, Session, Notebook, User, Task
from sqlalchemy.orm import Session as DBSessionType
from app.services.prompt_loader import load_prompt
from app.services.vector_service import _compute_session_content_hash


logger = logging.getLogger(__name__)

VALID_TYPES = {"topic", "concept", "key_point", "difficulty", "example", "conclusion"}
VALID_IMPORTANCE = {"high", "medium", "low"}
DEFAULT_TYPE = "concept"
DEFAULT_IMPORTANCE = "medium"
TASK_TYPE = "mind_map_generate"
ACTIVE_TASK_STATUSES = {"pending", "running"}


# ── Mind map vocabulary helpers ──

def _get_mind_map_from_vocabulary(note: Note) -> Optional[dict]:
    """Read mind_map entry from note.vocabulary."""
    if not isinstance(note.vocabulary, list):
        return None
    for item in note.vocabulary:
        if isinstance(item, dict) and item.get("kind") == "mind_map":
            return item
    return None


def _set_mind_map_in_vocabulary(note: Note, data: dict, content_hash: str):
    """Write mind_map entry to note.vocabulary, preserving other kinds."""
    existing = note.vocabulary if isinstance(note.vocabulary, list) else []
    next_items = [
        item for item in existing
        if not (isinstance(item, dict) and item.get("kind") == "mind_map")
    ]
    next_items.append({
        "kind": "mind_map",
        "data": data,
        "content_hash": content_hash,
        "generated_at": datetime.now(timezone.utc).isoformat(),
    })
    note.vocabulary = next_items


def _clear_mind_map_from_vocabulary(note: Note):
    """Remove mind_map entry from note.vocabulary."""
    existing = note.vocabulary if isinstance(note.vocabulary, list) else []
    next_items = [
        item for item in existing
        if not (isinstance(item, dict) and item.get("kind") == "mind_map")
    ]
    note.vocabulary = next_items


# ── Content extraction ──


# ── Normalization / validation ──

def _normalize_sources(sources) -> list[dict]:
    """Ensure sources is a list of dicts with required fields."""
    if not isinstance(sources, list):
        return []
    result = []
    for s in sources:
        if not isinstance(s, dict):
            continue
        source_type = s.get("source_type", "")
        if source_type not in ("transcript", "note", "ppt"):
            source_type = "note"
        snippet = str(s.get("snippet", ""))
        page = s.get("page") if isinstance(s.get("page"), int) else None
        block_id = str(s.get("block_id", "")) if s.get("block_id") else None
        result.append({
            "source_type": source_type,
            "snippet": snippet,
            "page": page,
            "block_id": block_id,
        })
    return result


def _normalize_node(node: dict) -> Optional[dict]:
    """Normalize a single node: fill defaults, discard if missing required fields."""
    if not isinstance(node, dict):
        return None

    node_id = node.get("id")
    title = node.get("title")
    if not node_id or not title:
        return None  # Drop invalid nodes

    node_type = node.get("type", DEFAULT_TYPE)
    if node_type not in VALID_TYPES:
        node_type = DEFAULT_TYPE

    importance = node.get("importance", DEFAULT_IMPORTANCE)
    if importance not in VALID_IMPORTANCE:
        importance = DEFAULT_IMPORTANCE

    return {
        "id": str(node_id),
        "title": str(title),
        "description": str(node.get("description", "")),
        "type": node_type,
        "importance": importance,
        "sources": _normalize_sources(node.get("sources", [])),
        "children": _normalize_nodes(node.get("children", [])),
    }


def _normalize_nodes(nodes) -> list[dict]:
    """Normalize a list of nodes, dropping invalid ones."""
    if not isinstance(nodes, list):
        return []
    result = []
    for n in nodes:
        normalized = _normalize_node(n)
        if normalized:
            result.append(normalized)
    return result


def normalize_mind_map_data(data: dict) -> dict:
    """Normalize and validate the entire mind map data structure.

    - Ensures nodes is a list, discarding invalid nodes.
    - Fills defaults for missing fields.
    - Recursively normalizes children.
    - Raises ValueError if the result is unusable (no valid nodes).
    """
    if not isinstance(data, dict):
        raise ValueError("AI 返回的 JSON 不是对象")

    # Normalize nodes
    raw_nodes = data.get("nodes", [])
    nodes = _normalize_nodes(raw_nodes)
    if not nodes:
        raise ValueError("AI 返回的 JSON 中没有有效的节点")

    return {
        "title": str(data.get("title", "知识导图")),
        "summary": str(data.get("summary", "")),
        "nodes": nodes,
    }


# ── Content extraction ──

def _extract_content_for_prompt(note: Note) -> str:
    """Extract all note content into a single text for the AI prompt."""
    parts = []

    # Layout blocks (structured)
    layout_blocks = note.layout_blocks
    if layout_blocks and isinstance(layout_blocks, list):
        for block in layout_blocks:
            if not isinstance(block, dict):
                continue
            btype = block.get("type", "")
            content = block.get("content", "")
            page = block.get("page")
            title = block.get("title", "")

            if btype == "transcript" and content:
                parts.append(f"[转写] {content.strip()}")
            elif btype == "note" and content:
                parts.append(f"[笔记] {content.strip()}")
            elif btype == "ppt":
                ppt_text = ""
                if title:
                    ppt_text += title + " "
                if content:
                    ppt_text += content + " "
                if ppt_text.strip():
                    parts.append(f"[PPT第{page or '?'}页] {ppt_text.strip()}")

    # Fallback: raw content
    if not parts and note.content:
        parts.append(note.content.strip())

    # Transcript
    if note.transcript and isinstance(note.transcript, list):
        transcript_text = " ".join(
            chunk.get("text", "")
            for chunk in sorted(note.transcript, key=lambda x: x.get("chunk_index", 0))
            if isinstance(chunk, dict)
        ).strip()
        if transcript_text and not any("[转写]" in p for p in parts):
            parts.append(f"[转写] {transcript_text}")

    # PPT images text
    if note.ppt_images and isinstance(note.ppt_images, list):
        for ppt_data in note.ppt_images:
            if not isinstance(ppt_data, dict):
                continue
            for slide in ppt_data.get("slides", []):
                if not isinstance(slide, dict):
                    continue
                slide_text = slide.get("text", "")
                if slide_text:
                    parts.append(f"[PPT第{slide.get('page', '?')}页] {slide_text.strip()}")

    return "\n\n".join(parts)


# ── Generation ──

def _get_session_for_user(session_id: str, user: User, db: DBSessionType) -> Session | None:
    return db.query(Session).filter(
        Session.id == session_id
    ).join(Notebook).filter(Notebook.user_id == user.id).first()


def _get_latest_task(session_id: str, db: DBSessionType) -> Task | None:
    return db.query(Task).filter(
        Task.session_id == session_id,
        Task.task_type == TASK_TYPE,
    ).order_by(Task.created_at.desc()).first()


def _get_active_task(session_id: str, db: DBSessionType) -> Task | None:
    return db.query(Task).filter(
        Task.session_id == session_id,
        Task.task_type == TASK_TYPE,
        Task.status.in_(ACTIVE_TASK_STATUSES),
    ).order_by(Task.created_at.desc()).first()


def _task_payload(task: Task | None) -> dict:
    if not task:
        return {}
    return {
        "task_id": task.id,
        "progress": float(task.progress or 0.0),
        "error": task.error_message,
    }


def generate_mind_map(session_id: str, user: User, db: DBSessionType) -> dict:
    """Generate a mind map for a session. Returns the mind map data or raises."""
    if not DEEPSEEK_API_KEY:
        raise ValueError("未配置 DEEPSEEK_API_KEY，无法生成知识导图")

    # Verify ownership
    session = _get_session_for_user(session_id, user, db)
    if not session:
        raise ValueError("Session not found or access denied")

    note = db.query(Note).filter(Note.session_id == session_id).first()
    if not note:
        raise ValueError("No note content found")

    content_text = _extract_content_for_prompt(note)
    if not content_text.strip():
        raise ValueError("No indexable content in note")

    # Build prompt
    keywords = ", ".join(session.keywords) if session.keywords else "无"
    prompt_template = load_prompt("mindmap")
    prompt = prompt_template.render(
        title=session.title or "未命名课次",
        keywords=keywords,
        content=content_text[:6000],  # Limit to avoid token overflow
    )

    # Call DeepSeek
    started = time.monotonic()
    client = OpenAI(api_key=DEEPSEEK_API_KEY, base_url=DEEPSEEK_BASE_URL)
    try:
        response = client.chat.completions.create(
            model=DEEPSEEK_MODEL,
            messages=[
                {"role": "system", "content": prompt_template.system},
                {"role": "user", "content": prompt},
            ],
            temperature=0.3,
            max_tokens=4000,
        )
    except Exception as e:
        error_msg = str(e)
        if "timeout" in error_msg.lower() or "timed out" in error_msg.lower():
            raise ValueError("知识导图生成失败: DeepSeek 请求超时，请稍后重试")
        raise ValueError(f"知识导图生成失败: {error_msg}")

    raw = response.choices[0].message.content.strip()

    # Strip markdown code fences if present
    if raw.startswith("```"):
        lines = raw.split("\n")
        lines = [l for l in lines if not l.startswith("```")]
        raw = "\n".join(lines)

    # Parse JSON
    try:
        mind_map_data = json.loads(raw)
    except json.JSONDecodeError as e:
        raise ValueError(f"AI 返回的 JSON 格式无效: {e}")

    # Validate and normalize structure
    mind_map_data = normalize_mind_map_data(mind_map_data)

    # Save to vocabulary
    content_hash = _compute_session_content_hash(note)
    _set_mind_map_in_vocabulary(note, mind_map_data, content_hash)
    db.commit()

    logger.info(
        "mind_map_generated session_id=%s user_id=%s elapsed_ms=%s",
        session_id,
        user.id,
        int((time.monotonic() - started) * 1000),
    )
    return mind_map_data


def _run_mind_map_task(task_id: str, session_id: str, user_id: str):
    db = SessionLocal()
    started = time.monotonic()
    try:
        task = db.query(Task).filter(Task.id == task_id).first()
        user = db.query(User).filter(User.id == user_id).first()
        if not task or not user:
            return

        task.status = "running"
        task.progress = 0.1
        task.error_message = None
        db.commit()

        generate_mind_map(session_id, user, db)

        task = db.query(Task).filter(Task.id == task_id).first()
        if task:
            task.status = "success"
            task.progress = 1.0
            task.error_message = None
            db.commit()
        logger.info(
            "mind_map_task_success task_id=%s session_id=%s user_id=%s elapsed_ms=%s",
            task_id,
            session_id,
            user_id,
            int((time.monotonic() - started) * 1000),
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
            "mind_map_task_failed task_id=%s session_id=%s user_id=%s",
            task_id,
            session_id,
            user_id,
        )
    finally:
        db.close()


def start_mind_map_generation(session_id: str, user: User, db: DBSessionType) -> dict:
    """Start or reuse an async mind map generation task."""
    if not DEEPSEEK_API_KEY:
        raise ValueError("未配置 DEEPSEEK_API_KEY，无法生成知识导图")

    session = _get_session_for_user(session_id, user, db)
    if not session:
        raise ValueError("Session not found or access denied")

    note = db.query(Note).filter(Note.session_id == session_id).first()
    if not note:
        raise ValueError("No note content found")
    content_text = _extract_content_for_prompt(note)
    if not content_text.strip():
        raise ValueError("No indexable content in note")

    status = get_mind_map_status(session_id, user, db)
    if status["status"] == "ready":
        return status
    if status["status"] == "generating":
        return status

    task = Task(
        session_id=session_id,
        task_type=TASK_TYPE,
        status="pending",
        progress=0.0,
        error_message=None,
    )
    db.add(task)
    db.commit()
    db.refresh(task)

    thread = threading.Thread(
        target=_run_mind_map_task,
        args=(task.id, session_id, user.id),
        daemon=True,
    )
    thread.start()
    logger.info(
        "mind_map_task_started task_id=%s session_id=%s user_id=%s",
        task.id,
        session_id,
        user.id,
    )

    return {
        "session_id": session_id,
        "status": "generating",
        "mind_map": status.get("mind_map"),
        **_task_payload(task),
    }


# ── Status ──

def get_mind_map_status(session_id: str, user: User, db: DBSessionType) -> dict:
    """Get mind map status for a session."""
    session = _get_session_for_user(session_id, user, db)
    if not session:
        raise ValueError("Session not found or access denied")

    note = db.query(Note).filter(Note.session_id == session_id).first()
    has_content = bool(note and (note.content or note.transcript or note.ppt_images or note.layout_blocks))

    if not has_content:
        return {"session_id": session_id, "status": "empty", "mind_map": None, "error": None}

    mm_entry = _get_mind_map_from_vocabulary(note) if note else None
    active_task = _get_active_task(session_id, db)

    if active_task:
        return {
            "session_id": session_id,
            "status": "generating",
            "mind_map": mm_entry.get("data") if mm_entry else None,
            **_task_payload(active_task),
        }

    if not mm_entry:
        latest_task = _get_latest_task(session_id, db)
        if latest_task and latest_task.status == "error":
            return {
                "session_id": session_id,
                "status": "error",
                "mind_map": None,
                **_task_payload(latest_task),
            }
        return {"session_id": session_id, "status": "not_generated", "mind_map": None, "error": None}

    # Check stale
    current_hash = _compute_session_content_hash(note) if note else ""
    indexed_hash = mm_entry.get("content_hash", "")
    is_stale = indexed_hash != current_hash

    if is_stale:
        latest_task = _get_latest_task(session_id, db)
        if latest_task and latest_task.status == "error":
            return {
                "session_id": session_id,
                "status": "error",
                "mind_map": mm_entry.get("data"),
                **_task_payload(latest_task),
            }
        return {
            "session_id": session_id,
            "status": "stale",
            "mind_map": mm_entry.get("data"),
            "error": None,
        }

    return {
        "session_id": session_id,
        "status": "ready",
        "mind_map": mm_entry.get("data"),
        "generated_at": mm_entry.get("generated_at"),
        "error": None,
    }


# ── Delete ──

def delete_mind_map(session_id: str, user: User, db: DBSessionType) -> dict:
    """Delete mind map for a session."""
    session = _get_session_for_user(session_id, user, db)
    if not session:
        raise ValueError("Session not found or access denied")

    note = db.query(Note).filter(Note.session_id == session_id).first()
    if note:
        _clear_mind_map_from_vocabulary(note)
        db.commit()

    return {"session_id": session_id, "status": "deleted"}
