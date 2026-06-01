import shutil
import uuid
import os
from pathlib import Path
from app.config import AUDIO_DIR, PPT_DIR, IMAGE_DIR, MAX_AUDIO_SIZE, MAX_PPT_SIZE

def get_upload_path(file_type: str, session_id: str, file_name: str) -> Path:
    """Get the absolute upload path for a file."""
    if file_type == "audio":
        return AUDIO_DIR / f"{session_id}_{file_name}"
    elif file_type == "ppt":
        return PPT_DIR / f"{session_id}_{file_name}"
    raise ValueError(f"Invalid file type: {file_type}")

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
