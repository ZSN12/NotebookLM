import json

from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.auth import get_current_user
from app.models import Note, Session as DBSession, Notebook, User
from app.config import DEEPSEEK_API_KEY, DEEPSEEK_BASE_URL, DEEPSEEK_MODEL
from app.services.prompt_loader import load_prompt

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

    # Generate summary
    summary = generate_summary(transcript_text, course_title)

    if summary:
        session.summary = summary
        db.commit()

    return {"status": "success", "summary": summary}
