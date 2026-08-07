import type { Language } from '@/lib/language';

export interface AppCopy {
  tagline: string;
  common: {
    loading: string;
    confirm: string;
    cancel: string;
    close: string;
    retry: string;
  };
  topBar: {
    usage: string;
    settings: string;
  };
  status: {
    states: Record<'connected' | 'connecting' | 'reconnecting' | 'disconnected', string>;
    branches: string;
    working: string;
    context: string;
    contextTooltip: (used: string, limit: string, percent: string) => string;
    contextCritical: string;
    contextWarning: string;
  };
  auth: {
    loading: string;
    title: string;
    privacy: string;
    branches: string;
    branchesDetail: string;
    artifacts: string;
    artifactsDetail: string;
    telemetry: string;
    telemetryDetail: string;
    required: string;
    unlock: string;
    instructions: string;
    userToken: string;
    tokenPlaceholder: string;
    signingIn: string;
    enter: string;
    tokenHelp: string;
    loginFailed: string;
    serverUnavailable: string;
  };
  restart: {
    title: string;
    message: string;
    confirm: string;
    success: string;
    failed: string;
  };
  usage: {
    heading: string;
    loading: string;
    refresh: string;
    refreshFailed: string;
    gatewayUsage: string;
    providerQuotas: string;
    billableTokensOnly: string;
    allTime: string;
    used: string;
    resets: string;
    weeklyLimit: string;
    limit: (label: string) => string;
    loadingLimits: string;
    limitsUnavailable: string;
    noLimits: string;
    noLimitDetails: string;
    providerLimits: (provider: string) => string;
    input: string;
    output: string;
    cached: string;
  };
  update: {
    badge: string;
    title: string;
    availableTitle: (version: string) => string;
    availableAria: (version: string) => string;
    description: (latest: string, current: string) => string;
    projectDirectory: string;
    commandHint: string;
    confirmHint: string;
    updateHint: string;
    rollbackHint: string;
    otherOptions: string;
    previewFirst: string;
    pinVersion: string;
    fullDocs: string;
  };
  media: {
    image: string;
    expandedView: (alt: string) => string;
    downloadImage: string;
    download: string;
    save: string;
    openOriginal: string;
    openNewTab: string;
    open: string;
  };
  code: {
    copiedAria: string;
    copyAria: string;
    copied: string;
    copy: string;
  };
  errors: {
    title: string;
    reload: string;
    panelCrashed: (name: string) => string;
  };
}

export const appCopy = {
  'zh-CN': {
    tagline: '让想法自由分支',
    common: { loading: '加载中…', confirm: '确认', cancel: '取消', close: '关闭', retry: '重试' },
    topBar: { usage: '用量', settings: '设置' },
    status: {
      states: {
        connected: 'Agent 运行端已连接',
        connecting: 'Agent 运行端连接中',
        reconnecting: '正在刷新 Agent 运行端状态',
        disconnected: 'Agent 运行端未连接',
      },
      branches: '分支',
      working: '工作中',
      context: '上下文',
      contextTooltip: (used, limit, percent) => `上下文：${used} / ${limit} Token（${percent}%）`,
      contextCritical: '严重：建议创建新的根分支',
      contextWarning: '警告：即将达到上下文上限',
    },
    auth: {
      loading: '加载中…',
      title: '登录你的 ConvoSketchpad',
      privacy: '只需认证一次，每个 Canvas 都仅对其所有者可见。',
      branches: '分支',
      branchesDetail: '自由探索和比较',
      artifacts: '产物',
      artifactsDetail: '让创作成果始终带着上下文',
      telemetry: '用量',
      telemetryDetail: '费用与运行状态',
      required: '需要认证',
      unlock: '进入 ConvoSketchpad',
      instructions: '请输入服务端管理员提供的受信用户令牌。',
      userToken: '用户令牌',
      tokenPlaceholder: '例如：example-token',
      signingIn: '正在登录…',
      enter: '进入 ConvoSketchpad',
      tokenHelp: '用户令牌由服务端管理员创建。如未获得令牌，请联系管理员。',
      loginFailed: '登录失败',
      serverUnavailable: '无法连接到服务端',
    },
    restart: {
      title: '重启 Agent 运行端',
      message: '运行端重启期间，正在进行的 Canvas 交互可能会重新连接。',
      confirm: '重启',
      success: '运行端已成功重启',
      failed: '运行端重启失败',
    },
    usage: {
      heading: '用量',
      loading: '加载中…',
      refresh: '刷新用量',
      refreshFailed: '刷新用量失败，当前显示上次结果。',
      gatewayUsage: '运行端用量',
      providerQuotas: 'Provider 配额',
      billableTokensOnly: '仅统计计费 Token',
      allTime: '累计',
      used: '已用',
      resets: '重置于',
      weeklyLimit: '周限额',
      limit: (label) => `${label}限额`,
      loadingLimits: '正在加载 Provider 限额…',
      limitsUnavailable: '无法获取 Provider 限额',
      noLimits: 'Provider 未返回限额',
      noLimitDetails: '暂无可显示的限额明细',
      providerLimits: (provider) => `${provider} 限额`,
      input: '输入',
      output: '输出',
      cached: '缓存',
    },
    update: {
      badge: '更新',
      title: '发现新版本',
      availableTitle: (version) => `可更新至 v${version}`,
      availableAria: (version) => `可更新至版本 ${version}，点击查看说明。`,
      description: (latest, current) => `ConvoSketchpad v${latest} 已发布，当前版本为 v${current}。`,
      projectDirectory: '项目目录',
      commandHint: '复制以下命令并在项目终端中运行：',
      confirmHint: '命令会先展示版本变化，并在更新前请求确认。',
      updateHint: '确认后将拉取版本、重新构建、重启并检查服务状态。',
      rollbackHint: '如有步骤失败，ConvoSketchpad 会自动回滚到当前版本。',
      otherOptions: '其他选项：',
      previewFirst: '先预览',
      pinVersion: '指定版本',
      fullDocs: '查看完整文档',
    },
    media: {
      image: '图片',
      expandedView: (alt) => `${alt}的大图预览`,
      downloadImage: '下载图片',
      download: '下载',
      save: '保存',
      openOriginal: '打开原图',
      openNewTab: '在新标签页打开',
      open: '打开',
    },
    code: {
      copiedAria: '代码已复制',
      copyAria: '复制代码',
      copied: '已复制',
      copy: '复制到剪贴板',
    },
    errors: {
      title: '页面出现了问题',
      reload: '重新加载',
      panelCrashed: (name) => `${name} 面板出现了问题`,
    },
  },
  en: {
    tagline: 'Let ideas fly free',
    common: { loading: 'Loading…', confirm: 'Confirm', cancel: 'Cancel', close: 'Close', retry: 'Retry' },
    topBar: { usage: 'Usage', settings: 'Settings' },
    status: {
      states: {
        connected: 'Agent Runtime connected',
        connecting: 'Connecting to Agent Runtime',
        reconnecting: 'Refreshing Agent Runtime status',
        disconnected: 'Agent Runtime disconnected',
      },
      branches: 'branches',
      working: 'working',
      context: 'Context',
      contextTooltip: (used, limit, percent) => `Context: ${used} / ${limit} tokens (${percent}%)`,
      contextCritical: 'CRITICAL: Consider starting a new root branch',
      contextWarning: 'Warning: Approaching context limit',
    },
    auth: {
      loading: 'Loading…',
      title: 'Sign in to ConvoSketchpad',
      privacy: 'Authenticate once, then keep every Canvas private to its owner.',
      branches: 'Branches',
      branchesDetail: 'Explore and compare',
      artifacts: 'Artifacts',
      artifactsDetail: 'Keep creative outputs in context',
      telemetry: 'Telemetry',
      telemetryDetail: 'Costs and runtime status',
      required: 'Authentication Required',
      unlock: 'Unlock ConvoSketchpad',
      instructions: 'Enter the trusted-user token provided by the server administrator.',
      userToken: 'User Token',
      tokenPlaceholder: 'For example: example-token',
      signingIn: 'Signing In…',
      enter: 'Enter ConvoSketchpad',
      tokenHelp: 'User tokens are created by the server administrator. Contact your administrator if you do not have one.',
      loginFailed: 'Login failed',
      serverUnavailable: 'Unable to connect to server',
    },
    restart: {
      title: 'Restart Agent Runtime',
      message: 'Active Canvas interactions may reconnect while the Runtime restarts.',
      confirm: 'Restart',
      success: 'Runtime restarted successfully',
      failed: 'Runtime restart failed',
    },
    usage: {
      heading: 'Usage',
      loading: 'Loading…',
      refresh: 'Refresh usage',
      refreshFailed: 'Usage refresh failed. Showing the last result.',
      gatewayUsage: 'Runtime usage',
      providerQuotas: 'Provider quotas',
      billableTokensOnly: 'Billable tokens only',
      allTime: 'all-time',
      used: 'used',
      resets: 'resets',
      weeklyLimit: 'Weekly limit',
      limit: (label) => `${label} limit`,
      loadingLimits: 'Loading Provider limits…',
      limitsUnavailable: 'Provider limits unavailable',
      noLimits: 'No provider limits reported',
      noLimitDetails: 'No quota details available',
      providerLimits: (provider) => `${provider} limits`,
      input: 'in',
      output: 'out',
      cached: 'cached',
    },
    update: {
      badge: 'update',
      title: 'Update Available',
      availableTitle: (version) => `Update available: v${version}`,
      availableAria: (version) => `Update available: version ${version}. Click for instructions.`,
      description: (latest, current) => `ConvoSketchpad v${latest} is available. You're running v${current}.`,
      projectDirectory: 'Project directory',
      commandHint: 'Copy and paste this into a terminal in the project directory:',
      confirmHint: 'This will show the version change and ask for confirmation before updating.',
      updateHint: 'After confirmation, it fetches the release, rebuilds, restarts, and verifies health.',
      rollbackHint: 'If anything fails, ConvoSketchpad automatically rolls back to your current version.',
      otherOptions: 'Other options:',
      previewFirst: 'Preview first',
      pinVersion: 'Pin to a specific version',
      fullDocs: 'See full docs',
    },
    media: {
      image: 'Image',
      expandedView: (alt) => `Expanded view of ${alt}`,
      downloadImage: 'Download image',
      download: 'Download',
      save: 'Save',
      openOriginal: 'Open original',
      openNewTab: 'Open in new tab',
      open: 'Open',
    },
    code: {
      copiedAria: 'Code copied',
      copyAria: 'Copy code',
      copied: 'Copied',
      copy: 'Copy to clipboard',
    },
    errors: {
      title: 'Something went wrong',
      reload: 'Reload',
      panelCrashed: (name) => `${name} crashed`,
    },
  },
} satisfies Record<Language, AppCopy>;

export function getAppCopy(language: Language): AppCopy {
  return appCopy[language];
}
