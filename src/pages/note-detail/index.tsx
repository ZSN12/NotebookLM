import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { toast } from 'sonner';
import {
  ArrowLeft, Play, Pause, ChevronUp, ChevronDown, Edit3, Loader2, AlertCircle, ImagePlus,
  X, FileText, Square, Download, Bold, List, Share2, Trash2, Mic, MicOff, Search,
  ChevronDown as ChevronDownIcon, Database, RefreshCw, BrainCircuit, Copy, Check,
  ClipboardCheck, CircleDot, Sparkles
} from 'lucide-react';
import { useStore } from '@/store/useStore';
import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { getProfile, getAvatarUrl } from '@/services/auth';
import ThemeToggle from '@/components/ThemeToggle';
import RichTextEditor from '@/components/RichTextEditor';
import { API_BASE, deleteAudio, uploadPPT, insertPPTIntoTranscript, uploadAudio, getMediaUrl, fetchNotebookDetail, fetchSessionById, enableShare, disableShare, getShareStatus, rebuildSessionVectorIndex, getSessionMindMap, generateSessionMindMap, deleteSessionMindMap, MindMapStatus, MindMapNode, MindMapData, getSessionQuizzes, generateSessionQuiz, getQuizDetail, submitQuizAnswers, deleteQuiz, getQuizBankStatus, rebuildQuizBank, QuizListItem, QuizDetail, QuizQuestion, QuizBankStatus, runAllAgents, fetchNote } from '@/services/api';
import { sanitizeHTML } from '@/lib/sanitize';
import { layoutFromNoteParts } from '@/lib/noteLayout';
import type { Notebook, Session } from '@/types';

import { useRecording } from './useRecording';
import { useTranscript, StudentNote } from './useTranscript';
import { usePPT } from './usePPT';
import { useNotes } from './useNotes';
import { useExport } from './useExport';
import { useShare } from './hooks/useShare';
import { useVectorIndex } from './hooks/useVectorIndex';
import { useRAG } from './hooks/useRAG';
import { useMindMap } from './hooks/useMindMap';
import { useQuiz } from './hooks/useQuiz';
import { useAudioUpload } from './hooks/useAudioUpload';
import { useAutoGenerate } from './hooks/useAutoGenerate';
import { useRestructure } from './hooks/useRestructure';
import { useProcessingStatus } from './hooks/useProcessingStatus';
import MindMapCanvas, { computeDefaultExpanded } from './MindMapCanvas';
import type { ContentBlock, RAGSource } from '@/services/api';

const TEXT_COLORS = [
  { name: '红色', value: '#ef4444' },
  { name: '黄色', value: '#eab308' },
  { name: '蓝色', value: '#3b82f6' },
  { name: '黑色', value: '#1e293b' },
];

export default function NoteDetail() {
  const { id, sessionId } = useParams<{ id: string; sessionId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { notebooks, sessions } = useStore();

  const notebook = notebooks.find((n) => n.id === id);
  const session = sessions.find((s) => s.id === sessionId);
  const [fallbackNotebook, setFallbackNotebook] = useState<Notebook | null>(null);
  const [fallbackSession, setFallbackSession] = useState<Session | null>(null);
  const displayNotebook = notebook || fallbackNotebook;
  const displaySession = session || fallbackSession;
  const [profile, setProfile] = useState<any>(null);

  useEffect(() => { getProfile().then(setProfile).catch(() => {}); }, []);

  useEffect(() => {
    if (!id || notebook) return;
    fetchNotebookDetail(id).then((data) => {
      if (!data) return;
      setFallbackNotebook({
        id: data.id,
        title: data.title,
        description: data.description || '',
        icon: data.icon || 'BookOpen',
        color: data.color || 'from-blue-500 to-blue-600',
        sessionCount: data.session_count,
        updatedAt: data.created_at.split('T')[0],
        createdAt: data.created_at.split('T')[0],
      });
    }).catch(() => {});
  }, [id, notebook]);

  useEffect(() => {
    if (!sessionId || session) return;
    fetchSessionById(sessionId).then(setFallbackSession).catch(() => {});
  }, [sessionId, session]);

  // ---- Hooks ----
  const recording = useRecording(sessionId);
  const ppt = usePPT(sessionId);
  const notesHook = useNotes();
  const transcript = useTranscript(sessionId, recording.state.isRecording, ppt.state.slides);
  const exportTools = useExport(displaySession, displayNotebook);
  const processing = useProcessingStatus(sessionId);

  const share = useShare();
  const vectorIndex = useVectorIndex(sessionId, processing.processingStatus);
  const rag = useRAG();
  const mindMap = useMindMap(sessionId, processing.processingStatus);
  const quiz = useQuiz(sessionId, processing.processingStatus);
  const audioUpload = useAudioUpload(sessionId);
  const autoGen = useAutoGenerate(sessionId, processing.processingStatus);
  const restructure = useRestructure();

  const [isLoading, setIsLoading] = useState(true);
  const [showLeftPanel, setShowLeftPanel] = useState(false); // tablet sidebar
  const [aiCorrectionStatus, setAiCorrectionStatus] = useState<{ type: 'idle' | 'processing' | 'corrected' | 'local' | 'error'; message?: string }>({ type: 'idle' });

  const isPendingCorrectionMessage = (message?: string | null) => {
    if (!message) return false;
    return message.includes('等待统一 AI 整理') || message.includes('正在统一 AI 整理');
  };
  const [showRawDebug, setShowRawDebug] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const transcriptEditRef = useRef<HTMLDivElement>(null);
  const noteEditRef = useRef<HTMLDivElement>(null);
  const activeTextElRef = useRef<HTMLDivElement | null>(null);
  const lastSentenceIdxRef = useRef(0);
  const paragraphContainerRef = useRef<HTMLDivElement>(null);

  const getRagSourceTypeLabel = useCallback((source: RAGSource) => {
    const rawType = source.source_type === 'layout'
      ? String(source.metadata?.block_type || source.source_type)
      : source.source_type;
    if (rawType === 'ppt') return 'PPT';
    if (rawType === 'transcript') return '转写';
    if (rawType === 'note') return '笔记';
    return '资料';
  }, []);

  const highlightTranscriptSnippet = useCallback((snippet?: string | null) => {
    const container = paragraphContainerRef.current;
    if (!container || !snippet) return false;
    const normalize = (value: string) => value.replace(/\s+/g, '').toLowerCase();
    const target = normalize(snippet).slice(0, 80);
    if (!target) return false;

    const candidates = Array.from(container.children) as HTMLElement[];
    const targetEl = candidates.find((el) => normalize(el.textContent || '').includes(target));
    if (!targetEl) return false;

    targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    targetEl.classList.add('ring-2', 'ring-violet-300', 'bg-violet-50', 'dark:bg-violet-900/20');
    window.setTimeout(() => {
      targetEl.classList.remove('ring-2', 'ring-violet-300', 'bg-violet-50', 'dark:bg-violet-900/20');
    }, 3000);
    return true;
  }, []);

  const handleRagSourceClick = useCallback((source: RAGSource, closePanel?: () => void) => {
    closePanel?.();
    if (source.session_id && source.session_id !== sessionId) {
      navigate(`/subject/${source.notebook_id}/session/${source.session_id}`, { state: { ragSource: source } });
      return;
    }

    const pageNumber = source.page == null ? null : Number(source.page);
    const typeLabel = getRagSourceTypeLabel(source);
    if (typeLabel === 'PPT' && Number.isFinite(pageNumber) && pageNumber! > 0) {
      ppt.actions.setActiveSlideIndex(pageNumber! - 1);
      return;
    }

    window.setTimeout(() => {
      const located = highlightTranscriptSnippet(source.snippet);
      if (!located) toast.info('已找到来源，但当前页面没有可精确定位的文本块');
    }, 200);
  }, [getRagSourceTypeLabel, highlightTranscriptSnippet, navigate, ppt.actions, sessionId]);

  const renderRagSourceCards = useCallback((closePanel?: () => void) => (
    <div className="space-y-2">
      {rag.state.ragSources.map((source, index) => (
        <button
          key={source.chunk_id}
          onClick={() => handleRagSourceClick(source, closePanel)}
          className="w-full text-left rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-900/30 px-3 py-2 hover:border-violet-200 hover:bg-violet-50/60 dark:hover:bg-violet-900/20 transition-colors"
        >
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[10px] font-semibold text-violet-600 dark:text-violet-300 bg-violet-100 dark:bg-violet-900/40 rounded-full px-2 py-0.5">
              [{index + 1}] {getRagSourceTypeLabel(source)}
            </span>
            <span className="text-[10px] text-slate-400 truncate">{source.session_title}</span>
            {source.page != null && <span className="text-[10px] text-slate-400">第 {source.page} 页</span>}
            <span className="ml-auto text-[10px] text-slate-400">{Math.round(source.score * 100)}%</span>
          </div>
          <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed line-clamp-2">{source.snippet}</p>
        </button>
      ))}
    </div>
  ), [getRagSourceTypeLabel, handleRagSourceClick, rag.state.ragSources]);

  useEffect(() => {
    const source = (location.state as { ragSource?: RAGSource } | null)?.ragSource;
    if (!source || source.session_id !== sessionId) return;
    const timer = window.setTimeout(() => {
      handleRagSourceClick(source);
      navigate(location.pathname, { replace: true, state: null });
    }, 800);
    return () => window.clearTimeout(timer);
  }, [handleRagSourceClick, location.pathname, location.state, navigate, sessionId]);

  // ---- Load history ----
  // Notes & PPT are restored reactively when the transcript hook finishes its
  // single fetchNote, avoiding a duplicate network call.
  useEffect(() => {
    if (!sessionId) { setIsLoading(false); return; }
    // useTranscript.loadHistory fires independently and sets loadedNote.
    // We wait for it rather than calling fetchNote ourselves.
  }, [sessionId]);

  // React to loadedNote from useTranscript (single source of truth for history load)
  const loadedNote = transcript.state.loadedNote;
  useEffect(() => {
    if (!sessionId || !transcript.state.isLoaded) return;
    if (!loadedNote) {
      setIsLoading(false);
      return;
    }
    // Restore notes
    if (loadedNote.content) {
      const hasTranscript = loadedNote.transcript && Array.isArray(loadedNote.transcript) && loadedNote.transcript.length > 0;
      const parsed = notesHook.actions.parseNotesFromContent(loadedNote.content, hasTranscript);
      if (parsed.length > 0) notesHook.actions.setNotes(parsed);
    }
    // Set AI correction status from loaded note
    if (loadedNote?.transcript && Array.isArray(loadedNote.transcript) && loadedNote.transcript.length > 0) {
      const sorted = [...loadedNote.transcript].sort((a: any, b: any) => (a.chunk_index || 0) - (b.chunk_index || 0));
      const lastEntry = sorted[sorted.length - 1];
      if (lastEntry?.is_ai_corrected) {
        setAiCorrectionStatus({ type: 'corrected' });
      } else if (lastEntry?.correction_error && !isPendingCorrectionMessage(lastEntry.correction_error)) {
        setAiCorrectionStatus({ type: 'error', message: lastEntry.correction_error });
      } else if (lastEntry?.correction_error && isPendingCorrectionMessage(lastEntry.correction_error)) {
        setAiCorrectionStatus({ type: 'local' });
      } else if (lastEntry?.is_corrected === false) {
        setAiCorrectionStatus({ type: 'local' });
      }
    }
    if (loadedNote.ppt_images && loadedNote.ppt_images.length > 0) {
      const lastPpt = loadedNote.ppt_images[loadedNote.ppt_images.length - 1];
      if (lastPpt.slides) ppt.actions.setSlides(lastPpt.slides);
      // Only auto-insert PPT if we don't have saved layout_blocks
      const hasLayoutBlocks = loadedNote.layout_blocks && Array.isArray(loadedNote.layout_blocks) && loadedNote.layout_blocks.length > 0;
      if (!hasLayoutBlocks) {
        setTimeout(async () => {
          try {
            const blocks = await insertPPTIntoTranscript(sessionId);
            if (blocks.blocks?.some((b: ContentBlock) => b.type === 'image')) {
              transcript.actions.updateContentBlocks(blocks.blocks, false, false);
            }
          } catch { /* ignore */ }
        }, 500);
      }
    }
    setIsLoading(false);
  }, [loadedNote, sessionId, transcript.state.isLoaded]);

  // ---- Auto-save ----
  useEffect(() => {
    if (!sessionId || !transcript.state.isLoaded || !transcript.state.hasLocalChanges || audioUpload.state.isUploadingAudio) return;
    const timer = setTimeout(() => {
      transcript.actions.saveContent(notesHook.state.notes);
    }, 3000);
    return () => clearTimeout(timer);
  }, [
    sessionId,
    transcript.state.isLoaded,
    transcript.state.hasLocalChanges,
    transcript.state.transcriptText,
    transcript.state.contentBlocks,
    notesHook.state.notes,
    transcript.actions.saveContent,
    audioUpload.state.isUploadingAudio,
  ]);

  const workflowStatus = useMemo(() => {
    const stages = processing.processingStatus?.stages;
    if (ppt.state.isUploadingPPT) return { tone: 'blue', text: '正在上传并解析 PPT' };
    if (audioUpload.state.isUploadingAudio) return { tone: 'blue', text: audioUpload.state.audioUploadStatus || '正在上传录音并转写' };
    if (recording.state.isProcessing) return { tone: 'blue', text: '正在初始化录音设备' };
    if (recording.state.isRecording && recording.state.isPaused) return { tone: 'amber', text: '录音已暂停' };
    if (recording.state.isRecording) return { tone: 'red', text: `录音中 ${recording.state.currentTime}` };
    if (stages?.upload_transcribe?.status === 'running') return { tone: 'blue', text: stages.upload_transcribe.message || '正在上传录音并转写' };
    if (stages?.recording_finalize?.status === 'running') return { tone: 'blue', text: '正在整理录音...' };
    if (stages?.transcript_finalize?.status === 'running') return { tone: 'violet', text: '正在统一 AI 整理...' };
    if (stages?.vector_index?.status === 'running') return { tone: 'blue', text: '正在建立知识索引...' };
    if (stages?.summary?.status === 'running' || stages?.mindmap?.status === 'running' || stages?.quiz_bank?.status === 'running') return { tone: 'blue', text: autoGen.state.autoGenerateToast || '正在生成学习资料...' };
    if (stages?.transcript_finalize?.status === 'error') return { tone: 'red', text: stages.transcript_finalize.error_message || '整理失败' };
    if (stages?.transcript_finalize?.status === 'fallback') return { tone: 'amber', text: '已使用本地整理稿' };
    if (stages?.upload_transcribe?.status === 'error') return { tone: 'red', text: '上传转写失败' };
    if (stages?.recording_finalize?.status === 'error') return { tone: 'red', text: '录音整理失败' };
    if (stages?.vector_index?.status === 'error') return { tone: 'red', text: '知识索引建立失败' };
    if (stages?.mindmap?.status === 'error' || stages?.quiz_bank?.status === 'error') return { tone: 'red', text: '学习资料生成失败，可手动重试' };
    if (autoGen.state.autoGenerateToast?.startsWith('正在')) return { tone: 'blue', text: autoGen.state.autoGenerateToast };
    if (transcript.state.isPptMatching) return { tone: 'blue', text: '正在匹配 PPT 页面' };
    if (transcript.state.saveStatus === 'saving') return { tone: 'blue', text: '正在自动保存' };
    if (transcript.state.saveStatus === 'error') return { tone: 'red', text: transcript.state.saveError || '保存失败' };
    if (ppt.state.uploadMessage) return { tone: 'green', text: ppt.state.uploadMessage };
    if (transcript.state.pptMatchMessage) return { tone: 'slate', text: transcript.state.pptMatchMessage };
    if (transcript.state.lastSaveTime) {
      const time = new Date(transcript.state.lastSaveTime).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
      return { tone: 'green', text: `已保存 ${time}` };
    }
    return { tone: 'slate', text: '准备记录' };
  }, [
    processing.processingStatus?.stages,
    audioUpload.state.isUploadingAudio,
    audioUpload.state.audioUploadStatus,
    ppt.state.isUploadingPPT,
    ppt.state.uploadMessage,
    recording.state.currentTime,
    recording.state.isPaused,
    recording.state.isProcessing,
    recording.state.isRecording,
    autoGen.state.autoGenerateToast,
    transcript.state.isPptMatching,
    transcript.state.lastSaveTime,
    transcript.state.pptMatchMessage,
    transcript.state.saveError,
    transcript.state.saveStatus,
  ]);

  const statusClass = {
    blue: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/20 dark:text-blue-300 dark:border-blue-800',
    green: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-300 dark:border-emerald-800',
    amber: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/20 dark:text-amber-300 dark:border-amber-800',
    red: 'bg-red-50 text-red-700 border-red-200 dark:bg-red-900/20 dark:text-red-300 dark:border-red-800',
    violet: 'bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-900/20 dark:text-violet-300 dark:border-violet-800',
    slate: 'bg-slate-50 text-slate-600 border-slate-200 dark:bg-slate-800/60 dark:text-slate-300 dark:border-slate-700',
  }[workflowStatus.tone];
  const isLiveTranscriptMode = recording.state.isRecording || recording.state.isProcessing || audioUpload.state.isUploadingAudio;
  // Has PPT blocks with image: show them even during recording
  const hasPptImageBlocks = transcript.state.contentBlocks.some(b => b.type === 'image');

  // ---- Format helpers ----
  const applyFormat = (formatType: string, value?: string) => {
    const el = activeTextElRef.current;
    if (!el) return;
    el.focus();
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    if (range.collapsed) return;
    const selectedText = range.toString();
    if (!selectedText) return;

    switch (formatType) {
      case 'bold': {
        const wrapper = document.createElement('strong');
        try {
          range.surroundContents(wrapper);
        } catch {
          const fragment = range.extractContents();
          wrapper.appendChild(fragment);
          range.insertNode(wrapper);
        }
        break;
      }
      case 'insertUnorderedList': {
        const ul = document.createElement('ul');
        const li = document.createElement('li'); li.textContent = selectedText;
        ul.appendChild(li); range.deleteContents(); range.insertNode(ul);
        break;
      }
      case 'foreColor': {
        if (value) {
          const span = document.createElement('span'); span.style.color = value;
          try {
            range.surroundContents(span);
          } catch {
            const fragment = range.extractContents();
            span.appendChild(fragment);
            range.insertNode(span);
          }
        }
        break;
      }
    }
    sel.removeAllRanges();
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };

  const normalizeTranscriptBlockForDisplay = (content?: string) => {
    return (content || '').trim().replace(/^#{1,6}\s*/, '');
  };

  // ---- Share ----


  // ---- Vector Index ----

  useEffect(() => {
    if (!transcript.state.hasLocalChanges) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [transcript.state.hasLocalChanges]);










  // ---- PPT ----
  const handlePPTClick = () => fileInputRef.current?.click();

  const handlePPTSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await ppt.actions.handlePPTUpload(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };






  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950">
        <div className="flex items-center gap-2 text-slate-400"><Loader2 className="w-5 h-5 animate-spin" /> 加载中...</div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-slate-50 dark:bg-slate-950">
      {/* ---- Top Nav ---- */}
      <nav className="flex-shrink-0 bg-white/70 dark:bg-slate-900/70 backdrop-blur-md border-b border-slate-200/60 dark:border-slate-800/60">
        <div className="px-3 py-2 flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <button onClick={() => navigate(`/subject/${id}`)} className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div className="min-w-0">
              <h1 className="text-sm font-semibold text-slate-800 dark:text-slate-200 truncate">{displaySession?.title || '课次'}</h1>
              <p className="text-xs text-slate-400 truncate">{displayNotebook?.title}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <button onClick={() => exportTools.actions.setShowExportMenu(!exportTools.state.showExportMenu)}
                className="flex items-center gap-1 px-3 py-2 text-sm text-slate-500 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-colors" title="导出">
                <Download className="w-3.5 h-3.5" />
                <ChevronDownIcon className="w-3 h-3" />
              </button>
              {exportTools.state.showExportMenu && (
                <div className="absolute right-0 top-full mt-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-lg py-1 z-50 min-w-[140px]">
                  <button onClick={() => {
                    const blocks = layoutFromNoteParts(transcript.state.transcriptText, transcript.state.contentBlocks, notesHook.state.notes);
                    exportTools.actions.exportMarkdown(transcript.state.transcriptText, notesHook.state.notes, blocks);
                  }}
                    className="w-full text-left px-3 py-2 text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors">
                    📝 导出 Markdown
                  </button>
                  <button onClick={() => {
                    const blocks = layoutFromNoteParts(transcript.state.transcriptText, transcript.state.contentBlocks, notesHook.state.notes);
                    exportTools.actions.exportPDF(transcript.state.transcriptText, notesHook.state.notes, blocks);
                  }} disabled={exportTools.state.isExportingPDF}
                    className="w-full text-left px-3 py-2 text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors disabled:opacity-50">
                    {exportTools.state.isExportingPDF ? '⏳ 导出中...' : '📄 导出 PDF'}
                  </button>
                  <button onClick={() => exportTools.actions.exportNotebookPackage()} disabled={exportTools.state.isExportingPackage}
                    className="w-full text-left px-3 py-2 text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors disabled:opacity-50">
                    {exportTools.state.isExportingPackage ? '⏳ 导出中...' : '📦 导出笔记本包'}
                  </button>
                </div>
              )}
            </div>
            <button onClick={() => share.actions.handleShareSession(sessionId!, share.state.shareExpiresIn, share.state.shareMaxViewsInput)} className="flex items-center gap-1 px-3 py-2 text-sm text-slate-500 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-colors" title="分享">
              <Share2 className="w-3.5 h-3.5" />
            </button>
            <button onClick={() => { const willOpen = !rag.state.showSearch; rag.actions.setShowSearch(willOpen); if (willOpen) vectorIndex.actions.ensureIndexed(); }} className={`flex items-center gap-1 px-3 py-2 text-sm rounded-lg transition-colors ${rag.state.showSearch ? 'text-blue-600 bg-blue-50 dark:bg-blue-900/20' : 'text-slate-500 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20'}`} title="搜索">
              <Search className="w-3.5 h-3.5" />
            </button>
            <button onClick={() => { mindMap.actions.setShowMindMap(true); vectorIndex.actions.ensureIndexed(); }} className="flex items-center gap-1 px-3 py-2 text-sm text-slate-500 hover:text-purple-600 hover:bg-purple-50 dark:hover:bg-purple-900/20 rounded-lg transition-colors" title="知识导图">
              <BrainCircuit className="w-3.5 h-3.5" />
            </button>
            <button onClick={() => { quiz.actions.setShowQuiz(true); quiz.actions.setActiveQuiz(null); quiz.actions.setQuizSubmitted(false); quiz.actions.setQuizAnswers({}); quiz.actions.setQuizError(null); vectorIndex.actions.ensureIndexed(); }} className="flex items-center gap-1 px-3 py-2 text-sm text-slate-500 hover:text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 rounded-lg transition-colors" title="测验">
              <ClipboardCheck className="w-3.5 h-3.5" />
            </button>
            <div className="flex items-center gap-1 px-2 py-1 text-xs rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
              {vectorIndex.state.vectorStatus?.status === 'indexed' ? (
                <>
                  <Database className="w-3 h-3 text-green-500" />
                  <span className="text-green-600 dark:text-green-400">已索引 {vectorIndex.state.vectorStatus.chunk_count}条</span>
                  <button onClick={vectorIndex.actions.handleRebuildIndex} disabled={vectorIndex.state.isRebuilding} className="ml-1 text-slate-400 hover:text-blue-500" title="重建索引">
                    <RefreshCw className={`w-3 h-3 ${vectorIndex.state.isRebuilding ? 'animate-spin' : ''}`} />
                  </button>
                </>
              ) : vectorIndex.state.vectorStatus?.status === 'stale' ? (
                <>
                  <Database className="w-3 h-3 text-amber-500" />
                  <span className="text-amber-600 dark:text-amber-400">内容已变化</span>
                  <button onClick={vectorIndex.actions.handleRebuildIndex} disabled={vectorIndex.state.isRebuilding} className="ml-1 text-amber-500 hover:text-blue-500 font-medium" title="重建索引">
                    {vectorIndex.state.isRebuilding ? <Loader2 className="w-3 h-3 animate-spin" /> : '重建'}
                  </button>
                </>
              ) : vectorIndex.state.vectorStatus?.status === 'not_indexed' ? (
                <>
                  <Database className="w-3 h-3 text-slate-400" />
                  <button onClick={vectorIndex.actions.handleRebuildIndex} disabled={vectorIndex.state.isRebuilding} className="text-slate-500 hover:text-blue-500" title="建立索引">
                    {vectorIndex.state.isRebuilding ? <Loader2 className="w-3 h-3 animate-spin" /> : '建立索引'}
                  </button>
                </>
              ) : (
                <span className="text-slate-400">无内容</span>
              )}
            </div>
            <ThemeToggle />
            <button onClick={() => navigate('/profile')} className="cursor-pointer">
              {profile?.avatar_url ? (
                <img src={getAvatarUrl(profile.id)} alt="avatar" className="w-7 h-7 rounded-full object-cover" />
              ) : (
                <div className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center text-white text-xs font-bold">
                  {(profile?.username || profile?.email || 'U')[0].toUpperCase()}
                </div>
              )}
            </button>
          </div>
        </div>
      </nav>

      {/* ---- Toolbar ---- */}
      <div className="flex-shrink-0 bg-white/60 dark:bg-slate-800/60 backdrop-blur-sm border-b border-slate-200/60 dark:border-slate-700/60">
        <div className="px-3 py-2 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <input ref={fileInputRef} type="file" accept=".ppt,.pptx,.pdf" onChange={handlePPTSelect} className="hidden" />
            <button onClick={handlePPTClick} disabled={ppt.state.isUploadingPPT}
              className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg hover:border-blue-300 hover:text-blue-600 transition-all disabled:opacity-50">
              {ppt.state.isUploadingPPT ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ImagePlus className="w-3.5 h-3.5" />}
              {ppt.state.isUploadingPPT ? '上传中...' : '上传PPT'}
            </button>
            {ppt.state.slides.length > 0 && <span className="text-xs text-slate-400">{ppt.state.slides.length} 页</span>}

            <input ref={audioUpload.refs.audioInputRef} type="file" multiple accept=".wav,.mp3,.webm,.m4a,.ogg,.flac" onChange={(e) => {
                  const files = e.target.files;
                  if (!files || files.length === 0) return;
                  audioUpload.actions.handleAudioUpload(Array.from(files), {
                    clearDerivedTranscriptViews: transcript.actions.clearDerivedTranscriptViews,
                    clearStreamingTranscriptChunks: transcript.actions.clearStreamingTranscriptChunks,
                    updateTranscriptText: transcript.actions.updateTranscriptText,
                    appendTranscriptText: transcript.actions.appendTranscriptText,
                    clearStreamingTranscriptChunksFinal: transcript.actions.clearStreamingTranscriptChunks,
                    clearContentBlocks: transcript.actions.clearContentBlocks,
                    scrollToBottom: () => {
                      if (paragraphContainerRef.current) {
                        paragraphContainerRef.current.scrollTop = paragraphContainerRef.current.scrollHeight;
                      }
                    },
                  }, setAiCorrectionStatus);
                }} className="hidden" />
            <button onClick={() => { if (audioUpload.refs.audioInputRef.current) audioUpload.refs.audioInputRef.current.value = ''; audioUpload.refs.audioInputRef.current?.click(); }} disabled={audioUpload.state.isUploadingAudio}
              className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg hover:border-green-300 hover:text-green-600 transition-all disabled:opacity-50">
              {audioUpload.state.isUploadingAudio ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Mic className="w-3.5 h-3.5" />}
              {audioUpload.state.isUploadingAudio
                ? (audioUpload.state.audioQueueProgress
                  ? `上传中 ${audioUpload.state.audioQueueProgress.current}/${audioUpload.state.audioQueueProgress.total}`
                  : '上传中...')
                : '上传录音'}
            </button>
          </div>

          <div className="flex items-center gap-3">
            <div className="relative">
              {recording.state.isProcessing ? (
                <button disabled className="w-9 h-9 rounded-full bg-gradient-to-br from-blue-500 to-blue-600 text-white flex items-center justify-center shadow-lg cursor-wait">
                  <Loader2 className="w-4 h-4 animate-spin" />
                </button>
              ) : recording.state.isError ? (
                <button onClick={() => {
                  if (recording.state.isRecording) {
                    recording.actions.stopRecording(transcript.actions.receiveAiText);
                  }
                }}
                  className="w-9 h-9 rounded-full bg-gradient-to-br from-red-500 to-red-600 text-white flex items-center justify-center shadow-lg hover:shadow-xl transition-all hover:scale-105 active:scale-95">
                  <AlertCircle className="w-4 h-4" />
                </button>
              ) : (
                <button onClick={() => {
                  if (recording.state.isPaused) recording.actions.resumeRecording();
                  else if (recording.state.isRecording) recording.actions.pauseRecording();
                  else {
                    transcript.actions.clearDerivedTranscriptViews();
                    transcript.actions.clearStreamingState();
                    recording.actions.startRecording(
                      transcript.actions.receivePartial,
                      transcript.actions.receiveFinal,
                    );
                  }
                }}
                  className={`w-11 h-11 rounded-full text-white flex items-center justify-center shadow-lg hover:shadow-xl transition-all hover:scale-105 active:scale-95 ${
                    recording.state.isRecording ? 'bg-gradient-to-br from-amber-500 to-amber-600 shadow-amber-200' : 'bg-gradient-to-br from-blue-500 to-blue-600 shadow-blue-200'
                  }`}>
                  {recording.state.isRecording ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
                </button>
              )}
            </div>

            <div className="flex items-center gap-0.5 h-7 hidden sm:flex">
              {recording.state.waveHeights.map((height, i) => (
                <div key={i} className="w-1 rounded-full transition-all duration-75"
                  style={{ height: `${height}px`, backgroundColor: recording.state.isRecording ? 'rgba(59, 130, 246, 0.5)' : 'rgba(148, 163, 184, 0.3)' }}
                />
              ))}
            </div>

            <span className="text-sm font-mono font-medium text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-700 px-2.5 py-0.5 rounded-md tabular-nums">
              {recording.state.currentTime}
            </span>

            {recording.state.isRecording && (
              <button onClick={() => {
                if (recording.state.isPaused) recording.actions.resumeRecording();
                else recording.actions.pauseRecording();
              }}
                className="flex items-center gap-1 px-3 py-2 text-sm font-medium rounded-md bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 hover:bg-amber-200 transition-colors min-h-[44px]">
                {recording.state.isPaused ? <Play className="w-3 h-3" /> : <Square className="w-3 h-3" />}
                {recording.state.isPaused ? '继续' : '暂停'}
              </button>
            )}

            {recording.state.isRecording && (
              <button onClick={() => {
                setAiCorrectionStatus({ type: 'processing', message: '正在统一 AI 整理...' });
                recording.actions.stopRecording(transcript.actions.receiveAiText).then((result) => {
                  const note = result?.note;
                  if (note) {
                    const sorted = [...note.transcript].sort((a: any, b: any) => (a.chunk_index || 0) - (b.chunk_index || 0));
                    const lastEntry = sorted[sorted.length - 1];
                    if (lastEntry?.is_ai_corrected) {
                      setAiCorrectionStatus({ type: 'corrected' });
                    } else if (lastEntry?.correction_error) {
                      setAiCorrectionStatus({ type: 'error', message: lastEntry.correction_error });
                    } else {
                      setAiCorrectionStatus({ type: 'local' });
                    }
                  } else {
                    setAiCorrectionStatus({ type: 'local' });
                  }
                  // Backend auto-triggers vector index and agents via processing status
                });
              }}
                className="flex items-center gap-1 px-3 py-2 text-sm font-medium rounded-md bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 hover:bg-red-200 dark:hover:bg-red-900/50 transition-colors min-h-[44px]">
                <MicOff className="w-3.5 h-3.5" />
                停止
              </button>
            )}
          </div>

          <div className="flex items-center gap-1.5">
            <button onMouseDown={(e) => e.preventDefault()} onClick={() => applyFormat('bold')}
              className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-md text-slate-500 dark:text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition-colors" title="加粗">
              <Bold className="w-5 h-5" />
            </button>
            <button onMouseDown={(e) => e.preventDefault()} onClick={() => applyFormat('insertUnorderedList')}
              className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-md text-slate-500 dark:text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition-colors" title="列表">
              <List className="w-5 h-5" />
            </button>
            <div className="w-px h-5 bg-slate-200 dark:bg-slate-600 mx-1" />
            <div className="flex items-center gap-1.5">
              {TEXT_COLORS.map((color) => (
                <button key={color.value} onMouseDown={(e) => e.preventDefault()} onClick={() => applyFormat('foreColor', color.value)}
                  className="w-7 h-7 rounded-full border-2 border-slate-300 dark:border-slate-500 hover:scale-125 hover:border-slate-400 transition-all"
                  style={{ backgroundColor: color.value }} title={color.name} />
              ))}
            </div>
          </div>
        </div>
      </div>

      {autoGen.state.autoGenerateToast && (
        <div className={`flex-shrink-0 mx-4 mt-3 px-3 py-2 border rounded-xl flex items-center gap-2 text-xs ${autoGen.state.autoGenerateToast.startsWith('正在') ? 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/20 dark:text-blue-300 dark:border-blue-800' : autoGen.state.autoGenerateToast.includes('失败') ? 'bg-red-50 text-red-700 border-red-200 dark:bg-red-900/20 dark:text-red-300 dark:border-red-800' : 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/20 dark:text-amber-300 dark:border-amber-800'}`}>
          {autoGen.state.autoGenerateToast.startsWith('正在') ? <Loader2 className="w-3.5 h-3.5 animate-spin flex-shrink-0" /> : autoGen.state.autoGenerateToast.includes('失败') ? <AlertCircle className="w-3.5 h-3.5 text-red-500 flex-shrink-0" /> : <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />}
          <span className="flex-1">{autoGen.state.autoGenerateToast}</span>
        </div>
      )}

      <div className={`flex-shrink-0 mx-4 mt-3 px-3 py-2 border rounded-xl flex items-center gap-2 text-xs ${statusClass}`}>
        {(ppt.state.isUploadingPPT || audioUpload.state.isUploadingAudio || recording.state.isProcessing || transcript.state.isPptMatching || transcript.state.saveStatus === 'saving' || processing.processingStatus?.overall_status === 'running') && (
          <Loader2 className="w-3.5 h-3.5 animate-spin flex-shrink-0" />
        )}
        <span className="flex-1">{workflowStatus.text}</span>
        <div className="flex items-center gap-1.5 ml-2" title="转写完成后自动生成学习资料">
          <input
            type="checkbox"
            id="auto-generate"
            checked={autoGen.state.autoGenerateStudyMaterials}
            onChange={(e) => autoGen.actions.setAutoGenerateStudyMaterials(e.target.checked)}
            className="w-3.5 h-3.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
          />
          <label htmlFor="auto-generate" className="cursor-pointer select-none text-[10px] opacity-80 hover:opacity-100">自动生成</label>
        </div>
        {transcript.state.saveStatus === 'error' && (
          <button
            onClick={() => transcript.actions.saveContent(notesHook.state.notes, true)}
            className="px-2 py-1 rounded-md bg-white/70 dark:bg-slate-900/60 hover:bg-white text-xs font-medium"
          >
            重试保存
          </button>
        )}
      </div>

      {recording.state.isError && recording.state.errorMessage && (
        <div className="flex-shrink-0 mx-4 mt-3 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl flex items-start gap-2">
          <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
          <div className="flex-1"><p className="text-xs text-red-600 dark:text-red-400">{recording.state.errorMessage}</p></div>
          <button onClick={() => { recording.actions.setIsError(false); recording.actions.setErrorMessage(''); }}
            className="p-0.5 text-red-400 hover:text-red-600"><X className="w-3.5 h-3.5" /></button>
        </div>
      )}

      {ppt.state.uploadError && (
        <div className="flex-shrink-0 mx-4 mt-3 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl flex items-start gap-2">
          <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
          <div className="flex-1"><p className="text-xs text-red-600 dark:text-red-400">{ppt.state.uploadError}</p></div>
          <button onClick={() => ppt.actions.setUploadError(null)} className="text-red-400 hover:text-red-600"><X className="w-4 h-4" /></button>
        </div>
      )}

      {audioUpload.state.audioUploadError && (
        <div className="flex-shrink-0 mx-4 mt-3 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl flex items-start gap-2">
          <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
          <div className="flex-1"><p className="text-xs text-red-600 dark:text-red-400">{audioUpload.state.audioUploadError}</p></div>
          <button onClick={() => audioUpload.actions.setAudioUploadError(null)}
            className="p-0.5 text-red-400 hover:text-red-600"><X className="w-3.5 h-3.5" /></button>
        </div>
      )}

      {transcript.state.isAiRestructuring && recording.state.isRecording && (
        <div className="flex-shrink-0 mx-4 mt-2 flex items-center gap-2 px-3 py-2 bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800 rounded-lg text-xs text-blue-600 dark:text-blue-400">
          <Loader2 className="w-3 h-3 animate-spin" />
          AI 正在整理文本...
        </div>
      )}

      {transcript.state.pendingAiText && (
        <div className="flex-shrink-0 mx-4 mt-3 p-3 bg-violet-50 dark:bg-violet-900/20 border border-violet-200 dark:border-violet-800 rounded-xl flex items-start gap-2">
          <FileText className="w-4 h-4 text-violet-500 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-xs text-violet-700 dark:text-violet-300">有 AI 整理版本可应用，当前编辑内容不会被自动覆盖。</p>
          </div>
          <button onClick={transcript.actions.applyPendingAiText} className="px-2 py-1 rounded-md bg-violet-500 text-white text-xs font-medium hover:bg-violet-600">应用</button>
          <button onClick={transcript.actions.dismissPendingAiText} className="text-violet-400 hover:text-violet-600"><X className="w-4 h-4" /></button>
        </div>
      )}

      {/* ---- Three-column layout (sidebars overlay on tablet) ---- */}
      <div className="flex-1 flex overflow-hidden">
        {!showLeftPanel && (
          <button
            onClick={() => setShowLeftPanel(true)}
            className="lg:hidden fixed bottom-20 right-6 z-40 w-11 h-11 rounded-full bg-blue-500 text-white shadow-lg flex items-center justify-center hover:bg-blue-600 transition-colors"
            title="PPT 与笔记"
          >
            <FileText className="w-5 h-5" />
          </button>
        )}

        {/* ---- Left (1/3): PPT on top, Notes on bottom ---- */}
        {showLeftPanel && <div onClick={() => setShowLeftPanel(false)} className="lg:hidden fixed inset-0 z-40 bg-black/50 backdrop-blur-sm" />}
        <aside className={`${showLeftPanel ? 'fixed inset-y-0 left-0 z-50 w-80' : 'hidden'} lg:relative lg:flex lg:w-[400px] xl:w-[440px] flex-shrink-0 bg-white/60 dark:bg-slate-800/60 backdrop-blur-sm border-r border-slate-200/60 dark:border-slate-700/60 flex flex-col overflow-hidden`}>
          <div className="lg:hidden flex-shrink-0 px-3 py-2 flex items-center justify-between border-b border-slate-200/60 dark:border-slate-700/60">
            <div className="flex items-center gap-1.5">
              <FileText className="w-3.5 h-3.5 text-blue-500" />
              <h3 className="text-xs font-semibold text-slate-600 dark:text-slate-300">PPT 与笔记</h3>
            </div>
            <button onClick={() => setShowLeftPanel(false)} className="min-w-[36px] min-h-[36px] flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* PPT section (top) */}
          <div className="flex-shrink-0 border-b border-slate-200/60 dark:border-slate-700/60">
            <div className="px-3 py-2 flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5 text-blue-500" />
                <h3 className="text-xs font-semibold text-slate-600 dark:text-slate-300">PPT</h3>
              </div>
              {ppt.state.slides.length > 0 && (
                <div className="flex items-center gap-1">
                  <span className="text-xs text-slate-400 font-mono">{ppt.state.activeSlideIndex + 1}/{ppt.state.slides.length}</span>
                  <button onClick={() => ppt.actions.setActiveSlideIndex(Math.max(0, ppt.state.activeSlideIndex - 1))}
                    disabled={ppt.state.activeSlideIndex === 0}
                    className="min-w-[32px] min-h-[32px] rounded text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-30 transition-colors flex items-center justify-center">
                    <ChevronUp className="w-5 h-5" />
                  </button>
                  <button onClick={() => ppt.actions.setActiveSlideIndex(Math.min(ppt.state.slides.length - 1, ppt.state.activeSlideIndex + 1))}
                    disabled={ppt.state.activeSlideIndex === ppt.state.slides.length - 1}
                    className="min-w-[32px] min-h-[32px] rounded text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-30 transition-colors flex items-center justify-center">
                    <ChevronDown className="w-5 h-5" />
                  </button>
                </div>
              )}
            </div>

            {/* PPT slide image */}
            <div className="px-3 pb-3">
              {ppt.state.slides.length > 0 && ppt.state.slides[ppt.state.activeSlideIndex] ? (
                <div className="rounded-lg overflow-hidden border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
                  {(() => {
                    const s = ppt.state.slides[ppt.state.activeSlideIndex];
                    const src = s.image_path
                      ? getMediaUrl(`/api/media/slides/${sessionId}/${s.image_path}`)
                      : s.image_base64 || '';
                    return src ? (
                      <img src={src} alt={`Slide ${s.page}`}
                        className="w-full object-cover"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                    ) : (
                      <div className="flex items-center justify-center h-28 text-xs text-slate-400">无预览图</div>
                    );
                  })()}
                </div>
              ) : (
                <div className="flex items-center justify-center h-28 bg-slate-50 dark:bg-slate-900/50 rounded-lg border border-dashed border-slate-300 dark:border-slate-600">
                  <p className="text-xs text-slate-400">上传PPT后显示</p>
                </div>
              )}
            </div>
          </div>

          {/* Notes section (bottom, flex-1) */}
          <div className="flex-1 flex flex-col min-h-0">
            <div className="flex-shrink-0 px-3 py-2 border-b border-slate-100 dark:border-slate-700/50 flex items-center gap-1.5">
              <Edit3 className="w-3.5 h-3.5 text-amber-500" />
              <h3 className="text-xs font-semibold text-slate-600 dark:text-slate-300">随堂思考与重难点</h3>
            </div>
            <div className="flex-1 overflow-y-auto p-3">
              <RichTextEditor
                ref={noteEditRef}
                value={notesHook.state.notes.length > 0 ? notesHook.state.notes[0].content : ''}
                onChange={(text) => {
                  transcript.actions.markUserEdited();
                  notesHook.actions.updateNote(0, text);
                }}
                onFocus={() => {
                  activeTextElRef.current = noteEditRef.current;
                }}
                placeholder="在此记录随堂思考与重难点..."
                className="rich-text-editor w-full p-2.5 text-sm text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-200 leading-relaxed"
              />
            </div>
          </div>
        </aside>

        {/* ---- Right (2/3): Transcript ---- */}
        <main className="flex-1 flex flex-col min-h-0 bg-white/40 dark:bg-slate-900/40 backdrop-blur-sm">
          <div className="flex-shrink-0 px-4 md:px-6 py-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-slate-600 dark:text-slate-300 flex items-center gap-2">
                {recording.state.isRecording ? <span className="w-2 h-2 rounded-full bg-red-400 animate-pulse" /> : <span className="w-2 h-2 rounded-full bg-slate-400" />}
                语音转文字 {recording.state.isRecording && <span className="text-xs font-normal text-slate-400">录制中</span>}
                {aiCorrectionStatus.type === 'corrected' && (
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" title="DeepSeek AI 已纠正同音字、术语和格式">AI 已纠正</span>
                )}
                {aiCorrectionStatus.type === 'processing' && (
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 inline-flex items-center gap-1" title={aiCorrectionStatus.message || '正在调用 DeepSeek 整理转写'}>
                    <Loader2 className="w-3 h-3 animate-spin" />
                    AI 整理中
                  </span>
                )}
                {aiCorrectionStatus.type === 'local' && (
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" title="未配置 DeepSeek API 或 AI 纠正被拦截，使用本地规则整理">本地整理</span>
                )}
                {aiCorrectionStatus.type === 'error' && (
                  <span
                    className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 cursor-help"
                    title={aiCorrectionStatus.message || 'AI 整理失败'}
                  >
                    {aiCorrectionStatus.message?.includes('删减')
                      ? 'AI 纠正被拦截：疑似删减'
                      : aiCorrectionStatus.message?.includes('超时')
                        ? 'AI 纠正超时'
                        : aiCorrectionStatus.message?.includes('未配置')
                          ? '本地整理：未配置 API'
                          : 'AI 纠正失败'}
                  </span>
                )}
              </h2>
              <div className="flex items-center gap-2">
                {transcript.state.transcriptText && !recording.state.isRecording && (
                  <button
                    onClick={() => restructure.actions.handleRestructure(sessionId, transcript.actions.receiveAiText, setAiCorrectionStatus)}
                    disabled={restructure.state.isRestructuring}
                    className="px-2 py-1 text-[10px] font-medium rounded bg-blue-50 text-blue-600 hover:bg-blue-100 dark:bg-blue-900/20 dark:text-blue-400 dark:hover:bg-blue-900/30 disabled:opacity-50 flex items-center gap-1 transition-colors"
                    title="重新调用 DeepSeek 整理转写文本"
                  >
                    {restructure.state.isRestructuring ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                    重新 AI 整理
                  </button>
                )}
                {transcript.state.transcriptText && (
                  <button
                    onClick={() => setShowRawDebug(v => !v)}
                    className="px-2 py-1 text-[10px] font-medium rounded bg-slate-50 text-slate-500 hover:bg-slate-100 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700 transition-colors"
                  >
                    {showRawDebug ? '隐藏调试' : '调试'}
                  </button>
                )}
                {transcript.state.lastSaveTime && <span className="text-xs text-slate-400">已保存 {new Date(transcript.state.lastSaveTime).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</span>}
              </div>
            </div>

            {recording.state.audioPlaybackUrl && !recording.state.isRecording && (
              <div className="mb-3 p-2.5 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl flex items-center gap-3">
                <button onClick={() => {
                  if (!recording.refs.audioPlayerRef.current) return;
                  if (recording.state.isPlayingAudio) { recording.refs.audioPlayerRef.current.pause(); recording.actions.setIsPlayingAudio(false); }
                  else { recording.refs.audioPlayerRef.current.play(); recording.actions.setIsPlayingAudio(true); }
                }}
                  className="min-w-[44px] min-h-[44px] rounded-full bg-blue-500 text-white flex items-center justify-center hover:bg-blue-600 transition-colors">
                  {recording.state.isPlayingAudio ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5 ml-0.5" />}
                </button>
                <span className="text-xs text-blue-600 dark:text-blue-400 flex-1">录音回放</span>
                <button onClick={async () => {
                  if (!sessionId || !window.confirm('确定要删除录音文件吗？')) return;
                  await deleteAudio(sessionId);
                }}
                  className="min-w-[44px] min-h-[44px] rounded-lg text-red-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 flex items-center justify-center transition-colors" title="删除录音">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
                <audio ref={recording.refs.audioPlayerRef} src={recording.state.audioPlaybackUrl}
                  onEnded={() => { recording.actions.setIsPlayingAudio(false); transcript.actions.setActiveSentenceIndex(null); lastSentenceIdxRef.current = 0; }}
                  onPause={() => { recording.actions.setIsPlayingAudio(false); }}
                  onPlay={() => { recording.actions.setIsPlayingAudio(true); lastSentenceIdxRef.current = 0; }}
                  onTimeUpdate={(e) => {
                    const currentTime = (e.target as HTMLAudioElement).currentTime;
                    const sentences = transcript.state.sentencesWithTime;
                    if (sentences.length === 0) return;
                    // Start scanning from last matched index (audio usually goes forward)
                    let idx = lastSentenceIdxRef.current;
                    if (idx >= sentences.length || currentTime < sentences[idx].startTime) {
                      idx = 0; // user seeked backward, restart from beginning
                    }
                    for (let i = idx; i < sentences.length; i++) {
                      if (currentTime >= sentences[i].startTime && currentTime < sentences[i].endTime) {
                        lastSentenceIdxRef.current = i;
                        transcript.actions.setActiveSentenceIndex(i);
                        return;
                      }
                    }
                    if (currentTime >= sentences[sentences.length - 1].startTime) {
                      lastSentenceIdxRef.current = sentences.length - 1;
                      transcript.actions.setActiveSentenceIndex(sentences.length - 1);
                    }
                  }}
                  className="hidden" />
              </div>
            )}
          </div>

          {/* 转写内容滚动区域 */}
          <div className="flex-1 overflow-y-auto px-4 md:px-6 pb-4">

            {/* 1) PPT+text layout blocks — show whenever we have image blocks, even while recording */}
            {hasPptImageBlocks ? (
              <div className="space-y-3">
                {(() => {
                  const blocks = transcript.state.contentBlocks;
                  const combined: { type: 'combined' | 'text'; imageBlock?: ContentBlock; textBlock?: ContentBlock }[] = [];
                  let i = 0;
                  while (i < blocks.length) {
                    if (blocks[i].type === 'image' && i + 1 < blocks.length && blocks[i + 1].type === 'text') {
                      combined.push({ type: 'combined', imageBlock: blocks[i], textBlock: blocks[i + 1] });
                      i += 2;
                    } else if (blocks[i].type === 'text') {
                      combined.push({ type: 'text', textBlock: blocks[i] });
                      i++;
                    } else {
                      i++;
                    }
                  }
                  return combined.map((group, idx) => {
                    if (group.type === 'combined' && group.imageBlock && group.textBlock) {
                      const imageBlock = group.imageBlock;
                      const textBlock = group.textBlock;
                      return (
                        <div key={idx} className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden shadow-sm">
                        <div
                          className="flex items-center gap-3 p-3 bg-slate-50/50 dark:bg-slate-800/50 border-b border-slate-100 dark:border-slate-700/50 cursor-pointer hover:bg-slate-100/50 dark:hover:bg-slate-700/50 transition-colors"
                          onClick={() => {
                            const pageIdx = (imageBlock.page || 1) - 1;
                            if (pageIdx >= 0 && pageIdx < ppt.state.slides.length) {
                              ppt.actions.setActiveSlideIndex(pageIdx);
                              if (window.innerWidth < 1024) {
                                setShowLeftPanel(true);
                              }
                            }
                          }}
                        >
                          <img
                            src={imageBlock.src?.startsWith('data:') ? imageBlock.src : imageBlock.src ? getMediaUrl(imageBlock.src) : ''}
                            alt={`PPT 第 ${imageBlock.page} 页`}
                            className="w-16 h-12 object-cover rounded-md border border-slate-100 dark:border-slate-600 flex-shrink-0 hover:scale-105 transition-transform"
                            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                          />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                              <FileText className="w-3.5 h-3.5 text-blue-500 flex-shrink-0" />
                              <span className="text-xs font-semibold text-slate-600 dark:text-slate-300 truncate">
                                PPT 第 {imageBlock.page} 页 · {imageBlock.title}
                              </span>
                            </div>
                            <p className="text-xs text-slate-400 mt-0.5">点击查看大图</p>
                          </div>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              const blocks = transcript.state.contentBlocks;
                              const imageBlockIndex = blocks.indexOf(imageBlock);
                              const nextBlocks = blocks.filter((_, blockIndex) => blockIndex !== imageBlockIndex);
                              transcript.actions.updateContentBlocks(nextBlocks);
                            }}
                            className="min-w-[32px] min-h-[32px] rounded-md text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 flex items-center justify-center transition-colors"
                            title="移除此 PPT 插入"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                          <ChevronUp className="w-4 h-4 text-slate-400 rotate-90 flex-shrink-0" />
                        </div>
                          <div
                            contentEditable
                            suppressContentEditableWarning
                            onPointerDown={(e) => { e.currentTarget.focus(); }}
                            onBlur={(e) => {
                              const blocks = transcript.state.contentBlocks;
                              const newBlocks = [...blocks];
                              const textBlockIndex = blocks.indexOf(textBlock);
                              if (textBlockIndex !== -1) {
                                const html = e.currentTarget.innerHTML;
                                const normalized = (html === '<br>' || html === '<br />') ? '' : html;
                                newBlocks[textBlockIndex] = { ...newBlocks[textBlockIndex], content: normalized };
                                transcript.actions.updateContentBlocks(newBlocks);
                              }
                            }}
                            className="p-4 text-sm text-slate-600 dark:text-slate-300 leading-relaxed whitespace-pre-line focus:outline-none min-h-[60px] select-text cursor-text"
                            dangerouslySetInnerHTML={{ __html: sanitizeHTML(textBlock.content || '') as unknown as string }}
                          />
                        </div>
                      );
                    } else if (group.type === 'text' && group.textBlock) {
                      const textBlock = group.textBlock;
                      return (
                        <div
                          key={idx}
                          contentEditable
                          suppressContentEditableWarning
                          onPointerDown={(e) => { e.currentTarget.focus(); }}
                          onBlur={(e) => {
                            const blocks = transcript.state.contentBlocks;
                            const newBlocks = [...blocks];
                            const textBlockIndex = blocks.indexOf(textBlock);
                            if (textBlockIndex !== -1) {
                              const html = e.currentTarget.innerHTML;
                              const normalized = (html === '<br>' || html === '<br />') ? '' : html;
                              newBlocks[textBlockIndex] = { ...newBlocks[textBlockIndex], content: normalized };
                              transcript.actions.updateContentBlocks(newBlocks);
                            }
                          }}
                          className="w-full p-4 text-sm text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-200 leading-relaxed whitespace-pre-line min-h-[60px] select-text cursor-text"
                          dangerouslySetInnerHTML={{ __html: sanitizeHTML(textBlock.content || '') as unknown as string }}
                        />
                      );
                    }
                    return null;
                  });
                })()}
              </div>
            ) : !isLiveTranscriptMode && transcript.state.contentBlocks.length > 0 && transcript.state.contentBlocks.some(b => b.type === 'image') ? (
              /* 1b) Fallback: post-recording image blocks that weren't caught by hasPptImageBlocks */
              <div className="space-y-3">
                {(() => {
                  const blocks = transcript.state.contentBlocks;
                  const hasImageBlocks = blocks.some((block) => block.type === 'image');
                  if (!hasImageBlocks) {
                    const textBlocks = blocks.filter((block) => block.type === 'text' && (block.content || '').trim());
                    return (
                      <div className="max-w-none px-1 py-1 text-sm text-slate-600 dark:text-slate-300 leading-8">
                        {textBlocks.map((textBlock, idx) => {
                          const blockIndex = blocks.indexOf(textBlock);
                          const displayContent = normalizeTranscriptBlockForDisplay(textBlock.content);
                          const isHeading = /^(课堂笔记|有名管道|无名管道|命名管道|进程|线程|通信|IPC|FIFO|Named Pipe)/i.test(displayContent) && displayContent.length <= 80;
                          return (
                            <div
                              key={idx}
                              contentEditable
                              suppressContentEditableWarning
                              onFocus={(e) => { activeTextElRef.current = e.currentTarget; }}
                          onPointerDown={(e) => { e.currentTarget.focus(); }}
                              onBlur={(e) => {
                                const newBlocks = [...blocks];
                                const html = e.currentTarget.innerHTML;
                                const normalized = (html === '<br>' || html === '<br />') ? '' : html;
                                if (blockIndex !== -1) {
                                  newBlocks[blockIndex] = { ...newBlocks[blockIndex], content: normalized };
                                  transcript.actions.updateContentBlocks(newBlocks);
                                }
                              }}
                              className={
                                isHeading
                                  ? 'mt-6 first:mt-0 mb-2 text-sm font-semibold text-slate-800 dark:text-slate-100 focus:outline-none select-text cursor-text'
                                  : 'mb-4 rounded-md border-l-2 border-transparent pl-3 pr-2 py-1 text-slate-600 dark:text-slate-300 whitespace-pre-wrap break-words hover:bg-slate-50/70 dark:hover:bg-slate-800/50 focus:bg-blue-50/50 dark:focus:bg-blue-900/10 focus:border-blue-300 focus:outline-none select-text cursor-text transition-colors'
                              }
                              dangerouslySetInnerHTML={{ __html: sanitizeHTML(displayContent) as unknown as string }}
                            />
                          );
                        })}
                      </div>
                    );
                  }
                  const combined: { type: 'combined' | 'text'; imageBlock?: ContentBlock; textBlock?: ContentBlock }[] = [];
                  let i = 0;
                  while (i < blocks.length) {
                    if (blocks[i].type === 'image' && i + 1 < blocks.length && blocks[i + 1].type === 'text') {
                      combined.push({ type: 'combined', imageBlock: blocks[i], textBlock: blocks[i + 1] });
                      i += 2;
                    } else if (blocks[i].type === 'text') {
                      combined.push({ type: 'text', textBlock: blocks[i] });
                      i++;
                    } else {
                      i++;
                    }
                  }
                  return combined.map((group, idx) => {
                    if (group.type === 'combined' && group.imageBlock && group.textBlock) {
                      const imageBlock = group.imageBlock;
                      const textBlock = group.textBlock;
                      return (
                        <div key={idx} className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden shadow-sm">
                        <div
                          className="flex items-center gap-3 p-3 bg-slate-50/50 dark:bg-slate-800/50 border-b border-slate-100 dark:border-slate-700/50 cursor-pointer hover:bg-slate-100/50 dark:hover:bg-slate-700/50 transition-colors"
                          onClick={() => {
                            const pageIdx = (imageBlock.page || 1) - 1;
                            if (pageIdx >= 0 && pageIdx < ppt.state.slides.length) {
                              ppt.actions.setActiveSlideIndex(pageIdx);
                              // 只在移动端（平板/手机）才需要点击后显示左侧面板
                              if (window.innerWidth < 1024) {
                                setShowLeftPanel(true);
                              }
                            }
                          }}
                        >
                          <img
                            src={imageBlock.src?.startsWith('data:') ? imageBlock.src : imageBlock.src ? getMediaUrl(imageBlock.src) : ''}
                            alt={`PPT 第 ${imageBlock.page} 页`}
                            className="w-16 h-12 object-cover rounded-md border border-slate-100 dark:border-slate-600 flex-shrink-0 hover:scale-105 transition-transform"
                            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                          />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                              <FileText className="w-3.5 h-3.5 text-blue-500 flex-shrink-0" />
                              <span className="text-xs font-semibold text-slate-600 dark:text-slate-300 truncate">
                                PPT 第 {imageBlock.page} 页 · {imageBlock.title}
                              </span>
                            </div>
                            <p className="text-xs text-slate-400 mt-0.5">点击查看大图</p>
                          </div>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              const imageBlockIndex = blocks.indexOf(imageBlock);
                              const nextBlocks = blocks.filter((_, blockIndex) => blockIndex !== imageBlockIndex);
                              transcript.actions.updateContentBlocks(nextBlocks);
                            }}
                            className="min-w-[32px] min-h-[32px] rounded-md text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 flex items-center justify-center transition-colors"
                            title="移除此 PPT 插入"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                          <ChevronUp className="w-4 h-4 text-slate-400 rotate-90 flex-shrink-0" />
                        </div>
                          <div
                            contentEditable
                            suppressContentEditableWarning
                            onPointerDown={(e) => { e.currentTarget.focus(); }}
                            onBlur={(e) => {
                              const newBlocks = [...blocks];
                              const textBlockIndex = blocks.indexOf(textBlock);
                              if (textBlockIndex !== -1) {
                                const html = e.currentTarget.innerHTML;
                                const normalized = (html === '<br>' || html === '<br />') ? '' : html;
                                newBlocks[textBlockIndex] = { ...newBlocks[textBlockIndex], content: normalized };
                                transcript.actions.updateContentBlocks(newBlocks);
                              }
                            }}
                            className="p-4 text-sm text-slate-600 dark:text-slate-300 leading-relaxed whitespace-pre-line focus:outline-none min-h-[60px] select-text cursor-text"
                            dangerouslySetInnerHTML={{ __html: sanitizeHTML(textBlock.content || '') as unknown as string }}
                          />
                        </div>
                      );
                    } else if (group.type === 'text' && group.textBlock) {
                      const textBlock = group.textBlock;
                      return (
                        <div
                          key={idx}
                          contentEditable
                          suppressContentEditableWarning
                          onPointerDown={(e) => { e.currentTarget.focus(); }}
                          onBlur={(e) => {
                            const newBlocks = [...blocks];
                            const textBlockIndex = blocks.indexOf(textBlock);
                            if (textBlockIndex !== -1) {
                              const html = e.currentTarget.innerHTML;
                              const normalized = (html === '<br>' || html === '<br />') ? '' : html;
                              newBlocks[textBlockIndex] = { ...newBlocks[textBlockIndex], content: normalized };
                              transcript.actions.updateContentBlocks(newBlocks);
                            }
                          }}
                          className="w-full p-4 text-sm text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-200 leading-relaxed whitespace-pre-line min-h-[60px] select-text cursor-text"
                          dangerouslySetInnerHTML={{ __html: sanitizeHTML(textBlock.content || '') as unknown as string }}
                        />
                      );
                    }
                    return null;
                  });
                })()}
              </div>
            ) : isLiveTranscriptMode ? (
              /* 2) Live streaming — WebSocket ASR */
              <div className="space-y-3">
                {/* Confirmed final transcript (editable) */}
                <RichTextEditor
                  ref={transcriptEditRef}
                  value={transcript.state.transcriptText}
                  onChange={(text) => { transcript.actions.updateTranscriptText(text); }}
                  onFocus={() => {
                    activeTextElRef.current = transcriptEditRef.current;
                  }}
                  placeholder={audioUpload.state.isUploadingAudio ? '正在识别上传录音，结果会逐段显示...' : '正在转录中，可直接编辑修改...'}
                  className="rich-text-editor w-full p-4 text-sm text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-800 border border-blue-200 dark:border-blue-700 rounded-xl min-h-[200px] focus:outline-none focus:ring-2 focus:ring-blue-200 leading-relaxed whitespace-pre-wrap break-words"
                />
                {/* Partial text — temporary, not saved */}
                {transcript.state.partialText && (
                  <div className="flex items-center gap-2 px-3 py-2 bg-blue-50/50 dark:bg-blue-900/10 border border-blue-100 dark:border-blue-800/30 rounded-lg">
                    <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse flex-shrink-0" />
                    <p className="text-sm text-slate-500 dark:text-slate-400 italic leading-relaxed">
                      {transcript.state.partialText}
                    </p>
                  </div>
                )}
                {!transcript.state.partialText && recording.state.isRecording && !recording.state.isPaused && (
                  <div className="flex items-center gap-2 px-3 py-2 text-slate-400 text-sm">
                    <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
                    正在聆听...
                  </div>
                )}
                {(recording.state.isProcessing || audioUpload.state.isUploadingAudio) && (
                  <div className="flex items-center gap-2 text-slate-400 text-sm">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    {audioUpload.state.isUploadingAudio ? (audioUpload.state.audioUploadStatus || '正在识别上传录音...') : '正在处理录音...'}
                  </div>
                )}
              </div>
            ) : transcript.state.transcriptText === '' ? (
              /* 3) Empty state */
              <div className="flex flex-col items-center justify-center py-20 text-slate-400 dark:text-slate-500">
                <div className="w-16 h-16 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center mb-4">
                  {audioUpload.state.isUploadingAudio ? (
                    <Loader2 className="w-6 h-6 text-blue-400 animate-spin" />
                  ) : (
                    <Mic className="w-6 h-6 text-slate-300 dark:text-slate-600" />
                  )}
                </div>
                <p className="text-sm">{audioUpload.state.isUploadingAudio ? '正在等待第一段转写' : '点击录制按钮开始录音'}</p>
                <p className="text-xs mt-1 text-slate-300 dark:text-slate-600">
                  {audioUpload.state.isUploadingAudio ? '识别结果会先显示原文，再由 AI 替换为整理稿' : '录音将实时转写，PPT 自动对齐插入'}
                </p>
              </div>
            ) : transcript.state.transcriptText ? (
              /* 4) Editable paragraph cards — smart split into ~2-4 sentence chunks */
              (() => {
                // Split on blank lines first; then sub-split any paragraph that is too long
                const rawParagraphs = transcript.state.transcriptText
                  .split('\n\n')
                  .map(p => p.trim())
                  .filter(p => p);
                const CARD_MAX_CHARS = 320;
                // Split a single long paragraph blob into sentence-aligned chunks
                const splitLongParagraph = (text: string): string[] => {
                  if (text.length <= CARD_MAX_CHARS) return [text];
                  const sentences = text.split(/(?<=[。！？.!?])/);
                  const chunks: string[] = [];
                  let current = '';
                  for (const s of sentences) {
                    if (current && (current + s).replace(/\s/g, '').length > CARD_MAX_CHARS) {
                      chunks.push(current.trim());
                      current = s;
                    } else {
                      current += s;
                    }
                  }
                  if (current.trim()) chunks.push(current.trim());
                  return chunks.length ? chunks : [text];
                };
                const paragraphs: string[] = [];
                for (const p of rawParagraphs) {
                  paragraphs.push(...splitLongParagraph(p));
                }

                const syncParagraphs = () => {
                  if (!paragraphContainerRef.current) return;
                  const parts: string[] = [];
                  for (const child of paragraphContainerRef.current.children) {
                    const html = (child as HTMLElement).innerHTML;
                    if (html && html !== '<br>' && html !== '<br />') {
                      parts.push(html);
                    }
                  }
                  transcript.actions.updateTranscriptText(parts.join('\n\n'));
                  if (transcript.state.sentencesWithTime.length > 0) {
                    transcript.actions.setSentencesWithTime([]);
                    transcript.actions.setActiveSentenceIndex(null);
                  }
                };
                return (
                  <div ref={paragraphContainerRef} className="space-y-3">
                    {paragraphs.map((para, i) => (
                      <div
                        key={i}
                        contentEditable
                        suppressContentEditableWarning
                        dangerouslySetInnerHTML={{ __html: sanitizeHTML(para.trim()) as unknown as string }}
                        onBlur={syncParagraphs}
                        onFocus={(e) => { activeTextElRef.current = e.currentTarget; }}
                          onPointerDown={(e) => { e.currentTarget.focus(); }}
                        className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-3 text-sm text-slate-600 dark:text-slate-300 leading-7 whitespace-pre-wrap break-words shadow-sm outline-none transition-colors hover:border-slate-300 dark:hover:border-slate-600 focus:border-blue-300 dark:focus:border-blue-600 focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-900/30 select-text cursor-text"
                      />
                    ))}
                  </div>
                );
              })()
            ) : transcript.state.sentencesWithTime.length > 0 ? (
              /* 5) Fallback timestamp view when no editable transcript text exists */
              <div className="space-y-1 leading-relaxed whitespace-pre-wrap break-words">
                {transcript.state.sentencesWithTime.map((sentence, idx) => {
                  const hasAudio = !!recording.state.audioPlaybackUrl;
                  return (
                  <span
                    key={idx}
                    onClick={hasAudio ? () => {
                      if (recording.refs.audioPlayerRef.current) {
                        recording.refs.audioPlayerRef.current.currentTime = sentence.startTime;
                        recording.refs.audioPlayerRef.current.play();
                        recording.actions.setIsPlayingAudio(true);
                      }
                    } : undefined}
                    className={`inline px-0.5 py-0.5 rounded transition-colors ${
                      transcript.state.activeSentenceIndex === idx
                        ? 'bg-blue-200 dark:bg-blue-700 text-blue-900 dark:text-blue-100'
                        : hasAudio
                          ? 'cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-700'
                          : ''
                    }`}
                  >
                    {sentence.text}
                  </span>
                  );
                })}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-20 text-slate-400 dark:text-slate-500">
                <div className="w-16 h-16 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center mb-4">
                  <Mic className="w-6 h-6 text-slate-300 dark:text-slate-600" />
                </div>
                <p className="text-sm">转录内容将显示在这里</p>
              </div>
            )}

            {/* Raw text debug view */}
            {showRawDebug && transcript.state.loadedNote?.transcript && (
              <div className="mx-4 mt-4 mb-4 p-3 bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-lg">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">调试 — raw_text（ASR 原始输出）</span>
                  <button onClick={() => setShowRawDebug(false)} className="text-slate-400 hover:text-slate-600"><X className="w-3 h-3" /></button>
                </div>
                <div className="space-y-2">
                  {(() => {
                    const entries = transcript.state.loadedNote.transcript
                      .filter((e: any) => e && typeof e === 'object')
                      .sort((a: any, b: any) => (a.chunk_index || 0) - (b.chunk_index || 0));
                    return entries.map((entry: any, idx: number) => (
                      <div key={idx} className="space-y-1">
                        <div className="text-[10px] text-slate-400 flex items-center gap-2">
                          <span>chunk {entry.chunk_index ?? idx}</span>
                          {entry.is_ai_corrected && <span className="text-green-500">AI corrected</span>}
                          {entry.correction_error && <span className="text-red-400">{entry.correction_error}</span>}
                          {entry.correction_stage && <span className="text-slate-300">{entry.correction_stage}</span>}
                        </div>
                        <pre className="text-[11px] text-slate-500 dark:text-slate-400 whitespace-pre-wrap break-words font-mono leading-relaxed bg-white dark:bg-slate-800 p-2 rounded border border-slate-100 dark:border-slate-700">{entry.raw_text || '(无 raw_text)'}</pre>
                        {entry.corrected_text && (
                          <div className="text-[11px] text-green-600 dark:text-green-400 font-mono leading-relaxed bg-green-50 dark:bg-green-900/10 p-2 rounded border border-green-100 dark:border-green-800/30">
                            corrected: {entry.corrected_text}
                          </div>
                        )}
                      </div>
                    ));
                  })()}
                </div>
              </div>
            )}
          </div>
        </main>
      </div>

      {/* ---- Mind Map Drawer ---- */}
      {mindMap.state.showMindMap && (
        <div className="fixed inset-0 z-50 flex">
          <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={() => mindMap.actions.setShowMindMap(false)} />
          <div className="relative ml-auto w-full max-w-[90vw] h-full bg-white dark:bg-slate-800 shadow-xl flex flex-col" onClick={(e) => e.stopPropagation()}>
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200 dark:border-slate-700 flex-shrink-0">
              <div className="flex items-center gap-2">
                <BrainCircuit className="w-5 h-5 text-purple-500" />
                <h2 className="text-base font-semibold text-slate-800 dark:text-slate-200">知识导图</h2>
                {mindMap.state.mindMapStatus?.mind_map?.title && mindMap.state.mindMapStatus.status === 'ready' && (
                  <span className="text-sm text-slate-400 ml-2">— {mindMap.state.mindMapStatus.mind_map.title}</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {mindMap.state.mindMapStatus?.mind_map && (
                  <button onClick={mindMap.actions.handleCopyMindMapOutline} className="p-2 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors" title="复制大纲">
                    {mindMap.state.copyMindMapSuccess ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
                  </button>
                )}
                {(mindMap.state.mindMapStatus?.status === 'ready' || mindMap.state.mindMapStatus?.status === 'stale') && (
                  <button onClick={() => mindMap.actions.handleGenerateMindMap(mindMap.state.mindMapStatus?.status === 'ready')} disabled={mindMap.state.isGeneratingMindMap} className="px-3 py-1.5 text-xs font-medium text-purple-600 bg-purple-50 dark:bg-purple-900/20 rounded-lg hover:bg-purple-100 dark:hover:bg-purple-900/30 disabled:opacity-50 flex items-center gap-1" title="重新生成">
                    <RefreshCw className={`w-3.5 h-3.5 ${mindMap.state.isGeneratingMindMap ? 'animate-spin' : ''}`} />
                    重新生成
                  </button>
                )}
                {mindMap.state.mindMapStatus?.status === 'ready' && (
                  <button onClick={mindMap.actions.handleDeleteMindMap} className="p-2 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors" title="删除导图">
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
                <button onClick={() => mindMap.actions.setShowMindMap(false)} className="p-2 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors">
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-hidden">
              {mindMap.state.mindMapStatus?.status === 'empty' ? (
                <div className="flex flex-col items-center justify-center h-full text-slate-400 gap-2">
                  <FileText className="w-10 h-10 opacity-30" />
                  <p className="text-sm">当前课次没有可生成的内容</p>
                </div>
              ) : mindMap.state.mindMapStatus?.status === 'not_generated' || mindMap.state.mindMapStatus?.status === 'stale' ? (
                <div className="flex flex-col items-center justify-center h-full text-slate-400 gap-4">
                  <BrainCircuit className="w-10 h-10 opacity-30" />
                  <p className="text-sm">{mindMap.state.mindMapStatus.status === 'stale' ? '内容已变化，需要重新生成' : '尚未生成知识导图'}</p>
                  <button onClick={() => mindMap.actions.handleGenerateMindMap()} disabled={mindMap.state.isGeneratingMindMap} className="px-4 py-2 text-sm font-medium text-white bg-purple-500 rounded-lg hover:bg-purple-600 disabled:opacity-50 flex items-center gap-2">
                    {mindMap.state.isGeneratingMindMap ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                    {mindMap.state.mindMapStatus.status === 'stale' ? '重新生成' : '生成导图'}
                  </button>
                </div>
              ) : mindMap.state.mindMapStatus?.status === 'error' ? (
                <div className="flex flex-col items-center justify-center h-full text-slate-400 gap-4">
                  <AlertCircle className="w-10 h-10 text-red-400 opacity-50" />
                  <p className="text-sm text-red-500">{mindMap.state.mindMapStatus.error || '生成失败'}</p>
                  <button onClick={() => mindMap.actions.handleGenerateMindMap()} disabled={mindMap.state.isGeneratingMindMap} className="px-4 py-2 text-sm font-medium text-white bg-purple-500 rounded-lg hover:bg-purple-600 disabled:opacity-50">重试</button>
                </div>
              ) : mindMap.state.isGeneratingMindMap || mindMap.state.mindMapStatus?.status === 'generating' ? (
                <div className="flex flex-col items-center justify-center h-full text-slate-400 gap-3">
                  <Loader2 className="w-8 h-8 animate-spin text-purple-500" />
                  <p className="text-sm">AI 正在分析课程内容，生成知识导图...</p>
                  {typeof mindMap.state.mindMapStatus?.progress === 'number' && (
                    <p className="text-xs text-slate-400">进度 {Math.round(mindMap.state.mindMapStatus.progress * 100)}%</p>
                  )}
                </div>
              ) : mindMap.state.mindMapStatus?.mind_map ? (
                <MindMapCanvas
                  data={mindMap.state.mindMapStatus.mind_map}
                  onSelect={mindMap.actions.setSelectedMindMapNode}
                  selectedNode={mindMap.state.selectedMindMapNode}
                  onSourceClick={(source) => {
                  if (source.source_type === 'ppt' && source.page != null) {
                    ppt.actions.setActiveSlideIndex(source.page - 1);
                    return;
                  }
                  if ((source.source_type === 'transcript' || source.source_type === 'note') && source.snippet) {
                    mindMap.actions.setShowMindMap(false);
                    setTimeout(() => {
                      const container = paragraphContainerRef.current;
                      if (!container) return;
                      const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
                      const lowerSnippet = source.snippet!.toLowerCase();
                      let node;
                      while ((node = walker.nextNode() as Text | null)) {
                        if (node.textContent?.toLowerCase().includes(lowerSnippet)) {
                          const el = node.parentElement;
                          if (el) {
                            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                            el.classList.add('bg-yellow-100', 'dark:bg-yellow-900/30', 'transition-colors');
                            setTimeout(() => {
                              el.classList.remove('bg-yellow-100', 'dark:bg-yellow-900/30', 'transition-colors');
                            }, 3000);
                          }
                          break;
                        }
                      }
                    }, 300);
                  }
                }}
                />
              ) : null}
            </div>
          </div>
        </div>
      )}

      {/* ---- Quiz Drawer ---- */}
      {quiz.state.showQuiz && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={() => { quiz.actions.setShowQuiz(false); quiz.actions.setShowQuizQA(false); }} />

          {/* ---- Left QA Panel ---- */}
          {quiz.state.showQuizQA && (
            <div className="relative z-10 w-full max-w-lg h-full bg-white dark:bg-slate-800 shadow-xl flex flex-col border-r border-slate-200 dark:border-slate-700">
              {/* Header */}
              <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-700">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-5 h-5 text-violet-500" />
                  <h2 className="text-base font-semibold text-slate-800 dark:text-slate-200">AI 答疑</h2>
                </div>
                <button onClick={() => quiz.actions.setShowQuizQA(false)} className="p-2 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors">
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Search input */}
              <div className="p-4 border-b border-slate-200 dark:border-slate-700 space-y-3">
                <div className="flex items-center gap-2">
                  <input
                    value={rag.state.searchQuery}
                    onChange={(e) => rag.actions.setSearchQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') rag.actions.handleRAGAsk(sessionId, displayNotebook?.id, vectorIndex.actions.ensureIndexed);
                    }}
                    placeholder="输入问题，AI 将基于课堂资料回答..."
                    className="flex-1 text-sm bg-transparent outline-none text-slate-700 dark:text-slate-200 placeholder:text-slate-400"
                    autoFocus
                  />
                  <button onClick={() => rag.actions.handleRAGAsk(sessionId, displayNotebook?.id, vectorIndex.actions.ensureIndexed)} disabled={rag.state.isAskingRAG} className="px-3 py-1.5 text-xs font-medium text-white bg-violet-500 rounded-lg hover:bg-violet-600 disabled:opacity-50">
                    {rag.state.isAskingRAG ? '...' : '提问'}
                  </button>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center rounded-lg border border-slate-200 dark:border-slate-600 overflow-hidden">
                    <button onClick={() => rag.actions.setSearchScope('session')} className={`px-2 py-1 text-[10px] font-medium transition-colors ${rag.state.searchScope === 'session' ? 'bg-blue-500 text-white' : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700'}`}>本课次</button>
                    <button onClick={() => rag.actions.setSearchScope('notebook')} className={`px-2 py-1 text-[10px] font-medium transition-colors ${rag.state.searchScope === 'notebook' ? 'bg-blue-500 text-white' : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700'}`}>本课程</button>
                  </div>
                  <span className="text-[10px] text-slate-400">基于测验和课次内容答疑</span>
                </div>
                {rag.state.ragError && (
                  <div className="text-xs text-red-500">{rag.state.ragError}</div>
                )}
                {rag.state.ragStatus && (
                  <div className="text-xs text-violet-500 flex items-center gap-1">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    {rag.state.ragStatus}
                  </div>
                )}
              </div>

              {/* Answer area */}
              <div className="flex-1 overflow-y-auto p-4">
                {rag.state.ragAnswer || rag.state.ragSources.length > 0 ? (
                  <div className="space-y-3">
                    {rag.state.ragAnswer ? (
                      <div className="text-sm text-slate-700 dark:text-slate-200 leading-relaxed whitespace-pre-wrap">{rag.state.ragAnswer}</div>
                    ) : (
                      <div className="text-xs text-slate-400">AI 暂时没有生成回答，但已检索到相关课堂来源。</div>
                    )}
                    {rag.state.ragSources.length > 0 && (
                      <div className="pt-3 border-t border-slate-100 dark:border-slate-700">
                        <p className="text-[10px] text-slate-400 mb-2">参考来源</p>
                        {renderRagSourceCards(() => quiz.actions.setShowQuizQA(false))}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="h-full flex flex-col items-center justify-center text-slate-400 gap-3">
                    <Sparkles className="w-10 h-10 opacity-30" />
                    <p className="text-sm">{rag.state.isAskingRAG ? '正在思考中...' : '输入问题，AI 将基于课堂资料回答'}</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ---- Right Quiz Panel ---- */}
          <div className="relative w-full max-w-2xl h-full bg-white dark:bg-slate-800 shadow-xl flex flex-col" onClick={(e) => e.stopPropagation()}>
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-700">
              <div className="flex items-center gap-2">
                <ClipboardCheck className="w-5 h-5 text-emerald-500" />
                <h2 className="text-base font-semibold text-slate-800 dark:text-slate-200">课次测验</h2>
              </div>
              <div className="flex items-center gap-2">
                {quiz.state.activeQuiz && (
                  <>
                    <button onClick={() => { quiz.actions.setActiveQuiz(null); quiz.actions.setQuizSubmitted(false); quiz.actions.setQuizAnswers({}); quiz.actions.setShowQuizQA(false); }} className="p-2 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors" title="返回列表">
                      <ChevronDown className="w-4 h-4 rotate-90" />
                    </button>
                    <button onClick={() => quiz.actions.setShowQuizQA(!quiz.state.showQuizQA)} className={`p-2 rounded-lg transition-colors ${quiz.state.showQuizQA ? 'text-blue-600 bg-blue-50 dark:bg-blue-900/20' : 'text-slate-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20'}`} title="测验答疑">
                      <Search className="w-4 h-4" />
                    </button>
                  </>
                )}
                <button onClick={() => { quiz.actions.setShowQuiz(false); quiz.actions.setShowQuizQA(false); }} className="p-2 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors">
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto">
              {quiz.state.quizError && (
                <div className="mx-5 mt-4 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 text-sm text-red-600 dark:text-red-400 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  {quiz.state.quizError}
                  <button onClick={() => quiz.actions.setQuizError(null)} className="ml-auto text-red-400 hover:text-red-600"><X className="w-3 h-3" /></button>
                </div>
              )}

              {quiz.state.activeQuiz ? (
                /* ---- Active Quiz View ---- */
                <div className="p-5">
                  <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100 mb-4">{quiz.state.activeQuiz.title}</h3>

                  {quiz.state.quizSubmitted && quiz.state.activeQuiz.submission ? (
                    /* ---- Results View ---- */
                    <div>
                      <div className="flex items-center gap-4 mb-6 p-4 rounded-xl bg-slate-50 dark:bg-slate-700/50">
                        <div className="text-center">
                          <div className={`text-3xl font-bold ${quiz.state.activeQuiz.submission.percentage >= 60 ? 'text-emerald-500' : 'text-red-500'}`}>
                            {quiz.state.activeQuiz.submission.percentage}%
                          </div>
                          <div className="text-xs text-slate-400 mt-1">正确率</div>
                        </div>
                        <div className="text-center">
                          <div className="text-2xl font-bold text-slate-700 dark:text-slate-200">
                            {quiz.state.activeQuiz?.submission?.score}/{quiz.state.activeQuiz?.submission?.total}
                          </div>
                          <div className="text-xs text-slate-400 mt-1">答对题数</div>
                        </div>
                      </div>

                      <div className="space-y-4">
                        {quiz.state.activeQuiz?.questions.map((q, idx) => {
                          const result = quiz.state.activeQuiz?.submission?.results.find(r => r.question_id === q.id);
                          const isCorrect = result?.correct;
                          return (
                            <div key={q.id} className={`p-4 rounded-xl border ${isCorrect ? 'border-emerald-200 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-900/10' : 'border-red-200 dark:border-red-800 bg-red-50/50 dark:bg-red-900/10'}`}>
                              <div className="flex items-start gap-2 mb-2">
                                <span className={`text-xs font-bold mt-0.5 ${isCorrect ? 'text-emerald-500' : 'text-red-500'}`}>
                                  {isCorrect ? '✓' : '✗'}
                                </span>
                                <span className="text-sm font-medium text-slate-700 dark:text-slate-200">{idx + 1}. {q.question}</span>
                              </div>
                              <div className="space-y-1.5 ml-5">
                                {q.options.map(opt => {
                                  const isSelected = result?.selected === opt.id;
                                  const isAnswer = q.answer === opt.id;
                                  return (
                                    <div key={opt.id} className={`text-xs px-2.5 py-1.5 rounded-lg ${isAnswer ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 font-medium' : isSelected ? 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 line-through' : 'text-slate-500 dark:text-slate-400'}`}>
                                      <span className="font-medium mr-1">{opt.id}.</span> {opt.text}
                                      {opt.explanation && <span className="ml-1 opacity-70">— {opt.explanation}</span>}
                                    </div>
                                  );
                                })}
                              </div>
                              {q.explanation && (
                                <div className="mt-2 ml-5 text-xs text-slate-500 dark:text-slate-400">
                                  <span className="font-medium">解析：</span>{q.explanation}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ) : (
                    /* ---- Taking Quiz View ---- */
                    <div>
                      <div className="space-y-5">
                        {quiz.state.activeQuiz?.questions.map((q, idx) => (
                          <div key={q.id} className="p-4 rounded-xl border border-slate-200 dark:border-slate-600">
                            <p className="text-sm font-medium text-slate-700 dark:text-slate-200 mb-3">
                              <span className="text-emerald-500 mr-1">{idx + 1}.</span>
                              {q.question}
                            </p>
                            <div className="space-y-2">
                              {q.options.map(opt => (
                                <button
                                  key={opt.id}
                                  onClick={() => quiz.actions.setQuizAnswers(prev => ({ ...prev, [q.id]: opt.id }))}
                                  className={`w-full text-left px-3 py-2.5 rounded-lg text-sm transition-colors flex items-center gap-2 ${
                                    quiz.state.quizAnswers[q.id] === opt.id
                                      ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700'
                                      : 'bg-slate-50 dark:bg-slate-700 text-slate-600 dark:text-slate-300 border border-transparent hover:bg-slate-100 dark:hover:bg-slate-600'
                                  }`}
                                >
                                  <CircleDot className={`w-4 h-4 flex-shrink-0 ${quiz.state.quizAnswers[q.id] === opt.id ? 'text-emerald-500' : 'text-slate-300 dark:text-slate-500'}`} />
                                  <span className="font-medium mr-1">{opt.id}.</span>
                                  {opt.text}
                                </button>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                      <div className="mt-6 flex items-center justify-between">
                        <span className="text-xs text-slate-400">已答 {Object.keys(quiz.state.quizAnswers).length}/{quiz.state.activeQuiz.questions.length} 题</span>
                        <button
                          onClick={quiz.actions.handleSubmitQuiz}
                          disabled={Object.keys(quiz.state.quizAnswers).length < quiz.state.activeQuiz.questions.length}
                          className="px-5 py-2.5 text-sm font-medium text-white bg-emerald-500 rounded-lg hover:bg-emerald-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                        >
                          提交答案
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                /* ---- Quiz List View ---- */
                <div className="p-5">
                  {/* Bank Status Banner */}
                  {quiz.state.bankStatus && quiz.state.bankStatus.status !== 'ready' && (
                    <div className={`mb-4 p-3 rounded-lg text-sm flex items-center gap-2 ${
                      quiz.state.bankStatus.status === 'generating' ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400' :
                      quiz.state.bankStatus.status === 'stale' ? 'bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400' :
                      quiz.state.bankStatus.status === 'error' ? 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400' :
                      quiz.state.bankStatus.status === 'empty' ? 'bg-slate-50 dark:bg-slate-700 text-slate-500' :
                      'bg-slate-50 dark:bg-slate-700 text-slate-500'
                    }`}>
                      {quiz.state.bankStatus.status === 'generating' && <Loader2 className="w-4 h-4 animate-spin flex-shrink-0" />}
                      {quiz.state.bankStatus.status === 'stale' && <AlertCircle className="w-4 h-4 flex-shrink-0" />}
                      {quiz.state.bankStatus.status === 'error' && <AlertCircle className="w-4 h-4 flex-shrink-0" />}
                      <span>
                        {quiz.state.bankStatus.status === 'generating' && '题库生成中，请稍候...'}
                        {quiz.state.bankStatus.status === 'stale' && '笔记内容已变化，题库需要更新'}
                        {quiz.state.bankStatus.status === 'error' && `题库生成失败: ${quiz.state.bankStatus.error || '未知错误'}`}
                        {quiz.state.bankStatus.status === 'empty' && '当前课次没有可生成的内容'}
                        {quiz.state.bankStatus.status === 'not_generated' && '尚未生成题库'}
                      </span>
                      {(quiz.state.bankStatus.status === 'stale' || quiz.state.bankStatus.status === 'error' || quiz.state.bankStatus.status === 'not_generated') && (
                        <button
                          onClick={quiz.actions.handleRebuildBank}
                          disabled={quiz.state.isRebuildingBank}
                          className="ml-auto px-2.5 py-1 text-xs font-medium text-white bg-blue-500 rounded hover:bg-blue-600 disabled:opacity-50 flex items-center gap-1"
                        >
                          {quiz.state.isRebuildingBank && <Loader2 className="w-3 h-3 animate-spin" />}
                          生成题库
                        </button>
                      )}
                    </div>
                  )}

                  {/* Rebuild Bank Button (when bank is ready) */}
                  {quiz.state.bankStatus && quiz.state.bankStatus.status === 'ready' && (
                    <div className="mb-4 flex items-center justify-between p-3 rounded-lg bg-emerald-50 dark:bg-emerald-900/10 text-sm">
                      <span className="text-emerald-600 dark:text-emerald-400">
                        题库已就绪 ({quiz.state.bankStatus.question_count} 题)
                      </span>
                      <button
                        onClick={quiz.actions.handleRebuildBank}
                        disabled={quiz.state.isRebuildingBank}
                        className="px-2.5 py-1 text-xs font-medium text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 rounded hover:bg-amber-100 dark:hover:bg-amber-900/40 disabled:opacity-50 flex items-center gap-1"
                        title="重新生成题库会调用 AI"
                      >
                        {quiz.state.isRebuildingBank ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                        重新生成题库
                      </button>
                    </div>
                  )}

                  {quiz.state.isGeneratingQuiz ? (
                    <div className="flex flex-col items-center justify-center py-16 text-slate-400 gap-3">
                      <Loader2 className="w-8 h-8 animate-spin text-emerald-500" />
                      <p className="text-sm">正在从题库抽取题目...</p>
                    </div>
                  ) : quiz.state.quizList.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-16 text-slate-400 gap-4">
                      <ClipboardCheck className="w-10 h-10 opacity-30" />
                      <p className="text-sm">尚未开始测验</p>
                      <button
                        onClick={quiz.actions.handleGenerateQuiz}
                        disabled={!quiz.state.bankStatus || quiz.state.bankStatus.status !== 'ready'}
                        className="px-4 py-2 text-sm font-medium text-white bg-emerald-500 rounded-lg hover:bg-emerald-600 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
                      >
                        开始测验
                      </button>
                    </div>
                  ) : (
                    <div>
                      <div className="flex items-center justify-between mb-4">
                        <span className="text-sm text-slate-500">历史测验</span>
                        <button
                          onClick={quiz.actions.handleGenerateQuiz}
                          disabled={quiz.state.isGeneratingQuiz || !quiz.state.bankStatus || quiz.state.bankStatus.status !== 'ready'}
                          className="px-3 py-1.5 text-xs font-medium text-white bg-emerald-500 rounded-lg hover:bg-emerald-600 disabled:opacity-50 flex items-center gap-1"
                        >
                          {quiz.state.isGeneratingQuiz ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                          开始新测验
                        </button>
                      </div>
                      <div className="space-y-2">
                        {quiz.state.quizList.map(q => (
                          <div key={q.quiz_id} className="flex items-center justify-between p-3 rounded-xl border border-slate-200 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors">
                            <button
                              onClick={() => quiz.actions.handleOpenQuiz(q.quiz_id, q.submitted)}
                              className="flex-1 text-left"
                            >
                              <div className="text-sm font-medium text-slate-700 dark:text-slate-200">{q.title}</div>
                              <div className="text-xs text-slate-400 mt-0.5">
                                {q.question_count} 题 · {q.submitted ? '已完成' : '未完成'}
                                {q.score && ` · ${q.score.percentage}%`}
                                {q.generated_at && ` · ${new Date(q.generated_at).toLocaleDateString()}`}
                              </div>
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); quiz.actions.handleDeleteQuiz(q.quiz_id); }}
                              className="p-1.5 rounded-lg text-slate-300 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                              title="删除"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {rag.state.showSearch && (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-20 bg-black/30 backdrop-blur-sm" onClick={() => rag.actions.setShowSearch(false)}>
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl w-full max-w-lg mx-4 overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 p-4 border-b border-slate-200 dark:border-slate-700">
              <Sparkles className="w-4 h-4 text-violet-400" />
              <input
                value={rag.state.searchQuery}
                onChange={(e) => rag.actions.setSearchQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') rag.actions.handleRAGAsk(sessionId, displayNotebook?.id, vectorIndex.actions.ensureIndexed);
                }}
                placeholder="输入问题，AI 将基于课堂资料回答..."
                className="flex-1 text-sm bg-transparent outline-none text-slate-700 dark:text-slate-200 placeholder:text-slate-400"
                autoFocus
              />
              <div className="flex items-center rounded-lg border border-slate-200 dark:border-slate-600 overflow-hidden">
                <button onClick={() => rag.actions.setSearchScope('session')} className={`px-2 py-1 text-[10px] font-medium transition-colors ${rag.state.searchScope === 'session' ? 'bg-blue-500 text-white' : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700'}`}>本课次</button>
                <button onClick={() => rag.actions.setSearchScope('notebook')} className={`px-2 py-1 text-[10px] font-medium transition-colors ${rag.state.searchScope === 'notebook' ? 'bg-blue-500 text-white' : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700'}`}>本课程</button>
              </div>
              <button onClick={() => rag.actions.handleRAGAsk(sessionId, displayNotebook?.id, vectorIndex.actions.ensureIndexed)} disabled={rag.state.isAskingRAG} className="px-3 py-1.5 text-xs font-medium text-white bg-violet-500 rounded-lg hover:bg-violet-600 disabled:opacity-50">
                {rag.state.isAskingRAG ? '...' : '提问'}
              </button>
            </div>
            <div className="max-h-96 overflow-y-auto">
              <div className="p-4">
                {rag.state.ragError && (
                  <div className="mb-3 text-xs text-red-500">{rag.state.ragError}</div>
                )}
                {rag.state.ragStatus && (
                  <div className="mb-3 text-xs text-violet-500 flex items-center gap-1">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    {rag.state.ragStatus}
                  </div>
                )}
                {rag.state.ragAnswer || rag.state.ragSources.length > 0 ? (
                  <div className="space-y-3">
                    {rag.state.ragAnswer ? (
                      <div className="text-sm text-slate-700 dark:text-slate-200 leading-relaxed whitespace-pre-wrap">{rag.state.ragAnswer}</div>
                    ) : (
                      <div className="text-xs text-slate-400">AI 暂时没有生成回答，但已检索到相关课堂来源。</div>
                    )}
                    {rag.state.ragSources.length > 0 && (
                      <div className="pt-3 border-t border-slate-100 dark:border-slate-700">
                        <p className="text-[10px] text-slate-400 mb-2">参考来源</p>
                        {renderRagSourceCards(() => rag.actions.setShowSearch(false))}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="py-8 text-center text-xs text-slate-400">
                    {rag.state.isAskingRAG ? '正在思考中...' : '输入问题，AI 将基于课堂资料回答'}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

{share.state.showShareModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => share.actions.setShowShareModal(false)}>
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl p-6 w-full max-w-md mx-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold text-slate-800 dark:text-slate-200">分享课次</h3>
              <button onClick={() => share.actions.setShowShareModal(false)} className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"><X className="w-4 h-4" /></button>
            </div>
            {share.state.shareLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
              </div>
            ) : share.state.shareEnabled && share.state.shareLink ? (
              <>
                <div className="flex items-center gap-2 mb-3">
                  <span className="w-2 h-2 rounded-full bg-green-400" />
                  <span className="text-xs text-green-600 dark:text-green-400">分享已开启</span>
                  {share.state.shareExpiresAt && (
                    <span className="text-xs text-amber-600 dark:text-amber-400 ml-2">
                      有效期至 {new Date(share.state.shareExpiresAt).toLocaleString()}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 mb-4">
                  <input readOnly value={share.state.shareLink} className="flex-1 px-3 py-2 text-sm border border-slate-200 dark:border-slate-600 rounded-lg bg-slate-50 dark:bg-slate-900 text-slate-600 dark:text-slate-300" />
                  <button onClick={() => { navigator.clipboard.writeText(share.state.shareLink); share.actions.setCopySuccess(true); setTimeout(() => share.actions.setCopySuccess(false), 3000); }}
                    className="px-3 py-2 text-sm font-medium text-white bg-blue-500 rounded-lg hover:bg-blue-600 transition-colors">{share.state.copySuccess ? '已复制' : '复制'}</button>
                </div>
                {share.state.shareMaxViews !== null && (
                  <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
                    已访问 {share.state.shareViewCount} / {share.state.shareMaxViews} 次
                  </p>
                )}
                <button onClick={() => share.actions.handleDisableShare(sessionId!)} className="w-full py-2 text-sm text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors">
                  关闭分享
                </button>
              </>
            ) : (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">有效期（小时）</label>
                    <input
                      type="number"
                      min={1}
                      placeholder="不限"
                      value={share.state.shareExpiresIn}
                      onChange={(e) => share.actions.setShareExpiresIn(e.target.value === '' ? '' : Number(e.target.value))}
                      className="w-full px-3 py-2 text-sm border border-slate-200 dark:border-slate-600 rounded-lg bg-slate-50 dark:bg-slate-700 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-300"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">最大访问次数</label>
                    <input
                      type="number"
                      min={1}
                      placeholder="不限"
                      value={share.state.shareMaxViewsInput}
                      onChange={(e) => share.actions.setShareMaxViewsInput(e.target.value === '' ? '' : Number(e.target.value))}
                      className="w-full px-3 py-2 text-sm border border-slate-200 dark:border-slate-600 rounded-lg bg-slate-50 dark:bg-slate-700 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-300"
                    />
                  </div>
                </div>
                <button onClick={() => share.actions.handleShareSession(sessionId!, share.state.shareExpiresIn, share.state.shareMaxViewsInput)} className="w-full py-2 text-sm font-medium text-white bg-blue-500 rounded-lg hover:bg-blue-600 transition-colors">
                  开启分享
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
