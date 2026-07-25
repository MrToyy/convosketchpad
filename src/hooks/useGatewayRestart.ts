import { useState, useCallback, useRef, useEffect } from 'react';
import { getAppCopy } from '@/lib/app-messages';
import { DEFAULT_LANGUAGE, type Language } from '@/lib/language';

interface GatewayRestartNotice {
  ok: boolean;
  message: string;
}

/**
 * Hook that manages gateway restart UI state: confirmation dialog,
 * in-progress indicator, and success/error notice with auto-dismiss.
 */
export function useGatewayRestart(language: Language = DEFAULT_LANGUAGE) {
  const copy = getAppCopy(language);
  const [showGatewayRestartConfirm, setShowGatewayRestartConfirm] = useState(false);
  const [gatewayRestarting, setGatewayRestarting] = useState(false);
  const [gatewayRestartNotice, setGatewayRestartNotice] = useState<GatewayRestartNotice | null>(null);
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clean up any pending dismiss timer on unmount.
  useEffect(() => () => {
    if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
  }, []);

  const handleGatewayRestart = useCallback(() => setShowGatewayRestartConfirm(true), []);
  const cancelGatewayRestart = useCallback(() => setShowGatewayRestartConfirm(false), []);
  
  const confirmGatewayRestart = useCallback(async () => {
    setShowGatewayRestartConfirm(false);
    setGatewayRestarting(true);
    setGatewayRestartNotice(null);
    try {
      const response = await fetch('/api/gateway/restart', { method: 'POST', credentials: 'include' });
      const data = await response.json() as { ok: boolean; output?: string; error?: string };
      const notice = {
        ok: data.ok,
        message: data.ok ? copy.restart.success : copy.restart.failed,
      };
      setGatewayRestartNotice(notice);
      // Auto-dismiss success notices after 6s, keep error notices until user dismisses
      if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
      if (notice.ok) {
        dismissTimerRef.current = setTimeout(() => setGatewayRestartNotice(null), 6000);
      }
    } catch (err) {
      console.debug('[GatewayRestart] Restart failed:', err);
      setGatewayRestartNotice({ ok: false, message: copy.restart.failed });
    } finally {
      setGatewayRestarting(false);
    }
  }, [copy.restart.failed, copy.restart.success]);

  const dismissNotice = useCallback(() => setGatewayRestartNotice(null), []);

  return {
    showGatewayRestartConfirm,
    gatewayRestarting,
    gatewayRestartNotice,
    handleGatewayRestart,
    cancelGatewayRestart,
    confirmGatewayRestart,
    dismissNotice,
  };
}
