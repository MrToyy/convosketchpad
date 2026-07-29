import {
  gatewayRpcCall,
  gatewaySupports,
} from './gateway-rpc.js';
import type { InteractionContextSnapshot } from './canvas-db.js';

interface GatewaySessionContextRow {
  key?: string;
  sessionKey?: string;
  id?: string;
  sessionId?: string;
  totalTokens?: number;
  totalTokensFresh?: boolean;
  contextTokens?: number;
  model?: string;
  modelProvider?: string;
  provider?: string;
  compactionCount?: number;
}

interface ContextSnapshotGateway {
  call: typeof gatewayRpcCall;
  supports: typeof gatewaySupports;
}

const defaultGateway: ContextSnapshotGateway = {
  call: gatewayRpcCall,
  supports: gatewaySupports,
};

export interface InteractionCompletionSession {
  sessionId: string;
  contextSnapshot: InteractionContextSnapshot | null;
}

function projectCompletionSession(
  row: GatewaySessionContextRow | null | undefined,
  sessionKey: string,
  expectedSessionId: string | undefined,
  capturedAt: number,
): InteractionCompletionSession | null {
  const rowKey = row?.sessionKey || row?.key;
  const rowSessionId = row?.sessionId || row?.id;
  if (
    !row
    || rowKey !== sessionKey
    || typeof rowSessionId !== 'string'
    || !rowSessionId
    || (expectedSessionId !== undefined && rowSessionId !== expectedSessionId)
  ) {
    return null;
  }
  const hasFreshContext = row.totalTokensFresh === true
    && typeof row.totalTokens === 'number'
    && Number.isFinite(row.totalTokens)
    && row.totalTokens >= 0
    && typeof row.contextTokens === 'number'
    && Number.isFinite(row.contextTokens)
    && row.contextTokens > 0;
  const contextSnapshot: InteractionContextSnapshot | null = hasFreshContext ? {
    usedTokens: row.totalTokens as number,
    contextLimit: row.contextTokens as number,
    sessionKey,
    sessionId: rowSessionId,
    ...(typeof row.model === 'string' && row.model ? { model: row.model } : {}),
    ...(typeof (row.modelProvider || row.provider) === 'string'
      ? { provider: (row.modelProvider || row.provider)! }
      : {}),
    ...(typeof row.compactionCount === 'number' && Number.isFinite(row.compactionCount)
      ? { compactionCount: row.compactionCount }
      : {}),
    capturedAt,
    source: 'openclaw-session',
  } : null;
  return {
    sessionId: rowSessionId,
    contextSnapshot,
  };
}

export async function captureInteractionCompletionSession(
  sessionKey: string,
  expectedSessionId?: string,
  gateway: ContextSnapshotGateway = defaultGateway,
  capturedAt = Date.now(),
): Promise<InteractionCompletionSession | null> {
  if (gateway.supports('sessions.describe')) {
    const response = await gateway.call('sessions.describe', { key: sessionKey }, 3_000) as {
      session?: GatewaySessionContextRow | null;
    };
    return projectCompletionSession(response.session, sessionKey, expectedSessionId, capturedAt);
  }

  const response = await gateway.call('sessions.list', {
    search: sessionKey,
    limit: 20,
  }, 3_000) as { sessions?: GatewaySessionContextRow[] };
  const session = response.sessions?.find(
    (candidate) => (candidate.sessionKey || candidate.key) === sessionKey,
  );
  return projectCompletionSession(session, sessionKey, expectedSessionId, capturedAt);
}

export async function captureInteractionContextSnapshot(
  sessionKey: string,
  expectedSessionId?: string,
  gateway: ContextSnapshotGateway = defaultGateway,
  capturedAt = Date.now(),
): Promise<InteractionContextSnapshot | null> {
  return (await captureInteractionCompletionSession(
    sessionKey,
    expectedSessionId,
    gateway,
    capturedAt,
  ))?.contextSnapshot || null;
}
