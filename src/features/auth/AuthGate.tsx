/**
 * AuthGate — guards the app behind authentication when enabled.
 *
 * Shows a loading spinner during auth check, the login page when
 * unauthenticated, or renders children (the full app) when authenticated.
 */
import { lazy, Suspense } from 'react';
import { RuntimeProvider } from '@/contexts/RuntimeContext';
import { SettingsProvider, useSettings } from '@/contexts/SettingsContext';
import { getAppCopy } from '@/lib/app-messages';
import { LoginPage } from './LoginPage';
import { useAuth } from './useAuth';

const App = lazy(() => import('@/App'));

function LoadingScreen({ message }: { message: string }) {
  return (
    <div className="flex h-screen w-screen items-center justify-center bg-background">
      <div className="animate-pulse font-mono text-xs text-muted-foreground">{message}</div>
    </div>
  );
}

export function AuthGate() {
  return <SettingsProvider><AuthGateContent /></SettingsProvider>;
}

function AuthGateContent() {
  const { language } = useSettings();
  const copy = getAppCopy(language);
  const { state, error, login, logout } = useAuth(language);

  if (state === 'loading') {
    return <LoadingScreen message={copy.auth.loading} />;
  }

  if (state === 'login') {
    return <LoginPage onLogin={login} error={error} />;
  }

  return (
    <RuntimeProvider>
      <Suspense fallback={<LoadingScreen message={copy.auth.loading} />}>
        <App onLogout={logout} />
      </Suspense>
    </RuntimeProvider>
  );
}
