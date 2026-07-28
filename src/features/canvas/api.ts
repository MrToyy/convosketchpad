import type {
  CanvasBranch,
  CanvasGraph,
  CanvasInteraction,
  CanvasLayout,
  CanvasSummary,
  SendReservation,
} from './types';

export class CanvasApiError extends Error {
  readonly status: number;
  readonly retryAfterMs: number | null;

  constructor(message: string, status: number, retryAfterMs: number | null = null) {
    super(message);
    this.name = 'CanvasApiError';
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

function retryAfterMs(response: Response): number | null {
  const value = response.headers.get('Retry-After')?.trim();
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    credentials: 'include',
    ...init,
    headers: init?.body instanceof FormData
      ? init.headers
      : { 'Content-Type': 'application/json', ...init?.headers },
  });
  const data = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) {
    throw new CanvasApiError(
      data.error || `画布请求失败（${response.status}）`,
      response.status,
      retryAfterMs(response),
    );
  }
  return data;
}

export const canvasApi = {
  async list(): Promise<CanvasSummary[]> {
    return (await request<{ canvases: CanvasSummary[] }>('/api/canvas/canvases')).canvases;
  },
  async create(name: string): Promise<CanvasSummary> {
    return (await request<{ canvas: CanvasSummary }>('/api/canvas/canvases', {
      method: 'POST', body: JSON.stringify({ name }),
    })).canvas;
  },
  async update(id: string, name: string): Promise<CanvasSummary> {
    return (await request<{ canvas: CanvasSummary }>(`/api/canvas/canvases/${id}`, {
      method: 'PATCH', body: JSON.stringify({ name }),
    })).canvas;
  },
  async updateAgent(id: string, agentId: string): Promise<CanvasSummary> {
    return (await request<{ canvas: CanvasSummary }>(`/api/canvas/canvases/${id}`, {
      method: 'PATCH', body: JSON.stringify({ agentId }),
    })).canvas;
  },
  async remove(id: string): Promise<void> {
    await request(`/api/canvas/canvases/${id}`, { method: 'DELETE' });
  },
  async graph(id: string): Promise<CanvasGraph> {
    return request<CanvasGraph>(`/api/canvas/canvases/${id}/graph`);
  },
  async agents(): Promise<{ agents?: Array<{ id: string; name?: string; identity?: { name?: string; emoji?: string } }> }> {
    return request('/api/canvas/agents');
  },
  async createRoot(canvasId: string): Promise<CanvasBranch> {
    return (await request<{ branch: CanvasBranch }>(`/api/canvas/canvases/${canvasId}/root-branches`, { method: 'POST' })).branch;
  },
  async fork(interactionId: string): Promise<CanvasBranch> {
    return (await request<{ branch: CanvasBranch }>(`/api/canvas/interactions/${interactionId}/fork`, { method: 'POST' })).branch;
  },
  async saveLayout(canvasId: string, layout: CanvasLayout): Promise<void> {
    await request(`/api/canvas/canvases/${canvasId}/layout`, { method: 'PUT', body: JSON.stringify(layout) });
  },
  async send(branchId: string, body: {
    expectedHeadInteractionId?: string | null;
    expectedAgentId: string;
    userInput: string;
    attachmentIds: string[];
  }): Promise<{ interaction?: CanvasInteraction; operation?: SendReservation }> {
    return request(`/api/canvas/branches/${branchId}/send`, {
      method: 'POST', body: JSON.stringify(body),
    });
  },
  async sendOperation(id: string): Promise<SendReservation> {
    return (await request<{ operation: SendReservation }>(
      `/api/canvas/send-operations/${encodeURIComponent(id)}`,
    )).operation;
  },
};

export function canvasArtifactUrl(uri: string): string {
  return uri;
}

export interface PersistedCanvasAttachment {
  id: string;
  name: string;
  uri: string;
  mimeType: string;
  sizeBytes: number;
  storage: 'canvas';
  available: true;
}

export async function persistCanvasFiles(files: File[], canvasId: string): Promise<PersistedCanvasAttachment[]> {
  const form = new FormData();
  files.forEach((file) => form.append('files', file));
  const result = await request<{ items: PersistedCanvasAttachment[] }>(
    `/api/canvas/canvases/${encodeURIComponent(canvasId)}/attachments`,
    { method: 'POST', body: form },
  );
  return result.items;
}
