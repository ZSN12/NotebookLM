import os
import re

from fastapi import APIRouter, UploadFile, File, HTTPException, Depends
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.auth import get_current_user
from app.models import Note, Session as DBSession, Notebook, User
from app.services.ppt_service import extract_keywords_from_ppt, parse_ppt_to_slides
from app.services.slide_aligner import SlideAligner
from app.services.file_service import save_file
from app.config import SLIDE_DIR

MAX_PPT_FILE_SIZE = 100 * 1024 * 1024  # 100MB

router = APIRouter()


def get_transcript_text(note) -> str:
    """Extract full transcript text from a note.

    Prioritise transcript array (latest ASR data), then fall back to
    stripping "## 语音转文字" sections from note.content.
    """
    # 1) Prefer latest transcript chunks (sorted by chunk_index)
    if note.transcript:
        texts = []
        for seg in sorted(
            note.transcript,
            key=lambda s: s.get("chunk_index", 0) if isinstance(s, dict) else 0,
        ):
            if isinstance(seg, dict):
                text = seg.get("text", "")
            else:
                text = str(seg)
            if text:
                texts.append(text)
        joined = " ".join(texts).strip()
        if joined:
            return joined

    # 2) Fall back to note.content, stripping markdown wrapper
    if note.content and note.content.strip():
        import re
        clean = re.sub(r'^##\s*语音转文字\s*\n*', '', note.content.strip())
        clean = re.sub(r'\n*---\s*$', '', clean)
        return clean.strip()

    return ""


@router.post("/ppt-insert")
def insert_ppt_into_transcript(
    session_id: str = "",
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Match transcript text against PPT slides and insert slide images into the text flow.

    Returns a list of content blocks:
    - {"type": "text", "content": "..."}
    - {"type": "image", "src": "/api/media/slides/{id}/slide_01.png", "page": 1}
    """
    if not session_id:
        raise HTTPException(status_code=400, detail="session_id is required")

    # Verify session ownership
    session = db.query(DBSession).filter(
        DBSession.id == session_id
    ).join(Notebook).filter(
        Notebook.user_id == current_user.id
    ).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    # Get note with transcript and PPT data
    note = db.query(Note).filter(Note.session_id == session_id).first()
    if not note:
        raise HTTPException(status_code=404, detail="Note not found")

    if not note.ppt_images:
        return {"blocks": [{"type": "text", "content": get_transcript_text(note)}]}

    last_ppt = note.ppt_images[-1]
    slides = last_ppt.get("slides", []) if isinstance(last_ppt, dict) else []
    if not slides:
        return {"blocks": [{"type": "text", "content": get_transcript_text(note)}]}

    transcript = get_transcript_text(note)
    if not transcript.strip():
        return {"blocks": [{"type": "text", "content": ""}]}

    # Create a fresh aligner instance for this request (avoid shared state)
    request_aligner = SlideAligner()
    request_aligner.set_slides(slides)

    # Split transcript into sentences for matching
    sentences = re.split(r'(?<=[。！？\n])', transcript)
    sentences = [s.strip() for s in sentences if s.strip()]

    if not sentences:
        return {"blocks": [{"type": "text", "content": transcript.strip()}]}

    # ── Build result blocks with sliding-window PPT matching ──
    # Single-short-sentence matching (e.g. "图书馆中饰 / 设计模式的分析")
    # often lacks enough signal to cross the alignment threshold. Using a
    # 2–4 sentence sliding window gives the aligner richer context.
    WINDOW_MIN = 2   # minimum sentences per match window
    WINDOW_MAX = 4   # maximum sentences per match window

    blocks: list[dict] = []
    matched_pages: set[int] = set()
    seg_idx = 0

    while seg_idx < len(sentences):
        # Expand window until we have WINDOW_MAX sentences or reach end
        window_end = min(seg_idx + WINDOW_MAX, len(sentences))
        window_text = "".join(sentences[seg_idx:window_end])

        # Try matching the full window first
        matched_idx = request_aligner.match(window_text, threshold=0.10)

        if matched_idx is None and window_end - seg_idx >= WINDOW_MIN:
            # Also try a shorter window (min size) — long windows can dilute signal
            short_end = min(seg_idx + WINDOW_MIN, len(sentences))
            short_text = "".join(sentences[seg_idx:short_end])
            matched_idx = request_aligner.match(short_text, threshold=0.12)

        if matched_idx is not None and matched_idx not in matched_pages:
            matched_pages.add(matched_idx)
            slide = slides[matched_idx]
            if slide.get("image_path"):
                blocks.append({
                    "type": "image",
                    "src": f"/api/media/slides/{session_id}/{slide['image_path']}",
                    "page": slide["page"],
                    "title": slide.get("title", ""),
                })

        # Push the matched sentences as text; merge with previous text block
        first_sentence = sentences[seg_idx]
        if first_sentence:
            if blocks and blocks[-1]["type"] == "text":
                blocks[-1]["content"] += " " + first_sentence
            else:
                blocks.append({"type": "text", "content": first_sentence})

        seg_idx += 1

    return {"blocks": blocks}


@router.post("/ppt-upload")
async def upload_ppt(
    file: UploadFile = File(...),
    session_id: str = "",
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Upload PPT/PDF file, parse slides, extract images, and return slide data for frontend display."""
    if not session_id:
        raise HTTPException(status_code=400, detail="session_id is required")

    session = db.query(DBSession).filter(
        DBSession.id == session_id
    ).join(Notebook).filter(
        Notebook.user_id == current_user.id
    ).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    file_ext = os.path.splitext(file.filename or "")[1].lower()
    if file_ext not in ['.ppt', '.pptx', '.pdf']:
        raise HTTPException(status_code=400, detail="Only PPT, PPTX, and PDF files are supported")

    try:
        file_bytes = await file.read()
        file_size = len(file_bytes)
        if file_size > MAX_PPT_FILE_SIZE:
            raise HTTPException(
                status_code=413,
                detail=f"PPT file too large: {file_size} bytes (max {MAX_PPT_FILE_SIZE} bytes)"
            )

        ppt_path = save_file("ppt", session_id, file.filename or f"upload{file_ext}", file_bytes)
        ppt_path_str = str(ppt_path)

        # Render slides to disk files (not base64 in DB)
        slide_dir = SLIDE_DIR / session_id
        slide_dir.mkdir(parents=True, exist_ok=True)

        slides = parse_ppt_to_slides(ppt_path_str, output_dir=str(slide_dir))
        if not slides:
            raise HTTPException(status_code=500, detail="Failed to parse PPT, no slides found")

        try:
            keywords = extract_keywords_from_ppt(ppt_path_str, session.title)
            if keywords:
                session.keywords = keywords
                db.commit()
        except Exception as kw_error:
            print(f"[WARN] Keyword extraction failed: {kw_error}")

        ppt_data = {
            "filename": file.filename,
            "path": ppt_path_str,
            "total_pages": len(slides),
            "slides": slides,  # image_path instead of image_base64
        }

        existing_note = db.query(Note).filter(Note.session_id == session_id).first()
        if not existing_note:
            note = Note(
                session_id=session_id,
                content="",
                transcript=[],
                ppt_images=[ppt_data],
                vocabulary=[],
            )
            db.add(note)
        else:
            note = existing_note
            # Replace instead of append — only keep the latest PPT
            note.ppt_images = [ppt_data]

        db.commit()
        db.refresh(note)

        return {
            "status": "success",
            "filename": file.filename,
            "total_pages": len(slides),
            "slides": slides,
            "note_id": note.id,
        }
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        print(f"[ERROR] PPT upload error: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/ppt-align")
def align_ppt_with_text(
    session_id: str = "",
    text: str = "",
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Match transcript text against PPT slides and return the best-matching slide index.

    If slides haven't been pre-loaded for this session, loads them from the note's ppt_images.
    """
    if not session_id or not text:
        raise HTTPException(status_code=400, detail="session_id and text are required")

    session = db.query(DBSession).filter(
        DBSession.id == session_id
    ).join(Notebook).filter(
        Notebook.user_id == current_user.id
    ).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    # Get note with PPT data
    note = db.query(Note).filter(Note.session_id == session_id).first()
    if not note or not note.ppt_images:
        return {"matched_page": None, "similarity": 0.0}

    last_ppt = note.ppt_images[-1]
    slides = last_ppt.get("slides", []) if isinstance(last_ppt, dict) else []
    if not slides:
        return {"matched_page": None, "similarity": 0.0}

    # Create a fresh aligner instance per request to avoid shared state
    request_aligner = SlideAligner()
    request_aligner.set_slides(slides)

    # Match text to slide
    matched_idx = request_aligner.match(text)

    if matched_idx is not None:
        return {
            "matched_page": matched_idx,
            "similarity": 1.0,
            "slide": slides[matched_idx],
        }

    return {"matched_page": None, "similarity": 0.0}
