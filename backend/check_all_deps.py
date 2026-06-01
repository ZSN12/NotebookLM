import sys
print(f"Python: {sys.executable}")
print(f"Version: {sys.version}")
print()

deps = {
    "funasr": "FunASR",
    "passlib": "Passlib",
    "bcrypt": "Bcrypt",
    "jwt": "PyJWT",
    "sqlalchemy": "SQLAlchemy",
    "fastapi": "FastAPI",
    "uvicorn": "Uvicorn",
    "openai": "OpenAI SDK",
    "dashscope": "DashScope",
    "python-multipart": "Multipart",
}

for module, name in deps.items():
    try:
        __import__(module)
        print(f"✅ {name}: OK")
    except ImportError as e:
        print(f"❌ {name}: Missing - {e}")
