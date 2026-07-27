/** Aggregated token usage and cost data from the gateway. */
export interface TokenData {
  entries?: TokenEntry[];
  totalCost?: number;
  totalInput?: number;
  totalOutput?: number;
  totalCacheRead?: number;
  totalMessages?: number;
  totalErrors?: number;
  breakdownAvailable?: boolean;
  updatedAt?: number;
}

/** Per-source breakdown of token usage and cost. */
export interface TokenEntry {
  source: string;
  cost: number;
  messageCount?: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
}
