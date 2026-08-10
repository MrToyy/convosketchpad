import type { AgentRuntime } from '../../agent-runtimes/contract.js';
import type { CanvasStore } from '../persistence/canvas-store.js';
import { CanvasApplicationError } from './errors.js';
import { UpstreamResourceResolver } from './upstream-resource-resolver.js';
import { runtimeAcceptsMimeType } from '../domain/material-capability.js';

export class CanvasResourceService {
  private readonly store: CanvasStore;
  private readonly runtimeResolver: (runtimeId: string) => AgentRuntime;

  constructor(
    store: CanvasStore,
    runtimeResolver: (runtimeId: string) => AgentRuntime,
  ) {
    this.store = store;
    this.runtimeResolver = runtimeResolver;
  }

  async list(ownerId: string, branchId: string) {
    const branch = this.store.getOwnedBranch(ownerId, branchId);
    if (!branch) throw new CanvasApplicationError('not_found', 404, 'Not found');
    const canvas = this.store.getCanvas(ownerId, branch.canvasId);
    if (!canvas) throw new CanvasApplicationError('not_found', 404, 'Not found');
    const capabilities = await this.runtimeResolver(canvas.agentRef.runtimeId)
      .getCapabilities(canvas.agentRef);
    return new UpstreamResourceResolver(this.store).listResources(ownerId, branchId).map((item) => ({
      ...item,
      selectable: item.available && runtimeAcceptsMimeType(capabilities, item.mimeType),
      ...(!item.available
        ? { unavailableReason: 'resource_unavailable' }
        : !runtimeAcceptsMimeType(capabilities, item.mimeType)
          ? { unavailableReason: 'runtime_input_unsupported' }
          : {}),
    }));
  }
}
