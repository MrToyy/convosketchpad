import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CanvasSendButton } from './CanvasSendButton';

vi.mock('@/contexts/SettingsContext', () => ({
  useSettings: () => ({ language: 'zh-CN' }),
}));

describe('CanvasSendButton', () => {
  it('isolates the dynamic icon from text replaced by a browser translator', () => {
    const { rerender } = render(<CanvasSendButton sending={false} disabled={false} onSend={vi.fn()} />);
    const button = screen.getByRole('button');
    const label = button.querySelector('[data-canvas-send-label]');
    const translated = document.createElement('font');
    translated.textContent = 'Translated send';
    label?.replaceChildren(translated);

    expect(() => rerender(<CanvasSendButton sending disabled onSend={vi.fn()} />)).not.toThrow();
    expect(button.getAttribute('translate')).toBe('no');
    expect(button.querySelector('.animate-spin')).not.toBeNull();
  });
});
