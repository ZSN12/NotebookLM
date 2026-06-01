"""PPT service: text extraction, keyword analysis, and slide-to-image rendering.

Slide images are saved as PNG files to disk (not base64 in the database).
"""

import os
import re
import shutil
from typing import List, Optional
from collections import Counter
from pptx import Presentation
from PIL import Image


def _render_slides_via_powerpoint(ppt_path: str, output_dir: str, slide_count: int) -> bool:
    """Render each slide as PNG via PowerPoint COM. Returns True on success."""
    try:
        import pythoncom
        import win32com.client

        pythoncom.CoInitialize()
        powerpoint = None
        presentation = None
        try:
            powerpoint = win32com.client.Dispatch("PowerPoint.Application")
            try:
                powerpoint.Visible = False
            except Exception:
                pass

            presentation = powerpoint.Presentations.Open(os.path.abspath(ppt_path), WithWindow=False)

            for i in range(1, slide_count + 1):
                slide = presentation.Slides(i)
                img_file = os.path.join(output_dir, f"slide_{i:02d}.png")
                slide.Export(img_file, "PNG")
                if os.path.exists(img_file):
                    img = Image.open(img_file)
                    max_width = 1400
                    if img.width > max_width:
                        ratio = max_width / img.width
                        new_height = int(img.height * ratio)
                        img = img.resize((max_width, new_height), Image.LANCZOS)
                        img.save(img_file, format="PNG")

            return True
        finally:
            if presentation is not None:
                try:
                    presentation.Close()
                except Exception:
                    pass
            if powerpoint is not None:
                try:
                    powerpoint.Quit()
                except Exception:
                    pass
            pythoncom.CoUninitialize()
    except Exception as e:
        print(f"[WARN] PowerPoint COM rendering failed: {e}")
        return False


def extract_text_from_slide(slide) -> str:
    """Extract all text from a slide (text boxes, tables, notes)."""
    texts = []
    for shape in slide.shapes:
        if shape.has_text_frame:
            for paragraph in shape.text_frame.paragraphs:
                text = paragraph.text.strip()
                if text:
                    texts.append(text)
        if hasattr(shape, "table") and shape.table:
            for row in shape.table.rows:
                for cell in row.cells:
                    text = cell.text.strip()
                    if text:
                        texts.append(text)
    if slide.has_notes_slide and slide.notes_slide.notes_text_frame:
        notes_text = slide.notes_slide.notes_text_frame.text.strip()
        if notes_text:
            texts.append(f"备注: {notes_text}")
    return "\n".join(texts)


def extract_keywords_from_ppt(ppt_path: str, course_title: str) -> List[str]:
    """Extract potential domain keywords from PPT content."""
    prs = Presentation(ppt_path)
    all_text = ""
    for slide in prs.slides:
        all_text += "\n" + extract_text_from_slide(slide)

    chinese_terms = re.findall(r'[一-鿿]{2,6}', all_text)
    english_terms = re.findall(r'\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b', all_text)

    term_counts = Counter(chinese_terms + english_terms)

    common_words = {'这个', '那个', '我们', '他们', '什么', '这样', '所以', '就是', '没有', '一个',
                    'the', 'and', 'that', 'with'}
    keywords = [
        term for term, count in term_counts.most_common(30)
        if count >= 2 and term not in common_words and len(term) >= 2
    ]

    return keywords[:15]


def parse_ppt_to_slides(ppt_path: str, output_dir: Optional[str] = None) -> List[dict]:
    """Parse PPT and return list of slides with text and image metadata.

    If output_dir is provided, slide screenshots are saved as PNG files there
    (old files in the directory are cleaned first).  The returned dicts contain
    ``image_path`` (relative path to the PNG) instead of inline base64.

    Each slide dict:
        page: int (1-based)
        title: str
        text: str
        image_path: str  (e.g. "slide_01.png")
    """
    prs = Presentation(ppt_path)
    slide_count = len(prs.slides)

    rendered = False
    if output_dir:
        os.makedirs(output_dir, exist_ok=True)
        # Clean old renders before generating new ones
        for old in os.listdir(output_dir):
            if old.startswith("slide_") and old.endswith(".png"):
                try:
                    os.remove(os.path.join(output_dir, old))
                except Exception:
                    pass
        rendered = _render_slides_via_powerpoint(ppt_path, output_dir, slide_count)

    slides = []
    for idx, slide in enumerate(prs.slides, start=1):
        title = ""
        for shape in slide.shapes:
            if shape.has_text_frame:
                first_text = shape.text_frame.paragraphs[0].text.strip()
                if first_text:
                    title = first_text
                    break

        text = extract_text_from_slide(slide)

        image_path = ""
        if rendered:
            image_path = f"slide_{idx:02d}.png"

        slides.append({
            "page": idx,
            "title": title,
            "text": text,
            "image_path": image_path,
        })

    return slides
