import json

from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.auth import get_current_user
from app.models import Note, Session as DBSession, Notebook, User
from app.config import DEEPSEEK_API_KEY, DEEPSEEK_BASE_URL, DEEPSEEK_MODEL
from app.services.prompt_loader import load_prompt
from app.services.term_corrector import corrector

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


@router.post("/session/{session_id}/restructure")
def restructure_transcript(
    session_id: str,
    force: bool = False,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Re-run DeepSeek restructure on the existing transcript.

    Three-tier fallback:
      1. raw_text       — merged from all transcript entries
      2. display_text   — deterministic local cleanup (always runs)
      3. corrected_text — DeepSeek enhancement (best-effort, never blocks)

    On any DeepSeek failure the endpoint still succeeds and returns the note
    with display_text = local_clean, corrected_text = None.
    """
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
    if not note or not note.transcript:
        raise HTTPException(status_code=400, detail="No transcript available")

    # Collect raw_text from all entries
    raw_parts = []
    all_timestamps = []
    for entry in note.transcript:
        if not isinstance(entry, dict):
            continue
        raw = (
            entry.get("raw_text")
            or entry.get("display_text")
            or entry.get("text")
            or ""
        ).strip()
        if raw:
            raw_parts.append(raw)
        ts = entry.get("timestamps", [])
        if ts:
            all_timestamps.extend(ts)

    if not raw_parts:
        raise HTTPException(status_code=400, detail="No transcript text available")

    full_raw = "\n\n".join(raw_parts)

    # Tier 2 — local deterministic cleanup (always runs)
    local_display = corrector.clean_transcript_for_display(full_raw).strip() or full_raw

    # Tier 3 — DeepSeek enhancement (best-effort)
    display_text = local_display
    corrected_text = None
    is_ai_corrected = False
    correction_error = None

    notebook = db.query(Notebook).filter(Notebook.id == session.notebook_id).first()
    course_title = notebook.title if notebook else ""
    keywords = session.keywords or []

    if getattr(corrector, "has_llm", False) and local_display:
        try:
            ai_text = corrector.restructure_transcript(
                text=local_display,
                course_title=course_title,
                keywords=keywords,
            )
            ai_text = (ai_text or "").strip()
            if ai_text:
                ai_display = corrector.clean_transcript_for_display(ai_text).strip() or ai_text
                if corrector.preserves_source_content(local_display, ai_display, min_ratio=0.65):
                    display_text = ai_display
                    corrected_text = ai_display
                    is_ai_corrected = True
                else:
                    correction_error = "AI 整理失败"
            else:
                correction_error = "AI 整理失败"
        except Exception as exc:
            correction_error = "AI 整理失败"
    else:
        correction_error = "AI 整理失败，已使用本地整理稿"

    # Replace existing transcript with a single restructured entry
    note.transcript = [{
        "chunk_index": 0,
        "text": display_text,
        "raw_text": full_raw,
        "display_text": display_text,
        "corrected_text": corrected_text,
        "timestamps": all_timestamps,
        "is_corrected": display_text != full_raw,
        "is_ai_corrected": is_ai_corrected,
        "correction_error": correction_error,
        "is_restructured": False,
        "correction_stage": "final",
    }]

    # Also update note.content so the frontend sees the new text immediately
    if note.content and "## 语音转文字" in note.content:
        parts = note.content.split("\n\n---\n\n", 1)
        notes_part = parts[1] if len(parts) > 1 else ""
        note.content = f"## 语音转文字\n\n{display_text}" + (f"\n\n---\n\n{notes_part}" if notes_part else "")
    db.commit()
    db.refresh(note)

    return {
        "status": "success",
        "session_id": session_id,
        "note": {
            "id": note.id,
            "session_id": note.session_id,
            "content": note.content or "",
            "transcript": note.transcript,
            "ppt_images": note.ppt_images or [],
            "vocabulary": note.vocabulary or [],
            "layout_blocks": note.layout_blocks or [],
            "created_at": note.created_at.isoformat() if note.created_at else None,
        },
    }
