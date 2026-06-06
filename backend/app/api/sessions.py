from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.core.auth import get_current_user
from app.api.schemas import SessionCreate, SessionUpdate, SessionResponse
from app.models import Session as DBSession, Notebook, User
from app.services.file_service import delete_session_files
import secrets

router = APIRouter(prefix="/api/sessions", tags=["sessions"])


@router.get("/", response_model=list[SessionResponse])
def list_sessions(
    notebook_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    notebook = db.query(Notebook).filter(
        Notebook.id == notebook_id,
        Notebook.user_id == current_user.id,
    ).first()
    if not notebook:
        raise HTTPException(status_code=404, detail="Notebook not found")

    return db.query(DBSession).filter(
        DBSession.notebook_id == notebook_id
    ).order_by(DBSession.created_at.desc()).all()


@router.post("/", response_model=SessionResponse, status_code=status.HTTP_201_CREATED)
def create_session(
    data: SessionCreate,
    notebook_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    notebook = db.query(Notebook).filter(
        Notebook.id == notebook_id,
        Notebook.user_id == current_user.id,
    ).first()
    if not notebook:
        raise HTTPException(status_code=404, detail="Notebook not found")
    session = DBSession(notebook_id=notebook_id, **data.model_dump())
    db.add(session)
    notebook.session_count += 1
    db.commit()
    db.refresh(session)
    return session


@router.get("/{session_id}", response_model=SessionResponse)
def get_session(
    session_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    session = db.query(DBSession).filter(
        DBSession.id == session_id
    ).join(Notebook).filter(Notebook.user_id == current_user.id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return session


@router.put("/{session_id}", response_model=SessionResponse)
def update_session(
    session_id: str,
    data: SessionUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    session = db.query(DBSession).filter(
        DBSession.id == session_id
    ).join(Notebook).filter(Notebook.user_id == current_user.id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    for key, value in data.model_dump(exclude_unset=True).items():
        setattr(session, key, value)
    db.commit()
    db.refresh(session)
    return session


@router.delete("/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_session(
    session_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    session = db.query(DBSession).filter(
        DBSession.id == session_id
    ).join(Notebook).filter(Notebook.user_id == current_user.id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    delete_session_files(session_id, delete_audio=False)
    notebook = db.query(Notebook).filter(Notebook.id == session.notebook_id).first()
    if notebook:
        notebook.session_count = max(0, notebook.session_count - 1)
    db.delete(session)
    db.commit()
    return None


# ── Share endpoints ──

@router.post("/{session_id}/share/enable")
def enable_share(
    session_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Enable sharing for a session, generating a share token."""
    session = db.query(DBSession).filter(
        DBSession.id == session_id
    ).join(Notebook).filter(Notebook.user_id == current_user.id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    token = secrets.token_urlsafe(24)
    session.share_enabled = True
    session.share_token = token
    db.commit()

    return {"share_enabled": True, "share_token": token,
            "share_url": f"/share/{session_id}?token={token}"}


@router.post("/{session_id}/share/disable")
def disable_share(
    session_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Disable sharing for a session."""
    session = db.query(DBSession).filter(
        DBSession.id == session_id
    ).join(Notebook).filter(Notebook.user_id == current_user.id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    session.share_enabled = False
    session.share_token = None
    db.commit()

    return {"share_enabled": False}


@router.get("/{session_id}/share/status")
def get_share_status(
    session_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get the current share status for a session."""
    session = db.query(DBSession).filter(
        DBSession.id == session_id
    ).join(Notebook).filter(Notebook.user_id == current_user.id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    return {
        "share_enabled": bool(session.share_enabled),
        "share_token": session.share_token if session.share_enabled else None,
        "share_url": f"/share/{session_id}?token={session.share_token}" if session.share_enabled and session.share_token else None,
    }
