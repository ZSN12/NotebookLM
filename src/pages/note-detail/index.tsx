import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Play, Pause, ChevronUp, ChevronDown, Edit3, Loader2, AlertCircle, ImagePlus,
  X, FileText, Square, Download, Bold, List, Share2, Trash2, Mic, MicOff, Search,
  ChevronDown as ChevronDownIcon, Database, RefreshCw, BrainCircuit, Copy, Check,
  ClipboardCheck, CircleDot
} from 'lucide-react';
import { useStore } from '@/store/useStore';
import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { getProfile, getAvatarUrl } from '@/services/auth';
import ThemeToggle from '@/components/ThemeToggle';
import RichTextEditor from '@/components/RichTextEditor';
import { API_BASE, deleteAudio, uploadPPT, insertPPTIntoTranscript, uploadAudio, getMediaUrl, fetchNotebookDetail, fetchSessionById, enableShare, disableShare, getShareStatus, rebuildSessionVectorIndex, getSessionVectorStatus, searchVectors, VectorIndexStatus, VectorSearchResult, getSessionMindMap, generateSessionMindMap, deleteSessionMindMap, MindMapStatus, MindMapNode, MindMapData, getSessionQuizzes, generateSessionQuiz, getQuizDetail, submitQuizAnswers, deleteQuiz, getQuizBankStatus, rebuildQuizBank, QuizListItem, QuizDetail, QuizQuestion, QuizBankStatus } from '@/services/api';
import { sanitizeHTML } from '@/lib/sanitize';
import { layoutFromNoteParts } from '@/lib/noteLayout';
import type { Notebook, Session } from '@/types';

import { useRecording } from './useRecording';
import { useTranscript, StudentNote } from './useTranscript';
import { usePPT } from './usePPT';
import { useNotes } from './useNotes';
import { useExport } from './useExport';
import MindMapCanvas from './MindMapCanvas';
import type { ContentBlock } from '@/services/api';

const TEXT_COLORS = [
  { name: '红色', value: '#ef4444' },
  { name: '黄色', value: '#eab308' },
  { name: '蓝色', value: '#3b82f6' },
  { name: '黑色', value: '#1e293b' },
];

export default function NoteDetail() {
  const { id, sessionId } = useParams<{ id: string; sessionId: string }>();
  const navigate = useNavigate();
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

  const [isLoading, setIsLoading] = useState(true);
  const [showShareModal, setShowShareModal] = useState(false);
  const [shareLink, setShareLink] = useState('');
  const [shareToken, setShareToken] = useState('');
  const [shareEnabled, setShareEnabled] = useState(false);
  const [shareLoading, setShareLoading] = useState(false);
  const [copySuccess, setCopySuccess] = useState(false);
  const [showLeftPanel, setShowLeftPanel] = useState(false); // tablet sidebar
  const [isUploadingAudio, setIsUploadingAudio] = useState(false);
  const [audioUploadStatus, setAudioUploadStatus] = useState<string | null>(null);
  const [audioUploadError, setAudioUploadError] = useState<string | null>(null);

  // Vector index state
  const [vectorStatus, setVectorStatus] = useState<VectorIndexStatus | null>(null);
  const [isRebuilding, setIsRebuilding] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<VectorSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchScope, setSearchScope] = useState<'session' | 'notebook'>('session');
  const [searchError, setSearchError] = useState<string | null>(null);

  // Mind map state
  const [showMindMap, setShowMindMap] = useState(false);
  const [mindMapStatus, setMindMapStatus] = useState<MindMapStatus | null>(null);
  const [isGeneratingMindMap, setIsGeneratingMindMap] = useState(false);
  const [selectedMindMapNode, setSelectedMindMapNode] = useState<MindMapNode | null>(null);
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  const [copyMindMapSuccess, setCopyMindMapSuccess] = useState(false);

  // Quiz state
  const [showQuiz, setShowQuiz] = useState(false);
  const [quizList, setQuizList] = useState<QuizListItem[]>([]);
  const [activeQuiz, setActiveQuiz] = useState<QuizDetail | null>(null);
  const [isGeneratingQuiz, setIsGeneratingQuiz] = useState(false);
  const [quizAnswers, setQuizAnswers] = useState<Record<string, string>>({});
  const [quizSubmitted, setQuizSubmitted] = useState(false);
  const [quizError, setQuizError] = useState<string | null>(null);
  const [bankStatus, setBankStatus] = useState<QuizBankStatus | null>(null);
  const [isRebuildingBank, setIsRebuildingBank] = useState(false);
  const bankPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const transcriptEditRef = useRef<HTMLDivElement>(null);
  const noteEditRef = useRef<HTMLDivElement>(null);
  const activeTextElRef = useRef<HTMLDivElement | null>(null);
  const lastSentenceIdxRef = useRef(0);
  const paragraphContainerRef = useRef<HTMLDivElement>(null);

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
          } catch {}
        }, 500);
      }
    }
    setIsLoading(false);
  }, [loadedNote, sessionId, transcript.state.isLoaded]);

  // ---- Auto-save ----
  useEffect(() => {
    if (!sessionId || !transcript.state.isLoaded || !transcript.state.hasLocalChanges || isUploadingAudio) return;
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
    isUploadingAudio,
  ]);

  const workflowStatus = useMemo(() => {
    if (ppt.state.isUploadingPPT) return { tone: 'blue', text: '正在上传并解析 PPT' };
    if (isUploadingAudio) return { tone: 'blue', text: audioUploadStatus || '正在上传录音并转写' };
    if (recording.state.isProcessing) return { tone: 'blue', text: '正在初始化录音设备' };
    if (recording.state.isRecording && recording.state.isPaused) return { tone: 'amber', text: '录音已暂停' };
    if (recording.state.isRecording) return { tone: 'red', text: `录音中 ${recording.state.currentTime}` };
    if (transcript.state.isAiRestructuring) return { tone: 'violet', text: '正在整理转写并匹配 PPT' };
    if (transcript.state.isTranscribing) return { tone: 'blue', text: '正在等待转写结果' };
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
    isUploadingAudio,
    audioUploadStatus,
    ppt.state.isUploadingPPT,
    ppt.state.uploadMessage,
    recording.state.currentTime,
    recording.state.isPaused,
    recording.state.isProcessing,
    recording.state.isRecording,
    transcript.state.isAiRestructuring,
    transcript.state.isPptMatching,
    transcript.state.isTranscribing,
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
  const isLiveTranscriptMode = recording.state.isRecording || recording.state.isProcessing;
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
  const handleShareSession = async () => {
    if (!sessionId) return;
    setShowShareModal(true);
    setShareLoading(true);
    try {
      const status = await getShareStatus(sessionId);
      if (status.share_enabled && status.share_url) {
        setShareEnabled(true);
        setShareToken(status.share_token || '');
        setShareLink(`${window.location.origin}${status.share_url}`);
      } else {
        const result = await enableShare(sessionId);
        setShareEnabled(true);
        setShareToken(result.share_token);
        setShareLink(`${window.location.origin}${result.share_url}`);
      }
    } catch (err: any) {
      setShareEnabled(false);
      setShareLink('');
      setShareToken('');
    } finally {
      setShareLoading(false);
    }
  };

  const handleDisableShare = async () => {
    if (!sessionId || !window.confirm('关闭分享后，已分享的链接将失效。确定关闭？')) return;
    setShareLoading(true);
    try {
      await disableShare(sessionId);
      setShareEnabled(false);
      setShareLink('');
      setShareToken('');
    } catch (err: any) {
      alert(err.message || '关闭分享失败');
    } finally {
      setShareLoading(false);
    }
  };

  // ---- Vector Index ----
  useEffect(() => {
    if (!sessionId) return;
    getSessionVectorStatus(sessionId).then(setVectorStatus).catch(() => {});
  }, [sessionId]);

  useEffect(() => {
    if (!transcript.state.hasLocalChanges) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [transcript.state.hasLocalChanges]);

  // ---- Mind Map ----
  useEffect(() => {
    if (!sessionId || !showMindMap) return;
    getSessionMindMap(sessionId).then(setMindMapStatus).catch((err: any) => {
      setMindMapStatus({ session_id: sessionId, status: 'error', mind_map: null, error: err?.message || '加载知识导图失败' });
    });
  }, [sessionId, showMindMap]);

  useEffect(() => {
    if (!sessionId || !showMindMap || mindMapStatus?.status !== 'generating') return;
    const timer = setInterval(() => {
      getSessionMindMap(sessionId).then(setMindMapStatus).catch((err: any) => {
        setMindMapStatus(prev => prev ? { ...prev, status: 'error', error: err?.message || '获取生成状态失败' } : { session_id: sessionId, status: 'error', mind_map: null, error: '获取生成状态失败' });
      });
    }, 2500);
    return () => clearInterval(timer);
  }, [sessionId, showMindMap, mindMapStatus?.status]);

  useEffect(() => {
    if (mindMapStatus?.status === 'ready' && mindMapStatus.mind_map?.nodes && expandedNodes.size === 0) {
      setExpandedNodes(new Set(mindMapStatus.mind_map.nodes.map(n => n.id)));
    }
  }, [mindMapStatus?.status, mindMapStatus?.mind_map, expandedNodes.size]);

  const handleGenerateMindMap = async () => {
    if (!sessionId) return;
    setIsGeneratingMindMap(true);
    try {
      const result = await generateSessionMindMap(sessionId);
      setMindMapStatus(result);
      // Expand all top-level nodes by default
      if (result.status === 'ready' && result.mind_map?.nodes) {
        setExpandedNodes(new Set(result.mind_map.nodes.map(n => n.id)));
      }
    } catch (err: any) {
      setMindMapStatus(prev => prev ? { ...prev, status: 'error', error: err.message || '生成失败' } : { session_id: sessionId, status: 'error', mind_map: null, error: err.message || '生成失败' });
    } finally {
      setIsGeneratingMindMap(false);
    }
  };

  const handleDeleteMindMap = async () => {
    if (!sessionId || !window.confirm('确定要删除知识导图吗？')) return;
    try {
      await deleteSessionMindMap(sessionId);
      setMindMapStatus({ session_id: sessionId, status: 'not_generated', mind_map: null, error: null });
      setSelectedMindMapNode(null);
    } catch (err: any) {
      setMindMapStatus(prev => prev ? { ...prev, status: 'error', error: err?.message || '删除导图失败' } : { session_id: sessionId, status: 'error', mind_map: null, error: '删除导图失败' });
    }
  };

  const handleCopyMindMapOutline = () => {
    if (!mindMapStatus?.mind_map) return;
    const lines: string[] = [];
    const walk = (nodes: MindMapNode[], depth: number) => {
      for (const node of nodes) {
        lines.push('  '.repeat(depth) + '- ' + node.title);
        if (node.children?.length) walk(node.children, depth + 1);
      }
    };
    lines.push('# ' + mindMapStatus.mind_map.title);
    if (mindMapStatus.mind_map.summary) lines.push(mindMapStatus.mind_map.summary);
    walk(mindMapStatus.mind_map.nodes, 0);
    navigator.clipboard.writeText(lines.join('\n')).then(() => { setCopyMindMapSuccess(true); setTimeout(() => setCopyMindMapSuccess(false), 2000); }).catch(() => {
      setMindMapStatus(prev => prev ? { ...prev, error: '复制失败，请检查浏览器剪贴板权限' } : prev);
    });
  };

  const toggleNodeExpand = (nodeId: string) => {
    setExpandedNodes(prev => {
      const next = new Set(prev);
      if (next.has(nodeId)) next.delete(nodeId); else next.add(nodeId);
      return next;
    });
  };

  const handleMindMapSourceClick = (source: { source_type: string; page?: number | null; block_id?: string }) => {
    if (source.source_type === 'ppt' && source.page != null) {
      ppt.actions.setActiveSlideIndex(source.page - 1);
    }
  };

  // ---- Quiz ----
  const loadQuizList = async () => {
    if (!sessionId) return;
    try {
      const list = await getSessionQuizzes(sessionId);
      setQuizList(list);
    } catch { /* ignore */ }
  };

  const loadBankStatus = async () => {
    if (!sessionId) return;
    try {
      const status = await getQuizBankStatus(sessionId);
      setBankStatus(status);
      return status;
    } catch { /* ignore */ }
    return null;
  };

  // Poll bank status while generating
  const startBankPolling = () => {
    if (bankPollRef.current) clearInterval(bankPollRef.current);
    bankPollRef.current = setInterval(async () => {
      const status = await loadBankStatus();
      if (status && status.status !== 'generating') {
        if (bankPollRef.current) clearInterval(bankPollRef.current);
        bankPollRef.current = null;
        setIsRebuildingBank(false);
      }
    }, 2000);
  };

  useEffect(() => {
    if (sessionId && showQuiz) {
      loadQuizList();
      loadBankStatus();
    }
    return () => {
      if (bankPollRef.current) {
        clearInterval(bankPollRef.current);
        bankPollRef.current = null;
      }
    };
  }, [sessionId, showQuiz]);

  const handleRebuildBank = async () => {
    if (!sessionId) return;
    setIsRebuildingBank(true);
    setQuizError(null);
    try {
      await rebuildQuizBank(sessionId);
      startBankPolling();
    } catch (err: any) {
      setQuizError(err?.message || '生成题库失败');
      setIsRebuildingBank(false);
    }
  };

  const handleGenerateQuiz = async () => {
    if (!sessionId) return;
    setIsGeneratingQuiz(true);
    setQuizError(null);
    try {
      const result = await generateSessionQuiz(sessionId);
      if ('status' in result && (result.status === 'generating' || result.status === 'stale')) {
        // Bank not ready — start polling
        setBankStatus(result as QuizBankStatus);
        if (result.status === 'generating') {
          startBankPolling();
        } else {
          // Need to trigger bank generation
          await handleRebuildBank();
        }
        setIsGeneratingQuiz(false);
        return;
      }
      // Quiz created successfully (no answers in response)
      const q = result as { quiz_id: string; title: string; questions: Array<{ id: string; question: string; options: Array<{ id: string; text: string }> }> };
      setActiveQuiz({
        quiz_id: q.quiz_id,
        title: q.title,
        questions: q.questions.map(qq => ({ ...qq, options: qq.options.map(o => ({ id: o.id, text: o.text })) })),
        generated_at: undefined,
        submission: undefined,
      });
      setQuizAnswers({});
      setQuizSubmitted(false);
      await loadQuizList();
    } catch (err: any) {
      setQuizError(err?.message || '生成测验失败');
    } finally {
      setIsGeneratingQuiz(false);
    }
  };

  const handleOpenQuiz = async (quizId: string, alreadySubmitted: boolean) => {
    if (!sessionId) return;
    try {
      const detail = await getQuizDetail(sessionId, quizId);
      setActiveQuiz(detail);
      setQuizSubmitted(alreadySubmitted);
      if (alreadySubmitted && detail.submission) {
        setQuizAnswers(detail.submission.answers);
      } else {
        setQuizAnswers({});
      }
    } catch (err: any) {
      setQuizError(err?.message || '加载测验失败');
    }
  };

  const handleSubmitQuiz = async () => {
    if (!sessionId || !activeQuiz) return;
    try {
      await submitQuizAnswers(sessionId, activeQuiz.quiz_id, quizAnswers);
      // Reload detail to get full explanations
      const detail = await getQuizDetail(sessionId, activeQuiz.quiz_id);
      setActiveQuiz(detail);
      setQuizSubmitted(true);
      await loadQuizList();
    } catch (err: any) {
      setQuizError(err?.message || '提交失败');
    }
  };

  const handleDeleteQuiz = async (quizId: string) => {
    if (!sessionId || !window.confirm('确定要删除这次测验吗？')) return;
    try {
      await deleteQuiz(sessionId, quizId);
      if (activeQuiz?.quiz_id === quizId) {
        setActiveQuiz(null);
        setQuizSubmitted(false);
        setQuizAnswers({});
      }
      await loadQuizList();
    } catch { /* ignore */ }
  };

  const handleQuizSourceClick = (source: { source_type: string; page?: number | null }) => {
    if (source.source_type === 'ppt' && source.page != null) {
      ppt.actions.setActiveSlideIndex(source.page - 1);
    }
  };

  const handleRebuildIndex = async () => {
    if (!sessionId) return;
    setIsRebuilding(true);
    try {
      const result = await rebuildSessionVectorIndex(sessionId);
      setVectorStatus({ session_id: sessionId, chunk_count: result.chunk_count, has_content: true, status: 'indexed' });
    } catch (err: any) {
      alert(err.message || '建立索引失败');
    } finally {
      setIsRebuilding(false);
    }
  };

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    setIsSearching(true);
    setSearchError(null);
    try {
      const result = await searchVectors(
        searchQuery,
        searchScope === 'session' ? sessionId : undefined,
        searchScope === 'notebook' ? displayNotebook?.id : undefined,
      );
      setSearchResults(result.results);
    } catch (err: any) {
      setSearchResults([]);
      setSearchError(err?.message || '搜索失败，请稍后重试');
    } finally {
      setIsSearching(false);
    }
  };

  // ---- PPT ----
  const handlePPTClick = () => fileInputRef.current?.click();

  const handlePPTSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await ppt.actions.handlePPTUpload(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const audioInputRef = useRef<HTMLInputElement>(null);
  const audioUploadAbortRef = useRef<(() => void) | null>(null);

  const handleAudioUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    console.log('[handleAudioUpload] called', e.target.files?.[0]?.name);
    const file = e.target.files?.[0];
    if (!file || !sessionId) return;

    setIsUploadingAudio(true);
    setAudioUploadStatus('正在上传录音文件');
    setAudioUploadError(null);

    // Clear transcript before streaming new content
    transcript.actions.clearDerivedTranscriptViews();
    transcript.actions.clearStreamingTranscriptChunks();
    transcript.actions.updateTranscriptText('', false);

    const { abort } = uploadAudio(file, sessionId, {
      onStatus: (message, segment, total) => {
        if (message) setAudioUploadStatus(message);
        else if (segment && total) setAudioUploadStatus(`正在识别第 ${segment}/${total} 段`);
      },
      onChunk: (text, segment, _segmentTotal, meta) => {
        setAudioUploadStatus('正在写入转写结果');
        if (text?.trim()) {
          transcript.actions.appendTranscriptText(text.trim());
        }
        if (meta?.correctionError) {
          setAudioUploadStatus(meta.correctionError);
        }
      },
      onDone: async (note) => {
        setIsUploadingAudio(false);
        setAudioUploadStatus(null);
        transcript.actions.clearStreamingTranscriptChunks();
        if (audioInputRef.current) audioInputRef.current.value = '';
        audioUploadAbortRef.current = null;
        // Use backend final display_text to replace transcript
        if (note) {
          const sorted = Array.isArray(note.transcript)
            ? [...note.transcript].sort((a: any, b: any) => (a.chunk_index || 0) - (b.chunk_index || 0))
            : [];
          const hasFinal = sorted.some((c: any) => c.correction_stage === 'final');
          const dbText = sorted
            .map((c: any) => c.display_text || c.text || c.raw_text || '')
            .filter(Boolean)
            .join('\n\n')
            .trim();
          if (dbText) {
            transcript.actions.receiveAiText(dbText, { force: true });
          }
          if (!hasFinal) {
            const sentences = transcript.actions.parseSentencesWithTime(note);
            if (sentences.length > 0) {
              transcript.actions.setSentencesWithTime(sentences);
            }
          }
          if (ppt.state.slides.length > 0 && sessionId) {
            try {
              const blocks = await insertPPTIntoTranscript(sessionId);
              if (blocks.blocks?.some((b: ContentBlock) => b.type === 'image')) {
                transcript.actions.updateContentBlocks(blocks.blocks, false, true);
              }
            } catch {}
          }
        }
      },
      onError: (errMsg) => {
        setAudioUploadError(errMsg || '录音上传失败，请确认格式或稍后重试');
        setIsUploadingAudio(false);
        setAudioUploadStatus(null);
        if (audioInputRef.current) audioInputRef.current.value = '';
        audioUploadAbortRef.current = null;
      },
    });

    audioUploadAbortRef.current = abort;
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
            <button onClick={handleShareSession} className="flex items-center gap-1 px-3 py-2 text-sm text-slate-500 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-colors" title="分享">
              <Share2 className="w-3.5 h-3.5" />
            </button>
            <button onClick={() => setShowSearch(!showSearch)} className={`flex items-center gap-1 px-3 py-2 text-sm rounded-lg transition-colors ${showSearch ? 'text-blue-600 bg-blue-50 dark:bg-blue-900/20' : 'text-slate-500 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20'}`} title="搜索">
              <Search className="w-3.5 h-3.5" />
            </button>
            <button onClick={() => setShowMindMap(true)} className="flex items-center gap-1 px-3 py-2 text-sm text-slate-500 hover:text-purple-600 hover:bg-purple-50 dark:hover:bg-purple-900/20 rounded-lg transition-colors" title="知识导图">
              <BrainCircuit className="w-3.5 h-3.5" />
            </button>
            <button onClick={() => { setShowQuiz(true); setActiveQuiz(null); setQuizSubmitted(false); setQuizAnswers({}); setQuizError(null); }} className="flex items-center gap-1 px-3 py-2 text-sm text-slate-500 hover:text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 rounded-lg transition-colors" title="测验">
              <ClipboardCheck className="w-3.5 h-3.5" />
            </button>
            <div className="flex items-center gap-1 px-2 py-1 text-xs rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
              {vectorStatus?.status === 'indexed' ? (
                <>
                  <Database className="w-3 h-3 text-green-500" />
                  <span className="text-green-600 dark:text-green-400">已索引 {vectorStatus.chunk_count}条</span>
                  <button onClick={handleRebuildIndex} disabled={isRebuilding} className="ml-1 text-slate-400 hover:text-blue-500" title="重建索引">
                    <RefreshCw className={`w-3 h-3 ${isRebuilding ? 'animate-spin' : ''}`} />
                  </button>
                </>
              ) : vectorStatus?.status === 'stale' ? (
                <>
                  <Database className="w-3 h-3 text-amber-500" />
                  <span className="text-amber-600 dark:text-amber-400">内容已变化</span>
                  <button onClick={handleRebuildIndex} disabled={isRebuilding} className="ml-1 text-amber-500 hover:text-blue-500 font-medium" title="重建索引">
                    {isRebuilding ? <Loader2 className="w-3 h-3 animate-spin" /> : '重建'}
                  </button>
                </>
              ) : vectorStatus?.status === 'not_indexed' ? (
                <>
                  <Database className="w-3 h-3 text-slate-400" />
                  <button onClick={handleRebuildIndex} disabled={isRebuilding} className="text-slate-500 hover:text-blue-500" title="建立索引">
                    {isRebuilding ? <Loader2 className="w-3 h-3 animate-spin" /> : '建立索引'}
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

            <input ref={audioInputRef} type="file" accept=".wav,.mp3,.webm,.m4a,.ogg,.flac" onChange={handleAudioUpload} className="hidden" />
            <button onClick={() => { if (audioInputRef.current) audioInputRef.current.value = ''; audioInputRef.current?.click(); }} disabled={isUploadingAudio}
              className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg hover:border-green-300 hover:text-green-600 transition-all disabled:opacity-50">
              {isUploadingAudio ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Mic className="w-3.5 h-3.5" />}
              {isUploadingAudio ? '上传中...' : '上传录音'}
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
                  if (recording.state.isRecording) recording.actions.stopRecording(transcript.actions.receiveAiText);
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
              <button onClick={() => recording.actions.stopRecording(transcript.actions.receiveAiText)}
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

      <div className={`flex-shrink-0 mx-4 mt-3 px-3 py-2 border rounded-xl flex items-center gap-2 text-xs ${statusClass}`}>
        {(ppt.state.isUploadingPPT || isUploadingAudio || recording.state.isProcessing || transcript.state.isPptMatching || transcript.state.saveStatus === 'saving') && (
          <Loader2 className="w-3.5 h-3.5 animate-spin flex-shrink-0" />
        )}
        <span className="flex-1">{workflowStatus.text}</span>
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

      {audioUploadError && (
        <div className="flex-shrink-0 mx-4 mt-3 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl flex items-start gap-2">
          <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
          <div className="flex-1"><p className="text-xs text-red-600 dark:text-red-400">{audioUploadError}</p></div>
          <button onClick={() => setAudioUploadError(null)}
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
        <aside className={`${showLeftPanel ? 'fixed inset-y-0 left-0 z-50 w-80' : 'hidden'} lg:relative lg:flex w-5/12 flex-shrink-0 bg-white/60 dark:bg-slate-800/60 backdrop-blur-sm border-r border-slate-200/60 dark:border-slate-700/60 flex flex-col overflow-hidden`}>
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
        <main className="w-7/12 flex flex-col min-h-0 bg-white/40 dark:bg-slate-900/40 backdrop-blur-sm">
          <div className="flex-shrink-0 px-4 md:px-6 py-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-slate-600 dark:text-slate-300 flex items-center gap-2">
                {recording.state.isRecording ? <span className="w-2 h-2 rounded-full bg-red-400 animate-pulse" /> : <span className="w-2 h-2 rounded-full bg-slate-400" />}
                语音转文字 {recording.state.isRecording && <span className="text-xs font-normal text-slate-400">录制中</span>}
              </h2>
              {transcript.state.lastSaveTime && <span className="text-xs text-slate-400">已保存 {new Date(transcript.state.lastSaveTime).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</span>}
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
                            className="p-4 text-sm text-slate-600 dark:text-slate-300 leading-relaxed whitespace-pre-line focus:outline-none min-h-[60px]"
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
                          className="w-full p-4 text-sm text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-200 leading-relaxed whitespace-pre-line min-h-[60px]"
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
                                  ? 'mt-6 first:mt-0 mb-2 text-sm font-semibold text-slate-800 dark:text-slate-100 focus:outline-none'
                                  : 'mb-4 rounded-md border-l-2 border-transparent pl-3 pr-2 py-1 text-slate-600 dark:text-slate-300 whitespace-pre-wrap break-words hover:bg-slate-50/70 dark:hover:bg-slate-800/50 focus:bg-blue-50/50 dark:focus:bg-blue-900/10 focus:border-blue-300 focus:outline-none transition-colors'
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
                            className="p-4 text-sm text-slate-600 dark:text-slate-300 leading-relaxed whitespace-pre-line focus:outline-none min-h-[60px]"
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
                          className="w-full p-4 text-sm text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-200 leading-relaxed whitespace-pre-line min-h-[60px]"
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
                  placeholder={isUploadingAudio ? '正在识别上传录音，结果会逐段显示...' : '正在转录中，可直接编辑修改...'}
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
                {(recording.state.isProcessing || isUploadingAudio) && (
                  <div className="flex items-center gap-2 text-slate-400 text-sm">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    {isUploadingAudio ? (audioUploadStatus || '正在识别上传录音...') : '正在处理录音...'}
                  </div>
                )}
              </div>
            ) : transcript.state.transcriptText === '' ? (
              /* 3) Empty state */
              <div className="flex flex-col items-center justify-center py-20 text-slate-400 dark:text-slate-500">
                <div className="w-16 h-16 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center mb-4">
                  {isUploadingAudio ? (
                    <Loader2 className="w-6 h-6 text-blue-400 animate-spin" />
                  ) : (
                    <Mic className="w-6 h-6 text-slate-300 dark:text-slate-600" />
                  )}
                </div>
                <p className="text-sm">{isUploadingAudio ? '正在等待第一段转写' : '点击录制按钮开始录音'}</p>
                <p className="text-xs mt-1 text-slate-300 dark:text-slate-600">
                  {isUploadingAudio ? '识别结果会先显示原文，再由 AI 替换为整理稿' : '录音将实时转写，PPT 自动对齐插入'}
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
                        className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-3 text-sm text-slate-600 dark:text-slate-300 leading-7 whitespace-pre-wrap break-words shadow-sm outline-none transition-colors hover:border-slate-300 dark:hover:border-slate-600 focus:border-blue-300 dark:focus:border-blue-600 focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-900/30"
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
          </div>
        </main>
      </div>

      {/* ---- Mind Map Drawer ---- */}
      {showMindMap && (
        <div className="fixed inset-0 z-50 flex">
          <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={() => setShowMindMap(false)} />
          <div className="relative ml-auto w-full max-w-[90vw] h-full bg-white dark:bg-slate-800 shadow-xl flex flex-col" onClick={(e) => e.stopPropagation()}>
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200 dark:border-slate-700 flex-shrink-0">
              <div className="flex items-center gap-2">
                <BrainCircuit className="w-5 h-5 text-purple-500" />
                <h2 className="text-base font-semibold text-slate-800 dark:text-slate-200">知识导图</h2>
                {mindMapStatus?.mind_map?.title && mindMapStatus.status === 'ready' && (
                  <span className="text-sm text-slate-400 ml-2">— {mindMapStatus.mind_map.title}</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {mindMapStatus?.mind_map && (
                  <button onClick={handleCopyMindMapOutline} className="p-2 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors" title="复制大纲">
                    {copyMindMapSuccess ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
                  </button>
                )}
                {(mindMapStatus?.status === 'ready' || mindMapStatus?.status === 'stale') && (
                  <button onClick={handleGenerateMindMap} disabled={isGeneratingMindMap} className="px-3 py-1.5 text-xs font-medium text-purple-600 bg-purple-50 dark:bg-purple-900/20 rounded-lg hover:bg-purple-100 dark:hover:bg-purple-900/30 disabled:opacity-50 flex items-center gap-1" title={mindMapStatus.status === 'stale' ? '重新生成' : '重新生成'}>
                    <RefreshCw className={`w-3.5 h-3.5 ${isGeneratingMindMap ? 'animate-spin' : ''}`} />
                    {mindMapStatus.status === 'stale' ? '重新生成' : '重新生成'}
                  </button>
                )}
                {mindMapStatus?.status === 'ready' && (
                  <button onClick={handleDeleteMindMap} className="p-2 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors" title="删除导图">
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
                <button onClick={() => setShowMindMap(false)} className="p-2 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors">
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-hidden">
              {mindMapStatus?.status === 'empty' ? (
                <div className="flex flex-col items-center justify-center h-full text-slate-400 gap-2">
                  <FileText className="w-10 h-10 opacity-30" />
                  <p className="text-sm">当前课次没有可生成的内容</p>
                </div>
              ) : mindMapStatus?.status === 'not_generated' || mindMapStatus?.status === 'stale' ? (
                <div className="flex flex-col items-center justify-center h-full text-slate-400 gap-4">
                  <BrainCircuit className="w-10 h-10 opacity-30" />
                  <p className="text-sm">{mindMapStatus.status === 'stale' ? '内容已变化，需要重新生成' : '尚未生成知识导图'}</p>
                  <button onClick={handleGenerateMindMap} disabled={isGeneratingMindMap} className="px-4 py-2 text-sm font-medium text-white bg-purple-500 rounded-lg hover:bg-purple-600 disabled:opacity-50 flex items-center gap-2">
                    {isGeneratingMindMap ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                    {mindMapStatus.status === 'stale' ? '重新生成' : '生成导图'}
                  </button>
                </div>
              ) : mindMapStatus?.status === 'error' ? (
                <div className="flex flex-col items-center justify-center h-full text-slate-400 gap-4">
                  <AlertCircle className="w-10 h-10 text-red-400 opacity-50" />
                  <p className="text-sm text-red-500">{mindMapStatus.error || '生成失败'}</p>
                  <button onClick={handleGenerateMindMap} disabled={isGeneratingMindMap} className="px-4 py-2 text-sm font-medium text-white bg-purple-500 rounded-lg hover:bg-purple-600 disabled:opacity-50">重试</button>
                </div>
              ) : isGeneratingMindMap || mindMapStatus?.status === 'generating' ? (
                <div className="flex flex-col items-center justify-center h-full text-slate-400 gap-3">
                  <Loader2 className="w-8 h-8 animate-spin text-purple-500" />
                  <p className="text-sm">AI 正在分析课程内容，生成知识导图...</p>
                  {typeof mindMapStatus?.progress === 'number' && (
                    <p className="text-xs text-slate-400">进度 {Math.round(mindMapStatus.progress * 100)}%</p>
                  )}
                </div>
              ) : mindMapStatus?.mind_map ? (
                <MindMapCanvas
                  data={mindMapStatus.mind_map}
                  expanded={expandedNodes}
                  onToggle={toggleNodeExpand}
                  onSelect={setSelectedMindMapNode}
                  selectedNode={selectedMindMapNode}
                  onSourceClick={handleMindMapSourceClick}
                />
              ) : null}
            </div>
          </div>
        </div>
      )}

      {/* ---- Quiz Drawer ---- */}
      {showQuiz && (
        <div className="fixed inset-0 z-50 flex">
          <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={() => setShowQuiz(false)} />
          <div className="relative ml-auto w-full max-w-2xl h-full bg-white dark:bg-slate-800 shadow-xl flex flex-col" onClick={(e) => e.stopPropagation()}>
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-700">
              <div className="flex items-center gap-2">
                <ClipboardCheck className="w-5 h-5 text-emerald-500" />
                <h2 className="text-base font-semibold text-slate-800 dark:text-slate-200">课次测验</h2>
              </div>
              <div className="flex items-center gap-2">
                {activeQuiz && (
                  <button onClick={() => { setActiveQuiz(null); setQuizSubmitted(false); setQuizAnswers({}); }} className="p-2 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors" title="返回列表">
                    <ChevronDown className="w-4 h-4 rotate-90" />
                  </button>
                )}
                <button onClick={() => setShowQuiz(false)} className="p-2 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors">
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto">
              {quizError && (
                <div className="mx-5 mt-4 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 text-sm text-red-600 dark:text-red-400 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  {quizError}
                  <button onClick={() => setQuizError(null)} className="ml-auto text-red-400 hover:text-red-600"><X className="w-3 h-3" /></button>
                </div>
              )}

              {activeQuiz ? (
                /* ---- Active Quiz View ---- */
                <div className="p-5">
                  <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100 mb-4">{activeQuiz.title}</h3>

                  {quizSubmitted && activeQuiz.submission ? (
                    /* ---- Results View ---- */
                    <div>
                      <div className="flex items-center gap-4 mb-6 p-4 rounded-xl bg-slate-50 dark:bg-slate-700/50">
                        <div className="text-center">
                          <div className={`text-3xl font-bold ${activeQuiz.submission.percentage >= 60 ? 'text-emerald-500' : 'text-red-500'}`}>
                            {activeQuiz.submission.percentage}%
                          </div>
                          <div className="text-xs text-slate-400 mt-1">正确率</div>
                        </div>
                        <div className="text-center">
                          <div className="text-2xl font-bold text-slate-700 dark:text-slate-200">
                            {activeQuiz.submission.score}/{activeQuiz.submission.total}
                          </div>
                          <div className="text-xs text-slate-400 mt-1">答对题数</div>
                        </div>
                      </div>

                      <div className="space-y-4">
                        {activeQuiz.questions.map((q, idx) => {
                          const result = activeQuiz.submission!.results.find(r => r.question_id === q.id);
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
                              {q.source && (
                                <button
                                  onClick={() => handleQuizSourceClick(q.source!)}
                                  className="mt-2 ml-5 text-[10px] text-blue-500 hover:text-blue-600 flex items-center gap-1"
                                >
                                  <span className="font-medium">{q.source.source_type === 'transcript' ? '转写' : q.source.source_type === 'ppt' ? `PPT第${q.source.page || '?'}页` : '笔记'}</span>
                                  <span className="line-clamp-1">{q.source.snippet}</span>
                                </button>
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
                        {activeQuiz.questions.map((q, idx) => (
                          <div key={q.id} className="p-4 rounded-xl border border-slate-200 dark:border-slate-600">
                            <p className="text-sm font-medium text-slate-700 dark:text-slate-200 mb-3">
                              <span className="text-emerald-500 mr-1">{idx + 1}.</span>
                              {q.question}
                            </p>
                            <div className="space-y-2">
                              {q.options.map(opt => (
                                <button
                                  key={opt.id}
                                  onClick={() => setQuizAnswers(prev => ({ ...prev, [q.id]: opt.id }))}
                                  className={`w-full text-left px-3 py-2.5 rounded-lg text-sm transition-colors flex items-center gap-2 ${
                                    quizAnswers[q.id] === opt.id
                                      ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700'
                                      : 'bg-slate-50 dark:bg-slate-700 text-slate-600 dark:text-slate-300 border border-transparent hover:bg-slate-100 dark:hover:bg-slate-600'
                                  }`}
                                >
                                  <CircleDot className={`w-4 h-4 flex-shrink-0 ${quizAnswers[q.id] === opt.id ? 'text-emerald-500' : 'text-slate-300 dark:text-slate-500'}`} />
                                  <span className="font-medium mr-1">{opt.id}.</span>
                                  {opt.text}
                                </button>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                      <div className="mt-6 flex items-center justify-between">
                        <span className="text-xs text-slate-400">已答 {Object.keys(quizAnswers).length}/{activeQuiz.questions.length} 题</span>
                        <button
                          onClick={handleSubmitQuiz}
                          disabled={Object.keys(quizAnswers).length < activeQuiz.questions.length}
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
                  {bankStatus && bankStatus.status !== 'ready' && (
                    <div className={`mb-4 p-3 rounded-lg text-sm flex items-center gap-2 ${
                      bankStatus.status === 'generating' ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400' :
                      bankStatus.status === 'stale' ? 'bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400' :
                      bankStatus.status === 'error' ? 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400' :
                      bankStatus.status === 'empty' ? 'bg-slate-50 dark:bg-slate-700 text-slate-500' :
                      'bg-slate-50 dark:bg-slate-700 text-slate-500'
                    }`}>
                      {bankStatus.status === 'generating' && <Loader2 className="w-4 h-4 animate-spin flex-shrink-0" />}
                      {bankStatus.status === 'stale' && <AlertCircle className="w-4 h-4 flex-shrink-0" />}
                      {bankStatus.status === 'error' && <AlertCircle className="w-4 h-4 flex-shrink-0" />}
                      <span>
                        {bankStatus.status === 'generating' && '题库生成中，请稍候...'}
                        {bankStatus.status === 'stale' && '笔记内容已变化，题库需要更新'}
                        {bankStatus.status === 'error' && `题库生成失败: ${bankStatus.error || '未知错误'}`}
                        {bankStatus.status === 'empty' && '当前课次没有可生成的内容'}
                        {bankStatus.status === 'not_generated' && '尚未生成题库'}
                      </span>
                      {(bankStatus.status === 'stale' || bankStatus.status === 'error' || bankStatus.status === 'not_generated') && (
                        <button
                          onClick={handleRebuildBank}
                          disabled={isRebuildingBank}
                          className="ml-auto px-2.5 py-1 text-xs font-medium text-white bg-blue-500 rounded hover:bg-blue-600 disabled:opacity-50 flex items-center gap-1"
                        >
                          {isRebuildingBank && <Loader2 className="w-3 h-3 animate-spin" />}
                          生成题库
                        </button>
                      )}
                    </div>
                  )}

                  {/* Rebuild Bank Button (when bank is ready) */}
                  {bankStatus && bankStatus.status === 'ready' && (
                    <div className="mb-4 flex items-center justify-between p-3 rounded-lg bg-emerald-50 dark:bg-emerald-900/10 text-sm">
                      <span className="text-emerald-600 dark:text-emerald-400">
                        题库已就绪 ({bankStatus.question_count} 题)
                      </span>
                      <button
                        onClick={handleRebuildBank}
                        disabled={isRebuildingBank}
                        className="px-2.5 py-1 text-xs font-medium text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 rounded hover:bg-amber-100 dark:hover:bg-amber-900/40 disabled:opacity-50 flex items-center gap-1"
                        title="重新生成题库会调用 AI"
                      >
                        {isRebuildingBank ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                        重新生成题库
                      </button>
                    </div>
                  )}

                  {isGeneratingQuiz ? (
                    <div className="flex flex-col items-center justify-center py-16 text-slate-400 gap-3">
                      <Loader2 className="w-8 h-8 animate-spin text-emerald-500" />
                      <p className="text-sm">正在从题库抽取题目...</p>
                    </div>
                  ) : quizList.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-16 text-slate-400 gap-4">
                      <ClipboardCheck className="w-10 h-10 opacity-30" />
                      <p className="text-sm">尚未开始测验</p>
                      <button
                        onClick={handleGenerateQuiz}
                        disabled={!bankStatus || bankStatus.status !== 'ready'}
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
                          onClick={handleGenerateQuiz}
                          disabled={isGeneratingQuiz || !bankStatus || bankStatus.status !== 'ready'}
                          className="px-3 py-1.5 text-xs font-medium text-white bg-emerald-500 rounded-lg hover:bg-emerald-600 disabled:opacity-50 flex items-center gap-1"
                        >
                          {isGeneratingQuiz ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                          开始新测验
                        </button>
                      </div>
                      <div className="space-y-2">
                        {quizList.map(quiz => (
                          <div key={quiz.quiz_id} className="flex items-center justify-between p-3 rounded-xl border border-slate-200 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors">
                            <button
                              onClick={() => handleOpenQuiz(quiz.quiz_id, quiz.submitted)}
                              className="flex-1 text-left"
                            >
                              <div className="text-sm font-medium text-slate-700 dark:text-slate-200">{quiz.title}</div>
                              <div className="text-xs text-slate-400 mt-0.5">
                                {quiz.question_count} 题 · {quiz.submitted ? '已完成' : '未完成'}
                                {quiz.score && ` · ${quiz.score.percentage}%`}
                                {quiz.generated_at && ` · ${new Date(quiz.generated_at).toLocaleDateString()}`}
                              </div>
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); handleDeleteQuiz(quiz.quiz_id); }}
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

      {showSearch && (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-20 bg-black/30 backdrop-blur-sm" onClick={() => setShowSearch(false)}>
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl w-full max-w-lg mx-4 overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 p-4 border-b border-slate-200 dark:border-slate-700">
              <Search className="w-4 h-4 text-slate-400" />
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleSearch(); }}
                placeholder="搜索关键词..."
                className="flex-1 text-sm bg-transparent outline-none text-slate-700 dark:text-slate-200 placeholder:text-slate-400"
                autoFocus
              />
              <div className="flex items-center rounded-lg border border-slate-200 dark:border-slate-600 overflow-hidden">
                <button onClick={() => setSearchScope('session')} className={`px-2 py-1 text-[10px] font-medium transition-colors ${searchScope === 'session' ? 'bg-blue-500 text-white' : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700'}`}>本课次</button>
                <button onClick={() => setSearchScope('notebook')} className={`px-2 py-1 text-[10px] font-medium transition-colors ${searchScope === 'notebook' ? 'bg-blue-500 text-white' : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700'}`}>本课程</button>
              </div>
              <button onClick={handleSearch} disabled={isSearching} className="px-3 py-1.5 text-xs font-medium text-white bg-blue-500 rounded-lg hover:bg-blue-600 disabled:opacity-50">
                {isSearching ? '...' : '搜索'}
              </button>
            </div>
            <div className="max-h-80 overflow-y-auto">
              {searchError ? (
                <div className="px-4 py-8 text-center text-xs text-red-500">{searchError}</div>
              ) : searchResults.length > 0 ? (
                <div className="divide-y divide-slate-100 dark:divide-slate-700">
                  {searchResults.map((r) => (
                    <button
                      key={r.chunk_id}
                      onClick={() => {
                        if (r.session_id !== sessionId) {
                          navigate(`/subject/${r.notebook_id}/session/${r.session_id}`);
                        }
                        setShowSearch(false);
                      }}
                      className="w-full text-left px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors"
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                          r.source_type === 'transcript' ? 'bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400' :
                          r.source_type === 'ppt' ? 'bg-purple-50 text-purple-600 dark:bg-purple-900/30 dark:text-purple-400' :
                          r.source_type === 'note' ? 'bg-amber-50 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400' :
                          'bg-slate-50 text-slate-600 dark:bg-slate-700 dark:text-slate-400'
                        }`}>
                          {r.source_type === 'transcript' ? '转写' : r.source_type === 'ppt' ? 'PPT' : r.source_type === 'note' ? '笔记' : r.source_type}
                        </span>
                        <span className="text-xs text-slate-500 dark:text-slate-400 truncate">{r.session_title}</span>
                        <span className="ml-auto text-[10px] text-slate-400">{(r.score * 100).toFixed(0)}%</span>
                      </div>
                      <p className="text-xs text-slate-600 dark:text-slate-300 line-clamp-2">{r.snippet}</p>
                    </button>
                  ))}
                </div>
              ) : searchQuery && !isSearching ? (
                <div className="px-4 py-8 text-center text-xs text-slate-400">未找到相关内容</div>
              ) : (
                <div className="px-4 py-8 text-center text-xs text-slate-400">输入关键词搜索{searchScope === 'session' ? '当前课次' : '当前课程'}</div>
              )}
            </div>
          </div>
        </div>
      )}

      {showShareModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setShowShareModal(false)}>
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl p-6 w-full max-w-md mx-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold text-slate-800 dark:text-slate-200">分享课次</h3>
              <button onClick={() => setShowShareModal(false)} className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"><X className="w-4 h-4" /></button>
            </div>
            {shareLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
              </div>
            ) : shareEnabled && shareLink ? (
              <>
                <div className="flex items-center gap-2 mb-3">
                  <span className="w-2 h-2 rounded-full bg-green-400" />
                  <span className="text-xs text-green-600 dark:text-green-400">分享已开启</span>
                </div>
                <div className="flex items-center gap-2 mb-4">
                  <input readOnly value={shareLink} className="flex-1 px-3 py-2 text-sm border border-slate-200 dark:border-slate-600 rounded-lg bg-slate-50 dark:bg-slate-900 text-slate-600 dark:text-slate-300" />
                  <button onClick={() => { navigator.clipboard.writeText(shareLink); setCopySuccess(true); setTimeout(() => setCopySuccess(false), 3000); }}
                    className="px-3 py-2 text-sm font-medium text-white bg-blue-500 rounded-lg hover:bg-blue-600 transition-colors">{copySuccess ? '已复制' : '复制'}</button>
                </div>
                <button onClick={handleDisableShare} className="w-full py-2 text-sm text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors">
                  关闭分享
                </button>
              </>
            ) : (
              <div className="text-center py-4">
                <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">开启分享失败，请重试</p>
                <button onClick={handleShareSession} className="px-4 py-2 text-sm font-medium text-white bg-blue-500 rounded-lg hover:bg-blue-600 transition-colors">重试</button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
