#!/usr/bin/env python
"""Test term_corrector LLM correction manually."""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app.services.term_corrector import corrector

test_text = """定义这个速度，那同样的跟父子进程没有什么区别。关键的是另外一个区别来了，哎不是亲戚关系的怎么办？Ok不是亲戚关系的，会有什么问题？我们刚才之所以啊父子进程和兄弟进程之间可以正常的通信，是因为什么？是因为父进城是子禁城的紫禁城，是父进城的一个完美的复制运系。

所以这个管道的阀门它完美的给复制过来了。但是现在啊如果没有亲戚关系就没有复制关系了，那怎么办？它有一个新的，它有一个亲的关系，原来那种管道没有给他起过任何的名字，那我们叫做无名管道，现在问题来了，那么没有血缘关系，那么就没有完美的复制过来那个阀门独阀门儿他写画面，那怎么办？我干脆就在内存里边，给他指定一个名字，这个管道就叫张三，你们要通信的双方写的人就把数据写到张三这个管道里边，然后读的人从张三这个管道里边读就行了。"""

print("=" * 60)
print("TEST: restructure_transcript")
print(f"API key present: {corrector.has_llm}")
print(f"Input length: {len(test_text)}")
print("-" * 60)

result = corrector.restructure_transcript(
    text=test_text,
    course_title="操作系统",
    keywords=["进程", "管道", "父子进程"],
)

print(f"Output length: {len(result)}")
print(f"Changed: {result.strip() != test_text.strip()}")

# Also test preserves_source_content
from app.services.term_corrector import TermCorrector
local = corrector.clean_transcript_for_display(test_text)
preserved = TermCorrector.preserves_source_content(local, result, min_ratio=0.65)
print(f"Local display length: {len(local)}")
print(f"Preserves content: {preserved}")

# Write to file so we can read the actual text
with open("test_correction_result.txt", "w", encoding="utf-8") as f:
    f.write("=== INPUT ===\n")
    f.write(test_text)
    f.write("\n\n=== OUTPUT ===\n")
    f.write(result)

print("\nResult written to test_correction_result.txt")
