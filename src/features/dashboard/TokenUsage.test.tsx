import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TokenUsage } from './TokenUsage';

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

    render(<TokenUsage data={{ totalCost: 0, breakdownAvailable: false }} />);

    expect(screen.getByText('Loading Provider limits…')).toBeInTheDocument();
    expect(await screen.findByText('OpenAI limits')).toBeInTheDocument();
    expect(screen.getByText('Weekly limit')).toBeInTheDocument();
    expect(screen.getByText('47% used')).toBeInTheDocument();
    expect(screen.queryByText('5h limit')).not.toBeInTheDocument();
    expect(global.fetch).toHaveBeenCalledWith('/api/provider-limits');
  });

  it('shows when the Gateway does not expose Provider quotas', async () => {
    global.fetch = vi.fn<typeof fetch>(async () => createMockResponse({
      available: false,
      providers: [],
    }));

    render(<TokenUsage data={{ totalCost: 0, breakdownAvailable: false }} />);

    expect(await screen.findByText('Provider limits unavailable')).toBeInTheDocument();
  });

  it('shows when OpenClaw reports no configured Provider limits', async () => {
    global.fetch = vi.fn<typeof fetch>(async () => createMockResponse({
      available: true,
      providers: [],
    }));

    render(<TokenUsage data={{ totalCost: 0, breakdownAvailable: false }} />);

    expect(await screen.findByText('No provider limits reported')).toBeInTheDocument();
  });
});
