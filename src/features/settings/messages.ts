import type { Language } from '@/lib/language';

export interface SettingsCopy {
  drawer: {
    controlRoom: string;
    title: string;
    close: string;
    categoriesAria: string;
    categories: { appearance: string; system: string };
    signOut: string;
  };
  system: {
    applicationHeading: string;
    version: string;
    restart: string;
    restarting: string;
  };
  appearance: {
    heading: string;
    language: string;
    languageHint: string;
    languageAria: string;
    theme: string;
    themeHint: string;
    themeAria: string;
    uiFont: string;
    uiFontHint: string;
    uiFontAria: string;
    fontSize: string;
    fontSizeHint: string;
    fontSizeAria: string;
    defaultSuffix: string;
  };
}

export const settingsCopy = {
  'zh-CN': {
    drawer: {
      controlRoom: '控制中心',
      title: '设置',
      close: '关闭设置',
      categoriesAria: '设置分类',
      categories: { appearance: '外观', system: '系统' },
      signOut: '退出登录',
    },
    system: {
      applicationHeading: 'ConvoSketchpad',
      version: '当前版本',
      restart: '重启',
      restarting: '正在重启…',
    },
    appearance: {
      heading: '外观',
      language: '界面语言',
      languageHint: '控制整个界面的显示语言。',
      languageAria: '选择界面语言',
      theme: '主题',
      themeHint: '切换整套界面配色。',
      themeAria: '选择主题',
      uiFont: '界面字体',
      uiFontHint: '代码块仍使用等宽字体。',
      uiFontAria: '选择字体',
      fontSize: '字体大小',
      fontSizeHint: '所有界面文字的基础字号。',
      fontSizeAria: '选择字体大小',
      defaultSuffix: '默认',
    },
  },
  en: {
    drawer: {
      controlRoom: 'Control center',
      title: 'Settings',
      close: 'Close settings',
      categoriesAria: 'Settings categories',
      categories: { appearance: 'Appearance', system: 'System' },
      signOut: 'Sign out',
    },
    system: {
      applicationHeading: 'ConvoSketchpad',
      version: 'Current version',
      restart: 'Restart',
      restarting: 'Restarting…',
    },
    appearance: {
      heading: 'Appearance',
      language: 'Interface language',
      languageHint: 'Controls the language of the entire interface.',
      languageAria: 'Select interface language',
      theme: 'Theme',
      themeHint: 'Switch the complete interface color scheme.',
      themeAria: 'Select theme',
      uiFont: 'Interface font',
      uiFontHint: 'Code blocks continue to use a monospace font.',
      uiFontAria: 'Select font',
      fontSize: 'Font size',
      fontSizeHint: 'Base size for all interface text.',
      fontSizeAria: 'Select font size',
      defaultSuffix: 'default',
    },
  },
} satisfies Record<Language, SettingsCopy>;

export function getSettingsCopy(language: Language): SettingsCopy {
  return settingsCopy[language];
}
