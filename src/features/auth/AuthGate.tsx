/**
 * AuthGate — guards the app behind authentication when enabled.
 *
 * Shows a loading spinner during auth check, the login page when
 * unauthenticated, or renders children (the full app) when authenticated.
 */
import App from '@/App';
import { RuntimeProvider } from '@/contexts/RuntimeContext';
import { SettingsProvider, useSettings } from '@/contexts/SettingsContext';
import { getAppCopy } from '@/lib/app-messages';
import { LoginPage } from './LoginPage';
import { useAuth } from './useAuth';

export function AuthGate() {
  return <SettingsProvider><AuthGateContent /></SettingsProvider>;
}

function AuthGateContent() {
  const { language } = useSettings();
  const copy = getAppCopy(language);
  const { state, error, login, logout } = useAuth(language);

  if (state === 'loading') {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-background">
        <div className="text-xs text-muted-foreground font-mono animate-pulse">{copy.auth.loading}</div>
      </div>
    );
  }

  if (state === 'login') {
    return <LoginPage onLogin={login} error={error} />;
  }

  return (
    <RuntimeProvider>
      <App onLogout={logout} />
    </RuntimeProvider>
  );
}
