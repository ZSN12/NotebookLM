from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from app.config import DATABASE_URL

if not DATABASE_URL.startswith(("postgresql://", "postgresql+psycopg2://")):
    raise RuntimeError(
        "Unsupported DATABASE_URL. SQLite support has been removed; use PostgreSQL."
    )

engine = create_engine(
    DATABASE_URL,
    pool_pre_ping=True,
    pool_recycle=3600,
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
