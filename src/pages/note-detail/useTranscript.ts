import { useState, useEffect, useCallback, useRef } from 'react';
import { fetchNote, updateNote as apiUpdateNote, insertPPTIntoTranscript, ContentBlock, Slide } from '@/services/api';
import { contentBlocksFromLayout, layoutFromNoteParts, normalizeHtmlText } from '@/lib/noteLayout';

const CORRECTION_POLL_MS = 12000;
const PPT_INSERT_INITIAL_MS = 8000;
const PPT_INSERT_INTERVAL_MS = 12000;

export interface StudentNote {
  type: string;
  content: string;
}

export interface SentenceWithTime {
  text: string;
  startTime: number;
  endTime: number;
}

export function useTranscript(
  sessionId: string | undefined,
  isRecording: boolean,
  slides: Slide[],
) {
  const [transcriptText, setTranscriptText] = useState('');
  const [sentencesWithTime, setSentencesWithTime] = useState<SentenceWithTime[]>([]);
  const [activeSentenceIndex, setActiveSentenceIndex] = useState<number | null>(null);
  const [isAiRestructuring, setIsAiRestructuring] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [contentBlocks, setContentBlocks] = useState<ContentBlock[]>([]);
  const [lastSaveTime, setLastSaveTime] = useState<number | null>(null);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isPptMatching, setIsPptMatching] = useState(false);
  const [pptMatchMessage, setPptMatchMessage] = useState<string | null>(null);
  const [pendingAiText, setPendingAiText] = useState<string | null>(null);
  const [loadedNote, setLoadedNote] = useState<any>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [hasLocalChanges, setHasLocalChanges] = useState(false);
  const prevTranscriptRef = useRef('');
  const userEditedRef = useRef(false);
  const hasLocalChangesRef = useRef(false);

  const markLocalChanged = useCallback((isUserEdit = true) => {
    if (isUserEdit) userEditedRef.current = true;
    hasLocalChangesRef.current = true;
    setHasLocalChanges(true);
    setSaveStatus('idle');
  }, []);

  const normalizeEditableHtml = useCallback((s: string) => normalizeHtmlText(s), []);

  const cleanTranscriptText = useCallback((value: string) => {
    return normalizeEditableHtml(value)
      .replace(/^(##\s*语音转文字\s*)+/g, '')
      .replace(/(?:\n\s*)?---+\s*$/g, '')
      .replace(/^[-\s]+$/g, '')
      .trim();
  }, [normalizeEditableHtml]);

  const transcriptFromBlocks = useCallback((blocks: ContentBlock[]) => {
    return blocks
      .filter((block) => block.type === 'text')
      .map((block) => normalizeEditableHtml(block.content || ''))
      .filter(Boolean)
      .join('\n\n');
  }, [normalizeEditableHtml]);

  const getCurrentTranscript = useCallback(() => {
    const blockText = transcriptFromBlocks(contentBlocks);
    return cleanTranscriptText(blockText || transcriptText);
  }, [cleanTranscriptText, contentBlocks, transcriptFromBlocks, transcriptText]);

  const updateTranscriptText = useCallback((value: string, markUserEdit = true) => {
    if (markUserEdit) markLocalChanged(true);
    else setSaveStatus('idle');
    setTranscriptText(value);
  }, [markLocalChanged]);

  const updateContentBlocks = useCallback((blocks: ContentBlock[], markUserEdit = true, markLocalChange = markUserEdit) => {
    if (markLocalChange) markLocalChanged(markUserEdit);
    else setSaveStatus('idle');
    setContentBlocks(blocks);
  }, [markLocalChanged]);

  const receiveAiText = useCallback((value: string) => {
    const nextText = value.trim();
    if (!nextText) return;
    if (userEditedRef.current) {
      setPendingAiText(nextText);
      return;
    }
    setTranscriptText(nextText);
    markLocalChanged(false);
  }, [markLocalChanged]);

  const parseSentencesWithTime = useCallback((note: any): SentenceWithTime[] => {
    if (!note?.transcript || !Array.isArray(note.transcript) || note.transcript.length === 0) return [];

    const sortedChunks = note.transcript
      .sort((a: any, b: any) => (a.chunk_index || 0) - (b.chunk_index || 0))
      .filter((chunk: any) => chunk.text && chunk.text.trim());

    if (sortedChunks.length === 0) return [];

    const fullText = sortedChunks.map((chunk: any) => chunk.text || '').join(' ').trim();

    // Build timestamp array with sequential position tracking to correctly handle
    // duplicate words (e.g. "的", "是", "在" appear many times in Chinese text).
    // Using indexOf(word, searchPos) ensures each occurrence maps to its actual position.
    const allTimestamps: { text: string; start: number; end: number; pos: number }[] = [];
    let searchPos = 0;
    for (const chunk of sortedChunks) {
      if (chunk.timestamps && Array.isArray(chunk.timestamps)) {
        for (const ts of chunk.timestamps) {
          const word = (ts.text || '').trim();
          if (!word) continue;
          const pos = fullText.indexOf(word, searchPos);
          if (pos !== -1) {
            allTimestamps.push({ text: word, start: ts.start || 0, end: ts.end || 0, pos });
            searchPos = pos + word.length;
          }
        }
      }
    }

    if (allTimestamps.length === 0) return [];

    // Split full text into sentences
    const sentenceRegex = /([^。！？.!?]+[。！？.!?]?)/g;
    const sentences: { text: string; startIdx: number; endIdx: number }[] = [];
    let match;
    while ((match = sentenceRegex.exec(fullText)) !== null) {
      const sentenceText = match[1].trim();
      if (sentenceText) {
        sentences.push({ text: sentenceText, startIdx: match.index, endIdx: match.index + match[1].length });
      }
    }

    // Map each sentence to its time range using the position-matched timestamps
    const result: SentenceWithTime[] = [];
    for (const sentence of sentences) {
      const wordsInRange = allTimestamps.filter(ts =>
        ts.pos >= sentence.startIdx && ts.pos < sentence.endIdx
      );

      if (wordsInRange.length > 0) {
        result.push({
          text: sentence.text,
          startTime: Math.min(...wordsInRange.map(w => w.start)),
          endTime: Math.max(...wordsInRange.map(w => w.end)),
        });
      } else if (result.length > 0) {
        // Fallback: estimate time range from previous sentence
        const prev = result[result.length - 1];
        result.push({
          text: sentence.text,
          startTime: prev.endTime,
          endTime: prev.endTime + 2,
        });
      } else {
        // First sentence(s) have no timestamp match — use the first available timestamp
        result.push({
          text: sentence.text,
          startTime: allTimestamps[0]?.start ?? 0,
          endTime: (allTimestamps[0]?.start ?? 0) + 2,
        });
      }
    }

    return result;
  }, []);

  const appendTranscriptText = useCallback((newText: string) => {
    markLocalChanged(false);
    setTranscriptText(prev => {
      const trimmed = newText.trim();
      if (!trimmed) return prev;
      const prevTrimmed = prev.trim();
      return prevTrimmed ? `${prevTrimmed}\n\n${trimmed}` : trimmed;
    });
  }, [markLocalChanged]);

  const loadHistory = useCallback(async () => {
    if (!sessionId) return;
    setIsLoaded(false);
    setLoadedNote(null);
    try {
      const note = await fetchNote(sessionId);
      if (note) {
        setLoadedNote(note); // Share with parent so it can skip its own fetch
        // Prefer user-edited transcript from note.content, fall back to
        // machine-generated note.transcript (preserves edits across reload).
        let transcriptRestored = false;
        if (note.content) {
          const match = note.content.match(/^## 语音转文字\n\n([\s\S]*?)(?:\n\n---\n\n[\s\S]*)?$/);
          if (match && match[1].trim()) {
            setTranscriptText(cleanTranscriptText(match[1]));
            transcriptRestored = true;
          }
        }
        if (!transcriptRestored && note.transcript && Array.isArray(note.transcript) && note.transcript.length > 0) {
          const fullTranscript = note.transcript
            .sort((a: any, b: any) => (a.chunk_index || 0) - (b.chunk_index || 0))
            .map((chunk: any) => chunk.text || '')
            .join(' ')
            .trim();
          if (fullTranscript) {
            setTranscriptText(cleanTranscriptText(fullTranscript));
          }
        }
        // Parse sentence-time mapping from transcript JSON (always needs note.transcript)
        if (note.transcript && Array.isArray(note.transcript) && note.transcript.length > 0) {
          const parsed = parseSentencesWithTime(note);
          if (parsed.length > 0) setSentencesWithTime(parsed);
        }
        const restoredBlocks = contentBlocksFromLayout(note.layout_blocks);
        if (restoredBlocks.length > 0) {
          updateContentBlocks(restoredBlocks, false);
          const layoutText = transcriptFromBlocks(restoredBlocks);
          if (layoutText) setTranscriptText(cleanTranscriptText(layoutText));
        } else if (note.ppt_images && note.ppt_images.length > 0) {
          setTimeout(async () => {
            try {
              const blocks = await insertPPTIntoTranscript(sessionId);
              if (blocks.blocks?.some((b: ContentBlock) => b.type === 'image')) {
                updateContentBlocks(blocks.blocks, false, false);
              }
            } catch {}
          }, 500);
        }
      }
    } catch (error) { console.error('Failed to load history:', error); }
    finally {
      hasLocalChangesRef.current = false;
      setHasLocalChanges(false);
      setIsLoaded(true);
    }
  }, [cleanTranscriptText, sessionId, parseSentencesWithTime, transcriptFromBlocks, updateContentBlocks]);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  const saveContent = useCallback(async (currentNotes: StudentNote[], forceRetry = false) => {
    if (!sessionId) return false;
    if (!forceRetry && !hasLocalChangesRef.current) return true;
    const cleanTranscript = cleanTranscriptText(getCurrentTranscript());
    const notesContent = currentNotes.map(n => normalizeEditableHtml(n.content)).filter(Boolean).join('\n\n');

    const fullContent = cleanTranscript
      ? `## 语音转文字\n\n${cleanTranscript}\n\n---\n\n${notesContent}`.trim()
      : notesContent;
    const layoutBlocks = layoutFromNoteParts(cleanTranscript, contentBlocks, currentNotes);
    if (fullContent || currentNotes.length > 0) {
      setSaveStatus('saving');
      setSaveError(null);
      try {
        await apiUpdateNote(sessionId, fullContent, layoutBlocks);
        setLastSaveTime(Date.now());
        setSaveStatus('saved');
        hasLocalChangesRef.current = false;
        setHasLocalChanges(false);
        return true;
      } catch (error: any) {
        console.error('[NoteDetail] Failed to save content:', error);
        setSaveStatus('error');
        setSaveError(error?.message || '保存失败，请检查网络后重试');
        return false;
      }
    }
    hasLocalChangesRef.current = false;
    setHasLocalChanges(false);
    return true;
  }, [cleanTranscriptText, contentBlocks, getCurrentTranscript, normalizeEditableHtml, sessionId]);

  useEffect(() => {
    if (!isRecording || !sessionId) return;
    const interval = setInterval(async () => {
      try {
        const note = await fetchNote(sessionId);
        if (note?.transcript && Array.isArray(note.transcript) && note.transcript.length > 0) {
          const corrected = note.transcript
            .sort((a: any, b: any) => (a.chunk_index || 0) - (b.chunk_index || 0))
            .map((chunk: any) => chunk.text || '')
            .join(' ');
          if (corrected.trim() && corrected.trim() !== transcriptText.trim()) {
            receiveAiText(corrected);
            setIsAiRestructuring(false);
            // Re-parse sentence-time mapping: AI restructured text changed,
            // old sentence boundaries no longer match
            const parsed = parseSentencesWithTime(note);
            if (parsed.length > 0) setSentencesWithTime(parsed);
          }
        }
      } catch {}
    }, CORRECTION_POLL_MS);
    return () => clearInterval(interval);
  }, [isRecording, sessionId, transcriptText, parseSentencesWithTime, receiveAiText]);

  useEffect(() => {
    if (!isRecording && sessionId && transcriptText) {
      prevTranscriptRef.current = transcriptText;
      setIsTranscribing(true);
    }
  }, [isRecording, sessionId]);

  useEffect(() => {
    if (!isTranscribing) return;
    if (transcriptText && transcriptText !== prevTranscriptRef.current) {
      prevTranscriptRef.current = transcriptText;
      setIsTranscribing(false);
      // 转录重组完成，用干净文本重新匹配 PPT
      if (sessionId) {
        setIsPptMatching(true);
        setPptMatchMessage('正在重新匹配 PPT');
        insertPPTIntoTranscript(sessionId).then(result => {
          if (result.blocks?.length > 0) {
            updateContentBlocks(result.blocks, false, true);
            const count = result.blocks.filter((b) => b.type === 'image').length;
            setPptMatchMessage(count > 0 ? `已匹配 ${count} 页 PPT` : '未匹配到 PPT 页面');
          }
        }).catch(() => {
          setPptMatchMessage('PPT 匹配失败，可稍后重试');
        }).finally(() => setIsPptMatching(false));
      }
    }
  }, [isTranscribing, transcriptText, sessionId, updateContentBlocks]);

  useEffect(() => {
    if (!isRecording || !sessionId || slides.length === 0) return;
    const doInsert = async () => {
      setIsPptMatching(true);
      setPptMatchMessage('正在匹配 PPT');
      try {
        const result = await insertPPTIntoTranscript(sessionId);
        if (result.blocks?.length > 0) {
          updateContentBlocks(result.blocks, false, true);
          const count = result.blocks.filter((b) => b.type === 'image').length;
          setPptMatchMessage(count > 0 ? `已匹配 ${count} 页 PPT` : '未匹配到 PPT 页面');
        }
      } catch {
        setPptMatchMessage('PPT 匹配失败，可稍后重试');
      } finally {
        setIsPptMatching(false);
      }
    };
    const t1 = setTimeout(doInsert, PPT_INSERT_INITIAL_MS);
    const t2 = setInterval(doInsert, PPT_INSERT_INTERVAL_MS);
    return () => { clearTimeout(t1); clearInterval(t2); };
  }, [isRecording, sessionId, slides.length]);

  useEffect(() => {
    if (isRecording && slides.length > 0) {
      const t = setTimeout(() => setIsAiRestructuring(true), PPT_INSERT_INITIAL_MS);
      return () => clearTimeout(t);
    } else {
      setIsAiRestructuring(false);
    }
  }, [isRecording, slides.length]);

  return {
    state: {
      transcriptText,
      sentencesWithTime,
      activeSentenceIndex,
      isAiRestructuring,
      isTranscribing,
      contentBlocks,
      lastSaveTime,
      saveStatus,
      saveError,
      isPptMatching,
      pptMatchMessage,
      pendingAiText,
      loadedNote,
      isLoaded,
      hasLocalChanges,
    },
    actions: {
      setTranscriptText,
      updateTranscriptText,
      receiveAiText,
      appendTranscriptText,
      setIsAiRestructuring,
      setIsTranscribing,
      setContentBlocks,
      updateContentBlocks,
      setActiveSentenceIndex,
      saveContent,
      parseSentencesWithTime,
      setSentencesWithTime,
      markUserEdited: () => markLocalChanged(true),
      markLocalChanged: () => markLocalChanged(false),
      applyPendingAiText: () => {
        if (!pendingAiText) return;
        userEditedRef.current = false;
        setTranscriptText(pendingAiText);
        setPendingAiText(null);
        setSentencesWithTime([]);
        setActiveSentenceIndex(null);
        markLocalChanged(false);
      },
      dismissPendingAiText: () => setPendingAiText(null),
    },
  };
}
