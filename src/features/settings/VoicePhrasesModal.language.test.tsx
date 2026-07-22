import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsProvider } from '@/contexts/SettingsContext';
import { VoicePhrasesModal } from './VoicePhrasesModal';

vi.mock('@/features/tts/useTTS', () => ({
  migrateTTSProvider: (value: string) => value,
  useTTS: () => ({ speak: vi.fn() }),
}));

describe('VoicePhrasesModal localization', () => {
  beforeEach(() => {
    localStorage.clear();
    globalThis.fetch = vi.fn((input: string | URL) => {
      const url = String(input);
      if (url.startsWith('/api/voice-phrases/')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            source: 'defaults',
            wakePhrases: ['你好 Kim'],
            stopPhrases: ['发送'],
            cancelPhrases: ['取消'],
          }),
        } as Response);
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ provider: 'local', model: 'base' }),
      } as Response);
    }) as typeof fetch;
  });

  it('renders the complete phrase editor in Simplified Chinese', async () => {
    render(
      <SettingsProvider>
        <VoicePhrasesModal
          open
          onClose={vi.fn()}
          languageCode="zh"
          languageName="Chinese"
          languageNativeName="中文"
        />
      </SettingsProvider>,
    );

    expect(await screen.findByText('语音短语 — 中文')).toBeInTheDocument();
    expect(screen.getByText('唤醒短语')).toBeInTheDocument();
    expect(screen.getByText('发送短语')).toBeInTheDocument();
    expect(screen.getByText('取消短语')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '保存短语' })).toBeInTheDocument();
  });
});
