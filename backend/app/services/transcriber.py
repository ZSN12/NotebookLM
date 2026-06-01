import os
import tempfile
from typing import List, Optional
from app.config import DASHSCOPE_API_KEY

try:
    from funasr import AutoModel
    _FUNASR_AVAILABLE = True
except ImportError:
    _FUNASR_AVAILABLE = False

try:
    from dashscope.audio import asr
    _DASHSCOPE_ASR_AVAILABLE = True
except ImportError:
    _DASHSCOPE_ASR_AVAILABLE = False


class ASRSegment:
    """Single transcribed segment with timestamps."""
    def __init__(self, text: str, start_ms: int, end_ms: int):
        self.text = text
        self.start_ms = start_ms
        self.end_ms = end_ms

    def to_dict(self) -> dict:
        return {
            "text": self.text,
            "start_ms": self.start_ms,
            "end_ms": self.end_ms,
        }


class Transcriber:
    """Speech-to-text service with FunASR fallback to DashScope cloud API."""

    def __init__(self):
        self._model = None
        self._model_loaded = False

    def _load_model(self):
        if self._model_loaded:
            return
        if _FUNASR_AVAILABLE:
            try:
                self._model = AutoModel(
                    model="paraformer-zh",
                    vad_model="fsmn-vad",
                    punc_model="ct-punc",
                    disable_update=True,
                )
                print("[INFO] FunASR model loaded successfully")
                self._model_loaded = True
            except Exception as e:
                print(f"[ERROR] FunASR model load failed: {e}")
                self._model = None

    def _transcribe_with_funasr(self, audio_path: str) -> List[ASRSegment]:
        """Use local FunASR model for transcription."""
        if not _FUNASR_AVAILABLE or not os.path.exists(audio_path):
            return []

        self._load_model()
        if not self._model:
            return []

        result = self._model.generate(
            input=audio_path,
            language="zh",
            use_itn=True,
            batch_size_s=120,
        )

        segments = []
        if isinstance(result, list):
            for item in result:
                segments.extend(self._parse_funasr_result(item))
        elif isinstance(result, dict):
            segments = self._parse_funasr_result(result)

        return segments

    def _transcribe_with_dashscope(self, audio_path: str) -> List[ASRSegment]:
        """Use DashScope cloud ASR API for transcription."""
        if not DASHSCOPE_API_KEY:
            print("[WARN] DASHSCOPE_API_KEY not configured, skipping cloud ASR fallback")
            return []

        try:
            from dashscope.audio.asr import Recognition
            recognizer = Recognition(
                model='paraformer-realtime-v2',
                format='webm',
                sample_rate=16000,
                callback=None,
            )
            result = recognizer.call(audio_path)

            if result and hasattr(result, 'output') and result.output:
                segments = []
                for sentence in result.output.get('sentences', []):
                    text = sentence.get('text', '')
                    start_ms = int(sentence.get('begin_time', 0))
                    end_ms = int(sentence.get('end_time', 0))
                    if text.strip():
                        segments.append(ASRSegment(text=text, start_ms=start_ms, end_ms=end_ms))
                return segments
        except Exception as e:
            print(f"[ERROR] DashScope ASR failed: {e}")
        return []

    def _transcribe_with_whisper_api(self, audio_path: str) -> List[ASRSegment]:
        """Use OpenAI-compatible Whisper API as fallback."""
        if not DASHSCOPE_API_KEY:
            return []

        try:
            from openai import OpenAI
            client = OpenAI(
                api_key=DASHSCOPE_API_KEY,
                base_url="https://dashscope.aliyuncs.com/compatible-mode/v1",
            )

            with open(audio_path, 'rb') as f:
                response = client.audio.transcriptions.create(
                    model="paraformer-v2",
                    file=f,
                    language="zh",
                    response_format="verbose_json",
                )

            segments = []
            if hasattr(response, 'segments'):
                for seg in response.segments:
                    text = seg.get('text', '') if isinstance(seg, dict) else getattr(seg, 'text', '')
                    start = seg.get('start', 0) if isinstance(seg, dict) else getattr(seg, 'start', 0)
                    end = seg.get('end', 0) if isinstance(seg, dict) else getattr(seg, 'end', 0)
                    if text.strip():
                        segments.append(ASRSegment(text=text, start_ms=int(start * 1000), end_ms=int(end * 1000)))
            elif hasattr(response, 'text') and response.text:
                segments.append(ASRSegment(text=response.text.strip(), start_ms=0, end_ms=0))

            return segments
        except Exception as e:
            print(f"[ERROR] Whisper API transcription failed: {e}")
        return []

    def transcribe(self, audio_path: str) -> List[ASRSegment]:
        """Transcribe audio file to segments with timestamps.

        Tries FunASR first, then DashScope cloud API, then Whisper API.

        Args:
            audio_path: Path to audio file (supports wav, mp3, webm, m4a, flac, ogg).

        Returns:
            List of ASRSegment with text and time info.
        """
        if not os.path.exists(audio_path):
            print(f"[ERROR] Audio file not found: {audio_path}")
            return []

        # Try FunASR first
        if _FUNASR_AVAILABLE:
            print("[DEBUG] Trying FunASR local model...")
            segments = self._transcribe_with_funasr(audio_path)
            if segments:
                return segments
            print("[DEBUG] FunASR returned no results")

        # Try DashScope cloud API
        if DASHSCOPE_API_KEY:
            print("[DEBUG] Trying DashScope cloud ASR...")
            segments = self._transcribe_with_dashscope(audio_path)
            if segments:
                return segments
            print("[DEBUG] DashScope ASR returned no results")

            print("[DEBUG] Trying DashScope Whisper-compatible API...")
            segments = self._transcribe_with_whisper_api(audio_path)
            if segments:
                return segments

        print("[ERROR] All transcription methods failed")
        return []

    def _parse_funasr_result(self, item: dict) -> List[ASRSegment]:
        """Parse FunASR result dict into ASRSegment list."""
        segments = []
        text = item.get("text", "")
        timestamp = item.get("timestamp", [])

        if timestamp:
            for ts in timestamp:
                seg = ASRSegment(
                    text=ts[2] if len(ts) > 2 else text,
                    start_ms=int(ts[0]),
                    end_ms=int(ts[1]),
                )
                segments.append(seg)
        else:
            segments.append(ASRSegment(text=text, start_ms=0, end_ms=0))

        return segments

    def transcribe_from_bytes(self, audio_bytes: bytes, file_ext: str = ".wav") -> List[ASRSegment]:
        """Transcribe from in-memory audio bytes.

        Args:
            audio_bytes: Raw audio data.
            file_ext: File extension for temp file (default .wav).

        Returns:
            List of ASRSegment.
        """
        tmp_path = None
        try:
            with tempfile.NamedTemporaryFile(suffix=file_ext, delete=False) as f:
                f.write(audio_bytes)
                f.flush()
                tmp_path = f.name
            return self.transcribe(tmp_path)
        finally:
            if tmp_path and os.path.exists(tmp_path):
                try:
                    os.unlink(tmp_path)
                except OSError:
                    pass


# Singleton instance
transcriber = Transcriber()
