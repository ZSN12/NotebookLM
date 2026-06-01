import { useState, useEffect, useCallback, useRef } from 'react';
import { fetchNote, updateNote as apiUpdateNote, insertPPTIntoTranscript, ContentBlock, Slide } from '@/services/api';

const CORRECTION_POLL_MS = 12000;
const PPT_INSERT_INITIAL_MS = 8000;
const PPT_INSERT_INTERVAL_MS = 12000;

export interface StudentNote {
  type: string;
  content: string;
}

export function useTranscript(
  sessionId: string | undefined,
  isRecording: boolean,
  slides: Slide[],
) {
  const [transcriptText, setTranscriptText] = useState('');
  const [isAiRestructuring, setIsAiRestructuring] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [contentBlocks, setContentBlocks] = useState<ContentBlock[]>([]);
  const [lastSaveTime, setLastSaveTime] = useState<number | null>(null);
  const prevTranscriptRef = useRef('');

  const appendTranscriptText = useCallback((newText: string) => {
    setTranscriptText(prev => {
      const trimmed = newText.trim();
      if (!trimmed) return prev;
      const prevTrimmed = prev.trim();
      return prevTrimmed ? `${prevTrimmed} ${trimmed}` : trimmed;
    });
  }, []);

  const loadHistory = useCallback(async () => {
    if (!sessionId) return;
    try {
      const note = await fetchNote(sessionId);
      if (note) {
        let transcriptRestored = false;
        if (note.transcript && Array.isArray(note.transcript) && note.transcript.length > 0) {
          const fullTranscript = note.transcript
            .sort((a: any, b: any) => (a.chunk_index || 0) - (b.chunk_index || 0))
            .map((chunk: any) => chunk.text || '')
            .join(' ')
            .trim();
          if (fullTranscript) { setTranscriptText(fullTranscript); transcriptRestored = true; }
        }
        if (!transcriptRestored && note.content) {
          const match = note.content.match(/^## 语音转文字\n\n([\s\S]*?)(?:\n\n---\n\n[\s\S]*)?$/);
          if (match && match[1].trim()) setTranscriptText(match[1].trim());
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
  }, [sessionId]);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  const lastSaveRef = useRef<number>(0);
  const saveContent = useCallback(async (currentNotes: StudentNote[]) => {
    if (!sessionId) return;
    const now = Date.now();
    if (now - lastSaveRef.current < 3000) return;
    lastSaveRef.current = now;
    const content = currentNotes.map(n => n.content).filter(Boolean).join('\n\n');
    const fullContent = transcriptText.trim()
      ? `## 语音转文字\n\n${transcriptText.trim()}\n\n---\n\n${content}`.trim()
      : content;
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
          }
        }
      } catch {}
    }, CORRECTION_POLL_MS);
    return () => clearInterval(interval);
  }, [isRecording, sessionId, transcriptText]);

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
      isAiRestructuring,
      isTranscribing,
      contentBlocks,
      lastSaveTime,
    },
    actions: {
      setTranscriptText,
      appendTranscriptText,
      setIsAiRestructuring,
      setIsTranscribing,
      setContentBlocks,
      saveContent,
    },
  };
}
