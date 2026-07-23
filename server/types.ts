/**
 * Shared types for the ConvoSketchpad server.
 *
 * Centralised type definitions used across routes, services, and lib modules.
 * @module
 */

/** A single entry in the agent activity log (persisted to agent-log.json). */
export interface AgentLogEntry {
  /** Epoch ms timestamp of the log entry. */
  ts: number;
  /** Arbitrary additional fields. */
  [key: string]: unknown;
}
