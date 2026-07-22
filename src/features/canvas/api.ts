import type {
  CanvasArtifact,
  CanvasAttachmentMeta,
  CanvasBranch,
  CanvasGraph,
  CanvasLayout,
  CanvasSummary,
  SendReservation,
} from './types';

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    credentials: 'include',
    ...init,
    headers: init?.body instanceof FormData
      ? init.headers
      : { 'Content-Type': 'application/json', ...init?.headers },
  });
  const data = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(data.error || `画布请求失败（${response.status}）`);
  return data;
}

export const canvasApi = {
  async list(): Promise<CanvasSummary[]> {
    return (await request<{ canvases: CanvasSummary[] }>('/api/canvas/canvases')).canvases;
  },
  async create(name: string, agentId: string): Promise<CanvasSummary> {
    return (await request<{ canvas: CanvasSummary }>('/api/canvas/canvases', {
      method: 'POST', body: JSON.stringify({ name, agentId }),
    })).canvas;
  },
  async update(id: string, name: string): Promise<CanvasSummary> {
    return (await request<{ canvas: CanvasSummary }>(`/api/canvas/canvases/${id}`, {
      method: 'PATCH', body: JSON.stringify({ name }),
    })).canvas;
  },
  async remove(id: string): Promise<void> {
    await request(`/api/canvas/canvases/${id}`, { method: 'DELETE' });
  },
  async graph(id: string): Promise<CanvasGraph> {
    return request<CanvasGraph>(`/api/canvas/canvases/${id}/graph`);
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
  async prepareSend(branchId: string, body: {
    expectedHeadInteractionId?: string | null;
    userInput: string;
    attachments: CanvasAttachmentMeta[];
  }): Promise<SendReservation> {
    return (await request<{ reservation: SendReservation }>(`/api/canvas/branches/${branchId}/prepare-send`, {
      method: 'POST', body: JSON.stringify(body),
    })).reservation;
  },
  async acknowledge(reservationId: string, runId?: string, bootstrapWarnings: string[] = []): Promise<{ id: string }> {
    return (await request<{ interaction: { id: string } }>(`/api/canvas/send-reservations/${reservationId}/ack`, {
      method: 'POST', body: JSON.stringify({ runId: runId || null, bootstrapWarnings }),
    })).interaction;
  },
  async failReservation(reservationId: string, error: string): Promise<void> {
    await request(`/api/canvas/send-reservations/${reservationId}/fail`, {
      method: 'POST', body: JSON.stringify({ error }),
    });
  },
  async complete(interactionId: string, body: {
    status: 'completed' | 'failed';
    agentOutput: string;
    artifacts: CanvasArtifact[];
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    await request(`/api/canvas/interactions/${interactionId}/complete`, {
      method: 'POST', body: JSON.stringify(body),
    });
  },
  async reconcile(interactionId: string, body: {
    terminalHint?: boolean;
    failureHint?: string;
    runId?: string;
    force?: boolean;
  } = {}): Promise<void> {
    await request(`/api/canvas/interactions/${interactionId}/reconcile`, {
      method: 'POST', body: JSON.stringify(body),
    });
  },
};

export function canvasArtifactUrl(uri: string): string {
  return uri.startsWith('/api/chat/media/')
    ? `/api/canvas/openclaw-artifact?uri=${encodeURIComponent(uri)}`
    : uri;
}

export interface StagedUpload {
  kind: 'direct_workspace_reference' | 'imported_workspace_reference';
  canonicalPath: string;
  absolutePath: string;
  uri: string;
  mimeType: string;
  sizeBytes: number;
  originalName: string;
}

export async function stageCanvasFiles(files: File[], agentId: string, canvasId: string): Promise<StagedUpload[]> {
  const form = new FormData();
  form.append('agentId', agentId);
  form.append('purpose', 'canvas');
  form.append('canvasId', canvasId);
  files.forEach((file) => form.append('files', file));
  const result = await request<{ items: StagedUpload[] }>('/api/upload-reference/resolve', { method: 'POST', body: form });
  return result.items;
}
