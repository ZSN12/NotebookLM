from fastapi import APIRouter, HTTPException, Depends, status, UploadFile, File
from sqlalchemy.orm import Session
import time
import threading
import os
import uuid
from app.core.database import get_db
from app.core.auth import hash_password, verify_password, create_access_token, create_refresh_token, decode_refresh_token, get_current_user
from app.api.schemas import UserCreate, UserLogin, UserResponse, Token, TokenRefresh, TokenRefreshResponse, PasswordReset, UserProfileUpdate, PasswordChange
from app.models import User

router = APIRouter(prefix="/api/auth", tags=["auth"])

AVATAR_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(__file__)))), "uploads", "avatars")
os.makedirs(AVATAR_DIR, exist_ok=True)
ALLOWED_AVATAR_EXTENSIONS = {".jpg", ".jpeg", ".png", ".gif", ".webp"}
MAX_AVATAR_SIZE = 5 * 1024 * 1024  # 5MB

# Login rate limiting: track failed attempts per email
_login_lock = threading.Lock()
_failed_login_attempts = {}  # email -> {"count": int, "locked_until": float}
MAX_LOGIN_ATTEMPTS = 5
LOGIN_LOCK_DURATION = 15 * 60  # 15 minutes


@router.post("/register", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
def register(data: UserCreate, db: Session = Depends(get_db)):
    existing = db.query(User).filter(User.email == data.email).first()
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")
    user = User(
        username=data.username,
        email=data.email,
        password_hash=hash_password(data.password),
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@router.post("/login", response_model=Token)
def login(data: UserLogin, db: Session = Depends(get_db)):
    email = data.email

    # Check if account is locked
    with _login_lock:
        attempts = _failed_login_attempts.get(email)
        if attempts and attempts["locked_until"] and time.time() < attempts["locked_until"]:
            remaining = int(attempts["locked_until"] - time.time())
            raise HTTPException(
                status_code=429,
                detail=f"Account locked due to too many failed attempts. Try again in {remaining} seconds."
            )
        # Lock expired, reset
        if attempts and attempts["locked_until"] and time.time() >= attempts["locked_until"]:
            _failed_login_attempts.pop(email, None)

    user = db.query(User).filter(User.email == email).first()
    if not user or not verify_password(data.password, user.password_hash):
        # Record failed attempt
        with _login_lock:
            current = _failed_login_attempts.get(email, {"count": 0, "locked_until": 0})
            current["count"] = current.get("count", 0) + 1

            if current["count"] >= MAX_LOGIN_ATTEMPTS:
                current["locked_until"] = time.time() + LOGIN_LOCK_DURATION
                _failed_login_attempts[email] = current
                raise HTTPException(
                    status_code=429,
                    detail=f"Account locked due to {MAX_LOGIN_ATTEMPTS} failed attempts. Try again in {LOGIN_LOCK_DURATION} seconds."
                )

            _failed_login_attempts[email] = current

        raise HTTPException(status_code=401, detail="Invalid email or password")

    # Successful login: reset failed attempts
    with _login_lock:
        _failed_login_attempts.pop(email, None)

    access_token = create_access_token(user.id)
    refresh_token = create_refresh_token(user.id)
    return {"access_token": access_token, "refresh_token": refresh_token, "token_type": "bearer"}


@router.post("/refresh", response_model=TokenRefreshResponse)
def refresh_token(data: TokenRefresh, db: Session = Depends(get_db)):
    user_id = decode_refresh_token(data.refresh_token)
    if user_id is None:
        raise HTTPException(status_code=401, detail="Invalid or expired refresh token")

    user = db.query(User).filter(User.id == user_id).first()
    if user is None:
        raise HTTPException(status_code=401, detail="User not found")

    new_access_token = create_access_token(user.id)
    return {"access_token": new_access_token, "token_type": "bearer"}


@router.get("/me", response_model=UserResponse)
def get_me(current_user: User = Depends(get_current_user)):
    return current_user


@router.post("/reset-password", status_code=status.HTTP_200_OK)
def reset_password(data: PasswordReset, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == data.email).first()
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")

    user.password_hash = hash_password(data.new_password)
    db.commit()
    return {"status": "ok", "message": "Password has been reset successfully"}


@router.put("/profile", response_model=UserResponse)
def update_profile(data: UserProfileUpdate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if data.username is not None:
        current_user.username = data.username
    db.commit()
    db.refresh(current_user)
    return current_user


@router.put("/change-password", status_code=status.HTTP_200_OK)
def change_password(data: PasswordChange, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if not verify_password(data.old_password, current_user.password_hash):
        raise HTTPException(status_code=400, detail="Current password is incorrect")

    current_user.password_hash = hash_password(data.new_password)
    db.commit()
    return {"status": "ok", "message": "Password changed successfully"}


@router.post("/avatar", status_code=status.HTTP_200_OK)
async def upload_avatar(file: UploadFile = File(...), current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in ALLOWED_AVATAR_EXTENSIONS:
        raise HTTPException(status_code=400, detail=f"Unsupported file type. Allowed: {', '.join(ALLOWED_AVATAR_EXTENSIONS)}")

    content = await file.read()
    if len(content) > MAX_AVATAR_SIZE:
        raise HTTPException(status_code=413, detail=f"File too large: {len(content)} bytes (max {MAX_AVATAR_SIZE} bytes)")

    filename = f"{current_user.id}_{uuid.uuid4().hex[:8]}{ext}"
    filepath = os.path.join(AVATAR_DIR, filename)
    with open(filepath, "wb") as f:
        f.write(content)

    current_user.avatar_url = f"/api/auth/avatar/{current_user.id}"
    db.commit()
    return {"status": "ok", "avatar_url": current_user.avatar_url}


@router.get("/avatar/{user_id}")
def get_avatar(user_id: str, db: Session = Depends(get_db)):
    from fastapi.responses import FileResponse
    user = db.query(User).filter(User.id == user_id).first()
    if not user or not user.avatar_url:
        raise HTTPException(status_code=404, detail="Avatar not found")

    filename = os.path.basename(user.avatar_url)
    filepath = os.path.join(AVATAR_DIR, filename)
    if not os.path.exists(filepath):
        raise HTTPException(status_code=404, detail="Avatar file not found")

    return FileResponse(filepath)
