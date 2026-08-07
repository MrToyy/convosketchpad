import { useState, useCallback, useRef, useEffect } from 'react';
import { getAppCopy } from '@/lib/app-messages';
import { DEFAULT_LANGUAGE, type Language } from '@/lib/language';

interface RuntimeRestartNotice {
  ok: boolean;
  message: string;
}

/** Manages confirmation, progress, and result state for a selected Runtime restart. */
export function useRuntimeRestart(language: Language = DEFAULT_LANGUAGE) {
  const copy = getAppCopy(language);
  const [showRuntimeRestartConfirm, setShowRuntimeRestartConfirm] = useState(false);
  const [runtimeRestarting, setRuntimeRestarting] = useState(false);
  const [runtimeRestartNotice, setRuntimeRestartNotice] = useState<RuntimeRestartNotice | null>(null);
  const [restartRuntimeId, setRestartRuntimeId] = useState<string | null>(null);
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
  }, []);

  const handleRuntimeRestart = useCallback((runtimeId: string) => {
    setRestartRuntimeId(runtimeId);
    setShowRuntimeRestartConfirm(true);
  }, []);
  const cancelRuntimeRestart = useCallback(() => {
    setShowRuntimeRestartConfirm(false);
    setRestartRuntimeId(null);
  }, []);

  const confirmRuntimeRestart = useCallback(async () => {
    setShowRuntimeRestartConfirm(false);
    setRuntimeRestarting(true);
    setRuntimeRestartNotice(null);
    try {
      if (!restartRuntimeId) throw new Error('Runtime restart target is missing');
      const response = await fetch(
        `/api/runtime/${encodeURIComponent(restartRuntimeId)}/restart`,
        { method: 'POST', credentials: 'include' },
      );
      const data = await response.json() as { ok: boolean };
      const notice = {
        ok: data.ok,
        message: data.ok ? copy.restart.success : copy.restart.failed,
      };
      setRuntimeRestartNotice(notice);
      if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
      if (notice.ok) {
        dismissTimerRef.current = setTimeout(() => setRuntimeRestartNotice(null), 6000);
      }
    } catch (error) {
      console.debug('[RuntimeRestart] Restart failed:', error);
      setRuntimeRestartNotice({ ok: false, message: copy.restart.failed });
    } finally {
      setRuntimeRestarting(false);
      setRestartRuntimeId(null);
    }
  }, [copy.restart.failed, copy.restart.success, restartRuntimeId]);

  const dismissNotice = useCallback(() => setRuntimeRestartNotice(null), []);

  return {
    showRuntimeRestartConfirm,
    runtimeRestarting,
    runtimeRestartNotice,
    handleRuntimeRestart,
    cancelRuntimeRestart,
    confirmRuntimeRestart,
    dismissNotice,
  };
}
