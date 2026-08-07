import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { OwnedInteractionRecord } from './canvas/model.js';

let tempRoot = '';
let workspaceRoot = '';
let artifactsRoot = '';

function interaction(overrides: Partial<OwnedInteractionRecord> = {}): OwnedInteractionRecord {
  return {
    id: 'interaction-1',
    branchId: 'branch-1',
    parentInteractionId: null,
    runtimeTurnId: 'run-1',
    turnRef: { runtimeId: 'openclaw', schemaVersion: 1, opaque: { runId: 'run-1' } },
    userInput: 'create a file',
    agentOutput: '',
    status: 'completed',
    attachments: [],
    artifacts: [],
    approvals: [],
    executionMetadata: {},
    createdAt: 1,
    updatedAt: 1,
    ownerId: 'owner-1',
    canvasId: 'canvas-1',
    conversationId: 'agent:main:canvas:branch-1',
    runtimeId: 'openclaw',
    agentProfileId: 'main',
    conversationRef: {
      runtimeId: 'openclaw',
      schemaVersion: 1,
      opaque: { sessionKey: 'agent:main:canvas:branch-1' },
    },
    conversationInstanceId: null,
    observedConversationInstanceId: null,
    conversationIntegrity: 'unknown',
    ...overrides,
  };
}

async function loadStore(options: { workspaceGet?: boolean } = {}) {
  vi.resetModules();
  vi.doMock('./config.js', () => ({
    config: {
      canvasArtifactsPath: artifactsRoot,
      gatewayUrl: 'ws://127.0.0.1:18789',
      gatewayToken: 'test-token',
    },
  }));
  vi.doMock('./agent-runtimes/adapters/openclaw/gateway-rpc.js', () => ({
    acquireGatewayRpc: () => () => undefined,
    gatewaySupports: (method: string) =>
      method === 'agents.list' || (options.workspaceGet === true && method === 'agents.workspace.get'),
    gatewayRpcCall: async (method: string) => {
      if (method === 'agents.list') return { agents: [{ id: 'main', workspace: workspaceRoot }] };
      if (method === 'agents.workspace.get') {
        return { file: { content: 'cmVtb3RlLWZpbGU=', encoding: 'base64', mimeType: 'text/plain' } };
      }
      return {};
    },
    getGatewaySharedHttpAuthToken: () => 'test-token',
  }));
  const [store, { createOpenClawAgentRuntime }] = await Promise.all([
    import('./canvas-artifact-store.js'),
    import('./agent-runtimes/adapters/openclaw/index.js'),
  ]);
  const openClawAgentRuntime = createOpenClawAgentRuntime();
  return {
    ...store,
    materializeCanvasArtifacts: (
      interactionRecord: OwnedInteractionRecord,
      artifacts: Parameters<typeof store.materializeCanvasArtifacts>[1],
    ) => store.materializeCanvasArtifacts(interactionRecord, artifacts, () => openClawAgentRuntime),
  };
}

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'canvas-artifact-store-'));
  workspaceRoot = path.join(tempRoot, 'workspace');
  artifactsRoot = path.join(tempRoot, 'artifacts');
  await fs.mkdir(workspaceRoot, { recursive: true });
});

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  await fs.rm(tempRoot, { recursive: true, force: true });
});

describe('Canvas Artifact Store', () => {
  it('persists user attachments directly in Canvas-owned storage', async () => {
    const store = await loadStore();

    const attachment = await store.persistCanvasAttachment('owner-1', 'canvas-1', {
      name: 'source.png',
      mimeType: 'image/png',
      bytes: Buffer.from('uploaded-image'),
    });

    expect(attachment).toEqual(expect.objectContaining({
      storage: 'canvas',
      available: true,
      uri: expect.stringMatching(/^\/api\/canvas\/attachments\/canvas-1\/[a-f0-9]{40}$/),
    }));
    const bytes = await store.readCanvasAttachment('owner-1', 'canvas-1', attachment.id!);
    expect(Buffer.from(bytes!).toString()).toBe('uploaded-image');
  });

  it('persists Workspace files and reuses the same stable artifact', async () => {
    const source = path.join(workspaceRoot, 'reports', 'result.txt');
    await fs.mkdir(path.dirname(source), { recursive: true });
    await fs.writeFile(source, 'durable result');
    const store = await loadStore();
    const current = interaction();

    const first = await store.materializeCanvasArtifacts(current, [{ name: 'result.txt', mimeType: 'text/plain', uri: source }]);
    expect(first.complete).toBe(true);
    expect(first.artifacts[0]).toEqual(expect.objectContaining({ storage: 'canvas', available: true, sourceUri: source }));

    const persisted = await store.readCanvasArtifact({ ...current, artifacts: first.artifacts }, first.artifacts[0].id!);
    expect(Buffer.from(persisted!.bytes).toString()).toBe('durable result');

    await fs.rm(source);
    const second = await store.materializeCanvasArtifacts(current, [{ name: 'renamed.txt', mimeType: 'text/plain', uri: source }]);
    expect(second.artifacts[0].id).toBe(first.artifacts[0].id);
    expect(second.artifacts[0].name).toBe('renamed.txt');
    expect(second.complete).toBe(true);
  });

  it('reads relative legacy paths through agents.workspace.get when advertised', async () => {
    const store = await loadStore({ workspaceGet: true });
    const result = await store.materializeCanvasArtifacts(
      interaction(),
      [{ name: 'remote.txt', mimeType: 'text/plain', uri: 'reports/remote.txt' }],
    );

    expect(result.complete).toBe(true);
    const persisted = await store.readCanvasArtifact(
      { ...interaction(), artifacts: result.artifacts },
      result.artifacts[0].id!,
    );
    expect(Buffer.from(persisted!.bytes).toString()).toBe('remote-file');
  });

  it('persists OpenClaw media through the authenticated Gateway endpoint', async () => {
    const store = await loadStore();
    const uri = '/api/chat/media/outgoing/agent%3Amain%3Acanvas%3Abranch-1/00000000-0000-4000-8000-000000000000/full';
    const fetchMock = vi.fn(async (_url: URL, init?: RequestInit) => {
      expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer test-token');
      return new Response('image-bytes', { status: 200, headers: { 'Content-Type': 'image/png' } });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await store.materializeCanvasArtifacts(interaction(), [{ name: 'result.png', uri }]);
    expect(result.complete).toBe(true);
    expect(result.artifacts[0]).toEqual(expect.objectContaining({ storage: 'canvas', mimeType: 'image/png', sizeBytes: 11 }));
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('decodes data URIs but leaves external links as references', async () => {
    const store = await loadStore();
    const result = await store.materializeCanvasArtifacts(interaction(), [
      { name: 'inline.txt', uri: 'data:text/plain;base64,aGVsbG8=' },
      { name: 'remote.pdf', uri: 'https://example.com/report.pdf', mimeType: 'application/pdf' },
    ]);

    expect(result.complete).toBe(true);
    expect(result.artifacts.map((artifact) => artifact.storage)).toEqual(['canvas', 'external']);
    expect(result.artifacts[1].uri).toBe('https://example.com/report.pdf');
  });

  it('keeps a warning when a local Artifact cannot be persisted', async () => {
    const store = await loadStore();
    const missing = path.join(workspaceRoot, 'missing.txt');
    const result = await store.materializeCanvasArtifacts(interaction(), [{ name: 'missing.txt', uri: missing }]);

    expect(result.complete).toBe(false);
    expect(result.artifacts[0]).toEqual(expect.objectContaining({ storage: 'source', available: false }));
    expect(result.warnings[0]).toContain('missing.txt');
  });

  it('rejects a symlink that escapes a workspace returned by the Gateway', async () => {
    const link = path.join(workspaceRoot, 'escaped.txt');
    await fs.symlink('/etc/hosts', link);
    const store = await loadStore();

    const result = await store.materializeCanvasArtifacts(
      interaction(),
      [{ name: 'escaped.txt', uri: link }],
    );

    expect(result.complete).toBe(false);
    expect(result.artifacts[0]).toEqual(expect.objectContaining({
      storage: 'source',
      available: false,
    }));
  });

  it('refuses to persist files larger than 25 MiB', async () => {
    const source = path.join(workspaceRoot, 'too-large.bin');
    const store = await loadStore();
    await fs.writeFile(source, 'x');
    await fs.truncate(source, store.CANVAS_ARTIFACT_MAX_BYTES + 1);

    const result = await store.materializeCanvasArtifacts(interaction(), [{ name: 'too-large.bin', uri: source }]);
    expect(result.complete).toBe(false);
    expect(result.artifacts[0].warning).toContain('25 MiB');
  });

  it('deletes only the selected Canvas directory', async () => {
    const store = await loadStore();
    const first = interaction();
    const second = interaction({ id: 'interaction-2', canvasId: 'canvas-2' });
    await store.materializeCanvasArtifacts(first, [{ name: 'one.txt', uri: 'data:text/plain;base64,b25l' }]);
    const secondResult = await store.materializeCanvasArtifacts(second, [{ name: 'two.txt', uri: 'data:text/plain;base64,dHdv' }]);

    await store.deleteCanvasArtifacts(first.ownerId, first.canvasId);
    expect(await store.readCanvasArtifact({ ...second, artifacts: secondResult.artifacts }, secondResult.artifacts[0].id!)).not.toBeNull();
  });
});
