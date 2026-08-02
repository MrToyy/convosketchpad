import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderWithSettings } from '@/test/render-with-settings';
import { SystemSettings } from './SystemSettings';

describe('SystemSettings', () => {
  it('lists every configured Backend separately from application updates', () => {
    const onRestart = vi.fn();
    renderWithSettings(<SystemSettings
      backendStatuses={{
        openclaw: { backendId: 'openclaw', state: 'connected', restartSupported: true },
        codex: { backendId: 'codex', state: 'disconnected', error: 'offline' },
      }}
      onRefreshStatus={vi.fn()}
      onBackendRestart={onRestart}
    />);
    expect(screen.getByRole('heading', { name: 'Agent Backends' })).toBeInTheDocument();
    expect(screen.getByText('openclaw')).toBeInTheDocument();
    expect(screen.getByText('codex')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'ConvoSketchpad' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重启' }));
    expect(onRestart).toHaveBeenCalledWith('openclaw');
  });

  it('does not offer restart when an Adapter reports it unsupported', () => {
    renderWithSettings(<SystemSettings
      backendStatuses={{ openclaw: { backendId: 'openclaw', state: 'connected', restartSupported: false } }}
      onRefreshStatus={vi.fn()}
      onBackendRestart={vi.fn()}
    />);
    expect(screen.queryByRole('button', { name: '重启' })).not.toBeInTheDocument();
  });
});
