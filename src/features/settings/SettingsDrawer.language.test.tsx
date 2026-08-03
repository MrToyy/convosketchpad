import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsProvider } from '@/contexts/SettingsContext';
import { LANGUAGE_STORAGE_KEY } from '@/lib/language';
import { SettingsDrawer } from './SettingsDrawer';

const drawerProps = {
  open: true,
  onClose: vi.fn(),
  onRefreshStatus: vi.fn(),
  runtimeStatuses: { openclaw: { runtimeId: 'openclaw', state: 'connected' as const } },
  onLogout: vi.fn(),
};

describe('SettingsDrawer interface language', () => {
  beforeEach(() => {
    vi.stubGlobal('__APP_VERSION__', 'test');
    Element.prototype.scrollIntoView = vi.fn();
    localStorage.clear();
    globalThis.fetch = vi.fn(() => new Promise<Response>(() => undefined)) as typeof fetch;
  });

  it('updates the open drawer immediately when the interface language changes', () => {
    render(
      <SettingsProvider>
        <SettingsDrawer {...drawerProps} />
      </SettingsProvider>,
    );

    expect(screen.getByText('设置')).toBeInTheDocument();
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((tab) => tab.textContent)).toEqual(['外观', '系统']);
    expect(screen.getByRole('tab', { name: '外观' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('界面语言')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '退出登录' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '选择界面语言' }));
    fireEvent.pointerDown(screen.getByRole('option', { name: 'English' }));

    expect(screen.getByText('Settings')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'System' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('en');

    fireEvent.click(screen.getByRole('tab', { name: 'System' }));
    expect(screen.getByRole('heading', { name: 'Agent Runtimes' })).toBeInTheDocument();
    expect(screen.getByText('Current version vtest')).toBeInTheDocument();
  });
});
