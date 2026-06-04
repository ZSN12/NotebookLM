from fastapi import APIRouter, Depends, HTTPException, Request, Query
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from pathlib import Path
from app.core.database import get_db
from app.models import Session as DBSession, Note, Notebook
from app.config import SLIDE_DIR

router = APIRouter(prefix="/api/public", tags=["public"])


def _safe_media_path(base_dir: Path, *parts: str) -> Path:
    base = base_dir.resolve()
    target = (base / Path(*parts)).resolve()
    if not target.is_relative_to(base):
        raise HTTPException(status_code=404, detail="Media not found")
    if not target.is_file():
        raise HTTPException(status_code=404, detail="Media not found")
    return target


@router.get("/share/{session_id}")
def get_shared_session(
    session_id: str,
    token: str = Query(...),
    db: Session = Depends(get_db),
):
    """Get shared session data. Requires valid share token. No auth needed."""
    session = db.query(DBSession).filter(DBSession.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    if not session.share_enabled or not session.share_token:
        raise HTTPException(status_code=403, detail="分享已关闭")

    # Constant-time comparison to prevent timing attacks
    if not _timing_safe_compare(token, session.share_token):
        raise HTTPException(status_code=403, detail="分享链接无效")

    notebook = db.query(Notebook).filter(Notebook.id == session.notebook_id).first()
    note = db.query(Note).filter(Note.session_id == session_id).first()

    return {
        "session": {
            "id": session.id,
            "notebook_id": session.notebook_id,
            "title": session.title,
            "summary": session.summary,
            "keywords": session.keywords or [],
            "duration": session.duration,
            "status": session.status,
        },
        "notebook": {
            "id": notebook.id if notebook else "",
            "title": notebook.title if notebook else "未知",
        },
        "note": {
            "content": note.content if note else None,
            "transcript": note.transcript if note else None,
            "ppt_images": note.ppt_images if note else None,
            "layout_blocks": note.layout_blocks if note else None,
        } if note else None,
    }


@router.get("/media/slides/{session_id}/{slide_path:path}")
def get_share_slide_media(
    session_id: str,
    slide_path: str,
    token: str = Query(...),
    db: Session = Depends(get_db),
):
    """Serve slide images for shared sessions. Validates share token."""
    session = db.query(DBSession).filter(DBSession.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Media not found")

    if not session.share_enabled or not session.share_token:
        raise HTTPException(status_code=403, detail="分享已关闭")

    if not _timing_safe_compare(token, session.share_token):
        raise HTTPException(status_code=403, detail="分享链接无效")

    target = _safe_media_path(SLIDE_DIR, session_id, slide_path)
    return FileResponse(target)


@router.get("/media/slides-pdf/{session_id}")
def get_share_slides_pdf(
    session_id: str,
    token: str = Query(...),
    db: Session = Depends(get_db),
):
    """Serve slides PDF for shared sessions."""
    session = db.query(DBSession).filter(DBSession.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Media not found")

    if not session.share_enabled or not session.share_token:
        raise HTTPException(status_code=403, detail="分享已关闭")

    if not _timing_safe_compare(token, session.share_token):
        raise HTTPException(status_code=403, detail="分享链接无效")

    pdf_path = SLIDE_DIR / session_id / "slides.pdf"
    if not pdf_path.exists():
        raise HTTPException(status_code=404, detail="PDF not found")

    return FileResponse(pdf_path)


def _timing_safe_compare(a: str, b: str) -> bool:
    """Constant-time string comparison to prevent timing attacks."""
    if len(a) != len(b):
        return False
    import hmac
    return hmac.compare_digest(a.encode(), b.encode())