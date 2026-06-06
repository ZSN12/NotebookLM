"""CSRF protection middleware for FastAPI.

Implements Origin/Referer header validation for stateless token-based auth.
Since the project uses Bearer tokens (not cookies), traditional CSRF attacks
are not applicable, but we still validate request origins for defense-in-depth.
"""
from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware
from urllib.parse import urlparse
from app.config import ALLOWED_ORIGINS

SAFE_METHODS = {"GET", "HEAD", "OPTIONS", "TRACE"}

SAFE_PATHS = {
    "/api/health",
    "/api/auth/login",
    "/api/auth/register",
    "/api/auth/refresh",
    "/api/media",
    "/docs",
    "/openapi.json",
    "/redoc",
}


def extract_origin(request: Request) -> str | None:
    origin = request.headers.get("origin")
    if origin:
        return origin
    referer = request.headers.get("referer")
    if referer:
        parsed = urlparse(referer)
        if parsed.scheme and parsed.netloc:
            return f"{parsed.scheme}://{parsed.netloc}"
    return None


class CSRFMiddleware(BaseHTTPMiddleware):
    """Origin-based CSRF protection for token-auth APIs."""

    def __init__(self, app):
        super().__init__(app)
        self._allowed_origins = set(ALLOWED_ORIGINS)

    async def dispatch(self, request: Request, call_next):
        method = request.method
        path = request.url.path

        if method in SAFE_METHODS or any(path.startswith(p) for p in SAFE_PATHS):
            return await call_next(request)

        auth = request.headers.get("authorization", "")
        if not auth.startswith("Bearer "):
            return await call_next(request)

        origin = extract_origin(request)
        if not origin or origin not in self._allowed_origins:
            return Response(
                content='{"detail": "CSRF validation failed: invalid origin"}',
                status_code=403,
                media_type="application/json",
                headers={"Vary": "Origin"},
            )

        response = await call_next(request)
        return response
