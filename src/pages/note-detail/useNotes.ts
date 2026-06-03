import { useState, useCallback } from 'react';

export interface StudentNote {
  type: string;
  content: string;
}

export function useNotes() {
  const [notes, setNotes] = useState<StudentNote[]>([{ type: 'text', content: '' }]);
  const [editingNote, setEditingNote] = useState<string | null>(null);

  const updateNote = useCallback((index: number, content: string) => {
    setNotes((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], content };
      return updated;
    });
  }, []);

  const parseNotesFromContent = useCallback((content: string, hasTranscript: boolean = false) => {
    const transcriptSectionMatch = content.match(/^## 语音转文字\n\n([\s\S]*?)\n\n---\n\n([\s\S]*)$/);
    if (transcriptSectionMatch && transcriptSectionMatch[2].trim()) {
      return [{ type: 'text', content: transcriptSectionMatch[2].trim() }];
    }
    // Only treat raw content as notes when there's genuinely no transcript.
    // If transcript exists, raw content is old-format data (transcript saved
    // directly to content without the ## header) and should be ignored.
    if (!hasTranscript && !content.startsWith('## 语音转文字\n\n') && content.trim()) {
      return [{ type: 'text', content: content.trim() }];
    }
    return [{ type: 'text', content: '' }];
  }, []);

  return {
    state: {
      notes,
      editingNote,
    },
    actions: {
      setNotes,
      setEditingNote,
      updateNote,
      parseNotesFromContent,
    },
  };
}
