import '@testing-library/jest-dom';
import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TokenUsage } from './TokenUsage';
import { renderWithSettings } from '@/test/render-with-settings';

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

    renderWithSettings(<TokenUsage data={{ totalCost: 0, breakdownAvailable: false }} />);

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

    renderWithSettings(<TokenUsage data={{ totalCost: 0, breakdownAvailable: false }} />);

    expect(await screen.findByText('无法获取 Provider 限额')).toBeInTheDocument();
  });

  it('shows when OpenClaw reports no configured Provider limits', async () => {
    global.fetch = vi.fn<typeof fetch>(async () => createMockResponse({
      available: true,
      providers: [],
    }));

    renderWithSettings(<TokenUsage data={{ totalCost: 0, breakdownAvailable: false }} />);

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

    renderWithSettings(<TokenUsage data={{ totalCost: 0, breakdownAvailable: false }} />);

    expect(await screen.findByText('OpenAI 限额')).toBeInTheDocument();
    expect(screen.getByText('暂无可显示的限额明细')).toBeInTheDocument();
  });
});
