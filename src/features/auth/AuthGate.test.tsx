import { act, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthGate } from './AuthGate';

const mocks = vi.hoisted(() => ({
  auth: {
    state: 'loading' as 'loading' | 'login' | 'authenticated',
    error: '',
    login: vi.fn(async () => undefined),
    logout: vi.fn(async () => undefined),
  },
  appModuleLoaded: vi.fn(),
}));

vi.mock('./useAuth', () => ({
  useAuth: () => mocks.auth,
}));

vi.mock('@/contexts/RuntimeContext', () => ({
  RuntimeProvider: ({ children }: { children: ReactNode }) => children,
}));

vi.mock('@/App', () => {
  mocks.appModuleLoaded();
  return { default: () => <div>Authenticated application</div> };
});

beforeEach(() => {
  mocks.auth.state = 'loading';
  mocks.auth.error = '';
  mocks.appModuleLoaded.mockClear();
});

describe('AuthGate application loading', () => {
  it('does not load the Canvas application while authentication is pending', async () => {
    render(<AuthGate />);

    expect(screen.getByText('加载中…')).toBeInTheDocument();
    await Promise.resolve();
    expect(mocks.appModuleLoaded).not.toHaveBeenCalled();
  });

  it('does not load the Canvas application for the managed login screen', async () => {
    mocks.auth.state = 'login';
    render(<AuthGate />);

    expect(screen.getByRole('heading', { name: '登录你的 ConvoSketchpad' })).toBeInTheDocument();
    await Promise.resolve();
    expect(mocks.appModuleLoaded).not.toHaveBeenCalled();
  });

  it('loads the Canvas application after authentication succeeds', async () => {
    mocks.auth.state = 'authenticated';
    await act(async () => {
      render(<AuthGate />);
      await vi.dynamicImportSettled();
    });

    expect(screen.getByText('Authenticated application')).toBeInTheDocument();
    expect(mocks.appModuleLoaded).toHaveBeenCalledOnce();
  });
});
