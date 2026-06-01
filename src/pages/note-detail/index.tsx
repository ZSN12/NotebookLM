import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Play, Pause, ChevronUp, ChevronDown, Edit3, Plus, Loader2, AlertCircle, ImagePlus,
  X, FileText, Square, Download, Bold, List, Share2, Trash2, Mic, MicOff,
  ChevronDown as ChevronDownIcon
} from 'lucide-react';
import { useStore } from '@/store/useStore';
import { useState, useRef, useCallback, useEffect } from 'react';
import { getProfile, getAvatarUrl } from '@/services/auth';
import ThemeToggle from '@/components/ThemeToggle';
import RichTextEditor from '@/components/RichTextEditor';
import { API_BASE, deleteAudio, fetchNote, updateNote, uploadPPT, insertPPTIntoTranscript } from '@/services/api';
import { sanitizeHTML } from '@/lib/sanitize';

import { useRecording } from './useRecording';
import { useTranscript, StudentNote } from './useTranscript';
import { usePPT } from './usePPT';
import { useNotes } from './useNotes';
import { useExport } from './useExport';
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
  const [profile, setProfile] = useState<any>(null);

  useEffect(() => { getProfile().then(setProfile).catch(() => {}); }, []);

  // ---- Hooks ----
  const recording = useRecording(sessionId);
  const ppt = usePPT(sessionId);
  const notesHook = useNotes();
  const transcript = useTranscript(sessionId, recording.state.isRecording, ppt.state.slides);
  const exportTools = useExport(session, notebook);

  const [isLoading, setIsLoading] = useState(true);
  const [showShareModal, setShowShareModal] = useState(false);
  const [shareLink, setShareLink] = useState('');
  const [copySuccess, setCopySuccess] = useState(false);
  const [showSidebar, setShowSidebar] = useState(false); // tablet sidebar toggle

  const fileInputRef = useRef<HTMLInputElement>(null);
  const transcriptEditRef = useRef<HTMLDivElement>(null);
  const noteEditRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const activeTextElRef = useRef<HTMLDivElement | null>(null);
  const activeTextSetterRef = useRef<((text: string) => void) | null>(null);

  // ---- Load history ----
  useEffect(() => {
    if (!sessionId) { setIsLoading(false); return; }
    (async () => {
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
            if (fullTranscript) { transcript.actions.setTranscriptText(fullTranscript); transcriptRestored = true; }
          }
          if (!transcriptRestored && note.content) {
            const match = note.content.match(/^## 语音转文字\n\n([\s\S]*?)(?:\n\n---\n\n[\s\S]*)?$/);
            if (match && match[1].trim()) transcript.actions.setTranscriptText(match[1].trim());
          }
          if (note.content) {
            const parsed = notesHook.actions.parseNotesFromContent(note.content);
            if (parsed.length > 0) notesHook.actions.setNotes(parsed);
          }
          if (note.ppt_images && note.ppt_images.length > 0) {
            const lastPpt = note.ppt_images[note.ppt_images.length - 1];
            if (lastPpt.slides) ppt.actions.setSlides(lastPpt.slides);
            setTimeout(async () => {
              try {
                const blocks = await insertPPTIntoTranscript(sessionId);
                if (blocks.blocks?.some((b: ContentBlock) => b.type === 'image')) {
                  transcript.actions.setContentBlocks(blocks.blocks);
                }
              } catch {}
            }, 500);
          }
        }
      } catch (error) { console.error('Failed to load history:', error); }
      finally { setIsLoading(false); }
    })();
  }, [sessionId]);

  // ---- Auto-save ----
  useEffect(() => {
    if (!sessionId) return;
    const timer = setTimeout(() => {
      transcript.actions.saveContent(notesHook.state.notes);
    }, 3000);
    return () => clearTimeout(timer);
  }, [transcript.state.transcriptText, notesHook.state.notes]);

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
        try { range.surroundContents(wrapper); } catch { document.execCommand('bold', false); }
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
          try { range.surroundContents(span); } catch { document.execCommand('foreColor', false, value); }
        }
        break;
      }
    }
    sel.removeAllRanges();
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };

  // ---- Share ----
  const handleShareSession = () => {
    if (!sessionId) return;
    const link = `${window.location.origin}/share/${sessionId}`;
    setShareLink(link);
    navigator.clipboard.writeText(link).then(() => setCopySuccess(true)).catch(() => {});
    setShowShareModal(true);
    setTimeout(() => setCopySuccess(false), 3000);
  };

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
    <div className="min-h-screen flex flex-col bg-slate-50 dark:bg-slate-950">
      {/* ---- Top Nav ---- */}
      <nav className="flex-shrink-0 bg-white/70 dark:bg-slate-900/70 backdrop-blur-md border-b border-slate-200/60 dark:border-slate-800/60">
        <div className="px-4 py-2.5 flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <button onClick={() => navigate(`/subject/${id}`)} className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div className="min-w-0">
              <h1 className="text-sm font-semibold text-slate-800 dark:text-slate-200 truncate">{session?.title || '课次'}</h1>
              <p className="text-xs text-slate-400 truncate">{notebook?.title}</p>
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
                  <button onClick={() => exportTools.actions.exportMarkdown(transcript.state.transcriptText, notesHook.state.notes)}
                    className="w-full text-left px-3 py-2 text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors">
                    📝 导出 Markdown
                  </button>
                  <button onClick={() => exportTools.actions.exportPDF(transcript.state.transcriptText, notesHook.state.notes)} disabled={exportTools.state.isExportingPDF}
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
        <div className="px-4 py-2.5 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <input ref={fileInputRef} type="file" accept=".ppt,.pptx,.pdf" onChange={handlePPTSelect} className="hidden" />
            <button onClick={handlePPTClick} disabled={ppt.state.isUploadingPPT}
              className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg hover:border-blue-300 hover:text-blue-600 transition-all disabled:opacity-50">
              {ppt.state.isUploadingPPT ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ImagePlus className="w-3.5 h-3.5" />}
              {ppt.state.isUploadingPPT ? '上传中...' : '上传PPT'}
            </button>
            {ppt.state.slides.length > 0 && <span className="text-xs text-slate-400">{ppt.state.slides.length} 页</span>}
          </div>

          <div className="flex items-center gap-3">
            <div className="relative">
              {recording.state.isProcessing ? (
                <button disabled className="w-9 h-9 rounded-full bg-gradient-to-br from-blue-500 to-blue-600 text-white flex items-center justify-center shadow-lg cursor-wait">
                  <Loader2 className="w-4 h-4 animate-spin" />
                </button>
              ) : recording.state.isError ? (
                <button onClick={() => {
                  if (recording.state.isRecording) recording.actions.stopRecording(transcript.actions.appendTranscriptText);
                }}
                  className="w-9 h-9 rounded-full bg-gradient-to-br from-red-500 to-red-600 text-white flex items-center justify-center shadow-lg hover:shadow-xl transition-all hover:scale-105 active:scale-95">
                  <AlertCircle className="w-4 h-4" />
                </button>
              ) : (
                <button onClick={() => {
                  if (recording.state.isPaused) recording.actions.resumeRecording(transcript.actions.appendTranscriptText);
                  else if (recording.state.isRecording) recording.actions.pauseRecording();
                  else recording.actions.startRecording(transcript.actions.appendTranscriptText);
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
                if (recording.state.isPaused) recording.actions.resumeRecording(transcript.actions.appendTranscriptText);
                else recording.actions.pauseRecording();
              }}
                className="flex items-center gap-1 px-3 py-2 text-sm font-medium rounded-md bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 hover:bg-amber-200 transition-colors min-h-[44px]">
                {recording.state.isPaused ? <Play className="w-3 h-3" /> : <Square className="w-3 h-3" />}
                {recording.state.isPaused ? '继续' : '暂停'}
              </button>
            )}

            {recording.state.isRecording && (
              <button onClick={() => recording.actions.stopRecording(transcript.actions.appendTranscriptText)}
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

      {recording.state.isError && recording.state.errorMessage && (
        <div className="flex-shrink-0 mx-4 mt-3 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl flex items-start gap-2">
          <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
          <div className="flex-1"><p className="text-xs text-red-600 dark:text-red-400">{recording.state.errorMessage}</p></div>
          <button onClick={() => { recording.actions.setIsError(false); recording.actions.setErrorMessage(''); }}
            className="p-0.5 text-red-400 hover:text-red-600"><X className="w-3.5 h-3.5" /></button>
        </div>
      )}

      {transcript.state.isAiRestructuring && recording.state.isRecording && (
        <div className="flex-shrink-0 mx-4 mt-2 flex items-center gap-2 px-3 py-2 bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800 rounded-lg text-xs text-blue-600 dark:text-blue-400">
          <Loader2 className="w-3 h-3 animate-spin" />
          AI 正在整理文本...
        </div>
      )}

      {transcript.state.isTranscribing && !recording.state.isRecording && (
        <div className="flex-shrink-0 mx-4 mt-2 flex items-center gap-2 px-3 py-2 bg-green-50 dark:bg-green-900/20 border border-green-100 dark:border-green-800 rounded-lg text-xs text-green-600 dark:text-green-400">
          <Loader2 className="w-3 h-3 animate-spin" />
          录音已保存，AI 正在整理全文...
        </div>
      )}

      {/* ---- Two-column layout (sidebar hidden on tablet, toggleable) ---- */}
      <div className="flex-1 flex overflow-hidden">
        {!showSidebar && (
          <button
            onClick={() => setShowSidebar(true)}
            className="lg:hidden fixed bottom-6 right-6 z-40 w-12 h-12 rounded-full bg-blue-500 text-white shadow-lg flex items-center justify-center hover:bg-blue-600 transition-colors"
            title="显示PPT和笔记"
          >
            <FileText className="w-5 h-5" />
          </button>
        )}
        <main className="flex-1 overflow-y-auto bg-white/40 dark:bg-slate-900/40 backdrop-blur-sm">
          <div className="px-6 md:px-8 py-5">
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
                  const ok = await deleteAudio(sessionId);
                  if (ok) { recording.actions.setAudioPlaybackUrl(null); recording.actions.setIsPlayingAudio(false); }
                }}
                  className="min-w-[44px] min-h-[44px] rounded-lg text-red-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 flex items-center justify-center transition-colors" title="删除录音">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
                <audio ref={recording.refs.audioPlayerRef} src={recording.state.audioPlaybackUrl} onEnded={() => recording.actions.setIsPlayingAudio(false)}
                  onPause={() => recording.actions.setIsPlayingAudio(false)} onPlay={() => recording.actions.setIsPlayingAudio(true)} className="hidden" />
              </div>
            )}

            {transcript.state.transcriptText === '' && !recording.state.isRecording && !recording.state.isProcessing ? (
              <div className="flex flex-col items-center justify-center py-20 text-slate-400 dark:text-slate-500">
                <div className="w-16 h-16 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center mb-4">
                  <Mic className="w-6 h-6 text-slate-300 dark:text-slate-600" />
                </div>
                <p className="text-sm">点击录制按钮开始录音</p>
                <p className="text-xs mt-1 text-slate-300 dark:text-slate-600">录音将实时转写，PPT 自动对齐插入</p>
              </div>
            ) : transcript.state.contentBlocks.length > 0 ? (
              <div className="space-y-4">
                {transcript.state.contentBlocks.map((block: ContentBlock, idx) =>
                  block.type === 'text' ? (
                    <div key={idx} className="prose prose-slate prose-sm dark:prose-invert max-w-none text-slate-600 dark:text-slate-300 leading-relaxed"
                      dangerouslySetInnerHTML={{ __html: sanitizeHTML(block.content || '') }} />
                  ) : block.type === 'image' ? (
                    <div key={idx} className="my-4 rounded-xl overflow-hidden border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800">
                      <div className="px-3 py-1.5 bg-slate-100 dark:bg-slate-700 text-xs text-slate-500 dark:text-slate-400 font-medium">PPT 第 {block.page} 页 · {block.title}</div>
                      <img src={block.src?.startsWith('data:') ? block.src : `${API_BASE}${block.src}`} alt={`PPT 第 ${block.page} 页`} className="w-full object-contain" />
                    </div>
                  ) : (
                    <div key={idx} className="flex items-center gap-2 py-2 px-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
                      <FileText className="w-3.5 h-3.5 text-blue-500" />
                      <span className="text-xs text-blue-600 dark:text-blue-400 font-medium">PPT 第 {block.page} 页 · {block.title}</span>
                    </div>
                  )
                )}
              </div>
            ) : recording.state.isRecording ? (
              <div className="space-y-2">
                <RichTextEditor
                  ref={transcriptEditRef}
                  value={transcript.state.transcriptText}
                  onChange={(text) => { transcript.actions.setTranscriptText(text); }}
                  onFocus={() => {
                    activeTextElRef.current = transcriptEditRef.current;
                    activeTextSetterRef.current = (text: string) => transcript.actions.setTranscriptText(text);
                  }}
                  placeholder="正在转录中，可直接编辑修改..."
                  className="rich-text-editor w-full p-4 text-sm text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-800 border border-blue-200 dark:border-blue-700 rounded-xl min-h-[300px] focus:outline-none focus:ring-2 focus:ring-blue-200 leading-relaxed"
                />
                {recording.state.isProcessing && (
                  <div className="flex items-center gap-2 text-slate-400 text-sm"><Loader2 className="w-4 h-4 animate-spin" />初始化录音...</div>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                <RichTextEditor
                  ref={transcriptEditRef}
                  value={transcript.state.transcriptText}
                  onChange={(text) => { transcript.actions.setTranscriptText(text); }}
                  onFocus={() => {
                    activeTextElRef.current = transcriptEditRef.current;
                    activeTextSetterRef.current = (text: string) => transcript.actions.setTranscriptText(text);
                  }}
                  onBlur={() => {
                    if (activeTextElRef.current === transcriptEditRef.current) {
                      activeTextElRef.current = null;
                      activeTextSetterRef.current = null;
                    }
                  }}
                  placeholder={recording.state.isRecording ? '正在转录...' : '转录内容将显示在这里，可直接编辑修改...'}
                  className="rich-text-editor w-full p-4 text-sm text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 rounded-xl min-h-[300px] focus:outline-none focus:ring-2 focus:ring-blue-200 leading-relaxed"
                />
              </div>
            )}
          </div>
        </main>

        <aside className={`${showSidebar ? 'fixed inset-0 z-50' : 'hidden'} lg:relative lg:flex lg:w-72 flex-shrink-0 bg-white/60 dark:bg-slate-800/60 backdrop-blur-sm border-l border-slate-200/60 dark:border-slate-700/60 flex flex-col overflow-hidden`}>
          <div className="flex-shrink-0 border-b border-slate-200/60 dark:border-slate-700/60">
            <div className="px-3 py-2 flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5 text-blue-500" />
                <h3 className="text-xs font-semibold text-slate-600 dark:text-slate-300">PPT</h3>
              </div>
              {/* Close button (tablet only) */}
              <button onClick={() => setShowSidebar(false)} className="lg:hidden min-w-[36px] min-h-[36px] flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors">
                <X className="w-4 h-4" />
              </button>
              {ppt.state.slides.length > 0 && (
                <div className="flex items-center gap-1">
                  <span className="text-xs text-slate-400 font-mono">{ppt.state.activeSlideIndex + 1}/{ppt.state.slides.length}</span>
                  <button onClick={() => ppt.actions.setActiveSlideIndex(Math.max(0, ppt.state.activeSlideIndex - 1))}
                    disabled={ppt.state.activeSlideIndex === 0}
                    className="p-0.5 rounded text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-30 transition-colors">
                    <ChevronUp className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => ppt.actions.setActiveSlideIndex(Math.min(ppt.state.slides.length - 1, ppt.state.activeSlideIndex + 1))}
                    disabled={ppt.state.activeSlideIndex === ppt.state.slides.length - 1}
                    className="p-0.5 rounded text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-30 transition-colors">
                    <ChevronDown className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>
            {ppt.state.slides.length > 0 && ppt.state.slides[ppt.state.activeSlideIndex] ? (
              <div className="px-3 pb-3">
                <div className="bg-slate-100 dark:bg-slate-900 rounded-lg overflow-hidden border border-slate-200 dark:border-slate-700">
                  {(() => {
                    const s = ppt.state.slides[ppt.state.activeSlideIndex];
                    const src = s.image_path
                      ? `${API_BASE}/api/media/slides/${sessionId}/${s.image_path}`
                      : s.image_base64 || '';
                    return src ? (
                      <img src={src} alt={`Slide ${s.page}`}
                        className="w-full object-contain max-h-48"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                    ) : (
                      <div className="flex items-center justify-center h-24 text-xs text-slate-400">无预览</div>
                    );
                  })()}
                </div>
              </div>
            ) : (
              <div className="px-3 pb-3">
                <div className="flex items-center justify-center h-20 bg-slate-50 dark:bg-slate-900/50 rounded-lg border border-dashed border-slate-300 dark:border-slate-600">
                  <p className="text-xs text-slate-400">提交PPT后即可显示</p>
                </div>
              </div>
            )}
          </div>

          <div className="flex-1 flex flex-col min-h-0">
            <div className="px-3 py-2 border-b border-slate-100 dark:border-slate-700/50 flex items-center gap-1.5">
              <Edit3 className="w-3.5 h-3.5 text-slate-400" />
              <h3 className="text-xs font-semibold text-slate-600 dark:text-slate-300">随堂思考与重难点</h3>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
              {notesHook.state.notes.map((note, idx) => (
                <div key={idx} className="group">
                  {notesHook.state.editingNote === String(idx) ? (
                    <div onBlur={() => notesHook.actions.setEditingNote(null)}>
                      <RichTextEditor ref={(el) => { if (el) noteEditRefs.current.set(String(idx), el); }}
                        value={note.content} onChange={(text) => notesHook.actions.updateNote(idx, text)}
                        onFocus={() => { activeTextElRef.current = noteEditRefs.current.get(String(idx)) || null; activeTextSetterRef.current = (text: string) => notesHook.actions.updateNote(idx, text); }}
                        placeholder="笔记内容..."
                        className="rich-text-editor w-full p-2.5 text-sm text-slate-600 dark:text-slate-300 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-200 leading-relaxed"
                      />
                    </div>
                  ) : note.content ? (
                    <div onClick={() => notesHook.actions.setEditingNote(String(idx))}
                      className="p-2.5 text-sm text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-700 border border-slate-100 dark:border-slate-600 rounded-lg hover:border-amber-200 hover:bg-amber-50/50 dark:hover:bg-amber-900/10 cursor-pointer transition-all leading-relaxed"
                      dangerouslySetInnerHTML={{ __html: sanitizeHTML(note.content) }} />
                  ) : (
                    <div onClick={() => notesHook.actions.setEditingNote(String(idx))}
                      className="p-2.5 text-sm text-slate-400 dark:text-slate-500 bg-white dark:bg-slate-700 border border-slate-100 dark:border-slate-600 rounded-lg hover:border-amber-200 cursor-pointer transition-all">点此编辑...</div>
                  )}
                </div>
              ))}
              <button onClick={notesHook.actions.addNote}
                className="w-full p-2.5 border-2 border-dashed border-slate-200 dark:border-slate-600 rounded-lg text-sm text-slate-400 hover:border-blue-300 hover:text-blue-500 hover:bg-blue-50/30 transition-all flex items-center justify-center gap-1.5">
                <Plus className="w-3.5 h-3.5" />添加笔记
              </button>
            </div>
          </div>
        </aside>
      </div>

      {showShareModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setShowShareModal(false)}>
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl p-6 w-full max-w-md mx-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold text-slate-800 dark:text-slate-200">分享课次</h3>
              <button onClick={() => setShowShareModal(false)} className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"><X className="w-4 h-4" /></button>
            </div>
            <div className="flex items-center gap-2 mb-4">
              <input readOnly value={shareLink} className="flex-1 px-3 py-2 text-sm border border-slate-200 dark:border-slate-600 rounded-lg bg-slate-50 dark:bg-slate-900 text-slate-600 dark:text-slate-300" />
              <button onClick={() => { navigator.clipboard.writeText(shareLink); setCopySuccess(true); setTimeout(() => setCopySuccess(false), 3000); }}
                className="px-3 py-2 text-sm font-medium text-white bg-blue-500 rounded-lg hover:bg-blue-600 transition-colors">{copySuccess ? '已复制' : '复制'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
