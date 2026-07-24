import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TopBar } from './TopBar';

vi.mock('./ConvoSketchpadLogo', () => ({
  default: () => <div data-testid="convosketchpad-logo" />,
}));

function renderTopBar() {
  return render(
    <TopBar
      onSettings={vi.fn()}
      agentLogEntries={[]}
      eventEntries={[]}
      tokenData={null}
    />,
  );
}

describe('TopBar', () => {
  it('shows the canonical product tagline', () => {
    renderTopBar();

    expect(screen.getByText('ConvoSketchpad')).toBeInTheDocument();
    expect(screen.getByText('A branching AI workspace for visual thinkers')).toBeInTheDocument();
    expect(screen.getByTestId('convosketchpad-logo')).toBeInTheDocument();
  });

  it('only exposes Canvas telemetry and settings actions', () => {
    renderTopBar();

    expect(screen.getByRole('button', { name: 'Log' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Events' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Usage' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Settings' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /chat|tasks|sessions|commands/i })).not.toBeInTheDocument();
  });
});
