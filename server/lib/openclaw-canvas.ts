import {
  gatewayDispatchCall,
  gatewayRpcCall,
  gatewaySupports,
  getGatewayRuntimeStatus,
  type GatewayRuntimeStatus,
} from './gateway-rpc.js';
import {
  getCanvasSessionResetPolicy,
  type OpenClawResetPolicy,
} from './openclaw-session-policy.js';

const SESSION_LIST_LIMIT = 1_000;

export interface OpenClawCanvasAgent {
  id?: string;
  name?: string;
  identity?: { name?: string; emoji?: string };
}

export interface OpenClawCanvasAgentCatalog {
  defaultId?: string;
  agents: OpenClawCanvasAgent[];
  ids: Set<string>;
}

interface OpenClawSessionSummary {
  key?: string;
  sessionKey?: string;
  id?: string;
  sessionId?: string;
}

export interface OpenClawSessionInspection {
  listed: boolean;
  sessionId: string | null;
}

export interface OpenClawCanvasPort {
  listAgents(): Promise<OpenClawCanvasAgentCatalog>;
  inspectSession(sessionKey: string): Promise<OpenClawSessionInspection>;
  getResetPolicy(): Promise<{ policy: OpenClawResetPolicy | null; available: boolean }>;
  send(
    params: Record<string, unknown>,
    timeoutMs?: number,
  ): Promise<{ runId?: unknown }>;
  supports(method: string): boolean;
  runtimeStatus(): GatewayRuntimeStatus;
}

export const openClawCanvas: OpenClawCanvasPort = {
  async listAgents() {
    const response = await gatewayRpcCall('agents.list', {}, 15_000) as {
      defaultId?: string;
      agents?: OpenClawCanvasAgent[];
    };
    const agents = Array.isArray(response.agents) ? response.agents : [];
    const ids = new Set(agents.flatMap((agent) =>
      typeof agent.id === 'string' && agent.id.trim() ? [agent.id.trim()] : []));
    const defaultId = typeof response.defaultId === 'string' ? response.defaultId.trim() : '';
    return {
      ...(defaultId ? { defaultId } : {}),
      agents,
      ids,
    };
  },

  async inspectSession(sessionKey) {
    const response = await gatewayRpcCall('sessions.list', {
      limit: SESSION_LIST_LIMIT,
    }, 15_000) as { sessions?: OpenClawSessionSummary[] };
    if (!Array.isArray(response.sessions)) return { listed: false, sessionId: null };
    const session = response.sessions.find(
      (candidate) => (candidate.sessionKey || candidate.key) === sessionKey,
    );
    return {
      listed: true,
      sessionId: session?.sessionId || session?.id || null,
    };
  },

  getResetPolicy() {
    return getCanvasSessionResetPolicy();
  },

  send(params, timeoutMs = 30_000) {
    return gatewayDispatchCall('chat.send', params, timeoutMs) as Promise<{ runId?: unknown }>;
  },

  supports(method) {
    return gatewaySupports(method);
  },
  runtimeStatus() {
    return getGatewayRuntimeStatus();
  },
};
