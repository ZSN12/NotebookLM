import { useState, useCallback } from 'react';

export interface StudentNote {
  type: string;
  content: string;
}

export function useNotes() {
  const [notes, setNotes] = useState<StudentNote[]>([]);
  const [editingNote, setEditingNote] = useState<string | null>(null);

  const updateNote = useCallback((index: number, content: string) => {
    setNotes((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], content };
      return updated;
    });
  }, []);

  const addNote = useCallback(() => {
    const newIdx = notes.length;
    setNotes((prev) => [...prev, { type: 'text', content: '' }]);
    setEditingNote(String(newIdx));
  }, [notes.length]);

  const parseNotesFromContent = useCallback((content: string) => {
    const transcriptSectionMatch = content.match(/^## 语音转文字\n\n([\s\S]*?)\n\n---\n\n([\s\S]*)$/);
    if (transcriptSectionMatch && transcriptSectionMatch[2].trim()) {
      return transcriptSectionMatch[2].split('\n\n').filter(Boolean).map(c => ({ type: 'text', content: c }));
    } else if (!content.startsWith('## 语音转文字\n\n')) {
      return content.split('\n\n').filter(Boolean).map(c => ({ type: 'text', content: c }));
    }
    return [];
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
      addNote,
      parseNotesFromContent,
    },
  };
}
