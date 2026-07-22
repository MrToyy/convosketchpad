import type { Language } from '@/lib/language';

const voiceLanguageNames: Record<string, string> = {
  en: '英语',
  zh: '中文',
  hi: '印地语',
  es: '西班牙语',
  fr: '法语',
  ar: '阿拉伯语',
  bn: '孟加拉语',
  pt: '葡萄牙语',
  ru: '俄语',
  ja: '日语',
  de: '德语',
  tr: '土耳其语',
};

export interface SettingsCopy {
  drawer: {
    controlRoom: string;
    title: string;
    closeTitle: string;
    closeAria: string;
    categoriesAria: string;
    categories: { advanced: string; audio: string; appearance: string };
    signOut: string;
  };
  connection: {
    heading: string;
    status: string;
    statuses: Record<'connected' | 'connecting' | 'reconnecting' | 'disconnected', string>;
    reconnect: string;
    reconnectTitle: string;
    gatewayUrl: string;
    gatewayUrlHint: string;
    authToken: string;
    showToken: string;
    hideToken: string;
    authTokenHint: string;
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
    editorFontSize: string;
    editorFontSizeHint: string;
    editorFontSizeAria: string;
    defaultSuffix: string;
    showEvents: string;
    showEventsHint: string;
    showEventsAria: string;
    showLog: string;
    showLogHint: string;
    showLogAria: string;
    showHidden: string;
    showHiddenHint: string;
    showHiddenAria: string;
    showCommands: string;
    showCommandsHint: string;
    showTasks: string;
    showTasksHint: string;
    showTasksAria: string;
  };
  audio: {
    heading: string;
    inputHeading: string;
    inputHeadingCopy: string;
    outputHeading: string;
    outputHeadingCopy: string;
    language: string;
    languageHint: string;
    languageAria: string;
    voiceLanguageName: (code: string, name: string) => string;
    voiceLanguageLabel: (code: string, name: string, nativeName: string) => string;
    englishOnlyWarning: (language: string) => string;
    tinyWarning: (language: string) => string;
    useBase: string;
    voicePhrases: string;
    voicePhrasesHint: (language: string) => string;
    voicePhrasesOptional: (language: string) => string;
    edit: string;
    configure: string;
    soundEffects: string;
    soundEffectsHint: string;
    soundEffectsAria: string;
    ttsProvider: string;
    free: string;
    ttsProviderHint: string;
    qwenUnsupported: (language: string) => string;
    ttsModel: string;
    ttsModelHint: string;
    ttsModelAria: string;
    saved: string;
    voice: string;
    openAiVoiceHint: string;
    openAiVoiceAria: string;
    edgeVoiceHint: string;
    edgeVoiceAria: string;
    xiaomiVoiceHint: string;
    xiaomiVoiceAria: string;
    voiceInstructions: string;
    voiceInstructionsPlaceholder: string;
    voiceDescription: string;
    voiceDescriptionPlaceholder: string;
    styleInstruction: string;
    styleInstructionPlaceholder: string;
    style: string;
    stylePlaceholder: string;
    wakeWord: string;
    wakeWordActive: (phrase: string) => string;
    wakeWordUnsupported: string;
    wakeWordManual: string;
    wakeWordAria: string;
    speechToText: string;
    sttProvider: string;
    localFree: string;
    localSttHint: string;
    openAiSttHint: string;
    openAiSttKeyHint: string;
    sttModel: string;
    sttModelHint: string;
    sttModelAria: string;
    multilingual: string;
    englishOnly: string;
    downloading: (model: string, percent: number) => string;
    downloadFailed: (error: string) => string;
    modelReady: string;
    noGpuWarning: (model: string, verySlow: boolean) => string;
    apiKeyRequired: (keyName: string, provider: string) => string;
    apiKeyPlaceholder: (keyName: string) => string;
    apiKeySaved: (keyName: string) => string;
    saving: string;
    save: string;
    inputMode: string;
    inputModeHint: string;
    inputModeAria: string;
    inputModes: { hybrid: string; browser: string; local: string };
    inputModeDescriptions: { hybrid: string; browser: string; local: string };
    livePreview: string;
    livePreviewHint: string;
    livePreviewAria: string;
    defaultModel: string;
    openAiVoiceDescriptions: Record<string, string>;
  };
  voicePhrases: {
    title: (language: string) => string;
    description: (nativeName: string, hasEnglishFallback: boolean) => string;
    wakePhrase: string;
    wakePhraseHint: string;
    wakePhrasePlaceholder: string;
    sendPhrases: string;
    sendPhrasesHint: string;
    sendPhrasePlaceholder: string;
    cancelPhrases: string;
    cancelPhrasesHint: string;
    cancelPhrasePlaceholder: string;
    add: string;
    removePhrase: (kind: string, index: number) => string;
    cancel: string;
    saving: string;
    save: string;
    loadFailed: string;
    saveFailed: string;
    saveFailedWithStatus: (status: number) => string;
  };
}

export const settingsCopy = {
  'zh-CN': {
    drawer: {
      controlRoom: '控制中心', title: '设置', closeTitle: '关闭（Esc）', closeAria: '关闭设置', categoriesAria: '设置分类',
      categories: { advanced: '连接', audio: '音频', appearance: '外观' }, signOut: '退出登录',
    },
    connection: {
      heading: '网关', status: '网关状态',
      statuses: { connected: '已连接', connecting: '正在连接…', reconnecting: '正在重新连接…', disconnected: '未连接' },
      reconnect: '重新连接', reconnectTitle: '重新连接网关', gatewayUrl: '网关地址',
      gatewayUrlHint: '使用本地网关，或粘贴远程中继地址。', authToken: '认证令牌', showToken: '显示令牌', hideToken: '隐藏令牌',
      authTokenHint: '不设防的本地开发环境可留空。', service: '网关服务', restartTitle: '重启本地网关',
      restartHint: '配对、模型或后台工作进程需要完全重新加载时使用。', restart: '重启', restarting: '正在重启…',
    },
    appearance: {
      heading: '外观', language: '界面语言', languageHint: '目前控制 Canvas 和设置界面的语言。', languageAria: '选择界面语言',
      theme: '主题', themeHint: '一键切换整套界面配色。', themeAria: '选择主题', uiFont: '界面字体', uiFontHint: '代码块仍使用等宽字体。', uiFontAria: '选择字体',
      fontSize: '字体大小', fontSizeHint: '所有界面文字的基础字号。', fontSizeAria: '选择字体大小', editorFontSize: '编辑器字号',
      editorFontSizeHint: '代码编辑器使用的字号。', editorFontSizeAria: '选择编辑器字号', defaultSuffix: '默认',
      showEvents: '显示事件', showEventsHint: '在遥测区域中保持事件栏可见。', showEventsAria: '切换事件面板显示',
      showLog: '显示活动日志', showLogHint: '在顶部区域显示智能体活动。', showLogAria: '切换活动日志显示',
      showHidden: '显示隐藏的工作区项目', showHiddenHint: '需要时在工作区浏览器中显示点文件和点目录。', showHiddenAria: '切换隐藏工作区项目显示',
      showCommands: '显示聊天框“命令”按钮', showCommandsHint: '在聊天输入框中保持“命令”入口可见。',
      showTasks: '显示工作区任务', showTasksHint: '切换工作区标签页中的看板视图。', showTasksAria: '切换工作区看板显示',
    },
    audio: {
      heading: '音频', inputHeading: '输入采集', inputHeadingCopy: '调整语言、唤醒短语和转写方式，再将语音交给智能体。',
      outputHeading: '语音输出', outputHeadingCopy: '调整回复和通知所使用的声音、模型与播放方式。',
      language: '语音语言', languageHint: '让唤醒短语、语音识别和声音选项匹配你实际使用的语言。', languageAria: '选择语音语言',
      voiceLanguageName: (code, name) => voiceLanguageNames[code] || name,
      voiceLanguageLabel: (code, name, nativeName) => `${voiceLanguageNames[code] || name} — ${nativeName}`,
      englishOnlyWarning: (language) => `当前模型仅支持英语。请在下方切换到多语言模型，以转写${language}。`,
      tinyWarning: (language) => `tiny 速度快，但转写日常${language}对话时准确率可能较低。建议使用 base。`, useBase: '使用 base',
      voicePhrases: '语音短语', voicePhrasesHint: (language) => `自定义${language}的唤醒、发送和取消短语。`,
      voicePhrasesOptional: (language) => `可选：自定义${language}的唤醒、发送和取消短语。`, edit: '编辑', configure: '配置',
      soundEffects: '声音效果', soundEffectsHint: '启用轻量的界面提示音和音频确认。', soundEffectsAria: '切换声音效果',
      ttsProvider: '语音合成服务', free: '免费', ttsProviderHint: '先选择语音引擎，再在下方调整模型和说话风格。',
      qwenUnsupported: (language) => `Qwen3 不支持${language}。语音输出将使用英语。`,
      ttsModel: '语音合成模型', ttsModelHint: '选择当前服务提供的合成模型。', ttsModelAria: '选择语音合成模型', saved: '已保存 ✓',
      voice: '声音', openAiVoiceHint: '选择用于播放回复的 OpenAI 声音。', openAiVoiceAria: '选择 OpenAI 声音',
      edgeVoiceHint: '使用与语言匹配的 Edge 声音进行免费本地播放。', edgeVoiceAria: '选择 Edge 声音',
      xiaomiVoiceHint: '选择一个小米内置的 MiMo 声音。', xiaomiVoiceAria: '选择小米声音',
      voiceInstructions: '声音指令', voiceInstructionsPlaceholder: '描述希望声音呈现的效果…',
      voiceDescription: '声音描述', voiceDescriptionPlaceholder: '描述声音的特点…', styleInstruction: '风格指令',
      styleInstructionPlaceholder: '描述情绪和风格…', style: '风格', stylePlaceholder: '例如：开心、轻声、平静、戏剧化…',
      wakeWord: '唤醒词', wakeWordActive: (phrase) => `说出“${phrase}”即可唤醒。`, wakeWordUnsupported: '移动端网页不支持唤醒词。',
      wakeWordManual: '请改用手动麦克风按钮。', wakeWordAria: '切换唤醒词检测', speechToText: '语音转文字', sttProvider: '语音识别服务',
      localFree: '本地（免费）', localSttHint: '使用内置 Whisper 模型，无需 API Key', openAiSttHint: '正在使用 OpenAI Whisper API',
      openAiSttKeyHint: 'OpenAI Whisper API — 请在下方输入 API Key', sttModel: '语音识别模型',
      sttModelHint: '选择后端转写使用的本地 Whisper 模型。', sttModelAria: '选择语音识别模型', multilingual: '多语言', englishOnly: '仅英语',
      downloading: (model, percent) => `正在下载 ${model}… ${percent}%`, downloadFailed: (error) => `下载失败：${error}`, modelReady: '✓ 模型已就绪',
      noGpuWarning: (model, verySlow) => `未检测到 GPU — ${model} 在 CPU 上${verySlow ? '会非常慢' : '可能较慢'}。可使用 tiny 获得更快的多语言转写。`,
      apiKeyRequired: (keyName, provider) => `${provider} 需要 ${keyName}`, apiKeyPlaceholder: (keyName) => `粘贴 ${keyName}…`,
      apiKeySaved: (keyName) => `✓ ${keyName} 已保存`, saving: '正在保存…', save: '保存', inputMode: '输入模式',
      inputModeHint: '选择最终文本来自浏览器、后端，还是优先使用浏览器并自动回退。', inputModeAria: '选择语音输入模式',
      inputModes: { hybrid: '混合', browser: '浏览器', local: '本地' },
      inputModeDescriptions: {
        browser: '使用浏览器语音识别生成最终消息；仅在浏览器识别不可用时使用后端转写。',
        local: '始终使用 /api/transcribe 的结果，即使浏览器预览看起来更准确。',
        hybrid: '浏览器成功捕获语音时使用其结果，否则回退到 /api/transcribe。',
      },
      livePreview: '实时转写预览', livePreviewHint: '说话时显示浏览器预览；最终提交的文本仍可能因服务而异。', livePreviewAria: '切换实时转写预览',
      defaultModel: '默认',
      openAiVoiceDescriptions: {
        alloy: '中性、均衡', ash: '温暖、自然', ballad: '富有表现力、善于叙事', cedar: '平静、沉稳', coral: '清晰、友好',
        echo: '顺滑、平静', fable: '英式口音、叙事感', marin: '温暖、亲切', nova: '活力、年轻', onyx: '深沉、权威',
        sage: '睿智、从容', shimmer: '柔和、轻盈', verse: '多变、灵动',
      },
    },
    voicePhrases: {
      title: (language) => `语音短语 — ${language}`, description: (nativeName, fallback) => `设置使用${nativeName}控制语音输入时要说的短语。${fallback ? '发送和取消操作始终可使用英语短语作为后备。' : ''}`,
      wakePhrase: '唤醒短语', wakePhraseHint: '每种语言可设置一个唤醒短语；留空则使用该语言的默认短语。', wakePhrasePlaceholder: '唤醒短语',
      sendPhrases: '发送短语', sendPhrasesHint: '说出任意一条即可发送消息。', sendPhrasePlaceholder: '发送短语',
      cancelPhrases: '取消短语', cancelPhrasesHint: '说出任意一条即可丢弃消息。', cancelPhrasePlaceholder: '取消短语',
      add: '添加', removePhrase: (kind, index) => `删除第 ${index} 条${kind}`, cancel: '取消', saving: '正在保存…', save: '保存短语',
      loadFailed: '无法加载语音短语，请稍后重试。', saveFailed: '无法保存语音短语，请重试。', saveFailedWithStatus: (status) => `无法保存语音短语（${status}），请重试。`,
    },
  },
  en: {
    drawer: {
      controlRoom: 'Control Room', title: 'Settings', closeTitle: 'Close (Esc)', closeAria: 'Close settings', categoriesAria: 'Settings categories',
      categories: { advanced: 'Connection', audio: 'Audio', appearance: 'Appearance' }, signOut: 'Sign Out',
    },
    connection: {
      heading: 'Gateway', status: 'Gateway status', statuses: { connected: 'Connected', connecting: 'Connecting…', reconnecting: 'Reconnecting…', disconnected: 'Disconnected' },
      reconnect: 'Reconnect', reconnectTitle: 'Reconnect to gateway', gatewayUrl: 'Gateway URL', gatewayUrlHint: 'Use the local gateway or paste a remote relay endpoint.',
      authToken: 'Auth Token', showToken: 'Show token', hideToken: 'Hide token', authTokenHint: 'Leave blank for unsecured local development.',
      service: 'Gateway Service', restartTitle: 'Restart the local gateway', restartHint: 'Useful when pairing, models, or background workers need a clean reload.',
      restart: 'Restart', restarting: 'Restarting…',
    },
    appearance: {
      heading: 'Appearance', language: 'Interface language', languageHint: 'Controls the Canvas and settings interfaces for now.', languageAria: 'Select interface language',
      theme: 'Theme', themeHint: 'Swap the full cockpit palette in one move.', themeAria: 'Select theme', uiFont: 'UI font', uiFontHint: 'Code blocks stay monospace.', uiFontAria: 'Select font',
      fontSize: 'Font size', fontSizeHint: 'Base size for all UI text.', fontSizeAria: 'Select font size', editorFontSize: 'Editor font size', editorFontSizeHint: 'Size for the code editor.',
      editorFontSizeAria: 'Select editor font size', defaultSuffix: 'default', showEvents: 'Show events', showEventsHint: 'Keep the event rail visible in the telemetry row.',
      showEventsAria: 'Toggle events panel visibility', showLog: 'Show activity log', showLogHint: 'Surface agent activity in the top chrome.', showLogAria: 'Toggle log panel visibility',
      showHidden: 'Show hidden workspace entries', showHiddenHint: 'Reveal dotfiles and dotfolders in the workspace browser when you need them.', showHiddenAria: 'Toggle hidden workspace entries visibility',
      showCommands: 'Show chatbox Commands button', showCommandsHint: 'Keep the Commands launcher visible in the chat composer.',
      showTasks: 'Show workspace tasks', showTasksHint: 'Toggle the Kanban view inside the workspace tabs.', showTasksAria: 'Toggle workspace kanban visibility',
    },
    audio: {
      heading: 'Audio', inputHeading: 'Input Capture', inputHeadingCopy: 'Tune language detection, wake phrases, and transcription before speech reaches the agent.',
      outputHeading: 'Voice Output', outputHeadingCopy: 'Shape the speaking voice, model, and playback behavior for replies and announcements.',
      language: 'Voice language', languageHint: 'Match wake phrases, STT support, and voice options to the language you actually use.', languageAria: 'Select voice language',
      voiceLanguageName: (_code, name) => name,
      voiceLanguageLabel: (_code, name, nativeName) => `${name} — ${nativeName}`, englishOnlyWarning: (language) => `Current model is English-only. Switch to a multilingual model below for ${language} transcription.`,
      tinyWarning: (language) => `Tiny is fast, but conversational ${language} can be less accurate. Use base for better results.`, useBase: 'Use base',
      voicePhrases: 'Voice phrases', voicePhrasesHint: (language) => `Customize wake, send, and cancel phrases for ${language}.`, voicePhrasesOptional: (language) => `Optional: customize wake/send/cancel phrases for ${language}.`,
      edit: 'Edit', configure: 'Configure', soundEffects: 'Sound effects', soundEffectsHint: 'Keep subtle UI cues and audio confirmations enabled.', soundEffectsAria: 'Toggle sound effects',
      ttsProvider: 'TTS Provider', free: 'Free', ttsProviderHint: 'Choose the voice engine first, then tune the model and speaking style below.',
      qwenUnsupported: (language) => `Qwen3 doesn't support ${language}. Voice output will use English.`, ttsModel: 'TTS model',
      ttsModelHint: 'Select the synthesis model exposed by the active provider.', ttsModelAria: 'TTS Model', saved: 'Saved ✓', voice: 'Voice',
      openAiVoiceHint: 'Pick the OpenAI voice profile used for reply playback.', openAiVoiceAria: 'OpenAI Voice', edgeVoiceHint: 'Use a language-matched Edge voice for free local playback.',
      edgeVoiceAria: 'Edge Voice', xiaomiVoiceHint: "Choose one of Xiaomi's built-in MiMo voices.", xiaomiVoiceAria: 'Xiaomi Voice',
      voiceInstructions: 'Voice Instructions', voiceInstructionsPlaceholder: 'Describe how the voice should sound…', voiceDescription: 'Voice Description',
      voiceDescriptionPlaceholder: 'Describe the voice character…', styleInstruction: 'Style Instruction', styleInstructionPlaceholder: 'Emotion and style guidance…',
      style: 'Style', stylePlaceholder: 'Happy, whisper, calm, dramatic…', wakeWord: 'Wake word', wakeWordActive: (phrase) => `Say “${phrase}” to activate.`,
      wakeWordUnsupported: "Wake word isn't supported on mobile web.", wakeWordManual: 'Use the manual mic trigger instead.', wakeWordAria: 'Toggle wake word detection',
      speechToText: 'Speech to Text', sttProvider: 'STT Provider', localFree: 'Local (Free)', localSttHint: 'Using built-in Whisper model — no API key needed',
      openAiSttHint: 'Using OpenAI Whisper API', openAiSttKeyHint: 'OpenAI Whisper API — enter your API key below', sttModel: 'STT model',
      sttModelHint: 'Choose the local Whisper model for backend transcription.', sttModelAria: 'STT Model', multilingual: 'multilingual', englishOnly: 'English only',
      downloading: (model, percent) => `Downloading ${model}… ${percent}%`, downloadFailed: (error) => `Download failed: ${error}`, modelReady: '✓ Model ready',
      noGpuWarning: (model, verySlow) => `No GPU detected — ${model} ${verySlow ? 'will be very slow' : 'may be slow'} on CPU. Use tiny for faster multilingual transcription.`,
      apiKeyRequired: (keyName, provider) => `${keyName} required for ${provider}`, apiKeyPlaceholder: (keyName) => `Paste your ${keyName}…`,
      apiKeySaved: (keyName) => `✓ ${keyName} saved`, saving: 'Saving…', save: 'Save', inputMode: 'Input mode',
      inputModeHint: 'Choose whether final text comes from the browser, the backend, or browser-first fallback.', inputModeAria: 'STT Input Mode',
      inputModes: { hybrid: 'Hybrid', browser: 'Browser', local: 'Local' },
      inputModeDescriptions: {
        browser: 'Use browser speech recognition for the final message. Backend transcription is only used if browser recognition is unavailable.',
        local: 'Always finalize from /api/transcribe, even if the browser preview looks better.',
        hybrid: 'Use the browser transcript when it captures speech; fall back to /api/transcribe when it does not.',
      },
      livePreview: 'Live transcription preview', livePreviewHint: 'Show a browser preview while speaking; the committed transcript may still differ by provider.', livePreviewAria: 'Toggle live transcription preview',
      defaultModel: 'default',
      openAiVoiceDescriptions: {
        alloy: 'Neutral, balanced', ash: 'Warm, conversational', ballad: 'Expressive, storytelling', cedar: 'Calm, steady', coral: 'Clear, friendly',
        echo: 'Smooth, calm', fable: 'British-accented, narrative', marin: 'Warm, approachable', nova: 'Energetic, young', onyx: 'Deep, authoritative',
        sage: 'Wise, measured', shimmer: 'Soft, gentle', verse: 'Versatile, dynamic',
      },
    },
    voicePhrases: {
      title: (language) => `Voice Phrases — ${language}`, description: (nativeName, fallback) => `Set the phrases you'll say in ${nativeName} to control voice input.${fallback ? ' English phrases always work as fallback for send and cancel.' : ''}`,
      wakePhrase: 'Wake Phrase', wakePhraseHint: 'One wake phrase per language. Leave empty to use the default phrase for this language.', wakePhrasePlaceholder: 'Wake phrase',
      sendPhrases: 'Send Phrases', sendPhrasesHint: 'Say any of these to send your message.', sendPhrasePlaceholder: 'Send phrase',
      cancelPhrases: 'Cancel Phrases', cancelPhrasesHint: 'Say any of these to discard your message.', cancelPhrasePlaceholder: 'Cancel phrase',
      add: 'Add', removePhrase: (kind, index) => `Remove ${kind.toLowerCase()} ${index}`, cancel: 'Cancel', saving: 'Saving…', save: 'Save Phrases',
      loadFailed: 'Failed to load voice phrases. Please try again.', saveFailed: 'Failed to save voice phrases. Please try again.', saveFailedWithStatus: (status) => `Failed to save voice phrases (${status}). Please try again.`,
    },
  },
} satisfies Record<Language, SettingsCopy>;

export function getSettingsCopy(language: Language): SettingsCopy {
  return settingsCopy[language];
}
