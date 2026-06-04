"""Local lightweight vector service using TF-IDF style embeddings.

No external embedding APIs or vector databases required.
Uses jieba for Chinese tokenization and a sparse TF-IDF-like vector representation.
"""

import hashlib
import json
import math
import re
import struct
from collections import Counter
from typing import Optional

import jieba

from app.models import (
    VectorChunk, Session as DBSession, Note, Notebook, User,
)
from sqlalchemy.orm import Session as DBSessionType

# ── Constants ──
VEC_DIM = 512  # dimension of our sparse-ish vector
MIN_CHUNK_CHARS = 10  # skip chunks shorter than this
CHUNK_SIZE = 300  # target chars per chunk
CHUNK_OVERLAP = 50  # overlap between chunks


# ── Tokenization ──

def _tokenize(text: str) -> list[str]:
    """Tokenize Chinese + English text into words."""
    # Split on whitespace first for English
    words: list[str] = []
    for segment in re.split(r'\s+', text):
        if not segment:
            continue
        # If segment is mostly CJK, use jieba
        cjk_count = sum(1 for c in segment if '\u4e00' <= c <= '\u9fff')
        if cjk_count > len(segment) * 0.3:
            words.extend(jieba.lcut(segment))
        else:
            words.append(segment.lower())
    # Filter very short tokens
    return [w for w in words if len(w) >= 2]


# ── Hash-based feature mapping ──

def _hash_feature(token: str) -> int:
    """Map a token to a deterministic bucket index in [0, VEC_DIM)."""
    h = hashlib.md5(token.encode('utf-8')).hexdigest()
    return int(h, 16) % VEC_DIM


# ── Embedding ──

def _text_to_embedding(text: str) -> bytes:
    """Convert text to a fixed-dimension float32 vector using TF hashing.

    Each token is hashed to a bucket. The value is the sum of token frequencies,
    then L2-normalized. Returns packed bytes (VEC_DIM * 4 bytes).
    """
    tokens = _tokenize(text)
    if not tokens:
        return struct.pack(f'{VEC_DIM}f', *([0.0] * VEC_DIM))

    counter = Counter(tokens)
    vec = [0.0] * VEC_DIM
    for token, count in counter.items():
        idx = _hash_feature(token)
        # Use log(1+count) to dampen high-frequency terms
        vec[idx] += math.log1p(count)

    # L2 normalize
    norm = math.sqrt(sum(v * v for v in vec))
    if norm > 0:
        vec = [v / norm for v in vec]

    return struct.pack(f'{VEC_DIM}f', *vec)


def _cosine_similarity(a: bytes, b: bytes) -> float:
    """Compute cosine similarity between two packed float32 vectors."""
    vec_a = struct.unpack(f'{VEC_DIM}f', a)
    vec_b = struct.unpack(f'{VEC_DIM}f', b)
    dot = sum(x * y for x, y in zip(vec_a, vec_b))
    norm_a = math.sqrt(sum(x * x for x in vec_a))
    norm_b = math.sqrt(sum(x * x for x in vec_b))
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot / (norm_a * norm_b)


# ── Chunking ──

def _chunk_text(text: str, chunk_size: int = CHUNK_SIZE, overlap: int = CHUNK_OVERLAP) -> list[str]:
    """Split text into overlapping chunks of roughly chunk_size characters."""
    if len(text) <= chunk_size:
        return [text] if text.strip() else []

    chunks = []
    start = 0
    while start < len(text):
        end = start + chunk_size
        chunk = text[start:end]
        chunks.append(chunk)
        start += chunk_size - overlap
    return chunks


# ── Content extraction ──

def _extract_text_from_note(note: Note) -> list[tuple[str, str, str, dict]]:
    """Extract indexable text chunks from a Note.

    Returns list of (source_type, source_id, text, metadata).
    """
    results = []

    # 1. Layout blocks (highest priority - structured content)
    layout_blocks = note.layout_blocks
    if layout_blocks and isinstance(layout_blocks, list):
        for i, block in enumerate(layout_blocks):
            if not isinstance(block, dict):
                continue
            btype = block.get("type", "")
            content = block.get("content", "")
            page = block.get("page")
            title = block.get("title", "")

            if btype == "transcript" and content and len(content.strip()) >= MIN_CHUNK_CHARS:
                meta = {"block_index": i, "block_type": "transcript"}
                results.append(("layout", block.get("id", ""), content.strip(), meta))
            elif btype == "note" and content and len(content.strip()) >= MIN_CHUNK_CHARS:
                meta = {"block_index": i, "block_type": "note"}
                results.append(("layout", block.get("id", ""), content.strip(), meta))
            elif btype == "ppt":
                # Index PPT title and any text content
                ppt_text = ""
                if title:
                    ppt_text += title + " "
                if content:
                    ppt_text += content + " "
                if ppt_text.strip() and len(ppt_text.strip()) >= MIN_CHUNK_CHARS:
                    meta = {"block_index": i, "block_type": "ppt", "page": page}
                    results.append(("ppt", block.get("id", ""), ppt_text.strip(), meta))

    # 2. Transcript (if no layout blocks)
    if not layout_blocks:
        transcript = note.transcript
        if transcript and isinstance(transcript, list):
            full_text = " ".join(
                chunk.get("text", "")
                for chunk in sorted(transcript, key=lambda x: x.get("chunk_index", 0))
                if isinstance(chunk, dict)
            ).strip()
            if full_text and len(full_text) >= MIN_CHUNK_CHARS:
                results.append(("transcript", note.id, full_text, {}))

    # 3. Note content (fallback)
    if not results and note.content:
        content = note.content.strip()
        if len(content) >= MIN_CHUNK_CHARS:
            results.append(("note", note.id, content, {}))

    # 4. PPT images text (if available)
    ppt_images = note.ppt_images
    if ppt_images and isinstance(ppt_images, list):
        for ppt_data in ppt_images:
            if not isinstance(ppt_data, dict):
                continue
            slides = ppt_data.get("slides", [])
            for slide in slides:
                if not isinstance(slide, dict):
                    continue
                slide_text = slide.get("text", "")
                page_num = slide.get("page", "")
                if slide_text and len(slide_text.strip()) >= MIN_CHUNK_CHARS:
                    meta = {"page": page_num}
                    results.append(("ppt", str(page_num), slide_text.strip(), meta))

    return results


# ── Content fingerprint ──

def _compute_session_content_hash(note: Note) -> str:
    """Compute a stable SHA-256 fingerprint of all note content.

    Serializes content, transcript, ppt_images, layout_blocks with
    sort_keys=True and ensure_ascii=False for deterministic output.
    """
    payload = {
        "content": note.content or "",
        "transcript": note.transcript or [],
        "ppt_images": note.ppt_images or [],
        "layout_blocks": note.layout_blocks or [],
    }
    raw = json.dumps(payload, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


# ── Index building ──

def build_session_index(session_id: str, user: User, db: DBSessionType) -> int:
    """Build vector index for a single session. Returns number of chunks created."""
    # Verify ownership
    session = db.query(DBSession).filter(
        DBSession.id == session_id
    ).join(Notebook).filter(Notebook.user_id == user.id).first()
    if not session:
        raise ValueError("Session not found or access denied")

    # Delete old chunks for this session
    db.query(VectorChunk).filter(VectorChunk.session_id == session_id).delete()

    note = db.query(Note).filter(Note.session_id == session_id).first()
    if not note:
        db.commit()
        return 0

    # Compute content fingerprint for stale detection
    session_content_hash = _compute_session_content_hash(note)

    extracted = _extract_text_from_note(note)
    chunk_count = 0

    for source_type, source_id, text, meta in extracted:
        # Chunk long texts
        text_chunks = _chunk_text(text)
        for idx, chunk_text in enumerate(text_chunks):
            if len(chunk_text.strip()) < MIN_CHUNK_CHARS:
                continue

            content_hash = hashlib.sha256(chunk_text.encode('utf-8')).hexdigest()
            embedding = _text_to_embedding(chunk_text)

            chunk_meta = {**meta, "chunk_in_source": idx, "session_content_hash": session_content_hash}

            vc = VectorChunk(
                user_id=user.id,
                notebook_id=session.notebook_id,
                session_id=session_id,
                source_type=source_type,
                source_id=source_id,
                chunk_index=chunk_count,
                text=chunk_text,
                chunk_meta=chunk_meta,
                embedding=embedding,
                content_hash=content_hash,
            )
            db.add(vc)
            chunk_count += 1

    db.commit()
    return chunk_count


def build_notebook_index(notebook_id: str, user: User, db: DBSessionType) -> int:
    """Build vector index for all sessions in a notebook. Returns total chunks."""
    notebook = db.query(Notebook).filter(
        Notebook.id == notebook_id,
        Notebook.user_id == user.id,
    ).first()
    if not notebook:
        raise ValueError("Notebook not found or access denied")

    total = 0
    for session in notebook.sessions:
        total += build_session_index(session.id, user, db)
    return total


# ── Search ──

def search_vectors(
    user: User,
    query: str,
    session_id: Optional[str] = None,
    notebook_id: Optional[str] = None,
    limit: int = 20,
    db: DBSessionType = None,
) -> list[dict]:
    """Search vector chunks by query. Returns sorted results with scores."""
    if not query.strip():
        return []

    query_embedding = _text_to_embedding(query)

    # Build base query - only user's own chunks
    q = db.query(VectorChunk).filter(VectorChunk.user_id == user.id)

    if session_id:
        q = q.filter(VectorChunk.session_id == session_id)
    if notebook_id:
        q = q.filter(VectorChunk.notebook_id == notebook_id)

    chunks = q.all()
    if not chunks:
        return []

    # Score each chunk
    scored = []
    for chunk in chunks:
        if not chunk.embedding:
            continue
        score = _cosine_similarity(query_embedding, chunk.embedding)
        if score > 0.01:  # minimum relevance threshold
            scored.append((chunk, score))

    # Sort by score descending
    scored.sort(key=lambda x: x[1], reverse=True)

    # Build results
    results = []
    for chunk, score in scored[:limit]:
        # Get session and notebook info
        session = db.query(DBSession).filter(DBSession.id == chunk.session_id).first()
        notebook = db.query(Notebook).filter(Notebook.id == chunk.notebook_id).first()

        results.append({
            "chunk_id": chunk.id,
            "notebook_id": chunk.notebook_id,
            "notebook_title": notebook.title if notebook else "未知",
            "session_id": chunk.session_id,
            "session_title": session.title if session else "未知",
            "source_type": chunk.source_type,
            "snippet": chunk.text[:200] + ("..." if len(chunk.text) > 200 else ""),
            "score": round(score, 4),
            "metadata": chunk.chunk_meta or {},
        })

    return results


# ── Status ──

def get_session_index_status(session_id: str, user: User, db: DBSessionType) -> dict:
    """Get indexing status for a session."""
    # Verify ownership
    session = db.query(DBSession).filter(
        DBSession.id == session_id
    ).join(Notebook).filter(Notebook.user_id == user.id).first()
    if not session:
        raise ValueError("Session not found or access denied")

    chunk_count = db.query(VectorChunk).filter(
        VectorChunk.session_id == session_id
    ).count()

    note = db.query(Note).filter(Note.session_id == session_id).first()
    has_content = bool(note and (note.content or note.transcript or note.ppt_images or note.layout_blocks))

    if not has_content:
        status = "empty"
    elif chunk_count == 0:
        status = "not_indexed"
    else:
        # Check if content has changed since last index
        current_hash = _compute_session_content_hash(note) if note else ""
        # Read indexed hash from any chunk's chunk_meta
        sample_chunk = db.query(VectorChunk).filter(
            VectorChunk.session_id == session_id
        ).first()
        indexed_hash = ""
        if sample_chunk and sample_chunk.chunk_meta:
            indexed_hash = sample_chunk.chunk_meta.get("session_content_hash", "")
        status = "indexed" if indexed_hash == current_hash else "stale"

    result = {
        "session_id": session_id,
        "chunk_count": chunk_count,
        "has_content": has_content,
        "status": status,
    }
    return result
