import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderWithSettings } from '@/test/render-with-settings';
import { StatusBar } from './StatusBar';

describe('StatusBar', () => {
  it('shows explicit OpenClaw state and hides zero working count', () => {
    renderWithSettings(<StatusBar connectionState="connected" branchCount={3} workingCount={0} />);

    expect(screen.getByText('OpenClaw 已连接')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.queryByText('工作中')).not.toBeInTheDocument();
  });

  it('shows working count and active context when supplied', () => {
    renderWithSettings(
      <StatusBar
        connectionState="connected"
        branchCount={3}
        workingCount={2}
        contextTokens={10_000}
        contextLimit={100_000}
      />,
    );

    expect(screen.getByText('工作中')).toBeInTheDocument();
    expect(screen.getByText('上下文')).toBeInTheDocument();
  });
});
