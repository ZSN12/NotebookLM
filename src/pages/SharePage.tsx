import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, ChevronRight, Loader2, Play, Pause, FileText, Download } from 'lucide-react';
import { useState, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import rehypeRaw from 'rehype-raw';
import ThemeToggle from '@/components/ThemeToggle';
import PPTViewer from '@/components/PPTViewer';
import { API_BASE, fetchNote, Slide } from '@/services/api';
import { sanitizeHTML } from '@/lib/sanitize';

interface SessionData {
  id: string;
  notebook_id: string;
  title: string;
  summary: string | null;
  duration: string;
  keywords: string[];
}

interface NotebookData {
  id: string;
  title: string;
}

export default function SharePage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();

  const [session, setSession] = useState<SessionData | null>(null);
  const [notebook, setNotebook] = useState<NotebookData | null>(null);
  const [transcriptText, setTranscriptText] = useState('');
  const [notes, setNotes] = useState<{ type: string; content: string }[]>([]);
  const [slides, setSlides] = useState<Slide[]>([]);
  const [summary, setSummary] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [activeSlideIndex, setActiveSlideIndex] = useState(0);

  useEffect(() => {
    const loadSharedSession = async () => {
      if (!sessionId) return;
      try {
        setIsLoading(true);

        const sessionRes = await fetch(`${API_BASE}/api/sessions/${sessionId}`).catch(() => null);
        if (sessionRes?.ok) {
          const sessionData = await sessionRes.json();
          setSession(sessionData);
          setSummary(sessionData.summary || '');

          const notebookRes = await fetch(`${API_BASE}/api/notebooks/${sessionData.notebook_id}`).catch(() => null);
          if (notebookRes?.ok) {
            const notebookData = await notebookRes.json();
            setNotebook(notebookData);
          }
        }

        const note = await fetchNote(sessionId);
        if (note) {
          if (note.transcript && Array.isArray(note.transcript) && note.transcript.length > 0) {
            const fullTranscript = note.transcript
              .sort((a: any, b: any) => (a.chunk_index || 0) - (b.chunk_index || 0))
              .map((chunk: any) => chunk.text || '')
              .join(' ');
            setTranscriptText(fullTranscript);
          }

          if (note.content) {
            const transcriptSectionMatch = note.content.match(/^## 语音转文字\n\n([\s\S]*?)\n\n---\n\n([\s\S]*)$/);
            if (transcriptSectionMatch) {
              const notesContent = transcriptSectionMatch[2];
              if (notesContent.trim()) {
                const savedNotes = notesContent.split('\n\n').filter(Boolean).map(content => ({
                  type: 'text',
                  content,
                }));
                setNotes(savedNotes);
              }
            } else {
              const savedNotes = note.content.split('\n\n').filter(Boolean).map(content => ({
                type: 'text',
                content,
              }));
              setNotes(savedNotes);
            }
          }

          if (note.ppt_images && note.ppt_images.length > 0) {
            const lastPpt = note.ppt_images[note.ppt_images.length - 1];
            if (lastPpt.slides) {
              setSlides(lastPpt.slides);
            }
          }
        }
      } catch (error) {
        console.error('Failed to load shared session:', error);
      } finally {
        setIsLoading(false);
      }
    };

    loadSharedSession();
  }, [sessionId]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-900">
        <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
        <p className="ml-2 text-slate-500 dark:text-slate-400">加载中...</p>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-900">
        <p className="text-slate-500 dark:text-slate-400">课次不存在或已被删除</p>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-gradient-to-br from-slate-50 via-blue-50/20 to-slate-100 dark:from-slate-900 dark:via-slate-900 dark:to-slate-800">
      <nav className="flex-shrink-0 sticky top-0 z-40 backdrop-blur-xl bg-white/70 dark:bg-slate-900/70 border-b border-slate-200/60 dark:border-slate-700/60">
        <div className="px-6 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <button
                onClick={() => navigate('/')}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
              <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
                <span>分享预览</span>
                <ChevronRight className="w-4 h-4 text-slate-300" />
                <span className="text-slate-700 dark:text-slate-200 font-medium truncate max-w-[200px]">
                  {session.title}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <ThemeToggle />
            </div>
          </div>
        </div>
      </nav>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto px-6 py-6">
          <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-200 mb-2">{session.title}</h1>
          <div className="flex items-center gap-4 text-sm text-slate-500 dark:text-slate-400 mb-6">
            {notebook && <span>所属科目：{notebook.title}</span>}
            {session.duration && <span>课程时长：{session.duration}</span>}
          </div>

          {summary && (
            <div className="mb-6 p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl">
              <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2 flex items-center gap-2">
                <FileText className="w-4 h-4" />
                课程摘要
              </h2>
              <div className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">{summary}</div>
            </div>
          )}

          {transcriptText && (
            <div className="mb-6">
              <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-3 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-slate-400" />
                语音转文字
              </h2>
              <div className="prose prose-slate prose-sm dark:prose-invert max-w-none p-4 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-600 dark:text-slate-300 leading-relaxed">
                {transcriptText}
              </div>
            </div>
          )}

          {notes.length > 0 && notes.some(n => n.content.trim()) && (
            <div className="mb-6">
              <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-3">随堂笔记</h2>
              <div className="space-y-3">
                {notes.filter(n => n.content.trim()).map((note, idx) => (
                  <div
                    key={idx}
                    className="p-4 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-xl text-sm text-slate-600 dark:text-slate-300 leading-relaxed"
                    dangerouslySetInnerHTML={{ __html: sanitizeHTML(note.content) }}
                  />
                ))}
              </div>
            </div>
          )}

          {slides.length > 0 && (
            <div className="mb-6">
              <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-3">PPT 内容</h2>
              <PPTViewer
                slides={slides}
                sessionId={sessionId}
                activeSlideIndex={activeSlideIndex}
                onSlideChange={setActiveSlideIndex}
              />
            </div>
          )}

          <div className="text-center text-xs text-slate-400 dark:text-slate-500 mt-8 pt-6 border-t border-slate-200 dark:border-slate-700">
            由 Nootbook 智能课堂笔记生成
          </div>
        </div>
      </div>
    </div>
  );
}
