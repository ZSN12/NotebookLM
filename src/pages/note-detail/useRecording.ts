import { useState, useRef, useCallback, useEffect } from 'react';
import { streamAudioChunk, finishRecording, getAudioUrl, updateSessionDuration, fetchNote } from '@/services/api';

const REALTIME_INTERVAL_MS = 2500;

export function useRecording(sessionId: string | undefined) {
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const isPausedRef = useRef(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isError, setIsError] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [currentTime, setCurrentTime] = useState('00:00:00');
  const [waveHeights, setWaveHeights] = useState<number[]>(Array(60).fill(4));
  const [audioPlaybackUrl, setAudioPlaybackUrl] = useState<string | null>(null);
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);

  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const startTimeRef = useRef<number>(0);
  const pausedDurationRef = useRef<number>(0);
  const pauseStartTimeRef = useRef<number>(0);
  const chunkIndexRef = useRef(0);
  const chunkIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timerIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pendingChunksRef = useRef<Array<{ blob: Blob; index: number; timestamp: number }>>([]);
  const isSendingRef = useRef(false);
  const rawAudioBufferRef = useRef<Float32Array[]>([]);
  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);

  const formatTime = useCallback((totalMs: number) => {
    const totalSeconds = Math.floor(totalMs / 1000);
    const hh = Math.floor(totalSeconds / 3600);
    const mm = Math.floor((totalSeconds % 3600) / 60);
    const ss = totalSeconds % 60;
    return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
  }, []);

  const encodeWavBlob = useCallback((audioBuffer: Float32Array, sampleRate: number): Blob => {
    const buffer = new ArrayBuffer(44 + audioBuffer.length * 2);
    const view = new DataView(buffer);
    const writeString = (offset: number, str: string) => {
      for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
    };
    writeString(0, 'RIFF');
    view.setUint32(4, 36 + audioBuffer.length * 2, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeString(36, 'data');
    view.setUint32(40, audioBuffer.length * 2, true);
    for (let i = 0; i < audioBuffer.length; i++) {
      const s = Math.max(-1, Math.min(1, audioBuffer[i]));
      view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    }
    return new Blob([buffer], { type: 'audio/wav' });
  }, []);

  const updateWaveform = useCallback(() => {
    if (!analyserRef.current) return;
    const analyser = analyserRef.current;
    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(dataArray);
    const newHeights = Array.from({ length: 60 }, (_, i) => {
      const dataIndex = Math.floor((i / 60) * analyser.frequencyBinCount);
      const value = dataArray[dataIndex] || 0;
      return Math.max(4, (value / 255) * 28);
    });
    setWaveHeights(newHeights);
    animationFrameRef.current = requestAnimationFrame(updateWaveform);
  }, []);

  const sendNextChunk = useCallback(async (onTranscribed: (text: string) => void) => {
    if (pendingChunksRef.current.length === 0 || isSendingRef.current || !sessionId) return;
    isSendingRef.current = true;
    const { blob, index } = pendingChunksRef.current.shift()!;
    try {
      await streamAudioChunk(blob, sessionId, index, async (text) => {
        if (text) onTranscribed(text);
      });
    } catch (error) {
      console.error('Chunk upload failed:', error);
      setIsError(true);
      setErrorMessage('录音上传失败，请检查网络连接后重试');
    } finally {
      isSendingRef.current = false;
      if (pendingChunksRef.current.length > 0) setTimeout(() => sendNextChunk(onTranscribed), 50);
    }
  }, [sessionId]);

  const _startChunkInterval = useCallback((onTranscribed: (text: string) => void) => {
    chunkIntervalRef.current = setInterval(() => {
      if (isPausedRef.current || rawAudioBufferRef.current.length === 0) return;
      const totalLength = rawAudioBufferRef.current.reduce((sum, buf) => sum + buf.length, 0);
      const combined = new Float32Array(totalLength);
      let offset = 0;
      for (const buf of rawAudioBufferRef.current) { combined.set(buf, offset); offset += buf.length; }
      pendingChunksRef.current.push({ blob: encodeWavBlob(combined, 16000), index: chunkIndexRef.current, timestamp: Date.now() - startTimeRef.current - pausedDurationRef.current });
      chunkIndexRef.current++;
      rawAudioBufferRef.current = [];
      if (!isSendingRef.current) sendNextChunk(onTranscribed);
    }, REALTIME_INTERVAL_MS);

    timerIntervalRef.current = setInterval(() => {
      if (!isPausedRef.current)
        setCurrentTime(formatTime(Date.now() - startTimeRef.current - pausedDurationRef.current));
    }, 200);
    animationFrameRef.current = requestAnimationFrame(updateWaveform);
  }, [encodeWavBlob, sendNextChunk, updateWaveform, formatTime]);

  const _cleanupTimers = useCallback(() => {
    if (chunkIntervalRef.current) { clearInterval(chunkIntervalRef.current); chunkIntervalRef.current = null; }
    if (timerIntervalRef.current) { clearInterval(timerIntervalRef.current); timerIntervalRef.current = null; }
    if (animationFrameRef.current) { cancelAnimationFrame(animationFrameRef.current); animationFrameRef.current = null; }
  }, []);

  const startRecording = useCallback(async (onTranscribed: (text: string) => void) => {
    if (!sessionId) return;
    setIsError(false);
    setErrorMessage('');
    setIsProcessing(true);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const audioContext = new AudioContext({ sampleRate: 16000 });
      audioContextRef.current = audioContext;
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyserRef.current = analyser;

      const processor = audioContext.createScriptProcessor(4096, 1, 1);
      rawAudioBufferRef.current = [];
      processor.onaudioprocess = (e) => {
        if (isPausedRef.current) return;
        rawAudioBufferRef.current.push(new Float32Array(e.inputBuffer.getChannelData(0)));
      };
      source.connect(processor);
      processor.connect(audioContext.destination);

      startTimeRef.current = Date.now();
      pausedDurationRef.current = 0;
      pauseStartTimeRef.current = 0;
      chunkIndexRef.current = 0;
      isPausedRef.current = false;

      _startChunkInterval(onTranscribed);

      setIsRecording(true);
      setIsPaused(false);
      setIsProcessing(false);
    } catch (error: any) {
      console.error('Recording failed:', error);
      setIsProcessing(false);
      setIsError(true);
      if (error.name === 'NotAllowedError') {
        setErrorMessage('麦克风权限被拒绝。请在浏览器设置中允许访问麦克风，然后重试。');
      } else if (error.name === 'NotFoundError') {
        setErrorMessage('未检测到麦克风设备。请连接麦克风后重试。');
      } else {
        setErrorMessage('录音启动失败，请检查设备并重试。');
      }
    }
  }, [sessionId, _startChunkInterval]);

  const pauseRecording = useCallback(() => {
    _cleanupTimers();
    rawAudioBufferRef.current = [];
    pauseStartTimeRef.current = Date.now();
    isPausedRef.current = true;
    setIsPaused(true);
    setWaveHeights(Array(60).fill(4));
  }, [_cleanupTimers]);

  const resumeRecording = useCallback((onTranscribed: (text: string) => void) => {
    isPausedRef.current = false;
    if (pauseStartTimeRef.current > 0) {
      pausedDurationRef.current += Date.now() - pauseStartTimeRef.current;
      pauseStartTimeRef.current = 0;
    }
    _startChunkInterval(onTranscribed);
    setIsPaused(false);
  }, [_startChunkInterval]);

  const stopRecording = useCallback((onTranscriptUpdate: (text: string) => void) => {
    if (streamRef.current) { streamRef.current.getTracks().forEach((track) => track.stop()); streamRef.current = null; }
    if (audioContextRef.current) { audioContextRef.current.close(); audioContextRef.current = null; }
    _cleanupTimers();

    if (rawAudioBufferRef.current.length > 0 && sessionId) {
      const totalLength = rawAudioBufferRef.current.reduce((sum, buf) => sum + buf.length, 0);
      const combined = new Float32Array(totalLength);
      let offset = 0;
      for (const buf of rawAudioBufferRef.current) { combined.set(buf, offset); offset += buf.length; }
      pendingChunksRef.current.push({ blob: encodeWavBlob(combined, 16000), index: chunkIndexRef.current, timestamp: Date.now() - startTimeRef.current - pausedDurationRef.current });
      sendNextChunk(() => {});
    }

    if (sessionId && startTimeRef.current) {
      updateSessionDuration(sessionId, Date.now() - startTimeRef.current - pausedDurationRef.current).catch(console.error);
    }

    if (sessionId) {
      finishRecording(sessionId).then(() => setAudioPlaybackUrl(getAudioUrl(sessionId))).catch(console.error);
    }

    setWaveHeights(Array(60).fill(4));
    setIsRecording(false);
    setIsPaused(false);
    setIsProcessing(false);

    if (sessionId) {
      fetchNote(sessionId).then((note: any) => {
        if (note?.transcript && Array.isArray(note.transcript) && note.transcript.length > 0) {
          const corrected = note.transcript
            .sort((a: any, b: any) => (a.chunk_index || 0) - (b.chunk_index || 0))
            .map((chunk: any) => chunk.text || '').join(' ');
          if (corrected.trim()) onTranscriptUpdate(corrected);
        }
      }).catch(console.error);
    }
  }, [sessionId, _cleanupTimers, sendNextChunk, encodeWavBlob]);

  useEffect(() => {
    return () => {
      if (streamRef.current) streamRef.current.getTracks().forEach((track) => track.stop());
      if (audioContextRef.current) audioContextRef.current.close();
      _cleanupTimers();
      rawAudioBufferRef.current = [];
      pendingChunksRef.current = [];
    };
  }, [_cleanupTimers]);

  return {
    state: {
      isRecording,
      isPaused,
      isProcessing,
      isError,
      errorMessage,
      currentTime,
      waveHeights,
      audioPlaybackUrl,
      isPlayingAudio,
    },
    refs: {
      audioPlayerRef,
    },
    actions: {
      startRecording,
      pauseRecording,
      resumeRecording,
      stopRecording,
      setIsError,
      setErrorMessage,
      setIsProcessing,
      setIsPlayingAudio,
      setAudioPlaybackUrl,
    },
  };
}
