import '@testing-library/jest-dom';
import { fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TokenUsage } from './TokenUsage';
import { renderWithSettings } from '@/test/render-with-settings';
import type { TokenData } from '@/types';

const tokenData: TokenData = {
  totalCost: 1.25,
  totalInput: 1_200,
  totalOutput: 340,
  totalCacheRead: 5_600,
  updatedAt: 123,
  source: 'openclaw-gateway',
};

function renderTokenUsage(data: TokenData | null = tokenData, opts?: {
  loading?: boolean;
  error?: boolean;
  onRefresh?: () => void;
}) {
  return renderWithSettings(
    <TokenUsage
      data={data}
      loading={opts?.loading ?? false}
      error={opts?.error ?? false}
      onRefresh={opts?.onRefresh ?? vi.fn()}
    />,
  );
}

function createMockResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('TokenUsage OpenClaw Provider limits', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('renders a weekly-only Provider quota from usage.status', async () => {
    global.fetch = vi.fn<typeof fetch>(async () => createMockResponse({
      available: true,
      providers: [{
        provider: 'openai',
        displayName: 'OpenAI',
        plan: 'pro',
        windows: [{
          label: '168h',
          usedPercent: 47,
          resetAt: 1_785_276_017_000,
        }],
      }],
    }));

    renderTokenUsage();

    expect(screen.getByText('正在加载 Provider 限额…')).toBeInTheDocument();
    expect(await screen.findByText('OpenAI 限额')).toBeInTheDocument();
    expect(screen.getByText('周限额')).toBeInTheDocument();
    expect(screen.getByText('47% 已用')).toBeInTheDocument();
    expect(screen.queryByText('5h limit')).not.toBeInTheDocument();
    expect(global.fetch).toHaveBeenCalledWith('/api/provider-limits', { cache: 'no-store' });
  });

  it('shows when the Gateway does not expose Provider quotas', async () => {
    global.fetch = vi.fn<typeof fetch>(async () => createMockResponse({
      available: false,
      providers: [],
    }));

    renderTokenUsage();

    expect(await screen.findByText('无法获取 Provider 限额')).toBeInTheDocument();
  });

  it('shows when OpenClaw reports no configured Provider limits', async () => {
    global.fetch = vi.fn<typeof fetch>(async () => createMockResponse({
      available: true,
      providers: [],
    }));

    renderTokenUsage();

    expect(await screen.findByText('Provider 未返回限额')).toBeInTheDocument();
  });

  it('does not render a blank Provider card when a Provider has no windows', async () => {
    global.fetch = vi.fn<typeof fetch>(async () => createMockResponse({
      available: true,
      providers: [{
        provider: 'openai',
        displayName: 'OpenAI',
        plan: 'pro',
        windows: [],
      }],
    }));

    renderTokenUsage();

    expect(await screen.findByText('OpenAI 限额')).toBeInTheDocument();
    expect(screen.getByText('暂无可显示的限额明细')).toBeInTheDocument();
  });

  it('separates Gateway totals from Provider quotas without historical Provider rows', async () => {
    global.fetch = vi.fn<typeof fetch>(async () => createMockResponse({
      available: true,
      providers: [],
    }));

    renderTokenUsage();

    expect(screen.getByText('Gateway 全局用量')).toBeInTheDocument();
    expect(screen.getByText('$1.25')).toBeInTheDocument();
    expect(screen.getByText('仅统计计费 Token')).toBeInTheDocument();
    expect(screen.getByText('1.2K')).toBeInTheDocument();
    expect(screen.getByText('340')).toBeInTheDocument();
    expect(screen.getByText('5.6K')).toBeInTheDocument();
    expect(screen.getByText('Provider 配额')).toBeInTheDocument();
    expect(screen.queryByText(/Provider 明细/)).not.toBeInTheDocument();
    expect(screen.queryByText('条消息')).not.toBeInTheDocument();
    expect(await screen.findByText('Provider 未返回限额')).toBeInTheDocument();
  });

  it('keeps the last result visible when a refresh fails', () => {
    global.fetch = vi.fn<typeof fetch>(() => new Promise(() => {}));

    renderTokenUsage(tokenData, { error: true });

    expect(screen.getByText('$1.25')).toBeInTheDocument();
    expect(screen.getByText('刷新用量失败，当前显示上次结果。')).toBeInTheDocument();
  });

  it('offers an explicit manual refresh action', () => {
    global.fetch = vi.fn<typeof fetch>(() => new Promise(() => {}));
    const onRefresh = vi.fn();

    renderTokenUsage(tokenData, { onRefresh });
    fireEvent.click(screen.getByRole('button', { name: '刷新用量' }));

    expect(onRefresh).toHaveBeenCalledOnce();
  });
});
