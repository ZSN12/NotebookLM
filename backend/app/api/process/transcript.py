import json

from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.auth import get_current_user
from app.models import Note, Session as DBSession, Notebook, User
from app.config import DEEPSEEK_API_KEY, DEEPSEEK_BASE_URL, DEEPSEEK_MODEL
from app.services.prompt_loader import load_prompt
from app.services.term_corrector import corrector
from app.services.state_service import set_running, set_ready, set_error, set_fallback
from app.services.vector_service import build_session_index, _compute_session_content_hash

# Agent integration
from app.agents import AgentContext, get_agent

router = APIRouter()


def generate_summary(transcript_text: str, course_title: str):
    """Generate a summary for the session using DeepSeek AI."""
    if not DEEPSEEK_API_KEY:
        return ""

    from openai import OpenAI

    client = OpenAI(api_key=DEEPSEEK_API_KEY, base_url=DEEPSEEK_BASE_URL)
    prompt_template = load_prompt("summary")
    prompt = prompt_template.render(
        course_title=course_title,
        text=transcript_text,
    )

    try:
        response = client.chat.completions.create(
            model=DEEPSEEK_MODEL,
            messages=[
                {"role": "system", "content": prompt_template.system},
                {"role": "user", "content": prompt},
            ],
            temperature=0.3,
            max_tokens=300,
        )
        return response.choices[0].message.content.strip()
    except Exception as e:
        print(f"[ERROR] Summary generation failed: {e}")
        return ""


def get_transcript_text(note) -> str:
    """Extract full transcript text from a note.

    Tries note.content first (manual notes), falls back to transcript array (streaming ASR).
    """
    if note.content and note.content.strip():
        return note.content
    if note.transcript:
        texts = []
        for seg in note.transcript:
            if isinstance(seg, dict):
                # Use corrected text if available, otherwise use original
                text = seg.get("text", "")
            else:
                text = str(seg)
            if text:
                texts.append(text)
        return " ".join(texts)
    return ""


@router.put("/transcript")
def update_transcript(
    session_id: str = "",
    content: str = "",
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Update the transcript text of a session."""
    if not session_id:
        raise HTTPException(status_code=400, detail="session_id is required")

    session = db.query(DBSession).filter(
        DBSession.id == session_id
    ).join(Notebook).filter(
        Notebook.user_id == current_user.id
    ).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    note = db.query(Note).filter(Note.session_id == session_id).first()
    if not note:
        raise HTTPException(status_code=404, detail="Note not found")

    # Parse the content as JSON array of transcript entries
    try:
        transcript_data = json.loads(content) if content else note.transcript
    except (json.JSONDecodeError, TypeError):
        transcript_data = note.transcript

    note.transcript = transcript_data
    db.commit()

    return {"status": "success"}


@router.post("/generate-summary")
def generate_summary_endpoint(
    session_id: str = "",
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Generate a summary for the session using DeepSeek AI and save it to the session."""
    if not session_id:
        raise HTTPException(status_code=400, detail="session_id is required")

    # Verify session exists
    session = db.query(DBSession).filter(
        DBSession.id == session_id
    ).join(Notebook).filter(
        Notebook.user_id == current_user.id
    ).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    # Get transcript text from note
    note = db.query(Note).filter(Note.session_id == session_id).first()
    if not note:
        raise HTTPException(status_code=400, detail="No transcript available")
    transcript_text = get_transcript_text(note)
    if not transcript_text:
        raise HTTPException(status_code=400, detail="No transcript available")

    # Get course title
    notebook = db.query(Notebook).filter(Notebook.id == session.notebook_id).first()
    course_title = notebook.title if notebook else ""

    # Try agent-based summary first; fall back to legacy function on failure.
    summary = ""
    try:
        agent = get_agent("summary")
        ctx = AgentContext(
            session_id=session_id,
            user=current_user,
            db=db,
            note=note,
            session=session,
            notebook=notebook,
        )
        result = agent.run(ctx)
        if result.success and result.data:
            summary = result.data.get("summary", "")
        elif result.error_message:
            print(f"[WARN] SummaryAgent failed: {result.error_message}")
    except Exception as e:
        print(f"[WARN] SummaryAgent error: {e}")

    if not summary:
        summary = generate_summary(transcript_text, course_title)

    if summary:
        session.summary = summary
        db.commit()

    return {"status": "success", "summary": summary}


def _auto_build_vector_index_sync(session_id: str, user: User, db: Session) -> None:
    """Auto-trigger vector index build after transcript finalization."""
    try:
        set_running(db, session_id, "vector_index", commit=False)
        db.commit()
        chunk_count = build_session_index(session_id, user, db)
        note = db.query(Note).filter(Note.session_id == session_id).first()
        current_hash = _compute_session_content_hash(note) if note else ""
        set_ready(db, session_id, "vector_index", content_hash=current_hash, commit=False)
        db.commit()
    except Exception as e:
        set_error(db, session_id, "vector_index", error_message=str(e), commit=False)
        db.commit()


def finalize_session_transcript(
    session_id: str,
    db: Session,
    current_user: User,
) -> dict:
    """Run DeepSeek finalization on a session's transcript and return note payload.

    This is the shared finalization logic used by:
      - the manual "restructure" endpoint
      - the audio-finish endpoint after real-time recording stops
    """
    set_running(db, session_id, "transcript_finalize", commit=False)
    try:
        session = db.query(DBSession).filter(
            DBSession.id == session_id
        ).join(Notebook).filter(
            Notebook.user_id == current_user.id
        ).first()
        if not session:
            set_error(db, session_id, "transcript_finalize", error_message="Session not found")
            raise HTTPException(status_code=404, detail="Session not found")

        note = db.query(Note).filter(Note.session_id == session_id).first()
        if not note or not note.transcript:
            set_error(db, session_id, "transcript_finalize", error_message="No transcript available")
            raise HTTPException(status_code=400, detail="No transcript available")

        notebook = db.query(Notebook).filter(Notebook.id == session.notebook_id).first()
        course_title = notebook.title if notebook else ""
        keywords = session.keywords or []

        # Build full text from ALL entries (sorted by chunk_index)
        sorted_entries = sorted(
            note.transcript,
            key=lambda e: e.get("chunk_index", 0) if isinstance(e, dict) else 0,
        )
        local_texts = [
            (e.get("display_text") or e.get("text") or e.get("raw_text") or "").strip()
            for e in sorted_entries
            if isinstance(e, dict)
        ]
        full_local_text = "\n\n".join(t for t in local_texts if t)

        # Preserve original raw_text for audit
        raw_texts = [
            (e.get("raw_text") or e.get("text") or "").strip()
            for e in sorted_entries
            if isinstance(e, dict)
        ]
        full_raw_text = "\n\n".join(t for t in raw_texts if t)
        if not full_local_text:
            set_error(db, session_id, "transcript_finalize", error_message="Transcript text is empty")
            raise HTTPException(status_code=400, detail="Transcript text is empty")

        # Tier 2 — local deterministic cleanup
        try:
            local_display = corrector.clean_transcript_for_display(full_local_text).strip() or full_local_text
        except Exception:
            local_display = full_local_text

        display_text = local_display
        corrected_text = None
        is_ai_corrected = False
        correction_error = None

        # Tier 3 — DeepSeek enhancement (best-effort)
        if not getattr(corrector, "has_llm", False):
            correction_error = "AI 整理失败，已使用本地整理稿"
        else:
            try:
                ai_text = corrector.restructure_transcript(
                    local_display,
                    course_title,
                    keywords,
                )
                ai_text = (ai_text or "").strip()
                if not ai_text:
                    raise ValueError("DeepSeek returned empty text")

                ai_display = corrector.clean_transcript_for_display(ai_text).strip() or ai_text
                display_text = ai_display
                corrected_text = ai_display
                is_ai_corrected = True
            except Exception:
                correction_error = "AI 整理失败，已使用本地整理稿"

        # Build unified transcript entry
        all_timestamps = []
        for e in sorted_entries:
            if isinstance(e, dict):
                ts = e.get("timestamps", [])
                if ts:
                    all_timestamps.extend(ts)

        updated_entry = {
            "chunk_index": 0,
            "text": display_text,
            "raw_text": full_raw_text,
            "display_text": display_text,
            "corrected_text": corrected_text,
            "timestamps": all_timestamps,
            "is_corrected": display_text != full_local_text,
            "is_ai_corrected": is_ai_corrected,
            "correction_error": correction_error,
            "is_restructured": False,
            "correction_stage": "final",
        }

        note.transcript = [updated_entry]

        # Update content and layout_blocks
        existing_content = (note.content or "").strip()
        notes_content = ""
        if existing_content.startswith("## 语音转文字"):
            marker = "\n\n---\n\n"
            if marker in existing_content:
                notes_content = existing_content.split(marker, 1)[1].strip()

        if notes_content:
            note.content = f"## 语音转文字\n\n{display_text}\n\n---\n\n{notes_content}".strip()
        else:
            note.content = f"## 语音转文字\n\n{display_text}".strip()

        note_blocks = [
            block for block in (note.layout_blocks or [])
            if isinstance(block, dict) and block.get("type") == "note"
        ]
        transcript_blocks = [
            {
                "id": f"transcript-{i + 1}",
                "type": "transcript",
                "content": part.strip(),
            }
            for i, part in enumerate(display_text.split("\n\n"))
            if part.strip()
        ]
        note.layout_blocks = transcript_blocks + note_blocks

        db.commit()
        db.refresh(note)

        # Set state based on outcome
        if is_ai_corrected:
            set_ready(db, session_id, "transcript_finalize", commit=False)
        else:
            set_fallback(db, session_id, "transcript_finalize", message="已使用本地整理稿", error_message=correction_error, commit=False)

        # Auto-trigger vector index
        _auto_build_vector_index_sync(session_id, current_user, db)

        return {
            "note": {
                "id": note.id,
                "session_id": note.session_id,
                "content": note.content or "",
                "transcript": note.transcript,
                "ppt_images": note.ppt_images or [],
                "vocabulary": note.vocabulary or [],
                "layout_blocks": note.layout_blocks or [],
                "created_at": note.created_at.isoformat() if note.created_at else None,
            }
        }
    except HTTPException:
        raise
    except Exception as e:
        set_error(db, session_id, "transcript_finalize", error_message=str(e))
        raise


@router.post("/session/{session_id}/restructure")
def restructure_transcript_endpoint(
    session_id: str,
    body: dict | None = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Re-run DeepSeek restructure on a session's transcript.

    Returns the updated note with corrected_text / is_ai_corrected / correction_error.
    On failure, falls back to local clean text and records the error.
    """
    if not session_id:
        raise HTTPException(status_code=400, detail="session_id is required")

    return finalize_session_transcript(session_id, db, current_user)
