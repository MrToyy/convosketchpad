/**
 * Shared types for the ConvoSketchpad updater.
 */

// ── Exit codes ───────────────────────────────────────────────────────

export const EXIT_CODES = {
  SUCCESS: 0,
  UP_TO_DATE: 1,
  PREFLIGHT: 10,
  VERSION_RESOLUTION: 20,
  BUILD: 40,
  MIGRATION: 45,
  RESTART: 50,
  HEALTH: 60,
  ROLLBACK: 70,
  LOCK: 80,
} as const;

export type ExitCode = (typeof EXIT_CODES)[keyof typeof EXIT_CODES];

// ── CLI options ──────────────────────────────────────────────────────

export interface UpdateOptions {
  version?: string;
  yes: boolean;
  dryRun: boolean;
  verbose: boolean;
  rollback: boolean;
  resume: boolean;
  status: boolean;
  noRestart: boolean;
  leaveStopped: boolean;
  cwd: string;
}

// ── Snapshot ─────────────────────────────────────────────────────────

export interface Snapshot {
  kind: 'full' | 'partial';
  ref: string;
  version: string;
  timestamp: number;
  envHash: string;
  environmentExisted?: boolean;
  environmentBackupPath?: string;
  databaseExisted?: boolean;
  databaseBackupPath?: string;
  databaseBackupSize?: number;
  databaseBackupSha256?: string;
  databaseIntegrityVerified?: boolean;
  databaseSchemaEpoch?: number;
  minimumReadableDatabaseSchemaEpoch?: number;
  maximumReadableDatabaseSchemaEpoch?: number;
  snapshotDir?: string;
}

// ── Version resolution ───────────────────────────────────────────────

export interface ResolvedVersion {
  tag: string;
  version: string;
  current: string;
  isUpToDate: boolean;
  source: 'release' | 'explicit';
}

// ── Preflight ────────────────────────────────────────────────────────

export interface PreflightResult {
  gitVersion: string;
  nodeVersion: string;
  npmVersion: string;
  isGitRepo: boolean;
  hasWritePermission: boolean;
  isClean: boolean;
}

// ── Health ───────────────────────────────────────────────────────────

export interface HealthResult {
  healthy: boolean;
  versionMatch: boolean;
  reportedVersion?: string;
  error?: string;
}

// ── Service management ───────────────────────────────────────────────

export interface ServiceManager {
  readonly name: string;
  detect(cwd: string): boolean;
  stop(): Promise<void>;
  restart(): Promise<void>;
  status(): Promise<ServiceState>;
  getLogs(lines: number): Promise<string>;
}

export type ServiceState = 'active' | 'inactive' | 'transitioning' | 'unknown';

export type UpdateTransactionPhase =
  | 'resolved'
  | 'service-inspected'
  | 'service-quiesced'
  | 'snapshot-created'
  | 'release-checked-out'
  | 'built'
  | 'environment-migrated'
  | 'database-migrated'
  | 'service-finalized'
  | 'health-verified';

export interface UpdateTransaction {
  schemaVersion: 1;
  id: string;
  pid: number;
  startedAt: number;
  updatedAt: number;
  status: 'in-progress' | 'failed' | 'committed' | 'recovered';
  phase: UpdateTransactionPhase;
  fromVersion: string;
  toVersion: string;
  targetTag: string;
  noRestart: boolean;
  leaveStopped: boolean;
  serviceManagerName?: string;
  serviceWasActive?: boolean;
  databaseConfirmedOffline: boolean;
  snapshot?: Snapshot;
  error?: string;
}

// ── Update result ────────────────────────────────────────────────────

export type UpdateStage =
  | 'lock'
  | 'preflight'
  | 'resolve'
  | 'confirm'
  | 'snapshot'
  | 'update'
  | 'build'
  | 'migrate'
  | 'restart'
  | 'health'
  | 'commit'
  | 'rollback'
  | 'unlock';

export interface UpdateResult {
  success: boolean;
  exitCode: ExitCode;
  stage: UpdateStage;
  fromVersion: string;
  toVersion: string;
  rolledBack: boolean;
  error?: string;
}

// ── Reporter interface ───────────────────────────────────────────────

export interface Reporter {
  stage(name: string, current: number, total: number): void;
  ok(msg: string): void;
  warn(msg: string): void;
  fail(msg: string): void;
  info(msg: string): void;
  dry(msg: string): void;
  verbose(msg: string): void;
  hint(msg: string): void;
  cmd(msg: string): void;
  confirm(msg: string): Promise<boolean>;
  done(fromVersion: string, toVersion: string): void;
  summary(result: UpdateResult): void;
}

// ── Custom errors ────────────────────────────────────────────────────

export class UpdateError extends Error {
  readonly stage: UpdateStage;
  readonly exitCode: ExitCode;

  constructor(message: string, stage: UpdateStage, exitCode: ExitCode) {
    super(message);
    this.name = 'UpdateError';
    this.stage = stage;
    this.exitCode = exitCode;
  }
}
