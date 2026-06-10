"""Supplement tests for transcriber service covering model loading, transcription fallbacks, and streaming session."""

import os
import sys
from pathlib import Path
from unittest.mock import patch, MagicMock

import pytest

BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))

os.environ["SKIP_ASR_PRELOAD"] = "1"

from app.services.transcriber import Transcriber, ASRSegment, StreamingASRSession


class TestTranscriberLoadModel:
    def test_load_model_already_loaded(self):
        t = Transcriber()
        t._model_loaded = True
        with patch("app.services.transcriber.AutoModel") as mock_auto:
            t._load_model()
            mock_auto.assert_not_called()

    def test_load_model_funasr_unavailable(self):
        t = Transcriber()
        t._model_loaded = False
        with patch("app.services.transcriber._FUNASR_AVAILABLE", False):
            t._load_model()
            assert t._model is None

    def test_load_model_exception(self):
        t = Transcriber()
        with patch("app.services.transcriber._FUNASR_AVAILABLE", True), \
             patch("app.services.transcriber.AutoModel", side_effect=Exception("boom")):
            t._load_model()
            assert t._model is None

    def test_load_streaming_model_already_loaded(self):
        t = Transcriber()
        t._streaming_model_loaded = True
        with patch("app.services.transcriber.AutoModel") as mock_auto:
            t._load_streaming_model()
            mock_auto.assert_not_called()


class TestTranscribeWithFunasr:
    def test_file_not_found(self):
        t = Transcriber()
        result = t._transcribe_with_funasr("/nonexistent/file.wav")
        assert result == []

    def test_funasr_unavailable(self):
        t = Transcriber()
        with patch("app.services.transcriber._FUNASR_AVAILABLE", False):
            result = t._transcribe_with_funasr(__file__)
            assert result == []

    def test_model_load_fails(self):
        t = Transcriber()
        with patch("app.services.transcriber._FUNASR_AVAILABLE", True), \
             patch.object(t, "_model", None), \
             patch.object(t, "_model_loaded", False), \
             patch("app.services.transcriber.AutoModel", side_effect=Exception("boom")):
            result = t._transcribe_with_funasr(__file__)
            assert result == []

    def test_success_with_list_result(self):
        t = Transcriber()
        mock_model = MagicMock()
        mock_model.generate.return_value = [
            {"text": "hello world", "timestamp": [[0, 500, "hello"], [500, 1000, "world"]]}
        ]
        with patch("app.services.transcriber._FUNASR_AVAILABLE", True), \
             patch.object(t, "_model", mock_model), \
             patch.object(t, "_model_loaded", True):
            result = t._transcribe_with_funasr(__file__)
            assert len(result) == 2
            assert result[0].text == "hello"

    def test_success_with_dict_result(self):
        t = Transcriber()
        mock_model = MagicMock()
        mock_model.generate.return_value = {
            "text": "hello world",
            "timestamp": [[0, 1000]],
        }
        with patch("app.services.transcriber._FUNASR_AVAILABLE", True), \
             patch.object(t, "_model", mock_model), \
             patch.object(t, "_model_loaded", True):
            result = t._transcribe_with_funasr(__file__)
            assert len(result) == 1
            assert result[0].text == "hello world"

    def test_empty_result(self):
        t = Transcriber()
        mock_model = MagicMock()
        mock_model.generate.return_value = []
        with patch("app.services.transcriber._FUNASR_AVAILABLE", True), \
             patch.object(t, "_model", mock_model), \
             patch.object(t, "_model_loaded", True):
            result = t._transcribe_with_funasr(__file__)
            assert result == []


class TestTranscribeWithDashscope:
    def test_no_api_key(self):
        t = Transcriber()
        with patch("app.services.transcriber.DASHSCOPE_API_KEY", ""):
            result = t._transcribe_with_dashscope(__file__)
            assert result == []

    def test_success(self):
        t = Transcriber()
        mock_result = MagicMock()
        mock_result.output = {
            "sentences": [
                {"text": "hello", "begin_time": 0, "end_time": 1000},
            ]
        }
        mock_recognizer = MagicMock()
        mock_recognizer.call.return_value = mock_result

        with patch("app.services.transcriber.DASHSCOPE_API_KEY", "test-key"), \
             patch("dashscope.audio.asr.Recognition", return_value=mock_recognizer):
            result = t._transcribe_with_dashscope(__file__)
            assert len(result) == 1
            assert result[0].text == "hello"

    def test_exception_returns_empty(self):
        t = Transcriber()
        with patch("app.services.transcriber.DASHSCOPE_API_KEY", "test-key"), \
             patch("dashscope.audio.asr.Recognition", side_effect=Exception("boom")):
            result = t._transcribe_with_dashscope(__file__)
            assert result == []


class TestTranscribeWithWhisperAPI:
    def test_no_api_key(self):
        t = Transcriber()
        with patch("app.services.transcriber.DASHSCOPE_API_KEY", ""):
            result = t._transcribe_with_whisper_api(__file__)
            assert result == []

    def test_success_with_segments(self):
        t = Transcriber()
        mock_seg = MagicMock()
        mock_seg.text = "hello"
        mock_seg.start = 0
        mock_seg.end = 1
        mock_response = MagicMock()
        mock_response.segments = [mock_seg]
        mock_client = MagicMock()
        mock_client.audio.transcriptions.create.return_value = mock_response

        with patch("app.services.transcriber.DASHSCOPE_API_KEY", "test-key"), \
             patch("openai.OpenAI", return_value=mock_client):
            result = t._transcribe_with_whisper_api(__file__)
            assert len(result) == 1
            assert result[0].text == "hello"

    def test_success_with_text_only(self):
        t = Transcriber()
        # Use a plain object without 'segments' so hasattr(response, 'segments') is False
        class FakeResponse:
            text = "hello world"
        mock_client = MagicMock()
        mock_client.audio.transcriptions.create.return_value = FakeResponse()

        with patch("app.services.transcriber.DASHSCOPE_API_KEY", "test-key"), \
             patch("openai.OpenAI", return_value=mock_client):
            result = t._transcribe_with_whisper_api(__file__)
            assert len(result) == 1
            assert result[0].text == "hello world"

    def test_exception_returns_empty(self):
        t = Transcriber()
        with patch("app.services.transcriber.DASHSCOPE_API_KEY", "test-key"), \
             patch("openai.OpenAI", side_effect=Exception("boom")):
            result = t._transcribe_with_whisper_api(__file__)
            assert result == []


class TestTranscribeMain:
    def test_file_not_found(self):
        t = Transcriber()
        result = t.transcribe("/nonexistent.wav")
        assert result == []

    def test_funasr_success(self):
        t = Transcriber()
        mock_model = MagicMock()
        mock_model.generate.return_value = [{"text": "ok", "timestamp": [[0, 100]]}]
        with patch("app.services.transcriber._FUNASR_AVAILABLE", True), \
             patch.object(t, "_model", mock_model), \
             patch.object(t, "_model_loaded", True):
            result = t.transcribe(__file__)
            assert len(result) == 1

    def test_fallback_to_dashscope(self):
        t = Transcriber()
        with patch("app.services.transcriber._FUNASR_AVAILABLE", True), \
             patch.object(t, "_model", None), \
             patch.object(t, "_model_loaded", True), \
             patch("app.services.transcriber.DASHSCOPE_API_KEY", "test-key"):
            mock_result = MagicMock()
            mock_result.output = {"sentences": [{"text": "fallback", "begin_time": 0, "end_time": 1000}]}
            mock_recognizer = MagicMock()
            mock_recognizer.call.return_value = mock_result
            with patch("dashscope.audio.asr.Recognition", return_value=mock_recognizer):
                result = t.transcribe(__file__)
                assert len(result) == 1
                assert result[0].text == "fallback"

    def test_all_methods_fail(self):
        t = Transcriber()
        with patch("app.services.transcriber._FUNASR_AVAILABLE", False), \
             patch("app.services.transcriber.DASHSCOPE_API_KEY", ""):
            result = t.transcribe(__file__)
            assert result == []


class TestStreamingASRSession:
    def test_feed_pcm_basic(self):
        mock_model = MagicMock()
        mock_model.generate.return_value = [{"text": "hello"}]
        session = StreamingASRSession(mock_model)

        # Need enough bytes for one chunk: 9600 samples * 2 bytes
        pcm = b"\x00" * (9600 * 2)
        text, is_final = session.feed_pcm(pcm)
        assert text == "hello"
        assert is_final is False

    def test_feed_pcm_silence_final(self):
        mock_model = MagicMock()
        mock_model.generate.return_value = [{"text": "hello"}]
        session = StreamingASRSession(mock_model)

        pcm = b"\x00" * (9600 * 2)
        session.feed_pcm(pcm)

        # Simulate silence: feed empty bytes after a long delay would require time manipulation,
        # so we directly set internal state to trigger finalization.
        session._last_text_at_ms = 0.0
        session._total_ms = 1000.0  # > SILENCE_FINALIZE_MS (800)
        text, is_final = session.feed_pcm(b"")
        assert is_final is True
        assert session._accumulated_text == ""

    def test_finalize_with_buffer(self):
        mock_model = MagicMock()
        mock_model.generate.return_value = [{"text": "world"}]
        session = StreamingASRSession(mock_model)

        session._buffer = b"\x00" * 3200
        session._accumulated_text = "hello"
        segs = session.finalize()
        assert len(segs) == 1
        assert segs[0].text == "helloworld"

    def test_finalize_no_accumulated_text(self):
        mock_model = MagicMock()
        session = StreamingASRSession(mock_model)
        segs = session.finalize()
        assert segs == []

    def test_recognize_chunk_exception(self):
        mock_model = MagicMock()
        mock_model.generate.side_effect = Exception("boom")
        session = StreamingASRSession(mock_model)
        result = session._recognize_chunk(b"\x00", is_final=False)
        assert result == ""

    def test_recognize_chunk_empty_result(self):
        mock_model = MagicMock()
        mock_model.generate.return_value = []
        session = StreamingASRSession(mock_model)
        result = session._recognize_chunk(b"\x00", is_final=False)
        assert result == ""

    def test_create_streaming_session(self):
        t = Transcriber()
        mock_model = MagicMock()
        with patch.object(t, "_streaming_model", mock_model), \
             patch.object(t, "_streaming_model_loaded", True):
            session = t.create_streaming_session()
            assert isinstance(session, StreamingASRSession)

    def test_create_streaming_session_no_model(self):
        t = Transcriber()
        with patch.object(t, "_streaming_model", None), \
             patch.object(t, "_streaming_model_loaded", True):
            with pytest.raises(RuntimeError, match="Streaming model not available"):
                t.create_streaming_session()
