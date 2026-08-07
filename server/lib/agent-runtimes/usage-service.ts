import type { AgentRuntimeRegistry } from './registry.js';

export class RuntimeUsageService {
  private readonly registry: Pick<AgentRuntimeRegistry, 'list'>;

  constructor(registry: Pick<AgentRuntimeRegistry, 'list'>) {
    this.registry = registry;
  }

  async read() {
    const entries = await Promise.all(this.registry.list().map(async (runtime) => {
      const status = runtime.getStatus();
      let displayName = runtime.id;
      try { displayName = (await runtime.describe()).displayName; } catch { /* keep stable id */ }
      if (status.state !== 'connected') {
        return {
          runtimeId: runtime.id,
          displayName,
          available: false as const,
          usageSupported: status.capabilities?.usage.accountUsage ?? null,
          error: status.error || 'Runtime unavailable',
        };
      }
      const capabilities = status.capabilities;
      if (!capabilities) {
        return {
          runtimeId: runtime.id,
          displayName,
          available: true as const,
          usageSupported: null,
          error: 'Runtime capabilities are not available yet',
        };
      }
      const [usage, quotas] = await Promise.all([
        capabilities.usage.accountUsage
          ? runtime.readUsageSummary().then((value) => ({ value })).catch((error) => ({ error }))
          : Promise.resolve(null),
        capabilities.usage.accountQuota
          ? runtime.readProviderQuotas().then((value) => ({ value })).catch((error) => ({ error }))
          : Promise.resolve(null),
      ]);
      const errors = [usage && 'error' in usage ? usage.error : null, quotas && 'error' in quotas ? quotas.error : null]
        .filter(Boolean)
        .map((error) => error instanceof Error ? error.message : String(error));
      return {
        runtimeId: runtime.id,
        displayName,
        available: true as const,
        usageSupported: capabilities.usage.accountUsage,
        ...(usage && 'value' in usage ? { usage: usage.value } : {}),
        ...(quotas && 'value' in quotas ? { quotas: quotas.value } : {}),
        ...(errors.length ? { error: errors.join('; ') } : {}),
      };
    }));
    const additive = entries.flatMap((entry) => entry.available && 'usage' in entry && entry.usage?.additive
      ? [entry.usage]
      : []);
    const usageRuntimes = entries.filter((entry) => entry.usageSupported !== false);
    const currencies = new Set(additive.map((usage) => usage.currency).filter(Boolean));
    const periods = new Set(additive.map((usage) => usage.period).filter(Boolean));
    const comparable = additive.length > 0
      && entries.every((entry) => entry.available)
      && additive.length === usageRuntimes.length
      && currencies.size === 1
      && periods.size === 1;
    return {
      runtimes: entries,
      ...(comparable ? {
        comparableCostTotal: {
          currency: [...currencies][0],
          amount: additive.reduce((sum, usage) => sum + usage.totalCost, 0),
        },
      } : {}),
      updatedAt: Date.now(),
    };
  }
}
