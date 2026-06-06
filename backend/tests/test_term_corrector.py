import asyncio
import sys
import time
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))

from app.services.term_corrector import corrector


def test_clean_transcript_for_display_removes_oral_noise_without_artifacts():
    text = (
        "义，这个速度OK啊，那同样的就是这样的啊，是吧？"
        "就这样的啊，没有什么区别，跟父子进程上没有什么区别。"
        "关键的是另外一个区别来了啊，说不是亲戚关系的怎么办？"
    )

    result = corrector.clean_transcript_for_display(text)

    assert "OK啊" not in result
    assert "是吧" not in result
    assert "就的啊" not in result
    assert "？？" not in result
    assert "父子进程" in result
    assert "亲戚关系" in result


def test_clean_transcript_for_display_dedupes_repeated_sentences():
    text = (
        "父子进程之间可以正常通信，因为父进程创建了子进程。"
        "父子进程之间可以正常通信，因为父进程创建了子进程。"
        "兄弟进程之间没有亲缘关系，需要借助命名管道通信。"
    )

    result = corrector.clean_transcript_for_display(text)

    assert result.count("父子进程之间可以正常通信") == 1
    assert "兄弟进程" in result
    assert "命名管道" in result


def test_clean_transcript_for_display_keeps_new_knowledge():
    text = (
        "匿名管道只能用于有亲缘关系的进程通信。"
        "命名管道可以让没有亲缘关系的进程通信。"
    )

    result = corrector.clean_transcript_for_display(text)

    assert "匿名管道" in result
    assert "命名管道" in result


def test_clean_transcript_for_display_collapses_short_sentence_loops():
    text = (
        "所以这个管道的阀门它完美的给复制过来了。"
        "但是现在如果没有亲戚关系，就没有。"
        "什么问题？复制关系了，那么怎么办？"
        "哎，他有一个新的兄弟，原来那种管道没有给他起过任何的名字，"
        "那我们叫做无名管道。"
        "复制关系了，那么怎么办？复制关系了，那么怎么办？"
        "复制关系了，那么怎么办？"
        "\n\n"
        "哎，他有一个新的兄弟，原来那种管道没有给他起过任何的名字，"
        "那我们叫做无名管道。复制关系了，那么怎么办？"
    )

    result = corrector.clean_transcript_for_display(text)

    assert result.count("复制关系") <= 1
    assert result.count("无名管道") == 1
    assert "阀门" in result


def test_clean_transcript_for_display_collapses_near_duplicate_short_questions():
    text = (
        "复制关系了，那么怎么办？"
        "复制关系了，那怎么办？"
        "复制关系了，怎么办？"
        "复制关系了，那么怎么办？"
    )

    result = corrector.clean_transcript_for_display(text)

    assert result.count("复制关系") == 1


def test_clean_transcript_for_display_collapses_exact_tiny_prompt_loops():
    text = (
        "所以这个管道的阀门已经复制过来了。"
        "什么问题？什么问题？什么问题？什么问题？"
        "没有血缘关系的进程之间，可以使用命名管道通信。"
    )

    result = corrector.clean_transcript_for_display(text)

    assert result.count("什么问题") == 1
    assert "命名管道" in result


def test_prepare_stream_chunk_strips_cumulative_history_prefix():
    history = (
        "所以这个管道的阀门已经复制过来了。"
        "但是现在如果没有亲缘关系，就没有。"
    )
    candidate = (
        "所以这个管道的阀门已经复制过来了。"
        "但是现在如果没有亲缘关系，就没有。"
        "原来那种管道没有名字，我们叫做无名管道。"
    )

    result = corrector.prepare_stream_chunk(candidate, history)

    assert "阀门已经复制过来了" not in result
    assert "无名管道" in result


def test_prepare_stream_chunk_drops_already_displayed_sentence():
    history = "父子进程通过匿名管道通信。"
    candidate = "父子进程通过匿名管道通信。"

    assert corrector.prepare_stream_chunk(candidate, history) == ""


def test_dedupe_asr_segments_removes_near_duplicate_segments():
    class Segment:
        def __init__(self, text):
            self.text = text

    segments = [
        Segment("复制关系了，那么怎么办？"),
        Segment("复制关系了，那怎么办？"),
        Segment("我们把这种管道叫做无名管道。"),
    ]

    result = corrector.dedupe_asr_segments(segments)

    assert [seg.text for seg in result] == [
        "复制关系了，那么怎么办？",
        "我们把这种管道叫做无名管道。",
    ]


def test_preserves_source_content_allows_deduped_repetitive_source():
    source = (
        "命名管道可以让没有血缘关系的进程通信。"
        "复制关系了，那么怎么办？复制关系了，那么怎么办？"
        "复制关系了，那么怎么办？"
    )
    candidate = "命名管道可以让没有血缘关系的进程通信。"

    assert corrector.preserves_source_content(source, candidate, min_ratio=0.80)


def test_audio_stream_correction_helper_uses_ai_when_available(monkeypatch):
    from app.api.process import audio

    class FakeCorrector:
        has_llm = True

        def clean_transcript_for_display(self, text):
            return text.replace("OK啊", "").strip()

        def restructure_transcript(self, text, course_title, keywords, ppt_slides=None):
            return "父子进程可以通过管道通信。"

        def preserves_source_content(self, source, candidate, min_ratio=0.60):
            return True

    monkeypatch.setattr(audio, "corrector", FakeCorrector())

    result = asyncio.run(audio._correct_window_for_stream("父子进程OK啊。", "操作系统", []))

    assert result["text"] == "父子进程可以通过管道通信。"
    assert result["is_ai_corrected"] is True
    assert result["correction_error"] is None


def test_audio_stream_correction_helper_falls_back_on_ai_error(monkeypatch):
    from app.api.process import audio

    class FakeCorrector:
        has_llm = True

        def clean_transcript_for_display(self, text):
            return text.replace("OK啊", "").strip()

        def restructure_transcript(self, text, course_title, keywords, ppt_slides=None):
            raise RuntimeError("network failed")

        def preserves_source_content(self, source, candidate, min_ratio=0.60):
            return True

    monkeypatch.setattr(audio, "corrector", FakeCorrector())

    result = asyncio.run(audio._correct_window_for_stream("父子进程OK啊。", "操作系统", []))

    assert result["text"] == "父子进程。"
    assert result["is_ai_corrected"] is False
    assert "AI 整理失败" in result["correction_error"]


def test_audio_stream_correction_helper_falls_back_on_ai_timeout(monkeypatch):
    from app.api.process import audio

    class FakeCorrector:
        has_llm = True

        def clean_transcript_for_display(self, text):
            return text.replace("OK啊", "").strip()

        def restructure_transcript(self, text, course_title, keywords, ppt_slides=None):
            time.sleep(0.05)
            return "too late"

        def preserves_source_content(self, source, candidate, min_ratio=0.60):
            return True

    monkeypatch.setattr(audio, "corrector", FakeCorrector())

    result = asyncio.run(
        audio._correct_window_for_stream("父子进程OK啊。", "操作系统", [], timeout_seconds=0.001)
    )

    assert result["text"] == "父子进程。"
    assert result["is_ai_corrected"] is False
    assert "超时" in result["correction_error"]


def test_audio_final_display_helper_uses_whole_text_for_ai(monkeypatch):
    from app.api.process import audio

    class FakeCorrector:
        has_llm = True

        def clean_transcript_for_display(self, text):
            return text.replace("OK啊", "").strip()

        def restructure_transcript(self, text, course_title, keywords, ppt_slides=None):
            assert "第一段" in text
            assert "第二段" in text
            return "第一段知识。\n\n第二段知识。"

        def preserves_source_content(self, source, candidate, min_ratio=0.65):
            return True

    monkeypatch.setattr(audio, "corrector", FakeCorrector())

    result = asyncio.run(
        audio._finalize_display_text_for_stream(
            raw_text="第一段OK啊。第二段OK啊。",
            display_source="第一段OK啊。\n\n第二段OK啊。",
            course_title="操作系统",
            keywords=[],
        )
    )

    assert result["text"] == "第一段知识。\n\n第二段知识。"
    assert result["is_ai_corrected"] is True
    assert result["correction_error"] is None


def test_audio_final_display_helper_falls_back_when_ai_rejected(monkeypatch):
    from app.api.process import audio

    class FakeCorrector:
        has_llm = True

        def clean_transcript_for_display(self, text):
            return text.replace("OK啊", "").strip()

        def restructure_transcript(self, text, course_title, keywords, ppt_slides=None):
            return "本节课讲了管道。"

        def preserves_source_content(self, source, candidate, min_ratio=0.65):
            return False

    monkeypatch.setattr(audio, "corrector", FakeCorrector())

    result = asyncio.run(
        audio._finalize_display_text_for_stream(
            raw_text="第一段OK啊。第二段OK啊。",
            display_source="第一段OK啊。\n\n第二段OK啊。",
            course_title="操作系统",
            keywords=[],
        )
    )

    assert result["text"] == "第一段。\n\n第二段。"
    assert result["is_ai_corrected"] is False
    assert "疑似删减" in result["correction_error"]
