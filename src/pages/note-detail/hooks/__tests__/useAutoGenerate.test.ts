import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useAutoGenerate } from '@/pages/note-detail/hooks/useAutoGenerate'
import * as api from '@/services/api'

function makeStage(status: api.ProcessingStatusValue): api.ProcessingStageState {
  return {
    status,
    progress: 0,
    message: null,
    error_message: null,
    content_hash: null,
    started_at: null,
    finished_at: null,
  }
}

function makeMockProcessing(opts: {
  summary?: api.ProcessingStatusValue
  mindmap?: api.ProcessingStatusValue
  quiz_bank?: api.ProcessingStatusValue
  vector_index?: api.ProcessingStatusValue
  transcript_finalize?: api.ProcessingStatusValue
} = {}): api.SessionProcessingStatus {
  return {
    session_id: 's-1',
    overall_status: 'ready',
    can_ask_rag: true,
    can_auto_generate: true,
    needs_user_action: false,
    stages: {
      upload_transcribe: makeStage('ready'),
      recording_finalize: makeStage('ready'),
      transcript_finalize: makeStage(opts.transcript_finalize ?? 'ready'),
      vector_index: makeStage(opts.vector_index ?? 'ready'),
      summary: makeStage(opts.summary ?? 'ready'),
      mindmap: makeStage(opts.mindmap ?? 'ready'),
      quiz_bank: makeStage(opts.quiz_bank ?? 'ready'),
    },
  }
}

describe('useAutoGenerate', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    localStorage.clear()
  })

  it('initializes autoGenerateStudyMaterials from localStorage', () => {
    localStorage.setItem('nootbook_auto_generate_study_materials', 'false')
    const { result } = renderHook(() => useAutoGenerate('s-1', makeMockProcessing()))
    expect(result.current.state.autoGenerateStudyMaterials).toBe(false)
  })

  it('defaults autoGenerateStudyMaterials to true when localStorage is empty', () => {
    const { result } = renderHook(() => useAutoGenerate('s-1', makeMockProcessing()))
    expect(result.current.state.autoGenerateStudyMaterials).toBe(true)
  })

  it('persists setting to localStorage', () => {
    const { result } = renderHook(() => useAutoGenerate('s-1', makeMockProcessing()))
    act(() => {
      result.current.actions.setAutoGenerateStudyMaterials(false)
    })
    expect(localStorage.getItem('nootbook_auto_generate_study_materials')).toBe('false')
    expect(result.current.state.autoGenerateStudyMaterials).toBe(false)
  })

  it('shows completion toast when all agent stages are ready', async () => {
    const { result } = renderHook(() => useAutoGenerate('s-1', makeMockProcessing()))
    await waitFor(() => {
      expect(result.current.state.autoGenerateToast).toBe('导图和题库生成完成')
    })
  })

  it('shows running toast when any agent stage is running', async () => {
    const { result } = renderHook(() =>
      useAutoGenerate('s-1', makeMockProcessing({ summary: 'running' })),
    )
    expect(result.current.state.autoGenerateToast).toBe('正在自动生成学习资料...')
  })

  it('shows error toast when any agent stage has error', async () => {
    const { result } = renderHook(() =>
      useAutoGenerate('s-1', makeMockProcessing({ mindmap: 'error' })),
    )
    await waitFor(() => {
      expect(result.current.state.autoGenerateToast).toBe('部分学习资料生成失败，可手动重试')
    })
  })

  it('handleTriggerAgents calls runAllAgents when given a sessionId', async () => {
    vi.spyOn(api, 'runAllAgents').mockResolvedValue({
      workflow_id: 'w-1',
      session_id: 's-1',
      agents: [],
    })

    // Use idle agent stages so observer effect doesn't set completion toast
    const { result } = renderHook(() =>
      useAutoGenerate('s-1', makeMockProcessing({ summary: 'idle', mindmap: 'idle', quiz_bank: 'idle' })),
    )

    await act(async () => {
      await result.current.actions.handleTriggerAgents('s-1')
    })

    expect(api.runAllAgents).toHaveBeenCalledWith('s-1', ['summary', 'mindmap', 'quiz'])
  })

  it('handleTriggerAgents does nothing when given undefined', async () => {
    vi.spyOn(api, 'runAllAgents').mockResolvedValue({
      workflow_id: 'w-1',
      session_id: 's-1',
      agents: [],
    })

    const { result } = renderHook(() =>
      useAutoGenerate(undefined, makeMockProcessing({ summary: 'idle', mindmap: 'idle', quiz_bank: 'idle' })),
    )

    await act(async () => {
      await result.current.actions.handleTriggerAgents(undefined)
    })

    expect(api.runAllAgents).not.toHaveBeenCalled()
  })

  it('handleTriggerAgents shows error toast on failure', async () => {
    vi.spyOn(api, 'runAllAgents').mockRejectedValue(new Error('agent error'))

    const { result } = renderHook(() =>
      useAutoGenerate('s-1', makeMockProcessing({ summary: 'idle', mindmap: 'idle', quiz_bank: 'idle' })),
    )

    await act(async () => {
      await result.current.actions.handleTriggerAgents('s-1')
    })

    expect(result.current.state.autoGenerateToast).toBe('自动启动学习资料生成失败，可手动重试')
  })

  it('auto-triggers agents when vector_index and transcript_finalize are ready', async () => {
    vi.spyOn(api, 'runAllAgents').mockResolvedValue({
      workflow_id: 'w-1',
      session_id: 's-1',
      agents: [],
    })

    renderHook(() => useAutoGenerate('s-1', makeMockProcessing()))

    await waitFor(() => {
      expect(api.runAllAgents).toHaveBeenCalledWith('s-1', ['summary', 'mindmap', 'quiz'])
    })
  })

  it('does not auto-trigger when autoGenerateStudyMaterials is disabled', async () => {
    localStorage.setItem('nootbook_auto_generate_study_materials', 'false')
    vi.spyOn(api, 'runAllAgents').mockResolvedValue({
      workflow_id: 'w-1',
      session_id: 's-1',
      agents: [],
    })

    renderHook(() => useAutoGenerate('s-1', makeMockProcessing()))

    await new Promise((r) => setTimeout(r, 50))
    expect(api.runAllAgents).not.toHaveBeenCalled()
  })

  it('does not auto-trigger when vector_index is not ready', async () => {
    vi.spyOn(api, 'runAllAgents').mockResolvedValue({
      workflow_id: 'w-1',
      session_id: 's-1',
      agents: [],
    })

    renderHook(() => useAutoGenerate('s-1', makeMockProcessing({ vector_index: 'running' })))

    await new Promise((r) => setTimeout(r, 50))
    expect(api.runAllAgents).not.toHaveBeenCalled()
  })

  it('does not auto-trigger when transcript_finalize is not ready', async () => {
    vi.spyOn(api, 'runAllAgents').mockResolvedValue({
      workflow_id: 'w-1',
      session_id: 's-1',
      agents: [],
    })

    renderHook(() => useAutoGenerate('s-1', makeMockProcessing({ transcript_finalize: 'running' })))

    await new Promise((r) => setTimeout(r, 50))
    expect(api.runAllAgents).not.toHaveBeenCalled()
  })
})
