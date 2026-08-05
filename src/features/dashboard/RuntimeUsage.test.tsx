import '@testing-library/jest-dom';
import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderWithSettings } from '@/test/render-with-settings';
import type { RuntimeUsageData } from '@/types';
import { RuntimeUsage } from './RuntimeUsage';

const usage: RuntimeUsageData = {
  comparableCostTotal: { currency: 'USD', amount: 1.25 },
  updatedAt: 123,
  runtimes: [{
    runtimeId: 'openclaw',
    displayName: 'OpenClaw',
    available: true,
    usage: {
      totalCost: 1.25,
      totalInput: 1_200,
      totalOutput: 340,
      totalCacheRead: 5_600,
      updatedAt: 123,
      source: 'openclaw-gateway',
      currency: 'USD',
      period: 'all-time',
      additive: true,
    },
    quotas: {
      available: true,
      providers: [{
        provider: 'openai',
        displayName: 'OpenAI',
        plan: 'pro',
        windows: [{ label: 'Weekly', usedPercent: 47, resetAt: 1_785_276_017_000 }],
      }],
    },
  }],
};

describe('RuntimeUsage aggregation', () => {
  it('renders comparable totals and keeps Provider quotas grouped by Runtime', () => {
    renderWithSettings(<RuntimeUsage data={usage} loading={false} error={false} onRefresh={vi.fn()} />);
    expect(screen.getAllByText('$1.25')).toHaveLength(2);
    expect(screen.getByText('OpenClaw')).toBeInTheDocument();
    expect(screen.getByText('OpenAI 限额')).toBeInTheDocument();
    expect(screen.getByText('47% 已用')).toBeInTheDocument();
    expect(screen.getByText('1.2K')).toBeInTheDocument();
  });

  it('does not invent a cross-Runtime total when costs are not comparable', () => {
    renderWithSettings(<RuntimeUsage data={{ ...usage, comparableCostTotal: undefined }} loading={false} error={false} onRefresh={vi.fn()} />);
    expect(screen.queryByText('可比较费用合计')).not.toBeInTheDocument();
  });

  it('keeps stale data visible after refresh failure', () => {
    renderWithSettings(<RuntimeUsage data={usage} loading={false} error onRefresh={vi.fn()} />);
    expect(screen.getByText('刷新用量失败，当前显示上次结果。')).toBeInTheDocument();
    expect(screen.getByText('OpenClaw')).toBeInTheDocument();
  });

  it('offers an explicit manual refresh action', () => {
    const onRefresh = vi.fn();
    renderWithSettings(<RuntimeUsage data={usage} loading={false} error={false} onRefresh={onRefresh} />);
    fireEvent.click(screen.getByRole('button', { name: '刷新用量' }));
    expect(onRefresh).toHaveBeenCalledOnce();
  });
});
