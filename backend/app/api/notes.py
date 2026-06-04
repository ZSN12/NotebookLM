from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.core.auth import get_current_user
from app.api.schemas import NoteResponse, NoteUpdate
from app.models import Note, Session as DBSession, Notebook, User

router = APIRouter(prefix="/api/notes", tags=["notes"])


def _get_user_session(session_id: str, user: User, db: Session) -> DBSession:
    """Verify session exists and belongs to user."""
    session = db.query(DBSession).filter(
        DBSession.id == session_id
    ).join(Notebook).filter(Notebook.user_id == user.id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return session


@router.get("/session/{session_id}", response_model=NoteResponse)
def get_note_by_session(
    session_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _get_user_session(session_id, current_user, db)
    note = db.query(Note).filter(Note.session_id == session_id).first()
    if not note:
        raise HTTPException(status_code=404, detail="Note not found")
    return note


@router.put("/session/{session_id}", response_model=NoteResponse)
def update_note(
    session_id: str,
    data: NoteUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _get_user_session(session_id, current_user, db)
    note = db.query(Note).filter(Note.session_id == session_id).first()
    if not note:
        note = Note(session_id=session_id, content=data.content or "")
        db.add(note)
    else:
        note.content = data.content or ""
    if data.layout_blocks is not None:
        note.layout_blocks = data.layout_blocks
    db.commit()
    db.refresh(note)
    return note
