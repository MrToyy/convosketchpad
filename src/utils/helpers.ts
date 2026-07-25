/**
 * helpers.ts — markdown rendering, content extraction, and tool descriptions
 * 
 * For formatting utilities, import directly from:
 *   - @/lib/formatting (esc, timeAgo, fmtTokens, fmtK)
 *   - @/lib/highlight (hljs, highlightCode)
 */
import { esc } from '@/lib/formatting';
import { highlightCode } from '@/lib/highlight';
import type { ContentBlock } from '@/types';
import { DEFAULT_LANGUAGE, type Language } from '@/lib/language';

// ─── Markdown cache ───
const MD_CACHE_MAX = 200;
const markdownCache = new Map<string, string>();

function getMarkdownCache(key: string): string | undefined {
  const val = markdownCache.get(key);
  if (!val) return undefined;
  markdownCache.delete(key);
  markdownCache.set(key, val);
  return val;
}

function setMarkdownCache(key: string, value: string): void {
  markdownCache.set(key, value);
  if (markdownCache.size > MD_CACHE_MAX) {
    const oldestKey = markdownCache.keys().next().value;
    if (oldestKey) markdownCache.delete(oldestKey);
  }
}

/**
 * Lightweight regex-based markdown renderer for streaming and tool results.
 *
 * Supports fenced code blocks (with syntax highlighting), inline code,
 * bold, italic, links, and unordered lists. Results are cached (LRU, max 200).
 */
export function renderMarkdown(text: string, opts: { highlight?: boolean } = {}): string {
  if (!text) return '';
  const highlight = opts.highlight !== false;
  const cacheKey = (highlight ? 'h:' : 'nh:') + text;
  const cached = getMarkdownCache(cacheKey);
  if (cached) return cached;

  let s = esc(text);
  s = s.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
    const highlighted = highlight ? highlightCode(code, lang) : code;
    const langLabel = lang ? `<span class="code-lang">${esc(lang)}</span>` : '';
    return `<pre class="hljs">${langLabel}<code>${highlighted}</code></pre>`;
  });
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '<em>$1</em>');
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  s = s.replace(/^[-*] (.+)$/gm, '• $1');
  s = s.replace(/\n/g, '<br>');
  s = s.replace(/<pre class="hljs">([\s\S]*?)<\/code><\/pre>/g, (_, inner) =>
    '<pre class="hljs">' + inner.replace(/<br>/g, '\n') + '</code></pre>'
  );

  setMarkdownCache(cacheKey, s);
  return s;
}

/** Replace tool-result sentinel markers with collapsible `<details>` elements. */
export function renderToolResults(html: string): string {
  // eslint-disable-next-line no-control-regex
  return html.replace(/\x00TOOLRESULT_START\x00([\s\S]*?)\x00TOOLRESULT_END\x00/g, (_, content) => {
    const plain = content.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').trim();
    const preview = plain.slice(0, 80).replace(/\n/g, ' ') + (plain.length > 80 ? '…' : '');
    // Use Unicode wrench instead of inline SVG — SVG is stripped by DOMPurify's FORBID_TAGS
    return `<details class="tool-result-details"><summary>🔧 result — ${esc(preview)}</summary><div class="tool-result-body">${content}</div></details>`;
  });
}

/**
 * Extract displayable text from a chat message, including tool call/result blocks.
 * Tool results are wrapped in sentinel markers for later rendering by {@link renderToolResults}.
 */
export function extractText(msg: { role: string; content: string | ContentBlock[]; text?: string }): string {
  if (typeof msg.content === 'string') return msg.content;
  if (Array.isArray(msg.content)) {
    const parts: string[] = [];
    for (const block of msg.content) {
      if (block.type === 'text' && block.text) parts.push(block.text);
      else if (block.type === 'tool_use' || block.type === 'toolCall') {
        const toolInput = block.input || block.arguments;
        parts.push(`**tool:** \`${block.name}\`\n\`\`\`json\n${JSON.stringify(toolInput, null, 2)}\n\`\`\``);
      } else if (block.type === 'tool_result' || block.type === 'toolResult') {
        const inner = typeof block.content === 'string' ? block.content
          : Array.isArray(block.content) ? (block.content as ContentBlock[]).filter(x => x.type === 'text').map(x => x.text || '').join('\n')
          : JSON.stringify(block.content);
        parts.push(`\x00TOOLRESULT_START\x00${inner || '(empty result)'}\x00TOOLRESULT_END\x00`);
      }
    }
    return parts.join('\n');
  }
  return msg.text || '';
}

// ─── Path sanitization helpers ───
function sanitizePath(path: string): string {
  // Replace /root/ with ~/, /home/user/ with ~/, or just use basename
  const str = String(path);
  if (str.startsWith('/root/')) return str.replace('/root/', '~/');
  if (str.match(/^\/home\/[^/]+\//)) return str.replace(/^\/home\/[^/]+\//, '~/');
  // For absolute paths that don't start with home/root, just use basename
  if (str.startsWith('/')) return str.split('/').pop() || str;
  return str;
}

function redactSecrets(cmd: string): string {
  // Redact common secret patterns in exec commands
  let safe = cmd;
  // Redact -H "Authorization: ..." or -H 'Authorization: ...'
  safe = safe.replace(/-H\s+["']Authorization:\s*[^"']+["']/gi, '-H "Authorization: [REDACTED]"');
  // Redact token=xxx, api_key=xxx, password=xxx
  safe = safe.replace(/\b(token|api_key|password|secret|auth)=[^\s&]+/gi, '$1=[REDACTED]');
  // Redact Bearer tokens
  safe = safe.replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]');
  return safe;
}

/**
 * Extract a short project name from a working directory path.
 * Returns the last meaningful path segment, or null for generic/root paths.
 */
export function extractProjectName(workdir: string | undefined | null): string | null {
  if (!workdir) return null;
  const trimmed = workdir.replace(/\/+$/, '');
  if (!trimmed || trimmed === '/' || trimmed === '/root' || trimmed === '/tmp') return null;
  const seg = trimmed.split('/').pop() || null;
  // Skip generic names
  if (!seg || seg === 'workspace' || seg === 'home' || seg === '~') return null;
  return seg;
}

/** Append project context suffix if available. */
function withProject(desc: string, project: string | null): string {
  return project ? `${desc} (${project})` : desc;
}

/**
 * Generate a short human-readable description for a tool invocation.
 * Used in the agent activity log. Returns `null` if tool name is empty.
 */
export function describeToolUse(toolName: string, input: Record<string, unknown>, language: Language = DEFAULT_LANGUAGE): string | null {
  if (!toolName) return null;
  const t = (zh: string, en: string) => language === 'zh-CN' ? zh : en;
  const p = input || {};
  const tn = toolName.toLowerCase();
  switch (tn) {
    case 'exec': {
      let cmd = String(p.command || '').trim();
      if (!cmd) return t('正在运行命令', 'running command');
      
      // Redact secrets before processing
      cmd = redactSecrets(cmd);
      const project = extractProjectName(p.workdir as string);
      
      if (cmd.includes('npm install') || cmd.includes('pip install') || cmd.includes('apt install') || cmd.includes('apt-get install'))
        return withProject(t('正在安装：', 'installing: ') + cmd.replace(/.*install\s+(-\w+\s+)*/, '').split(/\s/)[0], project);
      if (cmd.includes('bunx ')) return withProject(t('正在运行：', 'running: ') + (cmd.match(/bunx\s+(\S+)/)?.[1] || cmd.slice(0, 40)), project);
      if (cmd.includes('curl')) return t('正在获取 URL', 'fetching URL');
      if (cmd.includes('pkill') || cmd.includes('kill ')) return t('正在停止进程', 'stopping process');
      if (cmd.includes('git ')) return withProject('git ' + cmd.replace(/.*git\s+/, '').split(/\s/)[0], project);
      if (cmd.startsWith('cd ') && cmd.includes('node ')) return t('正在重启服务', 'restarting server');
      if (cmd.includes('python3')) return withProject(t('正在运行 Python 脚本', 'running python script'), project);
      if (cmd.includes('npm run build')) return withProject(t('正在构建', 'building'), project);
      if (cmd.includes('npm run lint')) return withProject(t('正在检查代码', 'linting'), project);
      if (cmd.includes('npm run ')) {
        const script = cmd.match(/npm run\s+(\S+)/)?.[1] || '';
        return withProject('npm run ' + script, project);
      }
      const short = cmd.split('&&')[0].split('|')[0].trim();
      if (/^(grep|find)\s/.test(short)) return withProject(t('正在搜索文件', 'searching files'), project);
      if (/^(cat|head|tail)\s/.test(short)) return withProject(t('正在读取文件', 'reading file'), project);
      if (/^(systemctl|service)\s/.test(short)) {
        const svcMatch = short.match(/(?:systemctl|service)\s+(\w+)\s+(\S+)/);
        if (svcMatch) {
          const actionMap: Record<string, string> = {
            start: t('正在启动', 'starting'), stop: t('正在停止', 'stopping'), restart: t('正在重启', 'restarting'),
            status: t('正在检查', 'checking'), enable: t('正在启用', 'enabling'), disable: t('正在停用', 'disabling'),
          };
          const verb = actionMap[svcMatch[1]] || svcMatch[1];
          return language === 'zh-CN' ? `${verb}服务：${svcMatch[2]}` : `${verb} service: ${svcMatch[2]}`;
        }
      }
      return project ? `${project}: ${short}` : t('执行：', 'exec: ') + short;
    }
    case 'read': return t('正在读取 ', 'reading ') + sanitizePath(String(p.path || p.file_path || t('文件', 'file')));
    case 'write': return t('正在写入 ', 'writing ') + sanitizePath(String(p.path || p.file_path || t('文件', 'file')));
    case 'edit': return t('正在编辑 ', 'editing ') + sanitizePath(String(p.path || p.file_path || t('文件', 'file')));
    case 'web_search': return t('正在搜索：', 'searching: ') + String(p.query || '');
    case 'web_fetch': return t('正在获取：', 'fetching: ') + String(p.url || '').replace(/https?:\/\/(www\.)?/, '').split('/')[0];
    case 'gateway': return t('网关：', 'gateway: ') + (p.action || t('操作', 'action'));
    case 'browser': return t('浏览器：', 'browser: ') + (p.action || t('操作', 'action'));
    case 'message': return t('正在发送消息', 'sending message');
    case 'image': return t('正在分析图片', 'analyzing image');
    case 'process': {
      const action = String(p.action || 'poll');
      if (action === 'poll' || action === 'log') return t('正在检查后台任务', 'checking background task');
      if (action === 'list') return t('正在列出后台任务', 'listing background tasks');
      if (action === 'kill') return t('正在停止后台任务', 'stopping background task');
      if (action === 'write' || action === 'send-keys' || action === 'paste') return t('正在向后台任务发送输入', 'sending input to background task');
      return t('正在管理后台任务', 'managing background task');
    }
    default: return t('正在使用 ', 'using ') + toolName;
  }
}
