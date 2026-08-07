export interface RuntimeTokenUsage {
  totalCost: number;
  totalInput: number;
  totalOutput: number;
  totalCacheRead: number;
  updatedAt: number;
  source: string;
  currency?: string;
  period?: 'all-time' | 'billing-cycle' | 'rolling' | 'unknown';
  additive?: boolean;
}

export interface ProviderLimitWindow {
  label: string;
  usedPercent: number;
  resetAt: number | null;
}

export interface ProviderLimit {
  provider: string;
  displayName: string;
  plan: string | null;
  windows: ProviderLimitWindow[];
}

export interface RuntimeUsageEntry {
  runtimeId: string;
  displayName: string;
  available: boolean;
  usageSupported?: boolean | null;
  usage?: RuntimeTokenUsage;
  quotas?: { available: boolean; providers: ProviderLimit[] };
  error?: string;
}

export interface RuntimeUsageData {
  runtimes: RuntimeUsageEntry[];
  comparableCostTotal?: { currency: string; amount: number };
  updatedAt: number;
}
