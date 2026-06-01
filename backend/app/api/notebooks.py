from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.core.auth import get_current_user
from app.api.schemas import NotebookCreate, NotebookUpdate, NotebookResponse, NotebookPackage, NoteCreate
from app.models import Notebook, User, Session, Note
from app.services.file_service import delete_notebook_files

router = APIRouter(prefix="/api/notebooks", tags=["notebooks"])


@router.get("/", response_model=list[NotebookResponse])
def list_notebooks(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return db.query(Notebook).filter(
        Notebook.user_id == current_user.id
    ).order_by(Notebook.created_at.desc()).all()


@router.post("/", response_model=NotebookResponse, status_code=status.HTTP_201_CREATED)
def create_notebook(
    data: NotebookCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    notebook = Notebook(user_id=current_user.id, **data.model_dump())
    db.add(notebook)
    db.commit()
    db.refresh(notebook)
    return notebook


@router.get("/{notebook_id}", response_model=NotebookResponse)
def get_notebook(
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
    return notebook


@router.put("/{notebook_id}", response_model=NotebookResponse)
def update_notebook(
    notebook_id: str,
    data: NotebookUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    notebook = db.query(Notebook).filter(
        Notebook.id == notebook_id,
        Notebook.user_id == current_user.id,
    ).first()
    if not notebook:
        raise HTTPException(status_code=404, detail="Notebook not found")
    for key, value in data.model_dump(exclude_unset=True).items():
        setattr(notebook, key, value)
    db.commit()
    db.refresh(notebook)
    return notebook


@router.delete("/{notebook_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_notebook(
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
    delete_notebook_files(notebook_id, db)
    db.delete(notebook)
    db.commit()
    return None


@router.get("/{notebook_id}/export", response_model=NotebookPackage)
def export_notebook(
    notebook_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Export a complete notebook package including all sessions and notes."""
    notebook = db.query(Notebook).filter(
        Notebook.id == notebook_id,
        Notebook.user_id == current_user.id,
    ).first()
    if not notebook:
        raise HTTPException(status_code=404, detail="Notebook not found")

    sessions_data = []
    sessions = db.query(Session).filter(
        Session.notebook_id == notebook_id
    ).order_by(Session.created_at.asc()).all()

    for sess in sessions:
        note = db.query(Note).filter(Note.session_id == sess.id).first()

        bundle = {
            "title": sess.title,
            "summary": sess.summary,
            "keywords": sess.keywords or [],
        }

        if note:
            bundle["content"] = note.content
            bundle["transcript"] = note.transcript
            bundle["ppt_images"] = note.ppt_images
        else:
            bundle["content"] = None
            bundle["transcript"] = None
            bundle["ppt_images"] = None

        sessions_data.append(bundle)

    notebook_create = {
        "title": notebook.title,
        "description": notebook.description,
        "icon": notebook.icon,
        "color": notebook.color,
    }

    return {
        "format_version": 1,
        "notebook": notebook_create,
        "sessions": sessions_data,
    }


@router.post("/import", response_model=NotebookResponse, status_code=status.HTTP_201_CREATED)
def import_notebook(
    data: NotebookPackage,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if data.format_version != 1:
        raise HTTPException(status_code=400, detail="Unsupported notebook package version")

    notebook = Notebook(user_id=current_user.id, **data.notebook.model_dump())
    db.add(notebook)
    db.flush()

    for sess_data in data.sessions:
        session = Session(notebook_id=notebook.id, title=sess_data.title, summary=sess_data.summary, keywords=sess_data.keywords or [])
        db.add(session)
        db.flush()
        notebook.session_count += 1

        if sess_data.content or sess_data.transcript or sess_data.ppt_images:
            note = Note(session_id=session.id, content=sess_data.content or "", transcript=sess_data.transcript, ppt_images=sess_data.ppt_images)
            db.add(note)

    db.commit()
    db.refresh(notebook)
    return notebook
