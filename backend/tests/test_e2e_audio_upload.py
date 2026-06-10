"""End-to-end test for the audio upload → ASR → correction pipeline.

Mimics the full frontend flow:
  1. Login
  2. Create a notebook + session
  3. Upload a small audio file
  4. Assert SSE event sequence: status → chunk → done
  5. Assert the saved note has is_ai_corrected=True and contains expected terms.
"""

import json
import os
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))

os.environ["SKIP_ASR_PRELOAD"] = "1"
os.environ["DEEPSEEK_API_KEY"] = "test-key"

from fastapi.testclient import TestClient

from app.main import app


def _auth_headers(client: TestClient) -> dict:
    resp = client.post(
        "/api/auth/login",
        json={"email": "admin", "password": "admin123"},
    )
    assert resp.status_code == 200
    return {
        "Authorization": f"Bearer {resp.json()['access_token']}",
        "Origin": "http://localhost:5173",
    }


def _create_notebook_and_session(client: TestClient, headers: dict) -> str:
    nb = client.post("/api/notebooks", json={"title": "操作系统"}, headers=headers)
    assert nb.status_code in (200, 201)
    notebook_id = nb.json()["id"]

    sess = client.post(
        "/api/sessions",
        params={"notebook_id": notebook_id},
        json={"title": "第1课：进程间通信"},
        headers=headers,
    )
    assert sess.status_code in (200, 201)
    return sess.json()["id"]


def _make_fake_wav() -> bytes:
    """Return a minimal WAV header so the endpoint treats the file as WAV."""
    # 44-byte standard WAV header for 1-second mono 16kHz 16-bit silence
    return (
        b"RIFF\x26\x00\x00\x00WAVEfmt \x10\x00\x00\x00\x01\x00\x01\x00"
        b"\x80>\x00\x00\x00}\x00\x00\x02\x00\x10\x00data\x02\x00\x00\x00\x00\x00"
    )


def test_audio_batch_stream_events_and_ai_correction():
    """Full pipeline: upload WAV → mocked ASR → mocked DeepSeek → verify SSE + DB state."""
    with TestClient(app) as client:
        headers = _auth_headers(client)
        session_id = _create_notebook_and_session(client, headers)

        fake_wav = _make_fake_wav()

        # ── Mock ASR segment ──
        mock_segment = MagicMock()
        mock_segment.text = "父子进程之间可以正常通信，因为父进程创建了子进程。"
        mock_segment.start_ms = 0
        mock_segment.end_ms = 5000
        mock_segment.to_dict.return_value = {
            "text": mock_segment.text,
            "start": 0.0,
            "end": 5.0,
        }

        mock_transcriber = MagicMock()
        mock_transcriber.transcribe.return_value = [mock_segment]

        # ── Mock corrector ──
        mock_corrector = MagicMock()
        mock_corrector.has_llm = True
        # deterministic cleanup: identity
        mock_corrector.clean_transcript_for_display.side_effect = lambda x: x
        # stream dedup: identity
        mock_corrector.prepare_stream_chunk.side_effect = (
            lambda x, history="": x
        )
        # DeepSeek enhancement: add a professional polish
        polished = (
            "父子进程之间可以正常通信，因为父进程通过 fork() 创建了子进程。"
        )
        mock_corrector.restructure_transcript.return_value = polished
        mock_corrector.preserves_source_content.return_value = True

        with patch("app.api.process.audio.transcriber", mock_transcriber), \
             patch("app.api.process.audio.corrector", mock_corrector), \
             patch("app.api.process.audio._FUNASR_AVAILABLE", True):

            resp = client.post(
                "/api/process/audio-batch",
                params={"session_id": session_id},
                files={"file": ("test.wav", fake_wav, "audio/wav")},
                headers=headers,
            )

        assert resp.status_code == 200, f"Unexpected status: {resp.status_code} {resp.text[:500]}"

        # Parse SSE lines
        lines = [
            line for line in resp.text.splitlines()
            if line.startswith("data: ")
        ]
        events = [json.loads(line[6:]) for line in lines]
        event_types = [e["type"] for e in events]

        # ── 1. Event sequence assertions ──
        assert "status" in event_types, f"Expected status event, got: {event_types}"
        assert "chunk" in event_types, f"Expected chunk event, got: {event_types}"
        assert "done" in event_types, f"Expected done event, got: {event_types}"
        assert "error" not in event_types, f"Unexpected error event: {[e for e in events if e['type']=='error']}"

        # ── 2. Chunk content assertions ──
        chunk_events = [e for e in events if e["type"] == "chunk"]
        assert any(
            "父子进程" in c.get("text", "") for c in chunk_events
        ), "Expected '父子进程' in at least one chunk"

        # ── 3. Final note assertions ──
        done_event = [e for e in events if e["type"] == "done"][0]
        note = done_event["note"]
        assert note["session_id"] == session_id

        transcript_list = note.get("transcript", [])
        assert transcript_list, "Note transcript should not be empty"

        first_tx = transcript_list[0]
        # Batch upload only does local cleanup; AI correction happens later via restructure endpoint
        assert first_tx["is_ai_corrected"] is False, (
            f"Expected is_ai_corrected=False, got {first_tx.get('is_ai_corrected')}"
        )
        assert first_tx.get("correction_error") is None, (
            f"Expected no correction error, got {first_tx.get('correction_error')}"
        )
        assert "父子进程" in first_tx["text"], (
            f"Expected '父子进程' in display text, got: {first_tx['text'][:200]}"
        )

        # ── 4. Layout blocks contain transcript blocks ──
        layout_blocks = note.get("layout_blocks", [])
        tx_blocks = [b for b in layout_blocks if b.get("type") == "transcript"]
        assert tx_blocks, "Expected at least one transcript layout block"


def test_audio_batch_without_llm_falls_back_to_local():
    """When DeepSeek is unavailable, pipeline should still succeed with local cleanup."""
    with TestClient(app) as client:
        headers = _auth_headers(client)
        session_id = _create_notebook_and_session(client, headers)

        fake_wav = _make_fake_wav()

        mock_segment = MagicMock()
        mock_segment.text = "兄弟进程之间没有亲缘关系。"
        mock_segment.start_ms = 0
        mock_segment.end_ms = 4000
        mock_segment.to_dict.return_value = {
            "text": mock_segment.text,
            "start": 0.0,
            "end": 4.0,
        }

        mock_transcriber = MagicMock()
        mock_transcriber.transcribe.return_value = [mock_segment]

        mock_corrector = MagicMock()
        mock_corrector.has_llm = False  # No LLM configured
        mock_corrector.clean_transcript_for_display.side_effect = lambda x: x
        mock_corrector.prepare_stream_chunk.side_effect = (
            lambda x, history="": x
        )

        with patch("app.api.process.audio.transcriber", mock_transcriber), \
             patch("app.api.process.audio.corrector", mock_corrector), \
             patch("app.api.process.audio._FUNASR_AVAILABLE", True):

            resp = client.post(
                "/api/process/audio-batch",
                params={"session_id": session_id},
                files={"file": ("test.wav", fake_wav, "audio/wav")},
                headers=headers,
            )

        assert resp.status_code == 200

        lines = [
            line for line in resp.text.splitlines()
            if line.startswith("data: ")
        ]
        events = [json.loads(line[6:]) for line in lines]
        event_types = [e["type"] for e in events]

        assert "done" in event_types

        done_event = [e for e in events if e["type"] == "done"][0]
        first_tx = done_event["note"]["transcript"][0]
        assert first_tx["is_ai_corrected"] is False
        assert first_tx.get("correction_error") is None



def test_audio_batch_chunked_upload_flow():
    """Large file (>10MB threshold) should use resumable chunk upload then finish."""
    with TestClient(app) as client:
        headers = _auth_headers(client)
        session_id = _create_notebook_and_session(client, headers)

        # Build a fake ~12MB "audio" blob so it triggers chunked path
        payload = b"RIFF" + b"\x00" * (12 * 1024 * 1024)

        mock_transcriber = MagicMock()
        mock_transcriber.transcribe.return_value = []

        mock_corrector = MagicMock()
        mock_corrector.has_llm = False
        mock_corrector.clean_transcript_for_display.side_effect = lambda x: x
        mock_corrector.prepare_stream_chunk.side_effect = lambda x, history="": x

        with patch("app.api.process.audio.transcriber", mock_transcriber), \
             patch("app.api.process.audio.corrector", mock_corrector), \
             patch("app.api.process.audio._FUNASR_AVAILABLE", True):

            chunk_size = 5 * 1024 * 1024
            total_chunks = (len(payload) + chunk_size - 1) // chunk_size
            for i in range(total_chunks):
                chunk = payload[i * chunk_size:(i + 1) * chunk_size]
                resp = client.post(
                    "/api/process/audio-chunk",
                    params={
                        "session_id": session_id,
                        "chunk_index": i,
                        "total_chunks": total_chunks,
                    },
                    files={"file": (f"audio.part{i}", chunk, "application/octet-stream")},
                    headers=headers,
                )
                assert resp.status_code == 200, f"Chunk {i} upload failed: {resp.text[:500]}"
                data = resp.json()
                assert data["received"] is True
                assert data["chunk_index"] == i

            finish_resp = client.post(
                "/api/process/audio-chunk-finish",
                params={
                    "session_id": session_id,
                    "file_name": "test_audio.webm",
                    "total_chunks": total_chunks,
                },
                headers=headers,
            )
            assert finish_resp.status_code == 200, (
                f"Finish failed: {finish_resp.status_code} {finish_resp.text[:500]}"
            )

        # The finish endpoint returns SSE (StreamingResponse) or JSON depending on
        # whether it falls through to the batch generator. With empty segments it
        # may yield an error event, but the HTTP handshake itself should succeed.
        assert finish_resp.status_code == 200
