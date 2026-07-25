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
    log: string;
    events: string;
    usage: string;
    settings: string;
  };
  status: {
    states: Record<'connected' | 'connecting' | 'reconnecting' | 'disconnected', string>;
    branches: string;
    sessions: string;
    uptime: string;
    context: string;
    contextTooltip: (used: string, limit: string, percent: string) => string;
    contextCritical: string;
    contextWarning: string;
  };
  activity: {
    agentLog: string;
    agentLogAria: string;
    events: string;
    eventLogAria: string;
    badges: Record<'system' | 'chat' | 'agent' | 'error', string>;
    canvasResponse: (state: string) => string;
    agentEvent: (state: string) => string;
    eventError: string;
    interactionCompleted: string;
    interactionFailed: string;
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
  connect: {
    eyebrow: string;
    title: string;
    description: string;
    connection: string;
    connectionTitle: string;
    connectionDetail: string;
    credentials: string;
    credentialsTitle: string;
    credentialsDetail: string;
    endpoint: string;
    token: string;
    tokenPlaceholder: string;
    localOnly: string;
    connecting: string;
    connect: string;
  };
  restart: {
    title: string;
    message: string;
    confirm: string;
    success: string;
    failed: string;
  };
  gateway: {
    invalidUrl: (detail: string) => string;
    timeout: string;
    authFailed: (detail: string) => string;
    unknown: string;
    pairingHint: (requestId: string) => string;
    websocketError: string;
  };
  usage: {
    heading: string;
    loading: string;
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
    providerDetails: (provider: string) => string;
    input: string;
    output: string;
    cached: string;
    messages: string;
    average: string;
    perMessage: string;
    breakdownUnavailable: string;
    noData: string;
    errors: string;
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
    saveAria: string;
    saveAs: (filename: string) => string;
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
    topBar: { log: '日志', events: '事件', usage: '用量', settings: '设置' },
    status: {
      states: { connected: '已连接', connecting: '连接中', reconnecting: '重连中', disconnected: '离线' },
      branches: '分支',
      sessions: '会话',
      uptime: '运行时间',
      context: '上下文',
      contextTooltip: (used, limit, percent) => `上下文：${used} / ${limit} Token（${percent}%）`,
      contextCritical: '严重：建议创建新的根分支',
      contextWarning: '警告：即将达到上下文上限',
    },
    activity: {
      agentLog: '智能体日志',
      agentLogAria: '智能体活动日志',
      events: '事件',
      eventLogAria: '事件日志',
      badges: { system: '系统', chat: '对话', agent: '智能体', error: '错误' },
      canvasResponse: (state) => `Canvas 响应：${translateActivityState(state)}`,
      agentEvent: (state) => `智能体：${translateActivityState(state)}`,
      eventError: '网关事件出错',
      interactionCompleted: 'Canvas 交互已完成',
      interactionFailed: 'Canvas 交互失败',
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
      telemetryDetail: '费用、事件与运行时间',
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
    connect: {
      eyebrow: '网关连接',
      title: '将 ConvoSketchpad 连接到 OpenClaw 网关',
      description: '填写网关地址，并在需要时提供令牌，即可让 Canvas 上线。',
      connection: '连接',
      connectionTitle: '安全的本地桥接',
      connectionDetail: 'ConvoSketchpad 通过 WebSocket 事件实时同步 Canvas 分支。',
      credentials: '凭据',
      credentialsTitle: '优先使用服务端认证',
      credentialsDetail: '服务端能安全注入凭据时，官方网关地址不会显示令牌输入框。',
      endpoint: 'WebSocket 地址',
      token: '网关令牌',
      tokenPlaceholder: '粘贴网关配置中的令牌',
      localOnly: '除非明确需要远程访问，否则请只在本机开放 ConvoSketchpad。',
      connecting: '正在连接…',
      connect: '连接网关',
    },
    restart: {
      title: '重启 OpenClaw 网关',
      message: '网关重启期间，正在进行的 Canvas 交互可能会重新连接。',
      confirm: '重启',
      success: '网关已成功重启',
      failed: '网关重启失败',
    },
    gateway: {
      invalidUrl: () => '地址无效，请检查后重试',
      timeout: '连接超时，请重试',
      authFailed: (detail) => `认证失败：${detail}`,
      unknown: '未知错误',
      pairingHint: (requestId) => ` 请运行：openclaw devices approve ${requestId}`,
      websocketError: 'WebSocket 出错，请检查地址',
    },
    usage: {
      heading: '用量',
      loading: '加载中…',
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
      providerDetails: (provider) => `${provider} Provider 明细`,
      input: '输入',
      output: '输出',
      cached: '缓存',
      messages: '条消息',
      average: '平均',
      perMessage: '/条',
      breakdownUnavailable: '无法获取 Provider 明细',
      noData: '暂无用量数据',
      errors: '个错误',
    },
    update: {
      badge: '更新',
      title: '发现新版本',
      availableTitle: (version) => `可更新至 v${version}`,
      availableAria: (version) => `可更新至版本 ${version}，点击查看说明。`,
      description: (latest, current) => `ConvoSketchpad v${latest} 已发布，当前版本为 v${current}。`,
      projectDirectory: '项目目录',
      commandHint: '复制以下命令，在 OpenClaw 会话或终端中运行：',
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
      saveAria: '保存到文件',
      saveAs: (filename) => `另存为 ${filename}`,
    },
    errors: {
      title: '页面出现了问题',
      reload: '重新加载',
      panelCrashed: (name) => `${name} 面板出现了问题`,
    },
  },
  en: {
    tagline: __APP_TAGLINE__,
    common: { loading: 'Loading…', confirm: 'Confirm', cancel: 'Cancel', close: 'Close', retry: 'Retry' },
    topBar: { log: 'Log', events: 'Events', usage: 'Usage', settings: 'Settings' },
    status: {
      states: { connected: 'Connected', connecting: 'Connecting', reconnecting: 'Reconnecting', disconnected: 'Offline' },
      branches: 'branches',
      sessions: 'sessions',
      uptime: 'Uptime',
      context: 'Context',
      contextTooltip: (used, limit, percent) => `Context: ${used} / ${limit} tokens (${percent}%)`,
      contextCritical: 'CRITICAL: Consider starting a new root branch',
      contextWarning: 'Warning: Approaching context limit',
    },
    activity: {
      agentLog: 'Agent Log',
      agentLogAria: 'Agent activity log',
      events: 'Events',
      eventLogAria: 'Event log',
      badges: { system: 'SYSTEM', chat: 'CHAT', agent: 'AGENT', error: 'ERROR' },
      canvasResponse: (state) => `Canvas response: ${state}`,
      agentEvent: (state) => `Agent ${state}`,
      eventError: 'Gateway event error',
      interactionCompleted: 'Canvas interaction completed',
      interactionFailed: 'Canvas interaction failed',
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
      telemetryDetail: 'Costs, events, and uptime',
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
    connect: {
      eyebrow: 'Gateway Handshake',
      title: 'Connect ConvoSketchpad to your OpenClaw gateway',
      description: 'Point ConvoSketchpad at the Gateway endpoint, provide your token when needed, and bring the Canvas online.',
      connection: 'Connection',
      connectionTitle: 'Secure local bridge',
      connectionDetail: 'ConvoSketchpad uses WebSocket events to keep Canvas branches in sync live.',
      credentials: 'Credentials',
      credentialsTitle: 'Use server auth when available',
      credentialsDetail: 'The token field disappears for the official gateway URL when the server can inject credentials safely.',
      endpoint: 'WebSocket endpoint',
      token: 'Gateway token',
      tokenPlaceholder: 'Paste the token from your gateway config',
      localOnly: 'Keep ConvoSketchpad bound to localhost unless you explicitly want remote access.',
      connecting: 'Connecting…',
      connect: 'Connect to Gateway',
    },
    restart: {
      title: 'Restart OpenClaw Gateway',
      message: 'Active Canvas interactions may reconnect while the gateway restarts.',
      confirm: 'Restart',
      success: 'Gateway restarted successfully',
      failed: 'Gateway restart failed',
    },
    gateway: {
      invalidUrl: (detail) => `Invalid URL: ${detail}`,
      timeout: 'Connection timed out — retry',
      authFailed: (detail) => `Auth failed: ${detail}`,
      unknown: 'unknown',
      pairingHint: (requestId) => ` Run: openclaw devices approve ${requestId}`,
      websocketError: 'WebSocket error — check URL',
    },
    usage: {
      heading: 'Usage',
      loading: 'Loading…',
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
      providerDetails: (provider) => `${provider} provider details`,
      input: 'in',
      output: 'out',
      cached: 'cached',
      messages: 'msgs',
      average: 'avg',
      perMessage: '/msg',
      breakdownUnavailable: 'Provider breakdown unavailable',
      noData: 'No usage data',
      errors: 'errors',
    },
    update: {
      badge: 'update',
      title: 'Update Available',
      availableTitle: (version) => `Update available: v${version}`,
      availableAria: (version) => `Update available: version ${version}. Click for instructions.`,
      description: (latest, current) => `ConvoSketchpad v${latest} is available. You're running v${current}.`,
      projectDirectory: 'Project directory',
      commandHint: 'Copy and paste this into your OpenClaw session or terminal:',
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
      saveAria: 'Save to file',
      saveAs: (filename) => `Save as ${filename}`,
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

function translateActivityState(state: string): string {
  const translations: Record<string, string> = {
    event: '事件',
    started: '已开始',
    thinking: '思考中',
    processing: '处理中',
    tool_use: '调用工具',
    executing: '执行中',
    tool: '工具调用',
    delta: '生成中',
    streaming: '生成中',
    final: '已完成',
    completed: '已完成',
    aborted: '已中止',
    error: '错误',
    failed: '失败',
  };
  return translations[state] || state;
}
