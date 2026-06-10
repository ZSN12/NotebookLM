import asyncio
import logging
import os
from pathlib import Path
from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api import auth, notebooks, sessions, process, notes, public, vector, mindmap, quiz, agents, rag
from app.api.process.asr_ws import router as asr_ws_router
from app.core.database import get_db, SessionLocal
from app.core.auth import hash_password, get_current_user
from app.middleware.rate_limit import RateLimitMiddleware
from app.middleware.csrf import CSRFMiddleware
from app.models import Base, Notebook, Session as DBSession, User
from app.core.database import engine
from app.config import SLIDE_DIR, AUDIO_DIR, ALLOWED_ORIGINS, ADMIN_DEFAULT_EMAIL, ADMIN_DEFAULT_PASSWORD

# ── Logging ──
_LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO").upper()
logging.basicConfig(
    level=getattr(logging, _LOG_LEVEL, logging.INFO),
    format="%(asctime)s %(levelname)-5s [%(name)s] %(message)s",
    datefmt="%H:%M:%S",
)

app = FastAPI(title="AI Notebook", version="0.1.0")

app.add_middleware(RateLimitMiddleware)
app.add_middleware(CSRFMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-CSRF-Token", "Origin", "Accept"],
)

app.include_router(auth.router)
app.include_router(notebooks.router)
app.include_router(sessions.router)
app.include_router(process.router)
app.include_router(notes.router)
app.include_router(public.router)
app.include_router(vector.router)
app.include_router(mindmap.router)
app.include_router(quiz.router)
app.include_router(agents.router)
app.include_router(rag.router)
app.include_router(asr_ws_router)


def _require_user_session(session_id: str, user: User, db: Session) -> DBSession:
    session = db.query(DBSession).filter(
        DBSession.id == session_id
    ).join(Notebook).filter(
        Notebook.user_id == user.id
    ).first()
    if not session:
        raise HTTPException(status_code=404, detail="Media not found")
    return session


def _safe_media_path(base_dir: Path, *parts: str) -> Path:
    base = base_dir.resolve()
    target = (base / Path(*parts)).resolve()
    if not target.is_relative_to(base):
        raise HTTPException(status_code=404, detail="Media not found")
    if not target.is_file():
        raise HTTPException(status_code=404, detail="Media not found")
    return target


@app.get("/api/media/slides/{session_id}/{slide_path:path}")
def get_slide_media(
    session_id: str,
    slide_path: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_user_session(session_id, current_user, db)
    return FileResponse(_safe_media_path(SLIDE_DIR, session_id, slide_path))


@app.get("/api/media/audio/{filename}")
def get_audio_media(
    filename: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not filename.endswith(".wav"):
        raise HTTPException(status_code=404, detail="Media not found")
    session_id = filename[:-4]
    _require_user_session(session_id, current_user, db)
    return FileResponse(_safe_media_path(AUDIO_DIR, filename))

@app.on_event("startup")
async def on_startup():
    # Run database migrations via Alembic
    try:
        from alembic.config import Config as AlembicConfig
        from alembic import command as alembic_command

        alembic_cfg = AlembicConfig(Path(__file__).resolve().parents[1] / "alembic.ini")
        alembic_command.upgrade(alembic_cfg, "head")
        print("[INFO] Database migrations applied.")
    except Exception as e:
        print(f"[WARN] Alembic upgrade failed (may already be up to date): {e}")
        # Fallback: create tables directly for test environments
        try:
            Base.metadata.create_all(bind=engine)
            print("[INFO] Tables created via Base.metadata.create_all.")
        except Exception as ce:
            print(f"[WARN] create_all also failed: {ce}")

    db = SessionLocal()
    try:
        admin = db.query(User).filter(User.email == ADMIN_DEFAULT_EMAIL).first()
        if not admin:
            password = ADMIN_DEFAULT_PASSWORD
            if not password:
                print("[WARN] ADMIN_DEFAULT_PASSWORD not set; skipping default admin creation.")
            else:
                admin = User(
                    username=ADMIN_DEFAULT_EMAIL,
                    email=ADMIN_DEFAULT_EMAIL,
                    password_hash=hash_password(password),
                )
                db.add(admin)
                try:
                    db.commit()
                    print(f"[INFO] Admin user created ({ADMIN_DEFAULT_EMAIL}).")
                    print("[INFO] Please change the password immediately after first login.")
                except IntegrityError:
                    db.rollback()
                    print(f"[INFO] Admin user already exists ({ADMIN_DEFAULT_EMAIL}).")
    finally:
        db.close()
    print("Database ready.")

    # Preload FunASR model in background
    if os.getenv("SKIP_ASR_PRELOAD") != "1":
        asyncio.create_task(_preload_asr_model())


async def _preload_asr_model():
    """Preload FunASR model in background on startup."""
    try:
        import asyncio
        from app.services.transcriber import transcriber
        loop = asyncio.get_running_loop()
        await loop.run_in_executor(None, transcriber._load_model)
        print("[INFO] FunASR model preloaded successfully")
    except Exception as e:
        print(f"[WARN] FunASR preload failed (will retry on first request): {e}")

@app.get("/api/health")
def health_check():
    from sqlalchemy import text
    from app.core.database import engine
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        return {"status": "ok", "database": "connected"}
    except Exception as e:
        return {"status": "degraded", "database": str(e)}

if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app.main:app", host="0.0.0.0", port=8003, reload=True)
