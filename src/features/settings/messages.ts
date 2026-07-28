import type { Language } from '@/lib/language';

export interface SettingsCopy {
  drawer: {
    controlRoom: string;
    title: string;
    close: string;
    categoriesAria: string;
    categories: { advanced: string; appearance: string };
    signOut: string;
  };
  connection: {
    heading: string;
    status: string;
    statuses: Record<'connected' | 'connecting' | 'reconnecting' | 'disconnected', string>;
    reconnect: string;
    reconnectTitle: string;
    application: string;
    version: string;
    service: string;
    restartTitle: string;
    restartHint: string;
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
      categories: { advanced: '连接', appearance: '外观' },
      signOut: '退出登录',
    },
    connection: {
      heading: '网关',
      status: '网关状态',
      statuses: { connected: '已连接', connecting: '正在连接…', reconnecting: '正在刷新状态…', disconnected: '未连接' },
      reconnect: '刷新状态',
      reconnectTitle: '刷新 OpenClaw 连接状态',
      application: '应用',
      version: '当前版本',
      service: '网关服务',
      restartTitle: '重启本地网关',
      restartHint: '配对、智能体或后台进程需要完全重新加载时使用。',
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
      categories: { advanced: 'Connection', appearance: 'Appearance' },
      signOut: 'Sign out',
    },
    connection: {
      heading: 'Gateway',
      status: 'Gateway status',
      statuses: { connected: 'Connected', connecting: 'Connecting…', reconnecting: 'Refreshing status…', disconnected: 'Disconnected' },
      reconnect: 'Refresh status',
      reconnectTitle: 'Refresh OpenClaw connection status',
      application: 'Application',
      version: 'Current version',
      service: 'Gateway service',
      restartTitle: 'Restart local gateway',
      restartHint: 'Use when pairing, agents, or background processes need a full reload.',
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
