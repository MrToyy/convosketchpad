import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type React from 'react';
import { screen, fireEvent } from '@testing-library/react';
import { ConnectDialog } from './ConnectDialog';
import { renderWithSettings } from '@/test/render-with-settings';

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/components/ui/input', () => ({
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}));

vi.mock('@/components/ui/button', () => ({
  Button: (props: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props} />,
}));

vi.mock('@/components/ConvoSketchpadLogo', () => ({
  default: () => <div>ConvoSketchpadLogo</div>,
}));

describe('ConnectDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows token field when serverSideAuth is disabled', () => {
    renderWithSettings(
      <ConnectDialog
        open
        onConnect={vi.fn(async () => {})}
        error=""
        defaultUrl="ws://localhost:1234/ws"
        defaultToken=""
        officialUrl="ws://localhost:1234/ws"
        serverSideAuth={false}
      />,
    );

    expect(screen.getByLabelText('网关令牌')).toBeTruthy();
  });

  it('hides token field when serverSideAuth is active and url is the default', () => {
    renderWithSettings(
      <ConnectDialog
        open
        onConnect={vi.fn(async () => {})}
        error=""
        defaultUrl="ws://localhost:1234/ws"
        defaultToken=""
        officialUrl="ws://localhost:1234/ws"
        serverSideAuth
      />,
    );

    expect(screen.queryByLabelText('网关令牌')).toBeFalsy();
  });

  it('hides token field when url is a loopback alias of the official gateway', () => {
    renderWithSettings(
      <ConnectDialog
        open
        onConnect={vi.fn(async () => {})}
        error=""
        defaultUrl="ws://localhost:1234/ws"
        defaultToken="stale-token"
        officialUrl="ws://127.0.0.1:1234/ws"
        serverSideAuth
      />,
    );

    expect(screen.queryByLabelText('网关令牌')).toBeFalsy();
  });

  it('shows token field when serverSideAuth is active but user changes url away from default', () => {
    renderWithSettings(
      <ConnectDialog
        open
        onConnect={vi.fn(async () => {})}
        error=""
        defaultUrl="ws://localhost:1234/ws"
        defaultToken=""
        officialUrl="ws://localhost:1234/ws"
        serverSideAuth
      />,
    );

    const urlInput = screen.getByLabelText('WebSocket 地址');
    fireEvent.change(urlInput, { target: { value: 'ws://example.com:1234/ws' } });

    expect(screen.getByLabelText('网关令牌')).toBeTruthy();
  });

  it('forces empty token when serverSideAuth is active for default host', async () => {
    const onConnect = vi.fn();
    renderWithSettings(
      <ConnectDialog
        open
        onConnect={onConnect}
        error=""
        defaultUrl="ws://localhost:1234/ws"
        defaultToken="stale-token"
        officialUrl="ws://localhost:1234/ws"
        serverSideAuth
      />,
    );

    const connectButton = screen.getByText('连接网关');
    fireEvent.click(connectButton);

    expect(onConnect).toHaveBeenCalledWith('ws://localhost:1234/ws', '');
  });

  it('canonicalizes loopback aliases to the official gateway url on connect', async () => {
    const onConnect = vi.fn();
    renderWithSettings(
      <ConnectDialog
        open
        onConnect={onConnect}
        error=""
        defaultUrl="ws://localhost:1234/ws"
        defaultToken="stale-token"
        officialUrl="ws://127.0.0.1:1234/ws"
        serverSideAuth
      />,
    );

    fireEvent.click(screen.getByText('连接网关'));

    expect(onConnect).toHaveBeenCalledWith('ws://127.0.0.1:1234/ws', '');
  });

  it('keeps token entry visible for saved custom urls when official url differs', async () => {
    const onConnect = vi.fn();
    renderWithSettings(
      <ConnectDialog
        open
        onConnect={onConnect}
        error=""
        defaultUrl="ws://custom.example/ws"
        defaultToken="custom-token"
        officialUrl="ws://official.example/ws"
        serverSideAuth
      />,
    );

    expect(screen.getByLabelText('网关令牌')).toBeTruthy();

    fireEvent.click(screen.getByText('连接网关'));

    expect(onConnect).toHaveBeenCalledWith('ws://custom.example/ws', 'custom-token');
  });
});
