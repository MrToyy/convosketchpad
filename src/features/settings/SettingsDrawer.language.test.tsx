import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsProvider } from '@/contexts/SettingsContext';
import { LANGUAGE_STORAGE_KEY } from '@/lib/language';
import { SettingsDrawer } from './SettingsDrawer';

const drawerProps = {
  open: true,
  onClose: vi.fn(),
  gatewayUrl: 'ws://localhost:18789',
  gatewayToken: '',
  onUrlChange: vi.fn(),
  onTokenChange: vi.fn(),
  onReconnect: vi.fn(),
  connectionState: 'connected' as const,
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
    expect(screen.getByText('A branching AI workspace for visual thinkers')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '退出登录' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: '外观' }));
    fireEvent.click(screen.getByRole('button', { name: '选择界面语言' }));
    fireEvent.pointerDown(screen.getByRole('option', { name: 'English' }));

    expect(screen.getByText('Settings')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Connection' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('en');
  });
});
