import asyncio
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from app.api import auth, notebooks, sessions, process, notes
from app.core.database import engine, SessionLocal
from app.core.auth import hash_password
from app.middleware.rate_limit import RateLimitMiddleware
from app.middleware.csrf import CSRFMiddleware
from app.models import Base, User
from app.config import SLIDE_DIR, AUDIO_DIR, ALLOWED_ORIGINS, ADMIN_DEFAULT_EMAIL, ADMIN_DEFAULT_PASSWORD

app = FastAPI(title="AI Notebook", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.add_middleware(RateLimitMiddleware)
app.add_middleware(CSRFMiddleware)

app.include_router(auth.router)
app.include_router(notebooks.router)
app.include_router(sessions.router)
app.include_router(process.router)
app.include_router(notes.router)

# Serve static media from disk (mount after routes to avoid intercepting API calls)
app.mount("/api/media/slides", StaticFiles(directory=str(SLIDE_DIR)), name="slides")
app.mount("/api/media/audio", StaticFiles(directory=str(AUDIO_DIR)), name="audio")

@app.on_event("startup")
def on_startup():
    Base.metadata.create_all(bind=engine)

    db = SessionLocal()
    try:
        admin = db.query(User).filter(User.email == "admin").first()
        if not admin:
            password = ADMIN_DEFAULT_PASSWORD
            if not password:
                import secrets
                password = secrets.token_urlsafe(8)
                print(f"[WARN] ADMIN_DEFAULT_PASSWORD not set, using generated password: {password}")

            admin = User(
                username=ADMIN_DEFAULT_EMAIL,
                email=ADMIN_DEFAULT_EMAIL,
                password_hash=hash_password(password),
            )
            db.add(admin)
            db.commit()
            print(f"[INFO] Admin user created ({ADMIN_DEFAULT_EMAIL} / {password}).")
            print("[INFO] Please change the password immediately after first login.")
    finally:
        db.close()
    print("Database ready.")

    # Preload FunASR model in background
    asyncio.create_task(_preload_asr_model())


async def _preload_asr_model():
    """Preload FunASR model in background on startup."""
    try:
        import asyncio
        from app.services.transcriber import transcriber
        await asyncio.get_event_loop().run_in_executor(None, transcriber._load_model)
        print("[INFO] FunASR model preloaded successfully")
    except Exception as e:
        print(f"[WARN] FunASR preload failed (will retry on first request): {e}")

@app.get("/api/health")
def health_check():
    return {"status": "ok"}

if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app.main:app", host="0.0.0.0", port=8003, reload=True)
