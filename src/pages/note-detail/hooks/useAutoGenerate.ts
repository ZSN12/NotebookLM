import { useState, useEffect, useCallback, useRef } from 'react';
import { runAllAgents } from '@/services/api';
import type { SessionProcessingStatus } from '@/services/api';

export function useAutoGenerate(
  sessionId: string | undefined,
  processingStatus: SessionProcessingStatus | null,
) {
  const [autoGenerateStudyMaterials, setAutoGenerateStudyMaterials] = useState(() => {
    try {
      const raw = localStorage.getItem('nootbook_auto_generate_study_materials');
      return raw === null ? true : JSON.parse(raw);
    } catch {
      return true;
    }
  });
  const [autoGenerateToast, setAutoGenerateToast] = useState<string | null>(null);
  const triggeredRef = useRef<Set<string>>(new Set());

  // Persist setting
  const persistSetting = useCallback((value: boolean) => {
    localStorage.setItem('nootbook_auto_generate_study_materials', JSON.stringify(value));
    setAutoGenerateStudyMaterials(value);
  }, []);

  // Observe processing status and show toast messages for agent stages
  useEffect(() => {
    if (!processingStatus) return;
    const stages = processingStatus.stages;
    const agentStages = [stages.summary, stages.mindmap, stages.quiz_bank];
    const anyRunning = agentStages.some(s => s?.status === 'running');
    const anyError = agentStages.some(s => s?.status === 'error');
    const allReady = agentStages.every(s => s?.status === 'ready' || s?.status === 'idle');
    const hasAgents = agentStages.some(s => s?.status !== 'idle');

    if (anyRunning) {
      setAutoGenerateToast('正在自动生成学习资料...');
    } else if (anyError && hasAgents) {
      setAutoGenerateToast('部分学习资料生成失败，可手动重试');
      const t = setTimeout(() => setAutoGenerateToast(null), 4000);
      return () => clearTimeout(t);
    } else if (allReady && hasAgents) {
      setAutoGenerateToast('导图和题库生成完成');
      const t = setTimeout(() => setAutoGenerateToast(null), 4000);
      return () => clearTimeout(t);
    }
  }, [processingStatus]);

  // Auto-trigger agents when vector_index becomes ready and auto-generate is enabled
  useEffect(() => {
    if (!sessionId || !autoGenerateStudyMaterials || !processingStatus) return;
    const stages = processingStatus.stages;
    const vectorReady = stages.vector_index?.status === 'ready';
    const transcriptReady = stages.transcript_finalize?.status === 'ready';
    const key = `${sessionId}:agents`;

    if (vectorReady && transcriptReady && !triggeredRef.current.has(key)) {
      triggeredRef.current.add(key);
      runAllAgents(sessionId, ['summary', 'mindmap', 'quiz']).catch(() => {
        setAutoGenerateToast('自动启动学习资料生成失败，可手动重试');
        setTimeout(() => setAutoGenerateToast(null), 4000);
      });
    }
  }, [sessionId, autoGenerateStudyMaterials, processingStatus]);

  const handleTriggerAgents = useCallback(async (sid: string | undefined) => {
    if (!sid) return;
    try {
      await runAllAgents(sid, ['summary', 'mindmap', 'quiz']);
    } catch {
      setAutoGenerateToast('自动启动学习资料生成失败，可手动重试');
      setTimeout(() => setAutoGenerateToast(null), 4000);
    }
  }, []);

  return {
    state: { autoGenerateStudyMaterials, autoGenerateToast },
    actions: { setAutoGenerateStudyMaterials: persistSetting, setAutoGenerateToast, handleTriggerAgents },
  };
}
