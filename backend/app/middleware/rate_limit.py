"""Rate limiting middleware using sliding window algorithm."""
import time
from collections import defaultdict
from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware

# Rate limit rules: (path_prefix, max_requests, window_seconds)
RATE_LIMITS = [
    ("/api/process/audio-stream", 10, 60),   # 10 requests per minute
    ("/api/process/audio-finish", 5, 60),     # 5 requests per minute
    ("/api/process/audio-batch", 5, 60),      # 5 requests per minute
    ("/api/process/ppt-upload", 5, 60),       # 5 requests per minute
    ("/api/notebooks", 30, 60),               # 30 requests per minute
    ("/api/sessions", 30, 60),                # 30 requests per minute
    ("/api/notes", 30, 60),                   # 30 requests per minute
    ("/api/auth/register", 5, 3600),          # 5 registrations per hour
]


class RateLimitMiddleware(BaseHTTPMiddleware):
    """Sliding window rate limiter per user (by IP for anonymous, by token for authenticated)."""

    def __init__(self, app):
        super().__init__(app)
        # Store request timestamps: { (user_key, path_prefix): [timestamp, ...] }
        self._requests: dict[tuple[str, str], list[float]] = defaultdict(list)

    def _get_user_key(self, request: Request) -> str:
        """Identify user by Authorization header (token hash) or IP address."""
        auth = request.headers.get("authorization", "")
        if auth.startswith("Bearer "):
            return f"user:{hash(auth)}"
        return f"ip:{request.client.host}" if request.client else "ip:unknown"

    def _check_rate_limit(self, user_key: str, path: str) -> tuple[bool, dict]:
        """Check if request is within rate limits. Returns (allowed, headers)."""
        now = time.time()

        for prefix, max_req, window in RATE_LIMITS:
            if path.startswith(prefix):
                key = (user_key, prefix)
                # Remove old timestamps outside the window
                timestamps = self._requests[key]
                cutoff = now - window
                self._requests[key] = [t for t in timestamps if t > cutoff]
                timestamps = self._requests[key]

                remaining = max_req - len(timestamps)
                reset_time = int(window - (now - timestamps[0])) if timestamps else 0

                if remaining <= 0:
                    return False, {
                        "X-RateLimit-Limit": str(max_req),
                        "X-RateLimit-Remaining": "0",
                        "X-RateLimit-Reset": str(reset_time),
                    }

                timestamps.append(now)
                return True, {
                    "X-RateLimit-Limit": str(max_req),
                    "X-RateLimit-Remaining": str(remaining - 1),
                    "X-RateLimit-Reset": str(reset_time),
                }

        return True, {}

    async def dispatch(self, request: Request, call_next):
        user_key = self._get_user_key(request)
        allowed, headers = self._check_rate_limit(user_key, request.url.path)

        if not allowed:
            return Response(
                content='{"detail": "Too many requests. Please try again later."}',
                status_code=429,
                media_type="application/json",
                headers=headers,
            )

        response = await call_next(request)
        for k, v in headers.items():
            response.headers[k] = v
        return response
