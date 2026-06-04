import shutil
import uuid
import os
from pathlib import Path
from app.config import AUDIO_DIR, PPT_DIR, IMAGE_DIR, MAX_AUDIO_SIZE, MAX_PPT_SIZE

def _safe_upload_name(file_name: str) -> str:
    """Return a filesystem-safe basename for an uploaded file."""
    original = Path(file_name or "upload").name
    safe_name = "".join(ch if ch.isalnum() or ch in "._- " else "_" for ch in original).strip()
    return safe_name or "upload"

def get_upload_path(file_type: str, session_id: str, file_name: str) -> Path:
    """Get the absolute upload path for a file."""
    safe_name = _safe_upload_name(file_name)
    directory = AUDIO_DIR if file_type == "audio" else PPT_DIR if file_type == "ppt" else None
    if directory is None:
        raise ValueError(f"Invalid file type: {file_type}")

    target = (directory / f"{session_id}_{uuid.uuid4().hex}_{safe_name}").resolve()
    base = directory.resolve()
    if not target.is_relative_to(base):
        raise ValueError("Invalid upload path")
    return target

def get_image_dir(session_id: str) -> Path:
    """Get the image output directory for a session."""
    dir_path = IMAGE_DIR / str(session_id)
    dir_path.mkdir(parents=True, exist_ok=True)
    return dir_path

def save_file(file_type: str, session_id: str, file_name: str, file_content: bytes) -> Path:
    """Save uploaded file and return its path."""
    if file_type == "audio":
        if len(file_content) > MAX_AUDIO_SIZE:
            raise ValueError(f"Audio file exceeds {MAX_AUDIO_SIZE / 1024 / 1024}MB limit")
    elif file_type == "ppt":
        if len(file_content) > MAX_PPT_SIZE:
            raise ValueError(f"PPT file exceeds {MAX_PPT_SIZE / 1024 / 1024}MB limit")

    file_path = get_upload_path(file_type, session_id, file_name)
    with open(file_path, "wb") as f:
        f.write(file_content)
    return file_path

def delete_file(file_path: Path) -> None:
    """Delete a file if it exists."""
    if file_path and file_path.exists():
        file_path.unlink()

def delete_session_files(session_id: str, delete_audio: bool = False) -> None:
    """Delete all files associated with a session."""
    sid = str(session_id)

    # Delete audio (only if requested - audio is kept by default)
    if delete_audio:
        for f in AUDIO_DIR.glob(f"{sid}_*"):
            f.unlink(missing_ok=True)

    # Delete PPT (always deleted)
    for f in PPT_DIR.glob(f"{sid}_*"):
        f.unlink(missing_ok=True)

    # Delete images
    image_dir = IMAGE_DIR / sid
    if image_dir.exists():
        shutil.rmtree(image_dir)

def delete_notebook_files(notebook_id: str, db) -> None:
    """Delete all files for all sessions in a notebook."""
    from app.models import Session, File

    sessions = db.query(Session).filter(Session.notebook_id == notebook_id).all()
    for session in sessions:
        delete_session_files(session.id, delete_audio=True)
