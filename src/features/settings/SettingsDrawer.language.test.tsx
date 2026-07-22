import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsProvider } from '@/contexts/SettingsContext';
import { LANGUAGE_STORAGE_KEY } from '@/lib/language';
import { SettingsDrawer } from './SettingsDrawer';

vi.mock('@/features/tts/useTTS', () => ({
  migrateTTSProvider: (value: string) => value,
  useTTS: () => ({ speak: vi.fn() }),
}));

const drawerProps = {
  open: true,
  onClose: vi.fn(),
  gatewayUrl: 'ws://localhost:18789',
  gatewayToken: '',
  onUrlChange: vi.fn(),
  onTokenChange: vi.fn(),
  onReconnect: vi.fn(),
  connectionState: 'connected' as const,
  soundEnabled: false,
  onToggleSound: vi.fn(),
  ttsProvider: 'edge' as const,
  ttsModel: '',
  onTtsProviderChange: vi.fn(),
  onTtsModelChange: vi.fn(),
  sttProvider: 'local' as const,
  sttInputMode: 'hybrid' as const,
  sttModel: 'base',
  onSttProviderChange: vi.fn(),
  onSttInputModeChange: vi.fn(),
  onSttModelChange: vi.fn(),
  wakeWordEnabled: false,
  onToggleWakeWord: vi.fn(),
  liveTranscriptionPreview: false,
  onToggleLiveTranscriptionPreview: vi.fn(),
  onLogout: vi.fn(),
};

describe('SettingsDrawer interface language', () => {
  beforeEach(() => {
    vi.stubGlobal('__APP_VERSION__', 'test');
    Element.prototype.scrollIntoView = vi.fn();
    localStorage.clear();
    globalThis.fetch = vi.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ provider: 'local', model: 'base' }),
    } as Response)) as typeof fetch;
  });

  it('updates the open drawer immediately when the interface language changes', () => {
    render(
      <SettingsProvider>
        <SettingsDrawer {...drawerProps} />
      </SettingsProvider>,
    );

    expect(screen.getByText('设置')).toBeInTheDocument();
    expect(screen.getByText('网关状态')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '退出登录' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: '外观' }));
    fireEvent.click(screen.getByRole('button', { name: '选择界面语言' }));
    fireEvent.pointerDown(screen.getByRole('option', { name: 'English' }));

    expect(screen.getByText('Settings')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Connection' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign Out' })).toBeInTheDocument();
    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('en');
  });
});
