/** Aggregated token usage and cost data from the gateway. */
export interface TokenData {
  totalCost: number;
  totalInput: number;
  totalOutput: number;
  totalCacheRead: number;
  updatedAt: number;
  source: 'openclaw-gateway';
}
