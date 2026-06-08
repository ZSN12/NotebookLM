from sqlalchemy import Column, DateTime, String, Text, Integer, JSON, ForeignKey, Float, Boolean, LargeBinary
from sqlalchemy.orm import relationship, DeclarativeBase
from sqlalchemy.sql import func
import uuid

class Base(DeclarativeBase):
    pass

class User(Base):
    __tablename__ = "users"
    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    username = Column(String(50), nullable=False)
    email = Column(String(100), unique=True, nullable=False)
    password_hash = Column(String(255), nullable=False)
    avatar_url = Column(Text)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    notebooks = relationship("Notebook", back_populates="user", cascade="all, delete-orphan")

class Notebook(Base):
    __tablename__ = "notebooks"
    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(String(36), ForeignKey("users.id"), nullable=False)
    title = Column(String(100), nullable=False)
    description = Column(Text)
    icon = Column(String(50))
    color = Column(String(50))
    session_count = Column(Integer, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    user = relationship("User", back_populates="notebooks")
    sessions = relationship("Session", back_populates="notebook", cascade="all, delete-orphan")
    vocabulary = relationship("Vocabulary", back_populates="notebook", cascade="all, delete-orphan")

class Session(Base):
    __tablename__ = "sessions"
    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    notebook_id = Column(String(36), ForeignKey("notebooks.id"), nullable=False)
    title = Column(String(200), nullable=False)
    summary = Column(Text, nullable=True)
    keywords = Column(JSON, default=[])
    duration = Column(String(20))
    status = Column(String(20), default="pending")
    share_enabled = Column(Boolean, default=False)
    share_token = Column(String(64), nullable=True)
    share_expires_at = Column(DateTime(timezone=True), nullable=True)
    share_max_views = Column(Integer, nullable=True)
    share_view_count = Column(Integer, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    notebook = relationship("Notebook", back_populates="sessions")
    notes = relationship("Note", back_populates="session", cascade="all, delete-orphan")
    files = relationship("File", back_populates="session", cascade="all, delete-orphan")
    tasks = relationship("Task", back_populates="session", cascade="all, delete-orphan")

class Note(Base):
    __tablename__ = "notes"
    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    session_id = Column(String(36), ForeignKey("sessions.id"), nullable=False)
    content = Column(Text)
    transcript = Column(JSON)
    ppt_images = Column(JSON)
    vocabulary = Column(JSON)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    session = relationship("Session", back_populates="notes")

    @property
    def layout_blocks(self):
        if not isinstance(self.vocabulary, list):
            return None
        for item in self.vocabulary:
            if isinstance(item, dict) and item.get("kind") == "layout_blocks":
                blocks = item.get("blocks")
                return blocks if isinstance(blocks, list) else None
        return None

    @layout_blocks.setter
    def layout_blocks(self, blocks):
        existing = self.vocabulary if isinstance(self.vocabulary, list) else []
        next_items = [
            item for item in existing
            if not (isinstance(item, dict) and item.get("kind") == "layout_blocks")
        ]
        if blocks is not None:
            next_items.append({"kind": "layout_blocks", "blocks": blocks})
        self.vocabulary = next_items

class File(Base):
    __tablename__ = "files"
    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    session_id = Column(String(36), ForeignKey("sessions.id"), nullable=False)
    file_type = Column(String(20), nullable=False)
    file_name = Column(String(255), nullable=False)
    file_path = Column(Text, nullable=False)
    file_size = Column(Integer)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    session = relationship("Session", back_populates="files")

class Task(Base):
    __tablename__ = "tasks"
    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    session_id = Column(String(36), ForeignKey("sessions.id"), nullable=False)
    task_type = Column(String(50), nullable=False)
    status = Column(String(20), default="pending")
    progress = Column(Float, default=0.0)
    error_message = Column(Text)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    session = relationship("Session", back_populates="tasks")

class Vocabulary(Base):
    __tablename__ = "vocabulary"
    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    notebook_id = Column(String(36), ForeignKey("notebooks.id"), nullable=False)
    term = Column(String(200), nullable=False)
    translation = Column(String(200))
    definition = Column(Text)
    source = Column(String(50))
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    notebook = relationship("Notebook", back_populates="vocabulary")

class VectorChunk(Base):
    __tablename__ = "vector_chunks"
    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(String(36), ForeignKey("users.id"), nullable=False, index=True)
    notebook_id = Column(String(36), ForeignKey("notebooks.id"), nullable=False, index=True)
    session_id = Column(String(36), ForeignKey("sessions.id"), nullable=False, index=True)
    source_type = Column(String(20), nullable=False)  # transcript | note | ppt | layout
    source_id = Column(String(36), nullable=True)
    chunk_index = Column(Integer, default=0)
    text = Column(Text, nullable=False)
    chunk_meta = Column(JSON, default={})
    embedding = Column(LargeBinary, nullable=True)  # packed float32 vector
    content_hash = Column(String(64), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

__all__ = ["Base", "User", "Notebook", "Session", "Note", "File", "Task", "Vocabulary", "VectorChunk"]
