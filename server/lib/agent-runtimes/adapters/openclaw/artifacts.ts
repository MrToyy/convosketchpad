import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RuntimeArtifactHandle, MaterializedArtifact } from '../../contract.js';
import { RuntimeOperationError, assertRuntimeHandle } from '../../contract.js';
import { openClawConfig } from './config.js';
import {
  gatewayRpcCall,
  gatewaySupports,
  getGatewaySharedHttpAuthToken,
} from './gateway-rpc.js';

const MAX_BYTES = 25 * 1024 * 1024;

function isWithin(candidate: string, root: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function gatewayHttpBase(): URL {
  const gatewayUrl = openClawConfig.gatewayUrl
    .replace(/^ws:/, 'http:')
    .replace(/^wss:/, 'https:')
    .replace(/\/ws\/?$/, '');
  return new URL(gatewayUrl.endsWith('/') ? gatewayUrl : `${gatewayUrl}/`);
}

async function responseBytes(response: Response): Promise<Uint8Array> {
  const declared = Number(response.headers.get('content-length') || 0);
  if (declared > MAX_BYTES) throw new RuntimeOperationError('rejected', 'Artifact exceeds the 25 MiB persistence limit');
  if (!response.body) throw new RuntimeOperationError('internal', 'Artifact response has no body');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BYTES) {
      await reader.cancel();
      throw new RuntimeOperationError('rejected', 'Artifact exceeds the 25 MiB persistence limit');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

async function downloadUrl(urlValue: string, mimeType?: string): Promise<MaterializedArtifact> {
  const base = gatewayHttpBase();
  const target = new URL(urlValue, base);
  if (target.origin !== base.origin) return { externalUrl: target.toString(), ...(mimeType ? { mimeType } : {}) };
  const token = getGatewaySharedHttpAuthToken();
  const response = await fetch(target, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new RuntimeOperationError('unavailable', `OpenClaw Artifact returned HTTP ${response.status}`);
  return {
    bytes: await responseBytes(response),
    mimeType: mimeType || response.headers.get('content-type') || undefined,
  };
}

async function workspaceRoot(agentId: string): Promise<string | null> {
  if (!gatewaySupports('agents.list')) return null;
  const result = await gatewayRpcCall('agents.list', {}, 15_000).catch(() => null) as {
    agents?: Array<{ id?: unknown; workspace?: unknown }>;
  } | null;
  const workspace = result?.agents?.find((agent) => agent.id === agentId)?.workspace;
  return typeof workspace === 'string' && path.isAbsolute(workspace) ? path.resolve(workspace) : null;
}

function decodeWorkspaceContent(result: unknown): MaterializedArtifact | null {
  const record = result && typeof result === 'object' ? result as Record<string, unknown> : null;
  const file = record?.file && typeof record.file === 'object' ? record.file as Record<string, unknown> : record;
  if (!file) return null;
  const content = typeof file.content === 'string' ? file.content : typeof file.data === 'string' ? file.data : null;
  if (content === null) return null;
  const encoding = typeof file.encoding === 'string' ? file.encoding.toLowerCase() : 'utf8';
  return {
    bytes: encoding === 'base64' ? Buffer.from(content, 'base64') : Buffer.from(content, 'utf8'),
    ...(typeof file.mimeType === 'string' ? { mimeType: file.mimeType } : {}),
  };
}

async function secureLocalPath(uri: string, agentId: string): Promise<string | null> {
  let candidate: string | null = null;
  try {
    if (uri.startsWith('file://')) candidate = fileURLToPath(uri);
    else if (path.isAbsolute(uri)) candidate = uri;
  } catch { return null; }
  if (!candidate) return null;
  const root = await workspaceRoot(agentId);
  const allowed = [...(root ? [root] : []), path.resolve(os.tmpdir())];
  const resolved = path.resolve(candidate);
  if (!allowed.some((entry) => isWithin(resolved, entry))) return null;
  const realPath = await fs.realpath(resolved).catch(() => null);
  if (!realPath) return null;
  const realRoots = await Promise.all(allowed.map((entry) => fs.realpath(entry).catch(() => entry)));
  if (!realRoots.some((entry) => isWithin(realPath, entry))) return null;
  const stat = await fs.stat(realPath).catch(() => null);
  if (!stat?.isFile()) return null;
  if (stat.size > MAX_BYTES) throw new RuntimeOperationError('rejected', 'Artifact exceeds the 25 MiB persistence limit');
  return realPath;
}

export async function materializeOpenClawArtifact(handle: RuntimeArtifactHandle): Promise<MaterializedArtifact> {
  assertRuntimeHandle(handle, 'openclaw');
  const { opaque } = handle;
  if (opaque.kind === 'native') {
    const query = opaque.runId
      ? { runId: opaque.runId, agentId: opaque.agentId }
      : { sessionKey: opaque.sessionKey, agentId: opaque.agentId };
    const result = await gatewayRpcCall('artifacts.download', {
      ...query,
      artifactId: opaque.artifactId,
    }, 30_000) as { artifact?: { mimeType?: string }; encoding?: unknown; data?: unknown; url?: unknown };
    const mimeType = result.artifact?.mimeType || opaque.mimeType;
    if (result.encoding === 'base64' && typeof result.data === 'string') {
      return { bytes: Buffer.from(result.data, 'base64'), ...(mimeType ? { mimeType } : {}) };
    }
    if (typeof result.url === 'string') return downloadUrl(result.url, mimeType);
    throw new RuntimeOperationError('internal', 'Gateway returned an unsupported Artifact download payload');
  }

  const uri = opaque.uri;
  if (!uri) throw new RuntimeOperationError('validation', 'OpenClaw Artifact handle is missing a source URI');
  if (/^https?:\/\//i.test(uri)) return { externalUrl: uri, ...(opaque.mimeType ? { mimeType: opaque.mimeType } : {}) };
  if (uri.startsWith('/api/chat/media/outgoing/')) {
    const match = uri.match(/^\/api\/chat\/media\/outgoing\/([^/]+)\//);
    let mediaSession = '';
    try { mediaSession = match ? decodeURIComponent(match[1]) : ''; } catch { /* invalid URI */ }
    if (opaque.sessionKey && mediaSession !== opaque.sessionKey) {
      throw new RuntimeOperationError('validation', 'Artifact media session does not match the Conversation');
    }
    return downloadUrl(uri, opaque.mimeType);
  }
  if (uri.startsWith('data:')) {
    const match = uri.match(/^data:([^;,]+)(?:;[^,]*)?;base64,(.+)$/s);
    if (!match) throw new RuntimeOperationError('validation', 'Unsupported Artifact data URI');
    const bytes = Buffer.from(match[2], 'base64');
    if (bytes.byteLength > MAX_BYTES) throw new RuntimeOperationError('rejected', 'Artifact exceeds the 25 MiB persistence limit');
    return { bytes, mimeType: opaque.mimeType || match[1] };
  }
  if (!path.isAbsolute(uri) && !uri.startsWith('file:') && !/^[a-z][a-z0-9+.-]*:/i.test(uri)) {
    if (!gatewaySupports('agents.workspace.get')) {
      throw new RuntimeOperationError('unsupported', 'Gateway does not provide agents.workspace.get for relative Artifact paths');
    }
    const decoded = decodeWorkspaceContent(await gatewayRpcCall('agents.workspace.get', {
      agentId: opaque.agentId,
      path: uri,
    }, 15_000));
    if (!decoded?.bytes) throw new RuntimeOperationError('internal', 'Gateway returned an unsupported workspace file payload');
    if (decoded.bytes.byteLength > MAX_BYTES) throw new RuntimeOperationError('rejected', 'Artifact exceeds the 25 MiB persistence limit');
    return { bytes: decoded.bytes, mimeType: opaque.mimeType || decoded.mimeType };
  }
  const localPath = await secureLocalPath(uri, opaque.agentId);
  if (!localPath) throw new RuntimeOperationError('validation', 'Artifact source is not an allowed OpenClaw local file');
  return { bytes: await fs.readFile(localPath), ...(opaque.mimeType ? { mimeType: opaque.mimeType } : {}) };
}
