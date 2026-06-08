# 可靠性修复方案（参考 2026-06-06 排查）

## 问题总结

今天的核心 bug 链：

1. **前端**：`file input` 选同一个文件不触发 `onChange` → 用户点了上传但根本没发请求
2. **后端**：`logging` 没配置 → `logger.info` 全被静默 → 看不到任何请求日志
3. **AI 纠正**：`min_ratio=0.65` 过保守 → DeepSeek 合法结果被丢弃 → 用户看到的是本地稿
4. **UI 状态**：没有"正在纠正"状态 → 用户以为结果已纠正，实际没走 LLM
5. **缺乏验证**：没有 e2e 测试 → 问题在线上才被发现

---

## 修复清单

### 1. 前端：上传按钮强制触发（已修复 ✅）

```tsx
// 每次点击前清空 input value，强制浏览器认为"值变了"
<button onClick={() => {
  if (audioInputRef.current) audioInputRef.current.value = '';
  audioInputRef.current?.click();
}}>
```

**为什么**：`<input type="file">` 的 `onChange` 只在 `value` 变化时触发，选同一个文件 value 不变。

---

### 2. 后端：强制 Logging 配置（已修复 ✅）

```python
# app/main.py 开头
import logging
_LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO").upper()
logging.basicConfig(
    level=getattr(logging, _LOG_LEVEL, logging.INFO),
    format="%(asctime)s %(levelname)-5s [%(name)s] %(message)s",
    datefmt="%H:%M:%S",
)
```

**为什么**：Python 默认 logging 级别是 WARNING，所有 `logger.info` 被丢弃。没有日志 = 盲人摸象。

---

### 3. AI 纠正：放宽阈值 + 核心词兜底（已修复 ✅）

```python
# 三处统一
min_ratio=0.50  # 之前 0.60/0.65/0.70 不一致

# 新增核心词覆盖率判断
_core_terms()  # 提取内容词（"进程"、"管道"、"父子进程"）
# 如果长度比不够，但 75% 核心词还在，就接受
```

**为什么**：课堂 ASR 有大量"啊、OK、是不是"等废话，DeepSeek 正常去掉后长度很容易降到 65% 以下。

---

### 4. 前端：显示"纠正状态"（待修复 ⏳）

当前 SSE 事件有 `is_ai_corrected` 和 `correction_error`，但 UI 没利用。

**目标**：在转写卡片上显示一个小标签：
- 🟢 "AI 已纠正" — `is_ai_corrected=True`
- 🟡 "本地整理" — `is_ai_corrected=False, correction_error=未配置 DeepSeek API`
- 🔴 "纠正失败：疑似删减" — `correction_error=AI 整理结果疑似删减内容`

这样用户一眼就能知道结果质量。

---

### 5. 端到端测试（待补充 ⏳）

```python
# backend/tests/test_e2e_audio_upload.py
"""
模拟完整流程：
1. 上传一段测试音频（可用 mock / 小段真实音频）
2. 验证 SSE 返回的 event.type 序列：status → chunk → done
3. 验证 done.note.transcript[0].is_ai_corrected = True
4. 验证 display_text 包含纠正后的专业术语
"""
```

**为什么**：今天的 bug 任何单元测试都抓不到，必须走完整链路才能发现。

---

### 6. 监控/告警（待补充 ⏳）

在后端关键路径加 metrics：

```python
# audio.py
logger.info("audio_upload pipeline: session=%s asr_ok=%s llm_called=%s llm_accepted=%s",
            session_id, bool(segments), corrector.has_llm, final_result.get("is_ai_corrected"))
```

然后写一个 health check 脚本，每天抽查一次：
```bash
# 上传测试音频，检查结果是否被纠正
curl -F "file=@test.wav" "http://localhost:8003/api/process/audio-batch?session_id=test"
# 检查响应里的 is_ai_corrected
```

---

### 7. 前端防御：上传超时/失败提示（已部分有，可加强 ⏳）

当前 `uploadAudio` 有 `onError` 回调，但如果请求根本没发（如今天的 onChange 没触发），错误处理也走不到。

**加强方案**：
```tsx
const [lastUploadAt, setLastUploadAt] = useState<number>(0);

// 点击上传按钮后 5 秒内如果没有收到任何 SSE 事件，提示用户
useEffect(() => {
  if (!isUploadingAudio) return;
  const timer = setTimeout(() => {
    if (lastUploadAt === 0) {
      setAudioUploadError('上传未开始，请重新选择文件');
      setIsUploadingAudio(false);
    }
  }, 5000);
  return () => clearTimeout(timer);
}, [isUploadingAudio]);
```

---

## 优先级

| 优先级 | 事项 | 状态 |
|--------|------|------|
| **P0** | file input 清空触发 | ✅ 已修复 |
| **P0** | logging 配置 | ✅ 已修复 |
| **P0** | min_ratio + 核心词兜底 | ✅ 已修复 |
| **P1** | 前端显示纠正状态标签 | ⏳ 待做 |
| **P1** | e2e 上传测试 | ⏳ 待做 |
| **P2** | 监控/health check | ⏳ 待做 |
| **P2** | 上传超时防御 | ⏳ 待做 |

---

## 核心原则

> **任何环节失败，都必须让用户感知到。**

今天的反面教材：
- 前端没发请求 → 用户以为在转写（静默失败）
- 后端没日志 → 开发者看不到问题（静默失败）
- DeepSeek 结果被丢弃 → 用户看到的是本地稿（静默降级）

修复后的目标：
- 上传失败 → UI 显示红色错误
- 后端异常 → 日志可见 + 前端收到 error SSE
- DeepSeek 被拦截 → UI 显示"本地整理，AI 纠正被拦截：xxx"
