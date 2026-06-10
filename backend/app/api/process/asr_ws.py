"""WebSocket endpoint for real-time streaming ASR.

Frontend sends:
  - binary: PCM int16 frames @ 16kHz mono
  - JSON control: { "type": "start" | "pause" | "resume" | "end" }

Backend sends:
  - { "type": "partial", "text": "...", "start_ms": 0, "end_ms": 3000 }
  - { "type": "final",   "text": "...", "start_ms": 0, "end_ms": 5000 }
  - { "type": "status",  "message": "..." }
  - { "type": "error",   "detail": "..." }
  - { "type": "done",    "note": {...} }
"""

import asyncio
import json
import logging

import jwt
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query, status
from sqlalchemy.orm import Session

from app.config import SECRET_KEY, ALGORITHM
from app.core.database import SessionLocal
from app.models import User, Session as DBSession, Notebook, Note
from app.services.streaming_asr import StreamingASRManager

logger = logging.getLogger(__name__)
router = APIRouter()


def _decode_ws_token(token: str) -> User | None:
    """Decode JWT and return user instance (or None)."""
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        if payload.get("type") != "access":
            return None
        user_id = payload.get("sub")
        if not user_id:
            return None
    except jwt.ExpiredSignatureError:
        return None
    except jwt.PyJWTError:
        return None

    db = SessionLocal()
    try:
        user = db.query(User).filter(User.id == user_id).first()
        return user
    finally:
        db.close()


def _get_user_session(session_id: str, user: User) -> DBSession | None:
    """Verify session exists and belongs to user.  Returns session or None."""
    db = SessionLocal()
    try:
        session = (
            db.query(DBSession)
            .filter(DBSession.id == session_id)
            .join(Notebook)
            .filter(Notebook.user_id == user.id)
            .first()
        )
        return session
    finally:
        db.close()


async def _send_note_payload(websocket: WebSocket, payload: dict) -> None:
    """Serialize a StreamingRecognizer finalize payload into a note-like
dict compatible with the frontend BackendNote type."""
    note_data = payload.get("transcript", [])
    await websocket.send_json({
        "type": "done",
        "note": {
            "id": "",
            "session_id": payload.get("session_id", ""),
            "content": "",
            "transcript": note_data,
            "ppt_images": [],
            "vocabulary": [],
            "layout_blocks": [],
            "created_at": None,
        },
    })


@router.websocket("/ws/asr/{session_id}")
async def asr_websocket(
    websocket: WebSocket,
    session_id: str,
    token: str = Query(...),
):
    # --- Auth ---
    user = _decode_ws_token(token)
    if user is None:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    db_session = _get_user_session(session_id, user)
    if db_session is None:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    await websocket.accept()
    logger.info("asr_ws_accepted session_id=%s user_id=%s", session_id, user.id)

    # --- Init recognizer ---
    notebook = None
    db = SessionLocal()
    try:
        notebook = db.query(Notebook).filter(Notebook.id == db_session.notebook_id).first()
    finally:
        db.close()

    manager = StreamingASRManager()
    recognizer = manager.create_recognizer(
        session_id=session_id,
        course_title=notebook.title if notebook else "",
        keywords=db_session.keywords or [],
    )

    try:
        while True:
            message = await websocket.receive()

            if "bytes" in message:
                pcm = message["bytes"]
                events = recognizer.feed_pcm(pcm)
                for ev in events:
                    await websocket.send_json(ev)

            elif "text" in message:
                data = json.loads(message["text"])
                msg_type = data.get("type")

                if msg_type == "start":
                    await websocket.send_json({
                        "type": "status",
                        "message": "识别已开始",
                    })

                elif msg_type == "pause":
                    recognizer.pause()
                    await websocket.send_json({
                        "type": "status",
                        "message": "已暂停",
                    })

                elif msg_type == "resume":
                    recognizer.resume()
                    await websocket.send_json({
                        "type": "status",
                        "message": "已恢复",
                    })

                elif msg_type == "end":
                    payload = recognizer.finalize()
                    # Also save note to DB (append mode)
                    db = SessionLocal()
                    try:
                        note = db.query(Note).filter(Note.session_id == session_id).first()
                        transcript_data = payload.get("transcript", [])

                        # Helper: extract notes content from existing note.content
                        def _extract_notes_content(content: str | None) -> str:
                            existing = (content or "").strip()
                            if not existing:
                                return ""
                            marker = "\n\n---\n\n"
                            if existing.startswith("## 语音转文字"):
                                return existing.split(marker, 1)[1].strip() if marker in existing else ""
                            return existing

                        # Helper: extract transcript text from existing note.content
                        def _extract_transcript_text(content: str | None) -> str:
                            existing = (content or "").strip()
                            if not existing:
                                return ""
                            if existing.startswith("## 语音转文字"):
                                marker = "\n\n---\n\n"
                                if marker in existing:
                                    transcript_part = existing.split(marker, 1)[0].strip()
                                else:
                                    transcript_part = existing.strip()
                                if transcript_part.startswith("## 语音转文字"):
                                    transcript_part = transcript_part[len("## 语音转文字"):].strip()
                                return transcript_part
                            return ""

                        if note:
                            notes_content = _extract_notes_content(note.content)
                            existing_transcript_text = _extract_transcript_text(note.content)

                            # Get new display text from payload
                            new_display_text = ""
                            if transcript_data:
                                new_display_text = (
                                    transcript_data[0].get("display_text")
                                    or transcript_data[0].get("text")
                                    or ""
                                ).strip()

                            # Combine transcript text
                            if existing_transcript_text and new_display_text:
                                combined_transcript_text = f"{existing_transcript_text}\n\n{new_display_text}".strip()
                            elif new_display_text:
                                combined_transcript_text = new_display_text
                            else:
                                combined_transcript_text = existing_transcript_text

                            # Update content
                            if notes_content and combined_transcript_text:
                                note.content = f"## 语音转文字\n\n{combined_transcript_text}\n\n---\n\n{notes_content}".strip()
                            elif combined_transcript_text:
                                note.content = f"## 语音转文字\n\n{combined_transcript_text}".strip()
                            else:
                                note.content = notes_content

                            # Append transcript entries
                            # Use list() copy so SQLAlchemy detects the mutation
                            existing_transcript = list(note.transcript or [])
                            base_index = len(existing_transcript)
                            for i, entry in enumerate(transcript_data):
                                entry["chunk_index"] = base_index + i
                            existing_transcript.extend(transcript_data)
                            note.transcript = existing_transcript

                            # Rebuild layout blocks
                            existing_layout = list(note.layout_blocks or [])
                            note_blocks = [
                                block for block in existing_layout
                                if isinstance(block, dict) and block.get("type") == "note"
                            ]
                            all_transcript_blocks = [
                                {
                                    "id": f"transcript-{i + 1}",
                                    "type": "transcript",
                                    "content": part.strip(),
                                }
                                for i, part in enumerate(combined_transcript_text.split("\n\n"))
                                if part.strip()
                            ]
                            note.layout_blocks = all_transcript_blocks + note_blocks

                            db.commit()
                            db.refresh(note)
                        else:
                            display_text = ""
                            if transcript_data:
                                display_text = (
                                    transcript_data[0].get("display_text")
                                    or transcript_data[0].get("text")
                                    or ""
                                ).strip()
                            note = Note(
                                session_id=session_id,
                                transcript=transcript_data,
                                content=f"## 语音转文字\n\n{display_text}".strip() if display_text else "",
                                ppt_images=[],
                                vocabulary=[],
                            )
                            if display_text:
                                note.layout_blocks = [
                                    {
                                        "id": f"transcript-{i + 1}",
                                        "type": "transcript",
                                        "content": part.strip(),
                                    }
                                    for i, part in enumerate(display_text.split("\n\n"))
                                    if part.strip()
                                ]
                            db.add(note)
                            db.commit()
                            db.refresh(note)
                        # Inject note id into payload for done response
                        payload["note_id"] = note.id
                    except Exception as exc:
                        logger.exception("asr_ws_save_note_failed session_id=%s", session_id)
                        await websocket.send_json({
                            "type": "error",
                            "detail": f"保存笔记失败: {exc}",
                        })
                    finally:
                        db.close()

                    await _send_note_payload(websocket, payload)
                    break

            else:
                # Unknown message type
                pass

    except WebSocketDisconnect:
        logger.info("asr_ws_disconnect session_id=%s", session_id)
    except Exception as exc:
        logger.exception("asr_ws_error session_id=%s", session_id)
        try:
            await websocket.send_json({
                "type": "error",
                "detail": str(exc) or "内部错误",
            })
        except Exception:
            pass
    finally:
        recognizer.cleanup()
        manager.remove_recognizer(session_id)
        try:
            await websocket.close()
        except Exception:
            pass
