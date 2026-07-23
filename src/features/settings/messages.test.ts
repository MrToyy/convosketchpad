import { describe, expect, it } from 'vitest';
import { getSettingsCopy, settingsCopy } from './messages';

describe('settings copy', () => {
  it('provides both supported interface languages', () => {
    expect(Object.keys(settingsCopy).sort()).toEqual(['en', 'zh-CN']);
    expect(getSettingsCopy('zh-CN').drawer.title).toBe('设置');
    expect(getSettingsCopy('en').drawer.title).toBe('Settings');
  });

  it('localizes Canvas-only appearance and connection settings', () => {
    expect(getSettingsCopy('zh-CN').appearance.language).toBe('界面语言');
    expect(getSettingsCopy('en').connection.restart).toBe('Restart');
  });
});
