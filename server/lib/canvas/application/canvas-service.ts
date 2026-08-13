import type { AgentRuntimeRegistry } from '../../agent-runtimes/registry.js';
import { listAgentCatalog } from '../../agent-runtimes/catalog.js';
import type { CanvasStore } from '../persistence/canvas-store.js';
import type { CanvasRecord } from '../model.js';
import { CanvasApplicationError } from './errors.js';

export class CanvasApplicationService {
  private readonly store: CanvasStore;
  private readonly runtimes: AgentRuntimeRegistry;
  private readonly deleteArtifacts: (ownerId: string, canvasId: string) => Promise<void>;

  constructor(
    store: CanvasStore,
    runtimes: AgentRuntimeRegistry,
    deleteArtifacts: (ownerId: string, canvasId: string) => Promise<void>,
  ) {
    this.store = store;
    this.runtimes = runtimes;
    this.deleteArtifacts = deleteArtifacts;
  }

  async agents(ownerId: string) {
    try {
      return await listAgentCatalog(this.runtimes, { ownerId });
    } catch (error) {
      throw new CanvasApplicationError(
        'agent_catalog_unavailable',
        502,
        'agent_catalog_unavailable',
        { cause: error },
      );
    }
  }

  async create(ownerId: string, name: string): Promise<CanvasRecord> {
    const catalog = await this.agents(ownerId);
    if (!catalog.firstAvailable) {
      throw new CanvasApplicationError('agent_catalog_unavailable', 503);
    }
    return this.store.createCanvas(ownerId, name, catalog.firstAvailable);
  }

  async update(ownerId: string, canvasId: string, input: {
    name?: string;
  }): Promise<CanvasRecord> {
    let canvas = this.store.getCanvas(ownerId, canvasId);
    if (!canvas) throw new CanvasApplicationError('not_found', 404, 'Not found');
    if (input.name) canvas = this.store.updateCanvas(ownerId, canvasId, input.name);
    if (!canvas) throw new CanvasApplicationError('not_found', 404, 'Not found');
    return canvas;
  }

  async remove(ownerId: string, canvasId: string): Promise<'completed' | 'pending'> {
    if (!this.store.getCanvas(ownerId, canvasId) || !this.store.deleteCanvas(ownerId, canvasId)) {
      throw new CanvasApplicationError('not_found', 404, 'Not found');
    }
    try {
      await this.deleteArtifacts(ownerId, canvasId);
      return 'completed';
    } catch {
      return 'pending';
    }
  }
}
