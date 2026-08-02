import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderWithSettings } from '@/test/render-with-settings';
import { StatusBar } from './StatusBar';

const statuses = {
  openclaw: { backendId: 'openclaw', state: 'connected' as const },
  codex: { backendId: 'codex', state: 'disconnected' as const, error: 'offline' },
};

describe('StatusBar', () => {
  it('shows aggregate Backend health and hides zero working count', () => {
    renderWithSettings(<StatusBar overallState="degraded" backendStatuses={statuses} branchCount={3} workingCount={0} />);
    expect(screen.getByText('1/2 后端可用')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveAttribute('title', expect.stringContaining('codex: disconnected'));
    expect(screen.queryByText('工作中')).not.toBeInTheDocument();
  });

  it('shows selected-Canvas working count and context without aggregating them', () => {
    renderWithSettings(<StatusBar overallState="ready" backendStatuses={{ openclaw: statuses.openclaw }} branchCount={3} workingCount={2} contextTokens={10_000} contextLimit={100_000} />);
    expect(screen.getByText('工作中')).toBeInTheDocument();
    expect(screen.getByText('上下文')).toBeInTheDocument();
  });
});
