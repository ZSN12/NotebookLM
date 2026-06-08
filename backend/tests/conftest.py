"""Shared pytest fixtures for backend tests.

Joins all tracked agent daemon threads after each test case so that slow LLM
mocks do not leak into the next test and pollute OpenAI mock call counts or
Task state.
"""

import sys
from pathlib import Path

import pytest

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.core.task_runner import wait_for_agent_threads  # noqa: E402


@pytest.fixture(autouse=True)
def _join_agent_threads():
    yield
    wait_for_agent_threads(timeout=10.0)
