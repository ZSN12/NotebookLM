import { useState } from 'react';
import { askRAG } from '@/services/api';
import type { RAGSource } from '@/services/api';

export function useRAG() {
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchScope, setSearchScope] = useState<'session' | 'notebook'>('session');
  const [ragAnswer, setRagAnswer] = useState('');
  const [ragSources, setRagSources] = useState<RAGSource[]>([]);
  const [isAskingRAG, setIsAskingRAG] = useState(false);
  const [ragError, setRagError] = useState<string | null>(null);
  const [ragStatus, setRagStatus] = useState<string | null>(null);

  const handleRAGAsk = async (
    sessionId: string | undefined,
    notebookId: string | undefined,
    ensureIndexed?: () => Promise<void>,
  ) => {
    if (!searchQuery.trim() || isAskingRAG) return;
    setIsAskingRAG(true);
    setRagAnswer('');
    setRagSources([]);
    setRagError(null);
    setRagStatus('正在检查知识索引...');

    try {
      await ensureIndexed?.();
    } catch (err: any) {
      setRagError(err?.message || '知识索引建立失败，请稍后重试');
      setIsAskingRAG(false);
      setRagStatus(null);
      return;
    }

    askRAG(
      searchQuery,
      searchScope === 'session' ? sessionId : undefined,
      searchScope === 'notebook' ? notebookId : undefined,
      {
        onStatus: (message: string) => setRagStatus(message || null),
        onChunk: (text: string) => setRagAnswer(text),
        onSources: (sources: RAGSource[]) => setRagSources(sources),
        onDone: () => {
          setIsAskingRAG(false);
          setRagStatus(null);
        },
        onError: (err: string) => {
          setRagError(err);
          setIsAskingRAG(false);
          setRagStatus(null);
        },
      }
    );
  };

  return {
    state: { showSearch, searchQuery, searchScope, ragAnswer, ragSources, isAskingRAG, ragError, ragStatus },
    actions: { setShowSearch, setSearchQuery, setSearchScope, handleRAGAsk },
  };
}
