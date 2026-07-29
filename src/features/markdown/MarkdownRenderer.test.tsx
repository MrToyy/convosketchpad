import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MarkdownRenderer } from './MarkdownRenderer';
import { renderWithSettings } from '@/test/render-with-settings';

describe('MarkdownRenderer', () => {
  it('renders Canvas response markdown and safe external links', () => {
    render(<MarkdownRenderer content={'## Result\n\n[OpenClaw](https://openclaw.ai)'} />);
    expect(screen.getByRole('heading', { name: 'Result' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'OpenClaw' })).toHaveAttribute('target', '_blank');
  });

  it('renders fenced code as escaped plain text with one copy action', () => {
    const { container } = renderWithSettings(
      <MarkdownRenderer content={'```html\n</code><script>alert("x")</script>\n```'} />,
    );

    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(screen.getByRole('button', { name: '复制代码' })).toBeInTheDocument();
    expect(container.querySelector('pre.plain-code-block')).toHaveTextContent(
      '</code><script>alert("x")</script>',
    );
    expect(container.querySelector('script')).not.toBeInTheDocument();
    expect(container.querySelector('.hljs')).not.toBeInTheDocument();
    expect(container.querySelector('.code-lang')).not.toBeInTheDocument();
  });

  it('copies the original fenced code and reports success', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    try {
      const { unmount } = renderWithSettings(
        <MarkdownRenderer content={'```ts\nconst ready = true;\n```'} />,
      );
      fireEvent.click(screen.getByRole('button', { name: '复制代码' }));

      await waitFor(() => {
        expect(writeText).toHaveBeenCalledWith('const ready = true;');
        expect(screen.getByRole('button', { name: '代码已复制' })).toBeInTheDocument();
      });
      unmount();
    } finally {
      if (originalClipboard) {
        Object.defineProperty(navigator, 'clipboard', originalClipboard);
      } else {
        Reflect.deleteProperty(navigator, 'clipboard');
      }
    }
  });
});
