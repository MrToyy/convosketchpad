import { describe, expect, it } from 'vitest';
import { getSettingsCopy, settingsCopy } from './messages';

describe('settings copy', () => {
  it('provides both supported interface languages', () => {
    expect(Object.keys(settingsCopy).sort()).toEqual(['en', 'zh-CN']);
    expect(getSettingsCopy('zh-CN').drawer.title).toBe('设置');
    expect(getSettingsCopy('en').drawer.title).toBe('Settings');
  });

  it('localizes dynamic settings messages', () => {
    const zh = getSettingsCopy('zh-CN');
    const en = getSettingsCopy('en');

    expect(zh.audio.voiceLanguageLabel('de', 'German', 'Deutsch')).toBe('德语 — Deutsch');
    expect(zh.audio.downloading('base', 42)).toBe('正在下载 base… 42%');
    expect(en.audio.downloading('base', 42)).toBe('Downloading base… 42%');
    expect(zh.voicePhrases.saveFailedWithStatus(400)).toContain('400');
  });
});
