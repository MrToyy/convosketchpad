import type { Language } from '@/lib/language';

export interface CanvasCopy {
  defaultCanvasName: (index: number) => string;
  status: {
    queued: string;
    working: string;
    settling: string;
    streaming: string;
    completed: string;
    failed: string;
  };
  knownErrors: Record<string, string>;
  userInput: string;
  attachmentsOnly: string;
  waitingForCompleteReply: string;
  waitingForResponse: string;
  noResponse: string;
  partialHistoryResources: string;
  artifactUnavailable: string;
  previewImage: (name: string) => string;
  forkFromInteraction: string;
  closeComposer: string;
  composerPlaceholder: string;
  addAttachment: string;
  send: string;
  attachmentReadFailed: (name: string) => string;
  attachmentTooLarge: (name: string) => string;
  imageCompressionFailed: (name: string) => string;
  loadCanvasListFailed: string;
  loadCanvasFailed: string;
  loadingCanvas: string;
  refreshOpenClawFailed: string;
  currentCanvasMissing: string;
  secureReadUrlMissing: string;
  readFailedWithStatus: (status: number) => string;
  readFailed: string;
  resourceWarning: (name: string, reason: string) => string;
  prepareAttachmentFailed: string;
  messageSendFailed: string;
  openClawRunFailed: string;
  forkFailed: string;
  createBranch: string;
  newSession: string;
  continueBranch: string;
  saveLayoutFailed: string;
  createCanvasFailed: string;
  renameCanvasFailed: string;
  changeAgentFailed: string;
  createSessionFailed: string;
  deleteCanvasConfirm: (name: string) => string;
  canvasList: string;
  agentLabel: (agentId: string) => string;
  selectAgent: string;
  retryAgentList: string;
  hideCanvasList: string;
  showCanvasList: string;
  newCanvas: string;
  renameCanvas: (name: string) => string;
  deleteCanvas: (name: string) => string;
  renameHint: string;
  connected: string;
  unavailable: string;
  canvasControls: string;
  zoomIn: string;
  zoomOut: string;
  fitView: string;
  toggleInteractive: string;
  minimap: string;
  emptyTitle: string;
  emptyDescription: string;
  previewDialog: (name: string) => string;
  closeImagePreview: string;
  closePreview: string;
}

/** Marks frontend-generated messages that are already localized for the selected Canvas language. */
export class CanvasLocalizedError extends Error {
  override name = 'CanvasLocalizedError';
}

const knownErrors = {
  'zh-CN': {
    not_found: '未找到对应内容',
    invalid_branch_transition: '分支状态已变化，请刷新后重试',
    send_in_progress: '该分支已有消息正在发送',
    cannot_fork_branch_head: '分支末尾只能继续对话，不能创建分支',
    interaction_not_completed: '只能从已完成的历史交互创建分支',
    reservation_not_prepared: '发送请求已失效，请重试',
    conflict: '当前位置已有一个未发送的输入框',
    'Not found': '未找到对应内容',
    'Invalid canvas': '画布信息无效',
    'Invalid canvas update': '画布更新信息无效',
    'Invalid name': '画布名称无效',
    'Authentication required': '请先登录',
    'Invalid send request': '发送内容无效',
    'Message or attachment required': '请输入消息或添加附件',
    'Video attachments are not supported in Canvas': '画布暂不支持视频附件',
    'Invalid layout': '画布布局数据无效',
    'Invalid acknowledgement': '发送确认信息无效',
    'Invalid failure': '发送失败信息无效',
    'Invalid completion': '交互完成信息无效',
    'Canvas operation failed': '画布操作失败',
    'Failed to fetch': '无法连接到服务端',
    unknown_agent: '所选智能体不存在',
    agent_locked: '首次交互已经提交，无法再修改智能体',
    agent_changed: '智能体已在其他页面中修改，请重新发送',
    agent_catalog_unavailable: '暂时无法读取 OpenClaw 智能体列表',
  },
  en: {
    not_found: 'The requested item was not found.',
    invalid_branch_transition: 'The branch changed. Refresh and try again.',
    send_in_progress: 'A message is already being sent on this branch.',
    cannot_fork_branch_head: 'Continue from the branch head instead of creating a fork.',
    interaction_not_completed: 'You can only fork from a completed historical interaction.',
    reservation_not_prepared: 'The send request expired. Try again.',
    conflict: 'An unsent composer already exists here.',
    'Not found': 'The requested item was not found.',
    'Invalid canvas': 'The Canvas data is invalid.',
    'Invalid canvas update': 'The Canvas update is invalid.',
    'Invalid name': 'The Canvas name is invalid.',
    'Authentication required': 'Sign in to continue.',
    'Invalid send request': 'The send request is invalid.',
    'Message or attachment required': 'Enter a message or add an attachment.',
    'Video attachments are not supported in Canvas': 'Canvas does not support video attachments yet.',
    'Invalid layout': 'The Canvas layout is invalid.',
    'Invalid acknowledgement': 'The send acknowledgement is invalid.',
    'Invalid failure': 'The failure information is invalid.',
    'Invalid completion': 'The completion information is invalid.',
    'Canvas operation failed': 'The Canvas operation failed.',
    'Failed to fetch': 'Unable to connect to the server.',
    unknown_agent: 'The selected agent does not exist.',
    agent_locked: 'The first interaction has been submitted, so the agent is locked.',
    agent_changed: 'The agent changed in another tab. Send again.',
    agent_catalog_unavailable: 'The OpenClaw agent list is temporarily unavailable.',
  },
} satisfies Record<Language, Record<string, string>>;

export const canvasCopy = {
  'zh-CN': {
    defaultCanvasName: (index) => `画布 ${index}`,
    status: { queued: '等待智能体响应', working: '智能体工作中', settling: '正在整理完整回复', streaming: '生成中', completed: '已完成', failed: '失败' },
    knownErrors: knownErrors['zh-CN'],
    userInput: '用户输入',
    attachmentsOnly: '（仅包含附件）',
    waitingForCompleteReply: '正在整理完整回复…',
    waitingForResponse: '正在等待 OpenClaw 响应…',
    noResponse: '暂无响应内容。',
    partialHistoryResources: '部分历史资源未能继承',
    artifactUnavailable: 'Artifact 暂不可用',
    previewImage: (name) => `预览图片 ${name}`,
    forkFromInteraction: '从此交互创建新分支',
    closeComposer: '关闭输入框',
    composerPlaceholder: '接下来希望 OpenClaw 做什么？',
    addAttachment: '添加附件',
    send: '发送',
    attachmentReadFailed: (name) => `无法读取附件：${name}`,
    attachmentTooLarge: (name) => `附件“${name}”超过 20 MB，无法发送给 OpenClaw`,
    imageCompressionFailed: (name) => `图片“${name}”无法压缩到 OpenClaw 可直接识别的大小`,
    loadCanvasListFailed: '无法加载画布列表',
    loadCanvasFailed: '无法加载画布',
    loadingCanvas: '正在加载画布…',
    refreshOpenClawFailed: '无法刷新 OpenClaw 状态',
    currentCanvasMissing: '未找到当前画布',
    secureReadUrlMissing: '缺少安全读取地址',
    readFailedWithStatus: (status) => `读取失败（${status}）`,
    readFailed: '读取失败',
    resourceWarning: (name, reason) => `${name}：${reason}`,
    prepareAttachmentFailed: '无法准备附件',
    messageSendFailed: '消息发送失败',
    openClawRunFailed: 'OpenClaw 运行失败',
    forkFailed: '无法创建新分支',
    createBranch: '创建分支',
    newSession: '新建主分支',
    continueBranch: '继续分支',
    saveLayoutFailed: '无法保存画布布局',
    createCanvasFailed: '无法创建画布',
    renameCanvasFailed: '无法重命名画布',
    changeAgentFailed: '无法修改智能体',
    createSessionFailed: '无法创建主分支',
    deleteCanvasConfirm: (name) => `确定删除“${name}”及其画布数据吗？OpenClaw 原始会话记录不会被修改。`,
    canvasList: '画布列表',
    agentLabel: (agentId) => `智能体：${agentId}`,
    selectAgent: '选择智能体',
    retryAgentList: '重新加载智能体列表',
    hideCanvasList: '隐藏画布列表',
    showCanvasList: '显示画布列表',
    newCanvas: '新建画布',
    renameCanvas: (name) => `重命名 ${name}`,
    deleteCanvas: (name) => `删除 ${name}`,
    renameHint: '按 Enter 保存，Esc 取消',
    connected: 'OpenClaw 已连接',
    unavailable: 'OpenClaw 暂不可用',
    canvasControls: '画布控制',
    zoomIn: '放大',
    zoomOut: '缩小',
    fitView: '适应视图',
    toggleInteractive: '切换节点交互',
    minimap: '画布缩略图',
    emptyTitle: '开始使用 OpenClaw 画布',
    emptyDescription: '创建画布后，你可以开始多个主分支，并从历史交互继续派生新的分支。',
    previewDialog: (name) => `图片预览：${name}`,
    closeImagePreview: '关闭图片预览',
    closePreview: '关闭预览',
  },
  en: {
    defaultCanvasName: (index) => `Canvas ${index}`,
    status: { queued: 'Waiting for agent', working: 'Agent working', settling: 'Finalizing response', streaming: 'Generating', completed: 'Completed', failed: 'Failed' },
    knownErrors: knownErrors.en,
    userInput: 'User input',
    attachmentsOnly: '(attachments only)',
    waitingForCompleteReply: 'Finalizing the complete response…',
    waitingForResponse: 'Waiting for OpenClaw…',
    noResponse: 'No response content.',
    partialHistoryResources: 'Some historical resources could not be inherited',
    artifactUnavailable: 'Artifact unavailable',
    previewImage: (name) => `Preview image ${name}`,
    forkFromInteraction: 'Create a branch from this interaction',
    closeComposer: 'Close composer',
    composerPlaceholder: 'What should OpenClaw do next?',
    addAttachment: 'Add attachment',
    send: 'Send',
    attachmentReadFailed: (name) => `Unable to read attachment: ${name}`,
    attachmentTooLarge: (name) => `Attachment “${name}” exceeds 20 MB and cannot be sent to OpenClaw`,
    imageCompressionFailed: (name) => `Image “${name}” could not be compressed to a size OpenClaw can process`,
    loadCanvasListFailed: 'Unable to load the Canvas list',
    loadCanvasFailed: 'Unable to load the Canvas',
    loadingCanvas: 'Loading Canvas…',
    refreshOpenClawFailed: 'Unable to refresh OpenClaw status',
    currentCanvasMissing: 'The current Canvas was not found',
    secureReadUrlMissing: 'Secure read URL is missing',
    readFailedWithStatus: (status) => `Read failed (${status})`,
    readFailed: 'Read failed',
    resourceWarning: (name, reason) => `${name}: ${reason}`,
    prepareAttachmentFailed: 'Unable to prepare attachment',
    messageSendFailed: 'Message failed to send',
    openClawRunFailed: 'OpenClaw run failed',
    forkFailed: 'Unable to create branch',
    createBranch: 'Create branch',
    newSession: 'New root branch',
    continueBranch: 'Continue branch',
    saveLayoutFailed: 'Unable to save Canvas layout',
    createCanvasFailed: 'Unable to create Canvas',
    renameCanvasFailed: 'Unable to rename Canvas',
    changeAgentFailed: 'Unable to change agent',
    createSessionFailed: 'Unable to create a root branch',
    deleteCanvasConfirm: (name) => `Delete “${name}” and its Canvas data? The original OpenClaw session history will not be modified.`,
    canvasList: 'Canvas list',
    agentLabel: (agentId) => `Agent: ${agentId}`,
    selectAgent: 'Select agent',
    retryAgentList: 'Reload agent list',
    hideCanvasList: 'Hide Canvas list',
    showCanvasList: 'Show Canvas list',
    newCanvas: 'New Canvas',
    renameCanvas: (name) => `Rename ${name}`,
    deleteCanvas: (name) => `Delete ${name}`,
    renameHint: 'Enter to save, Esc to cancel',
    connected: 'OpenClaw connected',
    unavailable: 'OpenClaw unavailable',
    canvasControls: 'Canvas controls',
    zoomIn: 'Zoom in',
    zoomOut: 'Zoom out',
    fitView: 'Fit view',
    toggleInteractive: 'Toggle interactivity',
    minimap: 'Canvas minimap',
    emptyTitle: 'Start with ConvoSketchpad',
    emptyDescription: 'Create a Canvas to start root branches and branch from historical interactions.',
    previewDialog: (name) => `Image preview: ${name}`,
    closeImagePreview: 'Close image preview',
    closePreview: 'Close preview',
  },
} satisfies Record<Language, CanvasCopy>;

export function getCanvasCopy(language: Language): CanvasCopy {
  return canvasCopy[language];
}

export function canvasErrorMessage(error: unknown, fallback: string, language: Language): string {
  const copy = getCanvasCopy(language);
  const message = error instanceof Error ? error.message : '';
  if (error instanceof CanvasLocalizedError) return message;
  return copy.knownErrors[message] || (language === 'zh-CN' && /[一-鿿]/.test(message) ? message : fallback);
}
