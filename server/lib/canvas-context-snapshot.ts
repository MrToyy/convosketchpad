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

function projectSnapshot(
  row: GatewaySessionContextRow | null | undefined,
  sessionKey: string,
  expectedSessionId: string | undefined,
  capturedAt: number,
): InteractionContextSnapshot | null {
  const rowKey = row?.sessionKey || row?.key;
  const rowSessionId = row?.sessionId || row?.id;
  if (
    !row
    || rowKey !== sessionKey
    || typeof rowSessionId !== 'string'
    || !rowSessionId
    || (expectedSessionId !== undefined && rowSessionId !== expectedSessionId)
    || row.totalTokensFresh !== true
    || typeof row.totalTokens !== 'number'
    || !Number.isFinite(row.totalTokens)
    || row.totalTokens < 0
    || typeof row.contextTokens !== 'number'
    || !Number.isFinite(row.contextTokens)
    || row.contextTokens <= 0
  ) {
    return null;
  }
  return {
    usedTokens: row.totalTokens,
    contextLimit: row.contextTokens,
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
  };
}

export async function captureInteractionContextSnapshot(
  sessionKey: string,
  expectedSessionId?: string,
  gateway: ContextSnapshotGateway = defaultGateway,
  capturedAt = Date.now(),
): Promise<InteractionContextSnapshot | null> {
  if (gateway.supports('sessions.describe')) {
    const response = await gateway.call('sessions.describe', { key: sessionKey }, 3_000) as {
      session?: GatewaySessionContextRow | null;
    };
    return projectSnapshot(response.session, sessionKey, expectedSessionId, capturedAt);
  }

  const response = await gateway.call('sessions.list', {
    search: sessionKey,
    limit: 20,
  }, 3_000) as { sessions?: GatewaySessionContextRow[] };
  const session = response.sessions?.find(
    (candidate) => (candidate.sessionKey || candidate.key) === sessionKey,
  );
  return projectSnapshot(session, sessionKey, expectedSessionId, capturedAt);
}
