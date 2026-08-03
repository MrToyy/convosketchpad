import '@testing-library/jest-dom';
import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TopBar } from './TopBar';
import { renderWithSettings } from '@/test/render-with-settings';
import type { RuntimeUsageData } from '@/types';

vi.mock('./ConvoSketchpadLogo', () => ({
  default: () => <div data-testid="convosketchpad-logo" />,
}));
vi.mock('@/features/dashboard/TokenUsage', () => ({
  TokenUsage: () => <div data-testid="token-usage-panel" />,
}));

function renderTopBar(opts?: {
  tokenData?: RuntimeUsageData | null;
  onUsageOpen?: () => void;
}) {
  return renderWithSettings(
    <TopBar
      onSettings={vi.fn()}
      tokenData={opts?.tokenData ?? null}
      usageLoading={false}
      usageError={false}
      onUsageOpen={opts?.onUsageOpen ?? vi.fn()}
      onUsageRefresh={vi.fn()}
    />,
  );
}

describe('TopBar', () => {
  it('shows the canonical product tagline', () => {
    renderTopBar();

    expect(screen.getByText('ConvoSketchpad')).toBeInTheDocument();
    expect(screen.getByText('让想法自由分支')).toBeInTheDocument();
    expect(screen.getByTestId('convosketchpad-logo')).toBeInTheDocument();
  });

  it('only exposes Canvas telemetry and settings actions', () => {
    renderTopBar();

    expect(screen.queryByRole('button', { name: '日志' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '事件' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '用量' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '设置' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /chat|tasks|sessions|commands/i })).not.toBeInTheDocument();
  });

  it('loads usage on first open and keeps the latest totalCost in the title bar', () => {
    const onUsageOpen = vi.fn();
    renderTopBar({
      onUsageOpen,
      tokenData: {
        runtimes: [],
        comparableCostTotal: { currency: 'USD', amount: 1.25 },
        updatedAt: 123,
      },
    });

    const usageButton = screen.getByRole('button', { name: /用量/ });
    expect(usageButton).toHaveTextContent('$1.25');

    fireEvent.click(usageButton);
    expect(onUsageOpen).toHaveBeenCalledOnce();
    expect(screen.getByTestId('token-usage-panel')).toBeInTheDocument();

    fireEvent.click(usageButton);
    expect(onUsageOpen).toHaveBeenCalledOnce();
    expect(screen.queryByTestId('token-usage-panel')).not.toBeInTheDocument();
  });
});
