import '@testing-library/jest-dom';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UpdateBadge } from './UpdateBadge';
import { renderWithSettings } from '@/test/render-with-settings';

function createMockResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json',
    },
  });
}

describe('UpdateBadge', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn<typeof fetch>(async () => createMockResponse({
      status: 'update-available',
      current: '1.5.2',
      latest: '1.5.3',
      updateAvailable: true,
      projectDir: '/tmp/convosketchpad repo',
    }));
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('shows a copy-paste update command with the project directory', async () => {
    const user = userEvent.setup();
    renderWithSettings(<UpdateBadge />);

    await user.click(await screen.findByRole('button', { name: /可更新至版本 1.5.3/ }));

    await waitFor(() => {
      expect(screen.getByText('项目目录')).toBeInTheDocument();
    });

    expect(screen.getByText('/tmp/convosketchpad repo')).toBeInTheDocument();
    expect(screen.getByText("cd '/tmp/convosketchpad repo' && npm run update")).toBeInTheDocument();
    expect(screen.queryByText(/npm run update -- --yes/)).not.toBeInTheDocument();
    expect(screen.getByText(/cd '\/tmp\/convosketchpad repo' && npm run update -- --dry-run/i)).toBeInTheDocument();
  });

  it('does not render when the server omits the project directory', async () => {
    global.fetch = vi.fn<typeof fetch>(async () => createMockResponse({
      status: 'update-available',
      current: '1.5.2',
      latest: '1.5.3',
      updateAvailable: true,
      projectDir: '',
    }));

    renderWithSettings(<UpdateBadge />);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    expect(screen.queryByRole('button', { name: /可更新至版本 1.5.3/ })).not.toBeInTheDocument();
  });

  it('does not render when update checks are disabled', async () => {
    global.fetch = vi.fn<typeof fetch>(async () => createMockResponse({
      status: 'disabled',
      current: '0.1.0',
      latest: null,
      updateAvailable: false,
    }));

    renderWithSettings(<UpdateBadge />);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });
    expect(screen.queryByRole('button', { name: /可更新/ })).not.toBeInTheDocument();
  });
});
