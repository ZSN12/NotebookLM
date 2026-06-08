"""Centralized agent task runner with join support.

Provides:
- _AGENT_THREADS registry so tests can wait for daemon tasks to finish.
- run_agent_task() helper that records the thread and runs a callback.
- wait_for_agent_threads() to join all tracked threads (useful in tests).
- clear_agent_threads() to drop references after joining.
"""

from __future__ import annotations

import logging
import threading
from typing import Callable

logger = logging.getLogger(__name__)

_AGENT_THREADS: list[threading.Thread] = []
_THREADS_LOCK = threading.Lock()


def run_agent_task(target: Callable[[], None], daemon: bool = True) -> threading.Thread:
    """Start a thread for an agent task and register it for testability."""
    thread = threading.Thread(target=target, daemon=daemon)
    with _THREADS_LOCK:
        # Clean up already-finished threads to avoid unbounded growth.
        _AGENT_THREADS[:] = [t for t in _AGENT_THREADS if t.is_alive()]
        _AGENT_THREADS.append(thread)
    thread.start()
    return thread


def get_agent_threads() -> list[threading.Thread]:
    """Return a snapshot of currently tracked agent threads."""
    with _THREADS_LOCK:
        return [t for t in _AGENT_THREADS if t.is_alive()]


def wait_for_agent_threads(timeout: float | None = None) -> None:
    """Join all tracked agent threads.

    Tests should call this between test cases (or in a fixture teardown)
    to prevent daemon tasks from leaking into the next test and polluting
    mocks / task state.
    """
    threads = get_agent_threads()
    for t in threads:
        t.join(timeout=timeout)
    with _THREADS_LOCK:
        _AGENT_THREADS[:] = [t for t in _AGENT_THREADS if t.is_alive()]


def clear_agent_threads() -> None:
    """Drop references to all tracked threads (use with caution)."""
    with _THREADS_LOCK:
        _AGENT_THREADS.clear()
