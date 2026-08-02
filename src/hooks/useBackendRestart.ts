import { useState, useCallback, useRef, useEffect } from 'react';
import { getAppCopy } from '@/lib/app-messages';
import { DEFAULT_LANGUAGE, type Language } from '@/lib/language';

interface BackendRestartNotice {
  ok: boolean;
  message: string;
}

/** Manages confirmation, progress, and result state for a selected Backend restart. */
export function useBackendRestart(language: Language = DEFAULT_LANGUAGE) {
  const copy = getAppCopy(language);
  const [showBackendRestartConfirm, setShowBackendRestartConfirm] = useState(false);
  const [backendRestarting, setBackendRestarting] = useState(false);
  const [backendRestartNotice, setBackendRestartNotice] = useState<BackendRestartNotice | null>(null);
  const [restartBackendId, setRestartBackendId] = useState<string | null>(null);
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
  }, []);

  const handleBackendRestart = useCallback((backendId: string) => {
    setRestartBackendId(backendId);
    setShowBackendRestartConfirm(true);
  }, []);
  const cancelBackendRestart = useCallback(() => {
    setShowBackendRestartConfirm(false);
    setRestartBackendId(null);
  }, []);

  const confirmBackendRestart = useCallback(async () => {
    setShowBackendRestartConfirm(false);
    setBackendRestarting(true);
    setBackendRestartNotice(null);
    try {
      if (!restartBackendId) throw new Error('Backend restart target is missing');
      const response = await fetch(
        `/api/runtime/backends/${encodeURIComponent(restartBackendId)}/restart`,
        { method: 'POST', credentials: 'include' },
      );
      const data = await response.json() as { ok: boolean };
      const notice = {
        ok: data.ok,
        message: data.ok ? copy.restart.success : copy.restart.failed,
      };
      setBackendRestartNotice(notice);
      if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
      if (notice.ok) {
        dismissTimerRef.current = setTimeout(() => setBackendRestartNotice(null), 6000);
      }
    } catch (error) {
      console.debug('[BackendRestart] Restart failed:', error);
      setBackendRestartNotice({ ok: false, message: copy.restart.failed });
    } finally {
      setBackendRestarting(false);
      setRestartBackendId(null);
    }
  }, [copy.restart.failed, copy.restart.success, restartBackendId]);

  const dismissNotice = useCallback(() => setBackendRestartNotice(null), []);

  return {
    showBackendRestartConfirm,
    backendRestarting,
    backendRestartNotice,
    handleBackendRestart,
    cancelBackendRestart,
    confirmBackendRestart,
    dismissNotice,
  };
}
