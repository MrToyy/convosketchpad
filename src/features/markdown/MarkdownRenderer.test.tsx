import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MarkdownRenderer } from './MarkdownRenderer';

describe('MarkdownRenderer', () => {
  it('renders Canvas response markdown and safe external links', () => {
    render(<MarkdownRenderer content={'## Result\n\n[OpenClaw](https://openclaw.ai)'} />);
    expect(screen.getByRole('heading', { name: 'Result' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'OpenClaw' })).toHaveAttribute('target', '_blank');
  });

  it('renders fenced code with copy actions', () => {
    const { container } = render(<MarkdownRenderer content={'```ts\nconst ready = true;\n```'} />);
    expect(screen.getByRole('button', { name: 'Copy code' })).toBeInTheDocument();
    expect(container).toHaveTextContent('const ready = true;');
  });
});
