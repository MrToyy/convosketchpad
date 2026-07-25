import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { config } from './config.js';

export type BranchKind = 'root' | 'fork';
export type BranchSessionState = 'draft' | 'active';
export type InteractionStatus = 'streaming' | 'completed' | 'failed';
export type SendMaterialization = 'lazy-root' | 'continue-existing' | 'checkpoint-delta' | 'canonical-replay' | 'session-recovery';
export type BranchSessionIntegrity = 'unknown' | 'healthy' | 'drifted';
export type CanvasUserStatus = 'active' | 'disabled' | 'unmanaged';

export interface CanvasUserRecord {
  id: string;
  displayName: string;
  tokenHash: string | null;
  tokenVersion: number;
  status: CanvasUserStatus;
  canvasCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface CanvasRecord {
  id: string;
  name: string;
  agentId: string;
  createdAt: number;
  updatedAt: number;
}

export interface BranchRecord {
  id: string;
  canvasId: string;
  kind: BranchKind;
  parentBranchId: string | null;
  forkedFromInteractionId: string | null;
  sessionKey: string;
  openClawSessionId: string | null;
  observedSessionId: string | null;
  sessionIntegrity: BranchSessionIntegrity;
  sessionState: BranchSessionState;
  headInteractionId: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface InteractionRecord {
  id: string;
  branchId: string;
  parentInteractionId: string | null;
  runId: string | null;
  userInput: string;
  agentOutput: string;
  status: InteractionStatus;
  attachments: CanvasAttachment[];
  artifacts: CanvasArtifact[];
  sessionMetadata: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

export interface OwnedInteractionRecord extends InteractionRecord {
  ownerId: string;
  canvasId: string;
  sessionKey: string;
  agentId: string;
  openClawSessionId: string | null;
  observedSessionId: string | null;
  sessionIntegrity: BranchSessionIntegrity;
}

export interface CanvasAttachment {
  id?: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  uri?: string;
  sourceUri?: string;
  storage?: 'canvas' | 'source';
  available?: boolean;
  warning?: string;
}

export interface CanvasArtifact {
  id?: string;
  gatewayArtifactId?: string;
  name: string;
  mimeType?: string;
  sizeBytes?: number;
  uri: string;
  sourceUri?: string;
  storage?: 'canvas' | 'external' | 'source';
  available?: boolean;
  warning?: string;
}

export interface CanvasContextResource {
  id: string;
  sourceInteractionId: string;
  source: 'user_attachment' | 'agent_artifact';
  name: string;
  mimeType: string;
  sizeBytes?: number;
  uri: string;
  available: boolean;
  warning?: string;
}

interface CanonicalSnapshot {
  version: 2;
  interactions: Array<{ id: string; user: string; assistant: string }>;
  resources: CanvasContextResource[];
}

export interface CanvasGraph {
  canvas: CanvasRecord;
  branches: BranchRecord[];
  interactions: InteractionRecord[];
  layout: { nodes: Record<string, { x: number; y: number }>; viewport?: { x: number; y: number; zoom: number } } | null;
}

export interface SendReservation {
  id: string;
  branchId: string;
  expectedHeadInteractionId: string | null;
  userInput: string;
  attachments: CanvasAttachment[];
  materialization: SendMaterialization;
  sessionKey: string;
  outgoingMessage: string;
  snapshotVersion?: number;
  bootstrapResources: Array<CanvasContextResource & { fetchUrl: string }>;
  status: 'prepared' | 'acknowledged' | 'failed';
  interactionId: string | null;
}

export interface BranchSessionLifecycle {
  sessionStartedAt: number | null;
  observedSessionStartedAt: number | null;
  lastInteractionAt: number | null;
}

type SqlRow = Record<string, unknown>;

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asNullableString(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

function asNumber(value: unknown): number {
  return typeof value === 'number' ? value : Number(value || 0);
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string' || !value) return fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

function contextResourceKey(uri: string): string {
  try {
    if (uri.startsWith('file://')) return `local:${path.resolve(fileURLToPath(uri))}`;
  } catch { /* use the URI as-is */ }
  return uri.trim();
}

function reusableContextResourceUri(uri: string): boolean {
  return uri.startsWith('/api/canvas/')
    || uri.startsWith('data:')
    || /^https?:\/\//i.test(uri);
}

function mapCanvas(row: SqlRow): CanvasRecord {
  return {
    id: asString(row.id),
    name: asString(row.name),
    agentId: asString(row.agent_id),
    createdAt: asNumber(row.created_at),
    updatedAt: asNumber(row.updated_at),
  };
}

function mapCanvasUser(row: SqlRow): CanvasUserRecord {
  return {
    id: asString(row.id),
    displayName: asString(row.display_name),
    tokenHash: asNullableString(row.token_hash),
    tokenVersion: Math.max(1, asNumber(row.token_version)),
    status: (asString(row.status) || 'unmanaged') as CanvasUserStatus,
    canvasCount: asNumber(row.canvas_count),
    createdAt: asNumber(row.created_at),
    updatedAt: asNumber(row.updated_at),
  };
}

function mapBranch(row: SqlRow): BranchRecord {
  return {
    id: asString(row.id),
    canvasId: asString(row.canvas_id),
    kind: asString(row.kind) as BranchKind,
    parentBranchId: asNullableString(row.parent_branch_id),
    forkedFromInteractionId: asNullableString(row.forked_from_interaction_id),
    sessionKey: asString(row.session_key),
    openClawSessionId: asNullableString(row.openclaw_session_id),
    observedSessionId: asNullableString(row.observed_session_id),
    sessionIntegrity: (asString(row.session_integrity) || 'unknown') as BranchSessionIntegrity,
    sessionState: asString(row.session_state) as BranchSessionState,
    headInteractionId: asNullableString(row.head_interaction_id),
    createdAt: asNumber(row.created_at),
    updatedAt: asNumber(row.updated_at),
  };
}

function mapInteraction(row: SqlRow): InteractionRecord {
  return {
    id: asString(row.id),
    branchId: asString(row.branch_id),
    parentInteractionId: asNullableString(row.parent_interaction_id),
    runId: asNullableString(row.run_id),
    userInput: asString(row.user_input),
    agentOutput: asString(row.agent_output),
    status: asString(row.status) as InteractionStatus,
    attachments: parseJson<CanvasAttachment[]>(row.attachments_json, []),
    artifacts: parseJson<CanvasArtifact[]>(row.artifacts_json, []),
    sessionMetadata: parseJson<Record<string, unknown>>(row.session_metadata_json, {}),
    createdAt: asNumber(row.created_at),
    updatedAt: asNumber(row.updated_at),
  };
}

function mapOwnedInteraction(row: SqlRow): OwnedInteractionRecord {
  return {
    ...mapInteraction(row),
    ownerId: asString(row.owner_id),
    canvasId: asString(row.canvas_id),
    sessionKey: asString(row.session_key),
    agentId: asString(row.agent_id),
    openClawSessionId: asNullableString(row.openclaw_session_id),
    observedSessionId: asNullableString(row.observed_session_id),
    sessionIntegrity: (asString(row.session_integrity) || 'unknown') as BranchSessionIntegrity,
  };
}

export class CanvasStore {
  readonly db: DatabaseSync;

  constructor(databasePath = config.canvasDatabasePath) {
    mkdirSync(path.dirname(databasePath), { recursive: true });
    this.db = new DatabaseSync(databasePath);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
    this.migrate();
  }

  close(): void {
    this.db.close();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS canvas_users (
        id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS canvases (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL REFERENCES canvas_users(id),
        name TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS branches (
        id TEXT PRIMARY KEY,
        canvas_id TEXT NOT NULL REFERENCES canvases(id) ON DELETE CASCADE,
        kind TEXT NOT NULL CHECK(kind IN ('root', 'fork')),
        parent_branch_id TEXT REFERENCES branches(id) ON DELETE SET NULL,
        forked_from_interaction_id TEXT,
        session_key TEXT NOT NULL UNIQUE,
        openclaw_session_id TEXT,
        openclaw_session_started_at INTEGER,
        observed_session_id TEXT,
        observed_session_started_at INTEGER,
        session_integrity TEXT NOT NULL DEFAULT 'unknown',
        session_state TEXT NOT NULL CHECK(session_state IN ('draft', 'active')),
        head_interaction_id TEXT,
        snapshot_json TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS interactions (
        id TEXT PRIMARY KEY,
        branch_id TEXT NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
        parent_interaction_id TEXT,
        run_id TEXT,
        user_input TEXT NOT NULL,
        agent_output TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL CHECK(status IN ('streaming', 'completed', 'failed')),
        attachments_json TEXT NOT NULL DEFAULT '[]',
        artifacts_json TEXT NOT NULL DEFAULT '[]',
        session_metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS canvas_layouts (
        canvas_id TEXT PRIMARY KEY REFERENCES canvases(id) ON DELETE CASCADE,
        layout_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS send_reservations (
        id TEXT PRIMARY KEY,
        branch_id TEXT NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
        expected_head_interaction_id TEXT,
        user_input TEXT NOT NULL,
        attachments_json TEXT NOT NULL DEFAULT '[]',
        materialization TEXT NOT NULL,
        session_key TEXT NOT NULL,
        outgoing_message TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('prepared', 'acknowledged', 'failed')),
        run_id TEXT,
        interaction_id TEXT,
        error TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS one_draft_root_per_canvas
        ON branches(canvas_id) WHERE kind = 'root' AND session_state = 'draft';
      CREATE UNIQUE INDEX IF NOT EXISTS one_draft_fork_per_source
        ON branches(forked_from_interaction_id) WHERE kind = 'fork' AND session_state = 'draft';
      CREATE UNIQUE INDEX IF NOT EXISTS one_prepared_send_per_branch
        ON send_reservations(branch_id) WHERE status = 'prepared';
      CREATE INDEX IF NOT EXISTS canvas_owner_updated ON canvases(owner_id, updated_at DESC);
      CREATE INDEX IF NOT EXISTS interaction_branch_created ON interactions(branch_id, created_at);
    `);
    const reservationColumns = this.db.prepare('PRAGMA table_info(send_reservations)').all() as SqlRow[];
    if (!reservationColumns.some((column) => asString(column.name) === 'bootstrap_resources_json')) {
      this.db.exec("ALTER TABLE send_reservations ADD COLUMN bootstrap_resources_json TEXT NOT NULL DEFAULT '[]'");
    }
    const userColumns = this.db.prepare('PRAGMA table_info(canvas_users)').all() as SqlRow[];
    if (!userColumns.some((column) => asString(column.name) === 'token_hash')) {
      this.db.exec('ALTER TABLE canvas_users ADD COLUMN token_hash TEXT');
    }
    if (!userColumns.some((column) => asString(column.name) === 'token_version')) {
      this.db.exec('ALTER TABLE canvas_users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 1');
    }
    if (!userColumns.some((column) => asString(column.name) === 'status')) {
      this.db.exec("ALTER TABLE canvas_users ADD COLUMN status TEXT NOT NULL DEFAULT 'unmanaged'");
    }
    const branchColumns = this.db.prepare('PRAGMA table_info(branches)').all() as SqlRow[];
    if (!branchColumns.some((column) => asString(column.name) === 'openclaw_session_id')) {
      this.db.exec('ALTER TABLE branches ADD COLUMN openclaw_session_id TEXT');
    }
    if (!branchColumns.some((column) => asString(column.name) === 'observed_session_id')) {
      this.db.exec('ALTER TABLE branches ADD COLUMN observed_session_id TEXT');
    }
    if (!branchColumns.some((column) => asString(column.name) === 'session_integrity')) {
      this.db.exec("ALTER TABLE branches ADD COLUMN session_integrity TEXT NOT NULL DEFAULT 'unknown'");
    }
    if (!branchColumns.some((column) => asString(column.name) === 'openclaw_session_started_at')) {
      this.db.exec('ALTER TABLE branches ADD COLUMN openclaw_session_started_at INTEGER');
    }
    if (!branchColumns.some((column) => asString(column.name) === 'observed_session_started_at')) {
      this.db.exec('ALTER TABLE branches ADD COLUMN observed_session_started_at INTEGER');
    }
    this.db.exec(`
      UPDATE branches
      SET openclaw_session_started_at = COALESCE(
        (SELECT MIN(i.created_at) FROM interactions i WHERE i.branch_id = branches.id),
        created_at
      )
      WHERE openclaw_session_id IS NOT NULL
        AND openclaw_session_started_at IS NULL;
      UPDATE branches
      SET observed_session_started_at = CASE
        WHEN observed_session_id = openclaw_session_id THEN openclaw_session_started_at
        ELSE updated_at
      END
      WHERE observed_session_id IS NOT NULL
        AND observed_session_started_at IS NULL;
    `);
  }

  transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const value = fn();
      this.db.exec('COMMIT');
      return value;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  ensureUser(id: string, displayName: string): void {
    const now = Date.now();
    this.db.prepare(`INSERT INTO canvas_users(id, display_name, created_at, updated_at)
      VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET display_name = excluded.display_name, updated_at = excluded.updated_at`)
      .run(id, displayName, now, now);
  }

  listManagedUsers(): CanvasUserRecord[] {
    return (this.db.prepare(`SELECT u.*, COUNT(c.id) AS canvas_count
      FROM canvas_users u LEFT JOIN canvases c ON c.owner_id = u.id
      WHERE u.token_hash IS NOT NULL
      GROUP BY u.id ORDER BY u.display_name COLLATE NOCASE`).all() as SqlRow[]).map(mapCanvasUser);
  }

  listUsersWithCredentials(): CanvasUserRecord[] {
    return (this.db.prepare(`SELECT u.*, COUNT(c.id) AS canvas_count
      FROM canvas_users u LEFT JOIN canvases c ON c.owner_id = u.id
      WHERE u.token_hash IS NOT NULL
      GROUP BY u.id ORDER BY u.created_at`).all() as SqlRow[]).map(mapCanvasUser);
  }

  getManagedUserById(id: string): CanvasUserRecord | null {
    const row = this.db.prepare(`SELECT u.*, COUNT(c.id) AS canvas_count
      FROM canvas_users u LEFT JOIN canvases c ON c.owner_id = u.id
      WHERE u.id = ? AND u.token_hash IS NOT NULL GROUP BY u.id`).get(id) as SqlRow | undefined;
    return row ? mapCanvasUser(row) : null;
  }

  getManagedUserByName(displayName: string): CanvasUserRecord | null {
    const row = this.db.prepare(`SELECT u.*, COUNT(c.id) AS canvas_count
      FROM canvas_users u LEFT JOIN canvases c ON c.owner_id = u.id
      WHERE u.display_name = ? COLLATE NOCASE AND u.token_hash IS NOT NULL GROUP BY u.id`).get(displayName) as SqlRow | undefined;
    return row ? mapCanvasUser(row) : null;
  }

  createManagedUser(displayName: string, tokenHash: string): { user: CanvasUserRecord; claimedCanvasCount: number } {
    return this.transaction(() => {
      const duplicate = this.db.prepare('SELECT id FROM canvas_users WHERE display_name = ? COLLATE NOCASE').get(displayName);
      if (duplicate) throw new Error('user_exists');
      const firstManaged = asNumber((this.db.prepare('SELECT COUNT(*) AS count FROM canvas_users WHERE token_hash IS NOT NULL').get() as SqlRow).count) === 0;
      const id = randomUUID();
      const now = Date.now();
      this.db.prepare(`INSERT INTO canvas_users(id, display_name, token_hash, token_version, status, created_at, updated_at)
        VALUES (?, ?, ?, 1, 'active', ?, ?)`).run(id, displayName, tokenHash, now, now);
      let claimedCanvasCount = 0;
      if (firstManaged) {
        const result = this.db.prepare("UPDATE canvases SET owner_id = ?, updated_at = ? WHERE owner_id = 'local'").run(id, now);
        claimedCanvasCount = Number(result.changes);
      }
      return { user: this.getManagedUserById(id)!, claimedCanvasCount };
    });
  }

  rotateManagedUserToken(displayName: string, tokenHash: string): CanvasUserRecord {
    return this.transaction(() => {
      const user = this.getManagedUserByName(displayName);
      if (!user) throw new Error('user_not_found');
      this.db.prepare(`UPDATE canvas_users SET token_hash = ?, token_version = token_version + 1, updated_at = ? WHERE id = ?`)
        .run(tokenHash, Date.now(), user.id);
      return this.getManagedUserById(user.id)!;
    });
  }

  setManagedUserStatus(displayName: string, status: Exclude<CanvasUserStatus, 'unmanaged'>): CanvasUserRecord {
    return this.transaction(() => {
      const user = this.getManagedUserByName(displayName);
      if (!user) throw new Error('user_not_found');
      if (user.status !== status) {
        this.db.prepare(`UPDATE canvas_users SET status = ?, token_version = token_version + 1, updated_at = ? WHERE id = ?`)
          .run(status, Date.now(), user.id);
      }
      return this.getManagedUserById(user.id)!;
    });
  }

  listCanvases(ownerId: string): CanvasRecord[] {
    return (this.db.prepare('SELECT * FROM canvases WHERE owner_id = ? ORDER BY updated_at DESC').all(ownerId) as SqlRow[]).map(mapCanvas);
  }

  createCanvas(ownerId: string, name: string, agentId: string): CanvasRecord {
    const now = Date.now();
    const id = randomUUID();
    this.db.prepare('INSERT INTO canvases(id, owner_id, name, agent_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, ownerId, name, agentId, now, now);
    return this.getCanvas(ownerId, id)!;
  }

  getCanvas(ownerId: string, id: string): CanvasRecord | null {
    const row = this.db.prepare('SELECT * FROM canvases WHERE id = ? AND owner_id = ?').get(id, ownerId) as SqlRow | undefined;
    return row ? mapCanvas(row) : null;
  }

  canvasExists(id: string): boolean {
    return Boolean(this.db.prepare('SELECT 1 FROM canvases WHERE id = ?').get(id));
  }

  updateCanvas(ownerId: string, id: string, name: string): CanvasRecord | null {
    this.db.prepare('UPDATE canvases SET name = ?, updated_at = ? WHERE id = ? AND owner_id = ?').run(name, Date.now(), id, ownerId);
    return this.getCanvas(ownerId, id);
  }

  updateCanvasAgentBeforeFirstInteraction(ownerId: string, id: string, agentId: string): CanvasRecord | null {
    return this.transaction(() => {
      const canvas = this.getCanvas(ownerId, id);
      if (!canvas) return null;
      if (canvas.agentId === agentId) return canvas;

      const locked = this.db.prepare(`SELECT 1
        FROM branches b
        LEFT JOIN interactions i ON i.branch_id = b.id
        LEFT JOIN send_reservations r ON r.branch_id = b.id AND r.status = 'prepared'
        WHERE b.canvas_id = ? AND (i.id IS NOT NULL OR r.id IS NOT NULL)
        LIMIT 1`).get(id);
      if (locked) throw new Error('agent_locked');

      const now = Date.now();
      this.db.prepare('UPDATE canvases SET agent_id = ?, updated_at = ? WHERE id = ? AND owner_id = ?')
        .run(agentId, now, id, ownerId);
      const draftBranches = this.db.prepare(
        "SELECT id FROM branches WHERE canvas_id = ? AND session_state = 'draft'",
      ).all(id) as SqlRow[];
      const updateBranch = this.db.prepare(
        "UPDATE branches SET session_key = ?, updated_at = ? WHERE id = ? AND session_state = 'draft'",
      );
      for (const branch of draftBranches) {
        const branchId = asString(branch.id);
        updateBranch.run(`agent:${agentId}:canvas:${branchId}`, now, branchId);
      }
      return this.getCanvas(ownerId, id);
    });
  }

  deleteCanvas(ownerId: string, id: string): boolean {
    return Number(this.db.prepare('DELETE FROM canvases WHERE id = ? AND owner_id = ?').run(id, ownerId).changes) > 0;
  }

  createRootBranch(ownerId: string, canvasId: string): BranchRecord {
    const canvas = this.getCanvas(ownerId, canvasId);
    if (!canvas) throw new Error('not_found');
    const existing = this.db.prepare(`SELECT b.* FROM branches b JOIN canvases c ON c.id = b.canvas_id
      WHERE b.canvas_id = ? AND c.owner_id = ? AND b.kind = 'root' AND b.session_state = 'draft'`).get(canvasId, ownerId) as SqlRow | undefined;
    if (existing) return mapBranch(existing);
    return this.insertBranch(canvasId, 'root', null, null, null, canvas.agentId);
  }

  private insertBranch(
    canvasId: string,
    kind: BranchKind,
    parentBranchId: string | null,
    forkedFromInteractionId: string | null,
    snapshot: unknown,
    agentId: string,
  ): BranchRecord {
    const id = randomUUID();
    const now = Date.now();
    const sessionKey = `agent:${agentId}:canvas:${id}`;
    this.db.prepare(`INSERT INTO branches
      (id, canvas_id, kind, parent_branch_id, forked_from_interaction_id, session_key, session_state, snapshot_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?)`)
      .run(id, canvasId, kind, parentBranchId, forkedFromInteractionId, sessionKey, snapshot == null ? null : JSON.stringify(snapshot), now, now);
    return this.getBranchById(id)!;
  }

  private getBranchById(id: string): BranchRecord | null {
    const row = this.db.prepare('SELECT * FROM branches WHERE id = ?').get(id) as SqlRow | undefined;
    return row ? mapBranch(row) : null;
  }

  getOwnedBranch(ownerId: string, id: string): BranchRecord | null {
    const row = this.db.prepare(`SELECT b.* FROM branches b JOIN canvases c ON c.id = b.canvas_id
      WHERE b.id = ? AND c.owner_id = ?`).get(id, ownerId) as SqlRow | undefined;
    return row ? mapBranch(row) : null;
  }

  getOwnedBranchSessionLifecycle(ownerId: string, branchId: string): BranchSessionLifecycle | null {
    const row = this.db.prepare(`SELECT
        b.openclaw_session_started_at,
        b.observed_session_started_at,
        (SELECT i.created_at FROM interactions i
          WHERE i.id = b.head_interaction_id) AS last_interaction_at
      FROM branches b JOIN canvases c ON c.id = b.canvas_id
      WHERE b.id = ? AND c.owner_id = ?`).get(branchId, ownerId) as SqlRow | undefined;
    if (!row) return null;
    const nullableNumber = (value: unknown): number | null =>
      value === null || value === undefined ? null : asNumber(value);
    return {
      sessionStartedAt: nullableNumber(row.openclaw_session_started_at),
      observedSessionStartedAt: nullableNumber(row.observed_session_started_at),
      lastInteractionAt: nullableNumber(row.last_interaction_at),
    };
  }

  observeBranchSession(branchId: string, sessionId: string, observedAt = Date.now()): BranchRecord | null {
    const normalized = sessionId.trim();
    if (!normalized) return this.getBranchById(branchId);
    const branch = this.getBranchById(branchId);
    if (!branch) return null;
    if (!branch.openClawSessionId) {
      this.db.prepare(`UPDATE branches
        SET openclaw_session_id = ?, openclaw_session_started_at = ?,
          observed_session_id = ?, observed_session_started_at = ?,
          session_integrity = 'healthy', updated_at = ?
        WHERE id = ?`).run(normalized, observedAt, normalized, observedAt, observedAt, branchId);
    } else if (branch.openClawSessionId === normalized) {
      this.db.prepare(`UPDATE branches
        SET openclaw_session_started_at = COALESCE(openclaw_session_started_at, ?),
          observed_session_id = ?,
          observed_session_started_at = COALESCE(openclaw_session_started_at, ?),
          session_integrity = 'healthy', updated_at = ?
        WHERE id = ?`).run(observedAt, normalized, observedAt, observedAt, branchId);
    } else {
      this.db.prepare(`UPDATE branches
        SET observed_session_started_at = CASE
          WHEN observed_session_id = ? THEN observed_session_started_at
          ELSE ? END,
          observed_session_id = ?, session_integrity = 'drifted', updated_at = ?
        WHERE id = ?`).run(normalized, observedAt, normalized, observedAt, branchId);
    }
    return this.getBranchById(branchId);
  }

  markBranchSessionMissing(branchId: string): BranchRecord | null {
    const branch = this.getBranchById(branchId);
    if (!branch?.openClawSessionId) return branch;
    this.db.prepare(`UPDATE branches
      SET observed_session_id = NULL, observed_session_started_at = NULL,
        session_integrity = 'drifted', updated_at = ?
      WHERE id = ?`).run(Date.now(), branchId);
    return this.getBranchById(branchId);
  }

  ownsSessionKey(ownerId: string, sessionKey: string): boolean {
    const row = this.db.prepare(`SELECT 1 FROM branches b JOIN canvases c ON c.id = b.canvas_id
      WHERE b.session_key = ? AND c.owner_id = ?`).get(sessionKey, ownerId);
    return Boolean(row);
  }

  forkInteraction(ownerId: string, interactionId: string): BranchRecord {
    const sourceRow = this.db.prepare(`SELECT i.*, b.canvas_id, b.head_interaction_id, c.agent_id, c.owner_id
      FROM interactions i JOIN branches b ON b.id = i.branch_id JOIN canvases c ON c.id = b.canvas_id
      WHERE i.id = ? AND c.owner_id = ?`).get(interactionId, ownerId) as SqlRow | undefined;
    if (!sourceRow) throw new Error('not_found');
    if (asString(sourceRow.status) !== 'completed') throw new Error('interaction_not_completed');
    if (asNullableString(sourceRow.head_interaction_id) === interactionId) throw new Error('cannot_fork_branch_head');

    const existing = this.db.prepare(`SELECT * FROM branches WHERE forked_from_interaction_id = ? AND session_state = 'draft'`)
      .get(interactionId) as SqlRow | undefined;
    if (existing) return mapBranch(existing);

    const snapshot = this.buildCanonicalSnapshot(interactionId);
    return this.insertBranch(
      asString(sourceRow.canvas_id),
      'fork',
      asString(sourceRow.branch_id),
      interactionId,
      snapshot,
      asString(sourceRow.agent_id),
    );
  }

  private buildCanonicalSnapshot(interactionId: string): CanonicalSnapshot {
    const rows: SqlRow[] = [];
    let cursor: string | null = interactionId;
    const seen = new Set<string>();
    while (cursor && !seen.has(cursor)) {
      seen.add(cursor);
      const row = this.db.prepare('SELECT * FROM interactions WHERE id = ?').get(cursor) as SqlRow | undefined;
      if (!row) break;
      rows.push(row);
      cursor = asNullableString(row.parent_interaction_id);
    }
    rows.reverse();

    const resources: CanvasContextResource[] = [];
    const seenResources = new Set<string>();
    const addResource = (resource: CanvasContextResource) => {
      if (!resource.available || !reusableContextResourceUri(resource.uri)) return;
      const key = contextResourceKey(resource.uri);
      if (!key || seenResources.has(key)) return;
      seenResources.add(key);
      resources.push(resource);
    };
    for (const row of rows) {
      const sourceInteractionId = asString(row.id);
      parseJson<CanvasAttachment[]>(row.attachments_json, []).forEach((attachment, index) => {
        if (!attachment.uri) return;
        addResource({
          id: `${sourceInteractionId}:attachment:${index}`,
          sourceInteractionId,
          source: 'user_attachment',
          name: attachment.name,
          mimeType: attachment.mimeType || 'application/octet-stream',
          sizeBytes: attachment.sizeBytes,
          uri: attachment.uri,
          available: attachment.available !== false,
          ...(attachment.warning ? { warning: attachment.warning } : {}),
        });
      });
      parseJson<CanvasArtifact[]>(row.artifacts_json, []).forEach((artifact, index) => {
        addResource({
          id: `${sourceInteractionId}:artifact:${index}`,
          sourceInteractionId,
          source: 'agent_artifact',
          name: artifact.name,
          mimeType: artifact.mimeType || 'application/octet-stream',
          sizeBytes: artifact.sizeBytes,
          uri: artifact.uri,
          available: artifact.available !== false,
          ...(artifact.warning ? { warning: artifact.warning } : {}),
        });
      });
    }
    return {
      version: 2,
      interactions: rows.map((row) => ({ id: asString(row.id), user: asString(row.user_input), assistant: asString(row.agent_output) })),
      resources,
    };
  }

  prepareSend(ownerId: string, input: {
    branchId: string;
    expectedHeadInteractionId?: string | null;
    userInput: string;
    attachments: CanvasAttachment[];
    forceSessionRecovery?: boolean;
  }): SendReservation {
    return this.transaction(() => {
      const branch = this.getOwnedBranch(ownerId, input.branchId);
      if (!branch) throw new Error('not_found');
      const existing = this.db.prepare(`SELECT * FROM send_reservations WHERE branch_id = ? AND status = 'prepared'`).get(branch.id) as SqlRow | undefined;
      if (existing) throw new Error('send_in_progress');

      let materialization: SendMaterialization;
      let outgoingMessage = input.userInput;
      let expectedHead: string | null = null;
      let bootstrapResources: CanvasContextResource[] = [];

      if (branch.sessionState === 'draft' && branch.kind === 'root' && !branch.headInteractionId) {
        materialization = 'lazy-root';
      } else if (branch.sessionState === 'draft' && branch.kind === 'fork' && !branch.headInteractionId) {
        materialization = 'canonical-replay';
        const row = this.db.prepare('SELECT snapshot_json FROM branches WHERE id = ?').get(branch.id) as SqlRow;
        const snapshot = parseJson<{ version?: number; interactions?: Array<{ user: string; assistant: string }>; resources?: CanvasContextResource[] }>(row.snapshot_json, {});
        bootstrapResources = snapshot.resources || [];
        const transcript = (snapshot.interactions || []).map((item, index) =>
          `Interaction ${index + 1}\nUser: ${item.user}\nAgent: ${item.assistant}`,
        ).join('\n\n');
        const resourceManifest = bootstrapResources.length > 0
          ? `\n\n<canvas-context-resources>${JSON.stringify(bootstrapResources.map(({ id, sourceInteractionId, source, name, mimeType, sizeBytes, uri }) => ({ id, sourceInteractionId, source, name, mimeType, sizeBytes, uri })))}</canvas-context-resources>`
          : '';
        outgoingMessage = `<canvas-context-snapshot>\nThe user forked an earlier Canvas interaction. Continue from this immutable prior context.\n\n${transcript}${resourceManifest}\n</canvas-context-snapshot>\n\n${input.userInput}`;
      } else if (branch.sessionState === 'active' && branch.headInteractionId && input.expectedHeadInteractionId === branch.headInteractionId) {
        expectedHead = branch.headInteractionId;
        if (branch.sessionIntegrity === 'drifted' || input.forceSessionRecovery) {
          materialization = 'session-recovery';
          const snapshot = this.buildCanonicalSnapshot(branch.headInteractionId);
          bootstrapResources = snapshot.resources;
          const transcript = snapshot.interactions.map((item, index) =>
            `Interaction ${index + 1}\nUser: ${item.user}\nAgent: ${item.assistant}`,
          ).join('\n\n');
          const resourceManifest = bootstrapResources.length > 0
            ? `\n\n<canvas-context-resources>${JSON.stringify(bootstrapResources.map(({ id, sourceInteractionId, source, name, mimeType, sizeBytes, uri }) => ({ id, sourceInteractionId, source, name, mimeType, sizeBytes, uri })))}</canvas-context-resources>`
            : '';
          outgoingMessage = `<canvas-context-snapshot>\nOpenClaw reset this Canvas session. Restore the immutable Canvas history before continuing.\n\n${transcript}${resourceManifest}\n</canvas-context-snapshot>\n\n${input.userInput}`;
        } else {
          materialization = 'continue-existing';
        }
      } else {
        throw new Error('invalid_branch_transition');
      }

      const id = randomUUID();
      const now = Date.now();
      this.db.prepare(`INSERT INTO send_reservations
        (id, branch_id, expected_head_interaction_id, user_input, attachments_json, materialization, session_key, outgoing_message, bootstrap_resources_json, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'prepared', ?, ?)`)
        .run(id, branch.id, expectedHead, input.userInput, JSON.stringify(input.attachments), materialization, branch.sessionKey, outgoingMessage, JSON.stringify(bootstrapResources), now, now);
      return this.getReservation(id)!;
    });
  }

  private getReservation(id: string): SendReservation | null {
    const row = this.db.prepare('SELECT * FROM send_reservations WHERE id = ?').get(id) as SqlRow | undefined;
    if (!row) return null;
    return {
      id: asString(row.id),
      branchId: asString(row.branch_id),
      expectedHeadInteractionId: asNullableString(row.expected_head_interaction_id),
      userInput: asString(row.user_input),
      attachments: parseJson<CanvasAttachment[]>(row.attachments_json, []),
      materialization: asString(row.materialization) as SendMaterialization,
      sessionKey: asString(row.session_key),
      outgoingMessage: asString(row.outgoing_message),
      snapshotVersion: ['canonical-replay', 'session-recovery'].includes(asString(row.materialization)) ? 2 : undefined,
      bootstrapResources: parseJson<CanvasContextResource[]>(row.bootstrap_resources_json, []).map((resource) => ({
        ...resource,
        fetchUrl: `/api/canvas/send-reservations/${encodeURIComponent(asString(row.id))}/resources/${encodeURIComponent(resource.id)}`,
      })),
      status: asString(row.status) as SendReservation['status'],
      interactionId: asNullableString(row.interaction_id),
    };
  }

  getOwnedReservationSessionTarget(
    ownerId: string,
    reservationId: string,
  ): { branchId: string; sessionKey: string } | null {
    const row = this.db.prepare(`SELECT r.branch_id, r.session_key
      FROM send_reservations r
      JOIN branches b ON b.id = r.branch_id
      JOIN canvases c ON c.id = b.canvas_id
      WHERE r.id = ? AND c.owner_id = ?`).get(reservationId, ownerId) as SqlRow | undefined;
    return row
      ? { branchId: asString(row.branch_id), sessionKey: asString(row.session_key) }
      : null;
  }

  acknowledgeSend(ownerId: string, reservationId: string, runId: string | null, bootstrapWarnings: string[] = []): InteractionRecord {
    return this.transaction(() => {
      const row = this.db.prepare(`SELECT r.*, b.canvas_id, b.kind, b.session_state, b.head_interaction_id, b.forked_from_interaction_id
        FROM send_reservations r JOIN branches b ON b.id = r.branch_id JOIN canvases c ON c.id = b.canvas_id
        WHERE r.id = ? AND c.owner_id = ?`).get(reservationId, ownerId) as SqlRow | undefined;
      if (!row) throw new Error('not_found');
      if (asString(row.status) === 'acknowledged') {
        const existing = this.db.prepare('SELECT * FROM interactions WHERE id = ?').get(asString(row.interaction_id)) as SqlRow;
        return mapInteraction(existing);
      }
      if (asString(row.status) !== 'prepared') throw new Error('reservation_not_prepared');

      const currentHead = asNullableString(row.head_interaction_id);
      const expectedHead = asNullableString(row.expected_head_interaction_id);
      if (expectedHead !== currentHead) throw new Error('invalid_branch_transition');
      const parentId = currentHead || asNullableString(row.forked_from_interaction_id);
      const id = randomUUID();
      const now = Date.now();
      this.db.prepare(`INSERT INTO interactions
        (id, branch_id, parent_interaction_id, run_id, user_input, status, attachments_json, session_metadata_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 'streaming', ?, ?, ?, ?)`)
        .run(id, asString(row.branch_id), parentId, runId, asString(row.user_input), asString(row.attachments_json), JSON.stringify({
          materialization: row.materialization,
          sessionKey: row.session_key,
          ...(bootstrapWarnings.length ? { bootstrapWarnings } : {}),
        }), now, now);
      this.db.prepare(`UPDATE branches SET session_state = 'active', head_interaction_id = ?,
        openclaw_session_id = CASE WHEN ? = 'session-recovery' THEN observed_session_id ELSE openclaw_session_id END,
        openclaw_session_started_at = CASE WHEN ? = 'session-recovery'
          THEN observed_session_started_at ELSE openclaw_session_started_at END,
        session_integrity = CASE WHEN ? = 'session-recovery' AND observed_session_id IS NOT NULL THEN 'healthy'
          WHEN ? = 'session-recovery' THEN 'unknown' ELSE session_integrity END,
        updated_at = ? WHERE id = ?`)
        .run(
          id,
          asString(row.materialization),
          asString(row.materialization),
          asString(row.materialization),
          asString(row.materialization),
          now,
          asString(row.branch_id),
        );
      this.db.prepare(`UPDATE send_reservations SET status = 'acknowledged', run_id = ?, interaction_id = ?, updated_at = ? WHERE id = ?`)
        .run(runId, id, now, reservationId);
      this.db.prepare('UPDATE canvases SET updated_at = ? WHERE id = ?').run(now, asString(row.canvas_id));
      return mapInteraction(this.db.prepare('SELECT * FROM interactions WHERE id = ?').get(id) as SqlRow);
    });
  }

  failReservation(ownerId: string, reservationId: string, error: string): boolean {
    const result = this.db.prepare(`UPDATE send_reservations SET status = 'failed', error = ?, updated_at = ?
      WHERE id = ? AND status = 'prepared' AND branch_id IN (
        SELECT b.id FROM branches b JOIN canvases c ON c.id = b.canvas_id WHERE c.owner_id = ?
      )`).run(error, Date.now(), reservationId, ownerId);
    return Number(result.changes) > 0;
  }

  getOwnedReservationResource(ownerId: string, reservationId: string, resourceId: string): { resource: CanvasContextResource; agentId: string } | null {
    const row = this.db.prepare(`SELECT r.bootstrap_resources_json, c.agent_id
      FROM send_reservations r JOIN branches b ON b.id = r.branch_id JOIN canvases c ON c.id = b.canvas_id
      WHERE r.id = ? AND c.owner_id = ?`).get(reservationId, ownerId) as SqlRow | undefined;
    if (!row) return null;
    const resource = parseJson<CanvasContextResource[]>(row.bootstrap_resources_json, []).find((item) => item.id === resourceId);
    return resource ? { resource, agentId: asString(row.agent_id) } : null;
  }

  getOwnedCanvasAttachment(ownerId: string, canvasId: string, attachmentId: string): CanvasAttachment | null {
    const row = this.db.prepare(`SELECT attachment.value AS attachment_json
      FROM interactions i
      JOIN branches b ON b.id = i.branch_id
      JOIN canvases c ON c.id = b.canvas_id
      JOIN json_each(i.attachments_json) AS attachment
      WHERE c.owner_id = ? AND c.id = ? AND json_extract(attachment.value, '$.id') = ?
      LIMIT 1`).get(ownerId, canvasId, attachmentId) as SqlRow | undefined;
    return row ? parseJson<CanvasAttachment>(row.attachment_json, {} as CanvasAttachment) : null;
  }

  completeInteraction(ownerId: string, interactionId: string, input: {
    status: 'completed' | 'failed';
    agentOutput: string;
    artifacts: CanvasArtifact[];
    metadata?: Record<string, unknown>;
  }): InteractionRecord | null {
    const now = Date.now();
    this.db.prepare(`UPDATE interactions SET status = ?, agent_output = ?, artifacts_json = ?, session_metadata_json = ?, updated_at = ?
      WHERE id = ? AND branch_id IN (
        SELECT b.id FROM branches b JOIN canvases c ON c.id = b.canvas_id WHERE c.owner_id = ?
      )`).run(input.status, input.agentOutput, JSON.stringify(input.artifacts), JSON.stringify(input.metadata || {}), now, interactionId, ownerId);
    const row = this.db.prepare(`SELECT i.* FROM interactions i JOIN branches b ON b.id = i.branch_id JOIN canvases c ON c.id = b.canvas_id
      WHERE i.id = ? AND c.owner_id = ?`).get(interactionId, ownerId) as SqlRow | undefined;
    return row ? mapInteraction(row) : null;
  }

  getOwnedInteraction(ownerId: string, interactionId: string): OwnedInteractionRecord | null {
    const row = this.db.prepare(`SELECT i.*, b.canvas_id, b.session_key, b.openclaw_session_id, b.observed_session_id, b.session_integrity, c.owner_id, c.agent_id
      FROM interactions i JOIN branches b ON b.id = i.branch_id JOIN canvases c ON c.id = b.canvas_id
      WHERE i.id = ? AND c.owner_id = ?`).get(interactionId, ownerId) as SqlRow | undefined;
    return row ? mapOwnedInteraction(row) : null;
  }

  getInteractionForReconciliation(interactionId: string): OwnedInteractionRecord | null {
    const row = this.db.prepare(`SELECT i.*, b.canvas_id, b.session_key, b.openclaw_session_id, b.observed_session_id, b.session_integrity, c.owner_id, c.agent_id
      FROM interactions i JOIN branches b ON b.id = i.branch_id JOIN canvases c ON c.id = b.canvas_id
      WHERE i.id = ?`).get(interactionId) as SqlRow | undefined;
    return row ? mapOwnedInteraction(row) : null;
  }

  listReconciliationCandidates(limit = 500): OwnedInteractionRecord[] {
    const rows = this.db.prepare(`SELECT i.*, b.canvas_id, b.session_key, b.openclaw_session_id, b.observed_session_id, b.session_integrity, c.owner_id, c.agent_id
      FROM interactions i JOIN branches b ON b.id = i.branch_id JOIN canvases c ON c.id = b.canvas_id
      WHERE i.status = 'streaming'
         OR COALESCE(json_extract(i.session_metadata_json, '$.reconciliation.version'), 0) < 4
         OR json_extract(i.session_metadata_json, '$.reconciliation.artifactSync') = 'pending'
         OR json_extract(i.session_metadata_json, '$.reconciliation.artifactSync') = 'degraded'
         OR (
           i.status = 'completed'
           AND trim(i.agent_output) = ''
           AND json_array_length(i.artifacts_json) = 0
           AND json_extract(i.session_metadata_json, '$.reconciliation.artifactSync') = 'synced'
         )
      ORDER BY i.updated_at ASC LIMIT ?`).all(limit) as SqlRow[];
    return rows.map(mapOwnedInteraction);
  }

  updateReconciliationMetadata(interactionId: string, patch: Record<string, unknown>): InteractionRecord | null {
    return this.transaction(() => {
      const row = this.db.prepare('SELECT * FROM interactions WHERE id = ?').get(interactionId) as SqlRow | undefined;
      if (!row) return null;
      const metadata = parseJson<Record<string, unknown>>(row.session_metadata_json, {});
      const previous = metadata.reconciliation && typeof metadata.reconciliation === 'object'
        ? metadata.reconciliation as Record<string, unknown>
        : {};
      const nextMetadata = { ...metadata, reconciliation: { ...previous, ...patch } };
      const now = Date.now();
      this.db.prepare('UPDATE interactions SET session_metadata_json = ?, updated_at = ? WHERE id = ?')
        .run(JSON.stringify(nextMetadata), now, interactionId);
      const updated = this.db.prepare('SELECT * FROM interactions WHERE id = ?').get(interactionId) as SqlRow;
      return mapInteraction(updated);
    });
  }

  applyReconciledInteraction(interactionId: string, input: {
    status: 'completed' | 'failed';
    agentOutput: string;
    artifacts: CanvasArtifact[];
    reconciliation: Record<string, unknown>;
  }): InteractionRecord | null {
    return this.transaction(() => {
      const row = this.db.prepare('SELECT * FROM interactions WHERE id = ?').get(interactionId) as SqlRow | undefined;
      if (!row) return null;
      const metadata = parseJson<Record<string, unknown>>(row.session_metadata_json, {});
      const previous = metadata.reconciliation && typeof metadata.reconciliation === 'object'
        ? metadata.reconciliation as Record<string, unknown>
        : {};
      const nextMetadata = { ...metadata, reconciliation: { ...previous, ...input.reconciliation } };
      const now = Date.now();
      this.db.prepare(`UPDATE interactions
        SET status = ?, agent_output = ?, artifacts_json = ?, session_metadata_json = ?, updated_at = ?
        WHERE id = ?`)
        .run(input.status, input.agentOutput, JSON.stringify(input.artifacts), JSON.stringify(nextMetadata), now, interactionId);
      const updated = this.db.prepare('SELECT * FROM interactions WHERE id = ?').get(interactionId) as SqlRow;
      return mapInteraction(updated);
    });
  }

  getGraph(ownerId: string, canvasId: string): CanvasGraph | null {
    const canvas = this.getCanvas(ownerId, canvasId);
    if (!canvas) return null;
    const branches = (this.db.prepare('SELECT * FROM branches WHERE canvas_id = ? ORDER BY created_at').all(canvasId) as SqlRow[]).map(mapBranch);
    const interactions = (this.db.prepare(`SELECT i.* FROM interactions i JOIN branches b ON b.id = i.branch_id
      WHERE b.canvas_id = ? ORDER BY i.created_at`).all(canvasId) as SqlRow[]).map(mapInteraction);
    const layoutRow = this.db.prepare('SELECT layout_json FROM canvas_layouts WHERE canvas_id = ?').get(canvasId) as SqlRow | undefined;
    return { canvas, branches, interactions, layout: layoutRow ? parseJson(rowValue(layoutRow, 'layout_json'), null) : null };
  }

  saveLayout(ownerId: string, canvasId: string, layout: CanvasGraph['layout']): boolean {
    if (!this.getCanvas(ownerId, canvasId) || !layout) return false;
    this.db.prepare(`INSERT INTO canvas_layouts(canvas_id, layout_json, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(canvas_id) DO UPDATE SET layout_json = excluded.layout_json, updated_at = excluded.updated_at`)
      .run(canvasId, JSON.stringify(layout), Date.now());
    return true;
  }
}

function rowValue(row: SqlRow, key: string): unknown {
  return row[key];
}

let store: CanvasStore | null = null;

export function getCanvasStore(): CanvasStore {
  store ||= new CanvasStore();
  return store;
}

export function resetCanvasStoreForTests(): void {
  store?.close();
  store = null;
}
