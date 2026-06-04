import type { Notebook, Session } from '@/types';
import { getToken, clearToken } from './auth';
import { API_BASE } from '@/config';
import type { NoteLayoutBlock } from '@/lib/noteLayout';
export { API_BASE };

function authHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export function getMediaUrl(pathOrUrl: string): string {
  const token = getToken();
  const url = pathOrUrl.startsWith('http') ? new URL(pathOrUrl) : new URL(`${API_BASE}${pathOrUrl}`);
  if (token) {
    url.searchParams.set('token', token);
  }
  return url.toString();
}

export interface BackendNotebook {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  icon: string | null;
  color: string | null;
  session_count: number;
  created_at: string;
}

export interface BackendSession {
  id: string;
  notebook_id: string;
  title: string;
  summary: string | null;
  keywords: string[];
  status: string;
  created_at: string;
}

export interface BackendNote {
  id: string;
  session_id: string;
  content: string | null;
  transcript: any[] | null;
  ppt_images: any[] | null;
  vocabulary: any[] | null;
  layout_blocks?: NoteLayoutBlock[] | null;
  created_at: string;
}

const iconMap: Record<string, string> = {
  'BookOpen': 'BookOpen',
  'Code': 'Code',
  'Brain': 'Brain',
  'Network': 'Network',
  'FileText': 'FileText',
};

const colorMap: Record<number, string> = {
  0: 'from-blue-500 to-blue-600',
  1: 'from-violet-500 to-violet-600',
  2: 'from-emerald-500 to-emerald-600',
  3: 'from-orange-500 to-orange-600',
  4: 'from-pink-500 to-pink-600',
  5: 'from-cyan-500 to-cyan-600',
};

export function mapBackendNotebook(bn: BackendNotebook): Notebook {
  return {
    id: bn.id,
    title: bn.title,
    description: bn.description || '',
    icon: iconMap[bn.icon || ''] || 'BookOpen',
    color: bn.color || colorMap[Math.floor(Math.random() * 6)],
    sessionCount: bn.session_count,
    updatedAt: bn.created_at.split('T')[0],
    createdAt: bn.created_at.split('T')[0],
  };
}

export function mapBackendSession(bs: BackendSession): Session {
  return {
    id: bs.id,
    notebookId: bs.notebook_id,
    title: bs.title,
    summary: bs.summary || '',
    keywords: bs.keywords || [],
    icon: 'FileText',
    date: bs.created_at.split('T')[0],
    duration: '00:00:00',
    content: `# ${bs.title}\n\n在这里开始编写笔记...`,
  };
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const fullUrl = `${API_BASE}${url}`;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    const res = await fetch(fullUrl, {
      ...options,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders(),
        ...options?.headers,
      },
    });

    clearTimeout(timeoutId);

    if (res.status === 401) {
      clearToken();
      window.location.href = '/login';
      throw new Error('Unauthorized');
    }
    if (res.status === 204) return undefined as unknown as T;
    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`API error: ${res.status} ${res.statusText} - ${errorText}`);
    }

    return res.json();
  } catch (error) {
    throw error;
  }
}

// Notebook API
export async function fetchNotebooks(): Promise<Notebook[]> {
  const data = await request<BackendNotebook[]>('/api/notebooks/');
  return data.map(mapBackendNotebook);
}

export async function createNotebook(title: string): Promise<Notebook> {
  const data = await request<BackendNotebook>('/api/notebooks/', {
    method: 'POST',
    body: JSON.stringify({ title }),
  });
  return mapBackendNotebook(data);
}

export async function deleteNotebook(notebookId: string): Promise<void> {
  await request<void>(`/api/notebooks/${notebookId}`, { method: 'DELETE' });
}

export async function updateNotebook(notebookId: string, title: string): Promise<Notebook> {
  const data = await request<BackendNotebook>(`/api/notebooks/${notebookId}`, {
    method: 'PUT',
    body: JSON.stringify({ title }),
  });
  return mapBackendNotebook(data);
}

export async function fetchNotebookDetail(notebookId: string): Promise<BackendNotebook | null> {
  try {
    const data = await request<BackendNotebook>(`/api/notebooks/${notebookId}`);
    return data;
  } catch { return null; }
}

// Session API
export async function fetchSessions(notebookId: string): Promise<Session[]> {
  const data = await request<BackendSession[]>(`/api/sessions?notebook_id=${notebookId}`);
  return data.map(mapBackendSession);
}

export async function fetchSessionDetail(notebookId: string): Promise<BackendSession[]> {
  try {
    const data = await request<BackendSession[]>(`/api/sessions?notebook_id=${notebookId}`);
    return data;
  } catch { return []; }
}

export async function fetchSessionById(sessionId: string): Promise<Session | null> {
  try {
    const data = await request<BackendSession>(`/api/sessions/${sessionId}`);
    return mapBackendSession(data);
  } catch { return null; }
}

export async function createSession(notebookId: string, title: string): Promise<Session> {
  const data = await request<BackendSession>(`/api/sessions?notebook_id=${notebookId}`, {
    method: 'POST',
    body: JSON.stringify({ title }),
  });
  return mapBackendSession(data);
}

export async function deleteSession(sessionId: string): Promise<void> {
  await request<void>(`/api/sessions/${sessionId}`, { method: 'DELETE' });
}

export async function updateSessionDuration(sessionId: string, durationMs: number): Promise<void> {
  const duration = formatDuration(durationMs);
  await request<void>(`/api/sessions/${sessionId}`, {
    method: 'PUT',
    body: JSON.stringify({ duration }),
  });
}

export async function generateSessionSummary(sessionId: string): Promise<{ status: string; summary: string }> {
  const data = await request<{ status: string; summary: string }>(
    `/api/process/generate-summary?session_id=${sessionId}`,
    { method: 'POST' }
  );
  return data;
}

export async function alignPPTWithText(sessionId: string, text: string): Promise<{ matched_page: number | null; similarity: number; slide?: any }> {
  const res = await fetch(`${API_BASE}/api/process/ppt-align?session_id=${sessionId}&text=${encodeURIComponent(text)}`, {
    method: 'POST',
    headers: authHeaders(),
  });
  if (!res.ok) return { matched_page: null, similarity: 0 };
  return res.json();
}

export interface ContentBlock {
  type: 'text' | 'image' | 'marker';
  content?: string;
  src?: string;
  page?: number;
  title?: string;
}

export async function insertPPTIntoTranscript(sessionId: string): Promise<{ blocks: ContentBlock[] }> {
  const res = await fetch(`${API_BASE}/api/process/ppt-insert?session_id=${sessionId}`, {
    method: 'POST',
    headers: authHeaders(),
  });
  if (!res.ok) return { blocks: [] };
  return res.json();
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hh = Math.floor(totalSeconds / 3600);
  const mm = Math.floor((totalSeconds % 3600) / 60);
  const ss = totalSeconds % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

export interface Slide {
  page: number;
  title: string;
  text: string;
  image_path?: string;
  image_base64?: string;
}

// File upload API
export async function uploadPPT(file: File, sessionId: string): Promise<{ status: string; filename: string; total_pages?: number; slides?: Slide[] }> {
  const formData = new FormData();
  formData.append('file', file);
  const res = await fetch(`${API_BASE}/api/process/ppt-upload?session_id=${sessionId}`, {
    method: 'POST',
    headers: authHeaders(),
    body: formData,
  });
  if (!res.ok) throw new Error(`PPT upload failed: ${res.status}`);
  return res.json();
}

export async function streamAudioChunk(
  audioBlob: Blob,
  sessionId: string,
  chunkIndex: number,
  onTranscribed: (text: string, timestamps: any[]) => void,
): Promise<void> {
  const formData = new FormData();
  formData.append('file', audioBlob, `chunk_${chunkIndex}.wav`);

  const url = `${API_BASE}/api/process/audio-stream?session_id=${sessionId}&chunk_index=${chunkIndex}`;

  console.log(`[streamAudioChunk] Sending chunk ${chunkIndex}, blob size: ${audioBlob.size}`);

  const res = await fetch(url, {
    method: 'POST',
    headers: authHeaders(),
    body: formData,
  });

  console.log(`[streamAudioChunk] Response status: ${res.status}`);

  if (!res.ok) {
    const errorText = await res.text();
    console.error(`[streamAudioChunk] Error response: ${res.status} ${errorText}`);
    throw new Error(`Audio stream failed: ${res.status}`);
  }

  const data = await res.json();
  console.log('[streamAudioChunk] Full response data:', JSON.stringify(data));

  if (data.corrected !== undefined && onTranscribed) {
    const text = data.corrected || data.original || '';
    const timestamps = data.timestamps || [];
    console.log('[streamAudioChunk] Calling onTranscribed with text:', text);
    onTranscribed(text, timestamps);
  } else {
    console.warn('[streamAudioChunk] data.corrected is undefined, skipping callback');
  }
}

// Note API
export async function fetchNote(sessionId: string): Promise<BackendNote | null> {
  try {
    const data = await request<BackendNote>(`/api/notes/session/${sessionId}`);
    return data;
  } catch { return null; }
}

export async function updateNote(sessionId: string, content: string, layoutBlocks?: NoteLayoutBlock[]): Promise<BackendNote | null> {
  try {
    const data = await request<BackendNote>(`/api/notes/session/${sessionId}`, {
      method: 'PUT',
      body: JSON.stringify({ content, layout_blocks: layoutBlocks }),
    });
    return data;
  } catch { return null; }
}

export async function finishRecording(sessionId: string): Promise<{ status: string; audio_path: string | null }> {
  try {
    const data = await request<{ status: string; audio_path: string | null }>(
      `/api/process/audio-finish?session_id=${sessionId}`,
      { method: 'POST' }
    );
    return data;
  } catch {
    return { status: 'error', audio_path: null };
  }
}

export function getAudioUrl(sessionId: string): string {
  return getMediaUrl(`/api/media/audio/${sessionId}.wav`);
}

export async function deleteAudio(sessionId: string): Promise<boolean> {
  try {
    await request<void>(`/api/process/audio?session_id=${sessionId}`, { method: 'DELETE' });
    return true;
  } catch {
    return false;
  }
}

export async function updateTranscript(sessionId: string, transcript: any[]): Promise<void> {
  try {
    await request<void>(`/api/process/transcript?session_id=${sessionId}`, {
      method: 'PUT',
      body: JSON.stringify({ content: JSON.stringify(transcript) }),
    });
  } catch {
    // ignore
  }
}

export interface AudioUploadCallbacks {
  onChunk: (text: string, window: number, total: number) => void;
  onDone: (note: BackendNote | null) => void;
  onError: (error: string) => void;
}

export function uploadAudio(
  file: File,
  sessionId: string,
  callbacks: AudioUploadCallbacks,
): { abort: () => void } {
  const formData = new FormData();
  formData.append('file', file);
  const controller = new AbortController();

  fetch(`${API_BASE}/api/process/audio-batch?session_id=${sessionId}`, {
    method: 'POST',
    headers: authHeaders(),
    body: formData,
    signal: controller.signal,
  }).then(async (res) => {
    if (!res.ok) {
      const errorText = await res.text().catch(() => 'Unknown error');
      callbacks.onError(`Audio upload failed: ${res.status} ${errorText}`);
      return;
    }

    const reader = res.body?.getReader();
    if (!reader) { callbacks.onError('No response body'); return; }

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      // Keep the last (potentially incomplete) line in buffer
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const event = JSON.parse(line.slice(6));
            switch (event.type) {
              case 'chunk':
                callbacks.onChunk(event.text, event.window, event.total);
                break;
              case 'done':
                callbacks.onDone(event.note || null);
                break;
              case 'error':
                callbacks.onError(event.detail || 'Unknown error');
                break;
            }
          } catch {}
        }
      }
    }
  }).catch((err) => {
    if (err.name === 'AbortError') return;
    callbacks.onError(err.message || 'Upload failed');
  });

  return { abort: () => controller.abort() };
}

// Import/Export API
export async function importNotebook(pkg: any): Promise<BackendNotebook> {
  const token = getToken();
  const res = await fetch(`${API_BASE}/api/notebooks/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(pkg),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: '导入失败' }));
    throw new Error(err.detail || '导入失败');
  }
  return res.json();
}

export async function exportNotebook(notebookId: string): Promise<any> {
  const token = getToken();
  const res = await fetch(`${API_BASE}/api/notebooks/${notebookId}/export`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: '导出失败' }));
    throw new Error(err.detail || '导出失败');
  }
  return res.json();
}

// Share API
export async function enableShare(sessionId: string): Promise<{ share_enabled: boolean; share_token: string; share_url: string }> {
  const token = getToken();
  const res = await fetch(`${API_BASE}/api/sessions/${sessionId}/share/enable`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: '开启分享失败' }));
    throw new Error(err.detail || '开启分享失败');
  }
  return res.json();
}

export async function disableShare(sessionId: string): Promise<{ share_enabled: boolean }> {
  const token = getToken();
  const res = await fetch(`${API_BASE}/api/sessions/${sessionId}/share/disable`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: '关闭分享失败' }));
    throw new Error(err.detail || '关闭分享失败');
  }
  return res.json();
}

export async function getShareStatus(sessionId: string): Promise<{ share_enabled: boolean; share_token: string | null; share_url: string | null }> {
  const token = getToken();
  const res = await fetch(`${API_BASE}/api/sessions/${sessionId}/share/status`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: '获取分享状态失败' }));
    throw new Error(err.detail || '获取分享状态失败');
  }
  return res.json();
}

export function getShareMediaUrl(pathOrUrl: string, shareToken: string): string {
  if (pathOrUrl.startsWith('data:')) return pathOrUrl;
  const url = pathOrUrl.replace('/api/media/slides/', '/api/public/media/slides/');
  const fullUrl = new URL(url.startsWith('http') ? url : `${API_BASE}${url}`);
  fullUrl.searchParams.set('token', shareToken);
  return fullUrl.toString();
}

// Vector API
export interface VectorIndexStatus {
  session_id: string;
  chunk_count: number;
  has_content: boolean;
  status: 'indexed' | 'not_indexed' | 'empty' | 'stale';
}

export interface VectorSearchResult {
  chunk_id: string;
  notebook_id: string;
  notebook_title: string;
  session_id: string;
  session_title: string;
  source_type: string;
  snippet: string;
  score: number;
  metadata: Record<string, any>;
}

export async function rebuildSessionVectorIndex(sessionId: string): Promise<{ session_id: string; chunk_count: number; status: string }> {
  const res = await request<any>(`/api/vector/session/${sessionId}/rebuild`, { method: 'POST' });
  return res;
}

export async function rebuildNotebookVectorIndex(notebookId: string): Promise<{ notebook_id: string; chunk_count: number; status: string }> {
  const res = await request<any>(`/api/vector/notebook/${notebookId}/rebuild`, { method: 'POST' });
  return res;
}

export async function getSessionVectorStatus(sessionId: string): Promise<VectorIndexStatus> {
  const res = await request<any>(`/api/vector/session/${sessionId}/status`);
  return res;
}

export async function searchVectors(query: string, sessionId?: string, notebookId?: string, limit: number = 20): Promise<{ results: VectorSearchResult[]; total: number }> {
  const res = await request<any>('/api/vector/search', {
    method: 'POST',
    body: JSON.stringify({ query, session_id: sessionId, notebook_id: notebookId, limit }),
  });
  return res;
}
