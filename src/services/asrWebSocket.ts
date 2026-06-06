import { API_BASE } from '@/config';
import { getToken } from '@/services/auth';
import type { BackendNote } from '@/services/api';

export interface ASRWebSocketCallbacks {
  onPartial: (text: string, startMs: number, endMs: number) => void;
  onFinal: (text: string, startMs: number, endMs: number) => void;
  onStatus: (message: string) => void;
  onError: (detail: string) => void;
  onDone: (note: BackendNote | null) => void;
}

/**
 * WebSocket client for real-time streaming ASR.
 *
 * Protocol:
 *   Send: binary PCM int16 frames, or JSON control messages
 *   Receive: partial / final / status / error / done
 */
export class ASRWebSocketClient {
  private ws: WebSocket | null = null;
  private sessionId: string;
  private callbacks: ASRWebSocketCallbacks;
  private _connected = false;
  private _endPromise: Promise<void> | null = null;
  private _endResolve: (() => void) | null = null;

  constructor(sessionId: string, callbacks: ASRWebSocketCallbacks) {
    this.sessionId = sessionId;
    this.callbacks = callbacks;
  }

  get connected() {
    return this._connected;
  }

  connect(): Promise<void> {
    const token = getToken();
    const wsUrl = `${API_BASE.replace(/^http/, 'ws')}/ws/asr/${this.sessionId}?token=${token}`;
    this.ws = new WebSocket(wsUrl);

    return new Promise((resolve, reject) => {
      this.ws!.onopen = () => {
        this._connected = true;
        this.sendJson({ type: 'start' });
        resolve();
      };
      this.ws!.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          this.handleMessage(data);
        } catch {
          // ignore non-JSON
        }
      };
      this.ws!.onerror = () => {
        this._connected = false;
        reject(new Error('WebSocket 连接失败'));
      };
      this.ws!.onclose = () => {
        this._connected = false;
        if (this._endResolve) {
          this._endResolve();
          this._endResolve = null;
        }
      };
    });
  }

  sendAudioFrame(pcmData: Int16Array): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(pcmData.buffer);
    }
  }

  sendJson(data: object): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  pause(): void {
    this.sendJson({ type: 'pause' });
  }

  resume(): void {
    this.sendJson({ type: 'resume' });
  }

  end(): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return Promise.resolve();
    }

    if (this._endPromise) {
      return this._endPromise;
    }

    this._endPromise = new Promise((resolve) => {
      this._endResolve = resolve;
      // Send end message; done handler will resolve
      this.sendJson({ type: 'end' });

      // Safety timeout: if server never replies, resolve anyway after 60s
      setTimeout(() => {
        if (this._endResolve) {
          this._endResolve();
          this._endResolve = null;
        }
      }, 60000);
    });

    return this._endPromise;
  }

  close(): void {
    this._connected = false;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    if (this._endResolve) {
      this._endResolve();
      this._endResolve = null;
    }
  }

  private handleMessage(data: any) {
    switch (data.type) {
      case 'partial':
        this.callbacks.onPartial(data.text, data.start_ms, data.end_ms);
        break;
      case 'final':
        this.callbacks.onFinal(data.text, data.start_ms, data.end_ms);
        break;
      case 'status':
        this.callbacks.onStatus(data.message);
        break;
      case 'error':
        this.callbacks.onError(data.detail);
        break;
      case 'done':
        this.callbacks.onDone(data.note || null);
        if (this._endResolve) {
          this._endResolve();
          this._endResolve = null;
        }
        break;
    }
  }
}
