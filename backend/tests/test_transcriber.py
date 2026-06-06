"""Tests for ASR transcriber service."""

import os
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))

os.environ["SECRET_KEY"] = "test-secret-key-with-at-least-32-bytes"
os.environ["SKIP_ASR_PRELOAD"] = "1"

from app.services.transcriber import Transcriber, ASRSegment


def test_parse_funasr_result_with_binary_timestamps():
    """Binary [[start, end], ...] timestamps should produce ONE segment,
    not duplicate the full text for each timestamp entry."""
    transcriber = Transcriber()
    item = {
        "text": "父子进程和兄弟进程之间可以正常的通信",
        "timestamp": [[0, 960], [960, 1920], [1920, 2880], [2880, 3840]],
    }
    segments = transcriber._parse_funasr_result(item)

    assert len(segments) == 1
    assert segments[0].text == "父子进程和兄弟进程之间可以正常的通信"
    assert segments[0].start_ms == 0
    assert segments[0].end_ms == 3840


def test_parse_funasr_result_with_text_timestamps():
    """[[start, end, text], ...] timestamps should produce one segment per entry."""
    transcriber = Transcriber()
    item = {
        "text": "第一第二第三",
        "timestamp": [[0, 500, "第一"], [500, 1000, "第二"], [1000, 1500, "第三"]],
    }
    segments = transcriber._parse_funasr_result(item)

    assert len(segments) == 3
    assert segments[0].text == "第一"
    assert segments[0].start_ms == 0
    assert segments[0].end_ms == 500
    assert segments[1].text == "第二"
    assert segments[1].start_ms == 500
    assert segments[1].end_ms == 1000
    assert segments[2].text == "第三"
    assert segments[2].start_ms == 1000
    assert segments[2].end_ms == 1500


def test_parse_funasr_result_no_timestamp():
    """No timestamp should produce a single segment with zero times."""
    transcriber = Transcriber()
    item = {"text": "没有任何时间戳"}
    segments = transcriber._parse_funasr_result(item)

    assert len(segments) == 1
    assert segments[0].text == "没有任何时间戳"
    assert segments[0].start_ms == 0
    assert segments[0].end_ms == 0


def test_parse_funasr_result_empty_text():
    """Empty text should produce one empty segment."""
    transcriber = Transcriber()
    item = {"text": "", "timestamp": [[0, 100]]}
    segments = transcriber._parse_funasr_result(item)

    assert len(segments) == 1
    assert segments[0].text == ""
    assert segments[0].start_ms == 0
    assert segments[0].end_ms == 100


def test_parse_funasr_result_mixed_timestamps_treated_as_binary():
    """If some entries have 3 fields and some have 2, treat as binary (safer)."""
    transcriber = Transcriber()
    item = {
        "text": "混合时间戳",
        "timestamp": [[0, 500, "混"], [500, 1000]],  # inconsistent
    }
    segments = transcriber._parse_funasr_result(item)

    # All() returns False because second entry has only 2 fields
    assert len(segments) == 1
    assert segments[0].text == "混合时间戳"
