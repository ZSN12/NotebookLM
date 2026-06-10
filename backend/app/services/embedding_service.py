"""Neural embedding service using DashScope text-embedding API.

Supports batch embedding to reduce API call overhead.
Callers should fall back to local TF-IDF when this returns None.
"""
import logging
import struct
from typing import List, Optional

from app.config import DASHSCOPE_API_KEY

logger = logging.getLogger(__name__)

# text-embedding-v2 produces 1536-dim vectors
EMBEDDING_DIM = 1536


class EmbeddingService:
    """Wrapper around DashScope/OpenAI-compatible embedding API."""

    def __init__(self):
        self._client = None
        if DASHSCOPE_API_KEY:
            try:
                from openai import OpenAI
                self._client = OpenAI(
                    api_key=DASHSCOPE_API_KEY,
                    base_url="https://dashscope.aliyuncs.com/compatible-mode/v1",
                )
                logger.info("embedding_service_initialized")
            except Exception as exc:
                logger.warning("embedding_service_init_failed error=%s", exc)
        else:
            logger.warning("embedding_service_no_api_key")

    @property
    def available(self) -> bool:
        return self._client is not None

    def embed(self, text: str) -> Optional[bytes]:
        """Embed a single text. Returns packed float32 bytes or None on failure."""
        if not text or not text.strip():
            return struct.pack(f"{EMBEDDING_DIM}f", *([0.0] * EMBEDDING_DIM))

        if not self.available:
            return None

        try:
            response = self._client.embeddings.create(
                model="text-embedding-v2",
                input=text.strip(),
                encoding_format="float",
            )
            vec = response.data[0].embedding
            if len(vec) != EMBEDDING_DIM:
                logger.warning(
                    "embedding_dim_mismatch expected=%s got=%s, returning None",
                    EMBEDDING_DIM, len(vec),
                )
                return None
            return struct.pack(f"{len(vec)}f", *vec)
        except Exception as exc:
            logger.warning("embedding_single_failed text_len=%s error=%s", len(text), exc)
            return None

    def embed_batch(self, texts: List[str]) -> List[Optional[bytes]]:
        """Embed multiple texts in one API call (up to API batch limit).

        Falls back to individual calls if batch fails.
        """
        if not self.available:
            return [None] * len(texts)

        # Filter out empty texts
        non_empty = [(i, t.strip()) for i, t in enumerate(texts) if t and t.strip()]
        if not non_empty:
            return [
                struct.pack(f"{EMBEDDING_DIM}f", *([0.0] * EMBEDDING_DIM))
                for _ in texts
            ]

        try:
            response = self._client.embeddings.create(
                model="text-embedding-v2",
                input=[t for _, t in non_empty],
                encoding_format="float",
            )

            results: List[Optional[bytes]] = [None] * len(texts)
            for (orig_idx, _), emb_data in zip(non_empty, response.data):
                vec = emb_data.embedding
                if len(vec) != EMBEDDING_DIM:
                    logger.warning(
                        "embedding_dim_mismatch expected=%s got=%s, skipping",
                        EMBEDDING_DIM, len(vec),
                    )
                    continue
                results[orig_idx] = struct.pack(f"{len(vec)}f", *vec)

            # Fill empty texts with zero vectors
            for i, t in enumerate(texts):
                if not t or not t.strip():
                    results[i] = struct.pack(f"{EMBEDDING_DIM}f", *([0.0] * EMBEDDING_DIM))

            return results
        except Exception as exc:
            logger.warning("embedding_batch_failed count=%s error=%s", len(non_empty), exc)
            # Fallback to individual calls
            return [self.embed(t) for t in texts]


# Global singleton
_embedding_service: Optional[EmbeddingService] = None


def get_embedding_service() -> EmbeddingService:
    """Lazy-init global embedding service."""
    global _embedding_service
    if _embedding_service is None:
        _embedding_service = EmbeddingService()
    return _embedding_service


def neural_embedding(text: str) -> Optional[bytes]:
    """Get neural embedding for text. Returns None if service unavailable."""
    return get_embedding_service().embed(text)


def neural_embedding_batch(texts: List[str]) -> List[Optional[bytes]]:
    """Batch neural embedding."""
    return get_embedding_service().embed_batch(texts)
