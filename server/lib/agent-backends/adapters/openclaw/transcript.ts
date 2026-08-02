import type { BackendArtifactCandidate } from '../../contract.js';

export type OpenClawMessage = Record<string, unknown>;

interface TurnMatchInput {
  userInput: string;
  createdAt: number;
  runId?: string;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function string(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function array(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  return value == null ? [] : [value];
}

function messageTimestamp(message: OpenClawMessage): number | undefined {
  const value = message.timestamp ?? message.createdAt ?? message.ts;
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function textFromContent(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return '';
  return value.map((item) => {
    const block = record(item);
    if (!block) return '';
    if (typeof block.text === 'string') return block.text;
    if (typeof block.content === 'string') return block.content;
    if (Array.isArray(block.content)) return textFromContent(block.content);
    return '';
  }).filter(Boolean).join('\n');
}

function messageText(message: OpenClawMessage): string {
  return textFromContent(message.content) || string(message.text);
}

function role(message: OpenClawMessage): string {
  return string(message.role).toLowerCase();
}

function messageRunId(message: OpenClawMessage): string {
  const direct = string(message.runId);
  if (direct) return direct;
  const idempotencyKey = string(message.idempotencyKey);
  return idempotencyKey.includes(':') ? idempotencyKey.split(':')[0] : '';
}

function basename(value: string, fallback: string): string {
  const clean = value.split(/[?#]/)[0].replace(/\/+$/, '');
  try { return decodeURIComponent(clean.split('/').pop() || fallback); } catch { return clean.split('/').pop() || fallback; }
}

function inferMimeType(uri: string): string | undefined {
  const clean = uri.split(/[?#]/)[0].toLowerCase();
  if (/\.(png|apng)$/.test(clean)) return 'image/png';
  if (/\.jpe?g$/.test(clean)) return 'image/jpeg';
  if (/\.gif$/.test(clean)) return 'image/gif';
  if (/\.webp$/.test(clean)) return 'image/webp';
  if (/\.svg$/.test(clean)) return 'image/svg+xml';
  if (/\.pdf$/.test(clean)) return 'application/pdf';
  if (/\.(md|txt|log|csv)$/.test(clean)) return 'text/plain';
  if (/\.json$/.test(clean)) return 'application/json';
  return undefined;
}

function artifactCollector() {
  const artifacts = new Map<string, BackendArtifactCandidate>();
  const add = (rawUri: unknown, rawName?: unknown, rawMimeType?: unknown, rawSize?: unknown) => {
    const uri = string(rawUri).trim();
    if (!uri || artifacts.has(uri)) return;
    const mimeType = string(rawMimeType) || inferMimeType(uri);
    const sizeBytes = finiteNumber(rawSize);
    artifacts.set(uri, {
      uri,
      name: string(rawName) || basename(uri, 'artifact'),
      ...(mimeType ? { mimeType } : {}),
      ...(sizeBytes !== undefined ? { sizeBytes } : {}),
    });
  };
  return { artifacts, add };
}

function collectBlock(block: Record<string, unknown>, add: ReturnType<typeof artifactCollector>['add']): void {
  const type = string(block.type).toLowerCase();
  const name = block.alt ?? block.filename ?? block.fileName ?? block.name;
  const mimeType = block.mimeType ?? block.media_type ?? block.mediaType;
  const size = block.sizeBytes ?? block.bytes ?? block.size;
  const directUri = block.openUrl ?? block.url ?? block.uri ?? block.href;
  if (directUri && ['image', 'file', 'attachment', 'document', 'audio', 'video'].includes(type)) {
    add(directUri, name, mimeType, size);
  }
  if (block.path && ['file', 'attachment', 'document', 'toolresult', 'tool_result'].includes(type)) {
    add(block.path, name, mimeType, size);
  }
  if (type === 'image' && typeof block.data === 'string') {
    add(`data:${string(mimeType) || 'image/png'};base64,${block.data}`, name || '图片', mimeType || 'image/png', size);
  }
  const source = record(block.source);
  if (type === 'image' && source && typeof source.data === 'string') {
    const sourceMime = string(source.media_type) || string(mimeType) || 'image/png';
    add(`data:${sourceMime};base64,${source.data}`, name || '图片', sourceMime, size);
  }
  if (Array.isArray(block.content)) {
    for (const item of block.content) {
      const nested = record(item);
      if (nested) collectBlock(nested, add);
    }
  }
}

function collectLinks(text: string, add: ReturnType<typeof artifactCollector>['add']): void {
  for (const match of text.matchAll(/!\[([^\]]*)\]\(([^)]+)\)/g)) add(match[2], match[1] || '图片', 'image/*');
  for (const match of text.matchAll(/\[([^\]]+)\]\((file:[^)]+|https?:\/\/[^)]+|\/api\/[^)]+)\)/g)) add(match[2], match[1]);
  for (const match of text.matchAll(/(?:^|[\s"'`(])((?:\/[^\s"'`)]+|file:\/\/[^\s"'`)]+)\.(?:png|jpe?g|gif|webp|svg|pdf|txt|md|json|csv|zip))(?:$|[\s"'`),])/gim)) {
    add(match[1], basename(match[1], 'artifact'));
  }
}

function pickMessages(messages: OpenClawMessage[], input: TurnMatchInput) {
  if (messages.length === 0) return { messages: [], matchedTurn: false };
  let userIndex = -1;
  const userInput = input.userInput.trim();
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (role(messages[index]) !== 'user') continue;
    if (!userInput || messageText(messages[index]).includes(userInput)) { userIndex = index; break; }
  }
  if (userIndex < 0) {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (role(messages[index]) !== 'user') continue;
      const timestamp = messageTimestamp(messages[index]);
      if (timestamp === undefined || timestamp <= input.createdAt + 15_000) { userIndex = index; break; }
    }
  }
  if (userIndex < 0 && input.runId) {
    const matched = messages.filter((message) => messageRunId(message) === input.runId);
    if (matched.length) return { messages: matched, matchedTurn: true };
  }
  if (userIndex < 0) return { messages: messages.slice(-20), matchedTurn: false };
  let endIndex = messages.length;
  for (let index = userIndex + 1; index < messages.length; index += 1) {
    if (role(messages[index]) === 'user') { endIndex = index; break; }
  }
  return { messages: messages.slice(userIndex, endIndex), matchedTurn: true };
}

export function extractOpenClawTurn(messages: OpenClawMessage[], input: TurnMatchInput) {
  const picked = pickMessages(messages, input);
  const { artifacts, add } = artifactCollector();
  for (const message of picked.messages) {
    const messageRole = role(message);
    if (messageRole !== 'assistant' && messageRole !== 'tool' && messageRole !== 'toolresult') continue;
    const mediaUrls = array(message.MediaUrls);
    const mediaTypes = array(message.MediaTypes);
    mediaUrls.forEach((uri, index) => add(uri, `媒体-${index + 1}`, mediaTypes[index]));
    add(message.MediaUrl, '媒体文件', message.MediaType);
    for (const mediaPath of array(message.MediaPaths)) add(mediaPath, basename(string(mediaPath), '媒体文件'));
    add(message.MediaPath, basename(string(message.MediaPath), '媒体文件'), message.MediaType);
    if (Array.isArray(message.content)) {
      for (const item of message.content) {
        const block = record(item);
        if (block) collectBlock(block, add);
      }
    }
    collectLinks(messageText(message), add);
  }
  const assistants = picked.messages.filter((message) => role(message) === 'assistant');
  return {
    agentOutput: [...assistants].reverse().map(messageText).find(Boolean) || '',
    artifacts: [...artifacts.values()],
    matchedTurn: picked.matchedTurn,
  };
}
