import os
from pathlib import Path
from dotenv import load_dotenv

# Load .env file
load_dotenv(Path(__file__).resolve().parent.parent / ".env")

BASE_DIR = Path(__file__).resolve().parent.parent

# Database
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./nootbook.db")

# File Storage
UPLOAD_DIR = BASE_DIR / "uploads"
OUTPUT_DIR = BASE_DIR / "outputs"
AUDIO_DIR = UPLOAD_DIR / "audio"
PPT_DIR = UPLOAD_DIR / "ppt"
IMAGE_DIR = OUTPUT_DIR / "images"

SLIDE_DIR = UPLOAD_DIR / "slides"  # PPT slide rendered images

AUDIO_DIR.mkdir(parents=True, exist_ok=True)
PPT_DIR.mkdir(parents=True, exist_ok=True)
IMAGE_DIR.mkdir(parents=True, exist_ok=True)
SLIDE_DIR.mkdir(parents=True, exist_ok=True)

MAX_AUDIO_SIZE = 200 * 1024 * 1024  # 200MB
MAX_PPT_SIZE = 50 * 1024 * 1024  # 50MB

# AI API Keys
DASHSCOPE_API_KEY = os.getenv("DASHSCOPE_API_KEY", "")
QWEN_VL_API_KEY = os.getenv("QWEN_VL_API_KEY", "")
DEEPSEEK_API_KEY = os.getenv("DEEPSEEK_API_KEY", "")
DEEPSEEK_BASE_URL = os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com")
DEEPSEEK_MODEL = os.getenv("DEEPSEEK_MODEL", "deepseek-chat")

# Security
SECRET_KEY = os.getenv("SECRET_KEY")
if not SECRET_KEY:
    raise RuntimeError(
        "SECRET_KEY environment variable is required for production deployment. "
        "Generate one with: python -c 'import secrets; print(secrets.token_hex(32))'"
    )
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60  # 60 minutes
REFRESH_TOKEN_EXPIRE_DAYS = 7  # 7 days

# CORS
# Comma-separated list of allowed origins (e.g. "http://localhost:5173,https://myapp.com")
ALLOWED_ORIGINS = [o.strip() for o in os.getenv("ALLOWED_ORIGINS", "http://localhost:5173,http://localhost:5174").split(",") if o.strip()]

# Default Admin Account (for first-run initialization)
ADMIN_DEFAULT_EMAIL = os.getenv("ADMIN_DEFAULT_EMAIL", "admin")
ADMIN_DEFAULT_PASSWORD = os.getenv("ADMIN_DEFAULT_PASSWORD")  # Must be set in production
