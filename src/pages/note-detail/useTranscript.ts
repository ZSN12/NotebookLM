import { useState, useEffect, useCallback, useRef } from 'react';
import { fetchNote, updateNote as apiUpdateNote, insertPPTIntoTranscript, ContentBlock, Slide } from '@/services/api';

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
  const [loadedNote, setLoadedNote] = useState<any>(null);
  const prevTranscriptRef = useRef('');

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
    setTranscriptText(prev => {
      const trimmed = newText.trim();
      if (!trimmed) return prev;
      const prevTrimmed = prev.trim();
      return prevTrimmed ? `${prevTrimmed}\n\n${trimmed}` : trimmed;
    });
  }, []);

  const loadHistory = useCallback(async () => {
    if (!sessionId) return;
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
            setTranscriptText(match[1].trim());
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
            setTranscriptText(fullTranscript);
          }
        }
        // Parse sentence-time mapping from transcript JSON (always needs note.transcript)
        if (note.transcript && Array.isArray(note.transcript) && note.transcript.length > 0) {
          const parsed = parseSentencesWithTime(note);
          if (parsed.length > 0) setSentencesWithTime(parsed);
        }
        if (note.ppt_images && note.ppt_images.length > 0) {
          setTimeout(async () => {
            try {
              const blocks = await insertPPTIntoTranscript(sessionId);
              if (blocks.blocks?.some((b: ContentBlock) => b.type === 'image')) {
                setContentBlocks(blocks.blocks);
              }
            } catch {}
          }, 500);
        }
      }
    } catch (error) { console.error('Failed to load history:', error); }
  }, [sessionId, parseSentencesWithTime]);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  const lastSaveRef = useRef<number>(0);
  const saveContent = useCallback(async (currentNotes: StudentNote[]) => {
    if (!sessionId) return;
    const now = Date.now();
    if (now - lastSaveRef.current < 3000) return;
    lastSaveRef.current = now;

    // Normalize empty state (Chrome contentEditable leaves <br> when cleared)
    const normalize = (s: string) => {
      const t = s.trim();
      return (t === '<br>' || t === '<br />') ? '' : t;
    };
    const cleanTranscript = normalize(transcriptText);
    const notesContent = currentNotes.map(n => normalize(n.content)).filter(Boolean).join('\n\n');

    const fullContent = cleanTranscript
      ? `## 语音转文字\n\n${cleanTranscript}\n\n---\n\n${notesContent}`.trim()
      : notesContent;
    if (fullContent || currentNotes.length > 0) {
      try { await apiUpdateNote(sessionId, fullContent); setLastSaveTime(Date.now()); }
      catch (error) { console.error('[NoteDetail] Failed to save content:', error); }
    }
  }, [sessionId, transcriptText]);

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
            setTranscriptText(corrected);
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
  }, [isRecording, sessionId, transcriptText, parseSentencesWithTime]);

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
        insertPPTIntoTranscript(sessionId).then(result => {
          if (result.blocks?.length > 0) setContentBlocks(result.blocks);
        }).catch(() => {});
      }
    }
  }, [isTranscribing, transcriptText, sessionId]);

  useEffect(() => {
    if (!isRecording || !sessionId || slides.length === 0) return;
    const doInsert = async () => {
      try {
        const result = await insertPPTIntoTranscript(sessionId);
        if (result.blocks?.length > 0) setContentBlocks(result.blocks);
      } catch {}
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
      loadedNote,
    },
    actions: {
      setTranscriptText,
      appendTranscriptText,
      setIsAiRestructuring,
      setIsTranscribing,
      setContentBlocks,
      setActiveSentenceIndex,
      saveContent,
      parseSentencesWithTime,
      setSentencesWithTime,
    },
  };
}
