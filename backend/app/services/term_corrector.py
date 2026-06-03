import re
from typing import List, Optional
from app.config import DEEPSEEK_API_KEY, DEEPSEEK_BASE_URL, DEEPSEEK_MODEL


class TermCorrector:
    """Use DeepSeek API to correct ASR output.

    Two modes:
    1. correct_segments — per-chunk term correction (lightweight, fast)
    2. restructure_transcript — full-text restructuring: fix terms, reorder
       sentences, remove duplicates, merge fragments into coherent paragraphs
    """

    def __init__(self):
        self._client = None
        if DEEPSEEK_API_KEY:
            try:
                from openai import OpenAI
                self._client = OpenAI(api_key=DEEPSEEK_API_KEY, base_url=DEEPSEEK_BASE_URL)
            except ImportError:
                pass

    # ----------------------------------------------------------------
    # Full restructure — the main correction method
    # ----------------------------------------------------------------

    def restructure_transcript(
        self,
        text: str,
        course_title: str,
        keywords: Optional[List[str]] = None,
    ) -> str:
        """Restructure the full transcript: correct terms, reorder sentences,
        remove duplicates, merge fragments into coherent paragraphs.

        Returns a single restructured text string.
        """
        if not self._client or not text or not text.strip():
            return text

        keyword_str = "、".join(keywords) if keywords else "无"
        prompt = self._build_restructure_prompt(text, course_title, keyword_str)

        result = self._call_llm(
            prompt,
            "你是一个专业的课程笔记整理助手。你的任务是把语音识别的碎片化文本整理成条理清晰、逻辑通顺的课堂记录。",
            temperature=0.3,
        )
        return result if result else text

    # ----------------------------------------------------------------
    # Legacy per-segment correction (used for real-time streaming)
    # ----------------------------------------------------------------

    def correct_segments(
        self,
        text: str,
        course_title: str,
        keywords: Optional[List[str]] = None,
    ) -> str:
        """Quick per-chunk correction — just fix obvious errors, no restructuring."""
        if not self._client or not text or not text.strip():
            return text

        keyword_str = "、".join(keywords) if keywords else "无"
        prompt = self._build_quick_prompt(text, course_title, keyword_str)

        result = self._call_llm(
            prompt,
            "你是一个专业的术语纠错助手。只纠正明显的术语错误和语音识别导致的同音字错误，不要改变句子结构。",
            temperature=0.1,
        )
        return result if result else text

    # ----------------------------------------------------------------
    # LLM call
    # ----------------------------------------------------------------

    def _call_llm(self, prompt: str, system_msg: str, temperature: float = 0.2) -> str:
        """Call DeepSeek API and extract cleaned text from response."""
        response = self._client.chat.completions.create(
            model=DEEPSEEK_MODEL,
            messages=[
                {"role": "system", "content": system_msg},
                {"role": "user", "content": prompt},
            ],
            temperature=temperature,
        )
        content = response.choices[0].message.content.strip()
        corrected = re.sub(r'^```(?:\w+)?\n', '', content, flags=re.MULTILINE)
        corrected = re.sub(r'\n?```\s*$', '', corrected, flags=re.MULTILINE)
        return corrected.strip()

    # ----------------------------------------------------------------
    # Prompts
    # ----------------------------------------------------------------

    @staticmethod
    def _build_restructure_prompt(text: str, course_title: str, keywords: str) -> str:
        return f"""## 课程信息
- 课程名称：{course_title}
- 课程关键词：{keywords}

## 语音识别原始文本（碎片化的，可能存在重复、乱序、同音字错误）
{text}

## 任务
你是一个课堂笔记整理助手。上面的文本是语音识别从课堂录音中转写的，有以下问题：
1. 句子碎片化、不完整
2. 可能存在重复的内容
3. 句子顺序可能和实际讲课顺序不一致
4. 专业术语和同音字识别错误

请你：
1. **纠正术语错误**：根据课程信息修正同音字和专业名词错误（例如"项链法则"→"链式法则"，"提度下降"→"梯度下降"）
2. **合并碎片**：把破碎的短句合并成通顺的完整句子
3. **删除重复**：去掉明显重复的内容
4. **重新排序**：按照讲课的逻辑顺序重新组织内容
5. **保持完整**：不要遗漏重要知识点

注意：
- 保持口语化的课堂风格，不要变成教科书
- 保持数学公式、代码等技术内容的准确性
- **重要：必须按逻辑段落组织，每个段落独立成行，段落之间用一个空行分隔**
- 段落不要太长，每段3-5句话为宜
- 如果原文有标题、小标题、列表等结构，请保留

## 输出
直接输出整理后的完整课堂记录，不需要任何说明或前缀。"""

    @staticmethod
    def _build_quick_prompt(text: str, course_title: str, keywords: str) -> str:
        return f"""## 课程信息
- 课程名称：{course_title}
- 课程关键词：{keywords}

## 文本
{text}

## 任务
纠正上面文本中的语音识别错误（同音字、专业术语错误等）。
只纠正明显的错误，不要改变原句结构和顺序，不要添加内容。

## 输出
直接输出修正后的文本，不要加任何解释。"""


# Singleton instance
corrector = TermCorrector()
