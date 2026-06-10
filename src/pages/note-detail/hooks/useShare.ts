import { useState } from 'react';
import { toast } from 'sonner';
import { enableShare, disableShare, getShareStatus } from '@/services/api';

export interface ShareState {
  showShareModal: boolean;
  shareLink: string;
  shareToken: string;
  shareEnabled: boolean;
  shareLoading: boolean;
  shareExpiresAt: string | null;
  shareMaxViews: number | null;
  shareViewCount: number;
  shareExpiresIn: number | '';
  shareMaxViewsInput: number | '';
  copySuccess: boolean;
}

export interface ShareActions {
  setShowShareModal: (v: boolean) => void;
  handleShareSession: (sessionId: string, shareExpiresIn: number | '', shareMaxViewsInput: number | '') => Promise<void>;
  handleDisableShare: (sessionId: string) => Promise<void>;
  setShareExpiresIn: (v: number | '') => void;
  setShareMaxViewsInput: (v: number | '') => void;
  setCopySuccess: (v: boolean) => void;
}

export function useShare(): { state: ShareState; actions: ShareActions } {
  const [showShareModal, setShowShareModal] = useState(false);
  const [shareLink, setShareLink] = useState('');
  const [shareToken, setShareToken] = useState('');
  const [shareEnabled, setShareEnabled] = useState(false);
  const [shareLoading, setShareLoading] = useState(false);
  const [shareExpiresAt, setShareExpiresAt] = useState<string | null>(null);
  const [shareMaxViews, setShareMaxViews] = useState<number | null>(null);
  const [shareViewCount, setShareViewCount] = useState(0);
  const [shareExpiresIn, setShareExpiresIn] = useState<number | ''>('');
  const [shareMaxViewsInput, setShareMaxViewsInput] = useState<number | ''>('');
  const [copySuccess, setCopySuccess] = useState(false);

  const handleShareSession = async (sessionId: string, expiresIn: number | '', maxViews: number | '') => {
    if (!sessionId) return;
    setShowShareModal(true);
    setShareLoading(true);
    try {
      const status = await getShareStatus(sessionId);
      if (status.share_enabled && status.share_url) {
        setShareEnabled(true);
        setShareToken(status.share_token || '');
        setShareLink(`${window.location.origin}${status.share_url}`);
        setShareExpiresAt(status.share_expires_at || null);
        setShareMaxViews(status.share_max_views ?? null);
        setShareViewCount(status.share_view_count || 0);
      } else {
        const ei = typeof expiresIn === 'number' && expiresIn > 0 ? expiresIn : undefined;
        const mv = typeof maxViews === 'number' && maxViews > 0 ? maxViews : undefined;
        const result = await enableShare(sessionId, ei, mv);
        setShareEnabled(true);
        setShareToken(result.share_token);
        setShareLink(`${window.location.origin}${result.share_url}`);
        setShareExpiresAt(result.share_expires_at || null);
        setShareMaxViews(result.share_max_views ?? null);
        setShareViewCount(0);
        toast.success('分享已开启');
      }
    } catch (err: unknown) {
      setShareEnabled(false);
      setShareLink('');
      setShareToken('');
      setShareExpiresAt(null);
      setShareMaxViews(null);
      setShareViewCount(0);
      toast.error(err instanceof Error ? err.message : '开启分享失败');
    } finally {
      setShareLoading(false);
    }
  };

  const handleDisableShare = async (sessionId: string) => {
    if (!sessionId) return;
    setShareLoading(true);
    try {
      await disableShare(sessionId);
      setShareEnabled(false);
      setShareLink('');
      setShareToken('');
      setShareExpiresAt(null);
      setShareMaxViews(null);
      setShareViewCount(0);
      setShareExpiresIn('');
      setShareMaxViewsInput('');
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : '关闭分享失败');
    } finally {
      setShareLoading(false);
    }
  };

  return {
    state: { showShareModal, shareLink, shareToken, shareEnabled, shareLoading, shareExpiresAt, shareMaxViews, shareViewCount, shareExpiresIn, shareMaxViewsInput, copySuccess },
    actions: { setShowShareModal, handleShareSession, handleDisableShare, setShareExpiresIn, setShareMaxViewsInput, setCopySuccess },
  };
}
