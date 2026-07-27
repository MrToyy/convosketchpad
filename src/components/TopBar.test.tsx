import '@testing-library/jest-dom';
import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TopBar } from './TopBar';
import { renderWithSettings } from '@/test/render-with-settings';

vi.mock('./ConvoSketchpadLogo', () => ({
  default: () => <div data-testid="convosketchpad-logo" />,
}));

function renderTopBar() {
  return renderWithSettings(
    <TopBar
      onSettings={vi.fn()}
      tokenData={null}
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
});
