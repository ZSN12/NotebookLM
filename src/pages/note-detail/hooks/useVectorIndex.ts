import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { toast } from 'sonner';
import { rebuildSessionVectorIndex, getSessionVectorStatus } from '@/services/api';
import type { VectorIndexStatus, SessionProcessingStatus } from '@/services/api';

function deriveFlowStatus(
  processingStatus: SessionProcessingStatus | null,
): VectorIndexStatus['status'] | null {
  if (!processingStatus) return null;
  const stage = processingStatus.stages.vector_index;
  if (!stage) return null;

  switch (stage.status) {
    case 'ready':
      return 'indexed';
    case 'stale':
      return 'stale';
    case 'running':
      return 'not_indexed';
    default:
      return null;
  }
}

export function useVectorIndex(
  sessionId: string | undefined,
  processingStatus: SessionProcessingStatus | null,
) {
  const [isRebuilding, setIsRebuilding] = useState(false);
  const [realVectorStatus, setRealVectorStatus] = useState<VectorIndexStatus | null>(null);
  const ensureTriggerRef = useRef(false);

  // Fetch real chunk_count from backend independently
  useEffect(() => {
    if (!sessionId) {
      setRealVectorStatus(null);
      return;
    }
    getSessionVectorStatus(sessionId)
      .then(setRealVectorStatus)
      .catch(() => {});
  }, [sessionId]);

  // Merge real status with flow status from processingStatus
  const vectorStatus = useMemo<VectorIndexStatus | null>(() => {
    if (!sessionId) return null;

    const flowStatus = deriveFlowStatus(processingStatus);
    if (!realVectorStatus && !flowStatus) {
      return {
        session_id: sessionId,
        chunk_count: 0,
        has_content: false,
        status: 'not_indexed',
      };
    }

    const base = realVectorStatus || {
      session_id: sessionId,
      chunk_count: 0,
      has_content: false,
      status: 'not_indexed' as VectorIndexStatus['status'],
    };

    // processingStatus overrides only flow-related statuses
    if (flowStatus) {
      return { ...base, status: flowStatus };
    }
    return base;
  }, [sessionId, realVectorStatus, processingStatus]);

  const handleRebuildIndex = useCallback(async () => {
    if (!sessionId) return;
    setIsRebuilding(true);
    try {
      await rebuildSessionVectorIndex(sessionId);
      toast.success('索引重建完成');
      // Refresh real status after rebuild
      const refreshed = await getSessionVectorStatus(sessionId);
      setRealVectorStatus(refreshed);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : '建立索引失败');
    } finally {
      setIsRebuilding(false);
    }
  }, [sessionId]);

  const ensureIndexed = useCallback(async () => {
    if (!sessionId || ensureTriggerRef.current) return;
    const status = vectorStatus;
    if (!status || status.status === 'not_indexed' || status.status === 'stale') {
      ensureTriggerRef.current = true;
      await handleRebuildIndex();
    }
  }, [sessionId, vectorStatus, handleRebuildIndex]);

  return {
    state: { vectorStatus, isRebuilding },
    actions: { handleRebuildIndex, ensureIndexed },
  };
}
