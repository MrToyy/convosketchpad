import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderWithSettings } from '@/test/render-with-settings';
import { SystemSettings } from './SystemSettings';

describe('SystemSettings', () => {
  it('groups OpenClaw Gateway controls separately from ConvoSketchpad updates', () => {
    const onReconnect = vi.fn();
    const onGatewayRestart = vi.fn();
    renderWithSettings(
      <SystemSettings
        connectionState="connected"
        gatewayRestartSupported
        onReconnect={onReconnect}
        onGatewayRestart={onGatewayRestart}
      />,
    );

    expect(screen.getByRole('heading', { name: 'OpenClaw 网关' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'ConvoSketchpad' })).toBeInTheDocument();
    expect(screen.getByText('连接状态')).toBeInTheDocument();
    expect(screen.getByText('重启 OpenClaw 网关')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重启' }));
    expect(onGatewayRestart).toHaveBeenCalledOnce();
  });

  it('replaces the restart action with host-management guidance for a remote Gateway', () => {
    renderWithSettings(
      <SystemSettings
        connectionState="connected"
        gatewayRestartSupported={false}
        onReconnect={vi.fn()}
        onGatewayRestart={vi.fn()}
      />,
    );

    expect(screen.queryByRole('button', { name: '重启' })).not.toBeInTheDocument();
    expect(screen.getByText('在网关主机上管理')).toBeInTheDocument();
    expect(screen.getByText(/远程 OpenClaw 网关/)).toBeInTheDocument();
  });
});
