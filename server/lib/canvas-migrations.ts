import type { DatabaseSync } from 'node:sqlite';
import { mergeEquivalentArtifacts } from './canvas-artifact-identity.js';
import { V020_TO_V030_MIGRATION } from './canvas-migration-plan.js';

type SqlRow = Record<string, unknown>;

interface MigratedArtifact {
  id?: string;
  backendArtifactId?: string;
  name: string;
  mimeType?: string;
  sizeBytes?: number;
  uri: string;
  sourceUri?: string;
  storage?: 'canvas' | 'external' | 'source';
  available?: boolean;
  warning?: string;
}

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
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function mapArtifactRow(row: SqlRow): MigratedArtifact {
  return {
    id: asNullableString(row.id) || undefined,
    backendArtifactId: asNullableString(row.gateway_artifact_id) || undefined,
    name: asString(row.name) || 'artifact',
    mimeType: asNullableString(row.mime_type) || undefined,
    sizeBytes: row.size_bytes == null ? undefined : asNumber(row.size_bytes),
    uri: asString(row.uri),
    sourceUri: asNullableString(row.source_uri) || undefined,
    storage: (asNullableString(row.storage) || undefined) as MigratedArtifact['storage'],
    available: asNumber(row.available) !== 0,
    warning: asNullableString(row.warning) || undefined,
  };
}

function normalizeLegacyArtifact(value: unknown, interactionId: string, index: number): MigratedArtifact | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const artifact = value as Record<string, unknown>;
  const uri = asString(artifact.uri);
  if (!uri) return null;
  return {
    id: asString(artifact.id) || `${interactionId}:legacy:${index}`,
    backendArtifactId: asNullableString(artifact.backendArtifactId) || undefined,
    name: asString(artifact.name) || 'artifact',
    mimeType: asNullableString(artifact.mimeType) || undefined,
    sizeBytes: artifact.sizeBytes == null ? undefined : asNumber(artifact.sizeBytes),
    uri,
    sourceUri: asNullableString(artifact.sourceUri) || undefined,
    storage: (asNullableString(artifact.storage) || undefined) as MigratedArtifact['storage'],
    available: artifact.available !== false,
    warning: asNullableString(artifact.warning) || undefined,
  };
}

function migrationApplied(db: DatabaseSync): boolean {
  return Boolean(db.prepare('SELECT 1 FROM schema_migrations WHERE id = ?')
    .get(V020_TO_V030_MIGRATION));
}

export function applySingleChainSchemaMigration(db: DatabaseSync, appVersion: string): boolean {
  if (migrationApplied(db)) return false;

  const interactions = db.prepare('SELECT * FROM interactions ORDER BY created_at, id').all() as SqlRow[];
  const selectArtifacts = db.prepare(`SELECT * FROM interaction_artifacts
    WHERE interaction_id = ? ORDER BY ordinal, id`);
  const deleteArtifacts = db.prepare('DELETE FROM interaction_artifacts WHERE interaction_id = ?');
  const insertArtifact = db.prepare(`INSERT INTO interaction_artifacts
    (interaction_id, id, gateway_artifact_id, name, mime_type, size_bytes, uri,
      source_uri, storage, available, warning, ordinal, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const updateInteraction = db.prepare(`UPDATE interactions
    SET execution_state = ?, artifact_sync_state = ?, terminal_at = ?, error = ?,
      session_metadata_json = ?
    WHERE id = ?`);

  for (const row of interactions) {
    const interactionId = asString(row.id);
    const normalizedRows = selectArtifacts.all(interactionId) as SqlRow[];
    const artifacts = normalizedRows.length > 0
      ? normalizedRows.map(mapArtifactRow)
      : parseJson<unknown[]>(row.artifacts_json, [])
        .map((value, index) => normalizeLegacyArtifact(value, interactionId, index))
        .filter((artifact): artifact is MigratedArtifact => Boolean(artifact));
    const canonicalArtifacts = mergeEquivalentArtifacts(artifacts);
    const artifactWarnings = canonicalArtifacts
      .flatMap((artifact) => artifact.warning ? [artifact.warning] : []);
    const artifactIncomplete = canonicalArtifacts.some((artifact) =>
      artifact.available === false || Boolean(artifact.warning));
    const status = asString(row.status);
    const terminal = status === 'completed' || status === 'failed';
    const executionState = terminal ? status : 'unconfirmed';
    const artifactSyncState = terminal
      ? (artifactIncomplete ? 'degraded' : 'synced')
      : 'observing';
    const metadata = parseJson<Record<string, unknown>>(row.session_metadata_json, {});
    const previousReconciliation = metadata.reconciliation
      && typeof metadata.reconciliation === 'object'
      && !Array.isArray(metadata.reconciliation)
      ? metadata.reconciliation as Record<string, unknown>
      : {};
    const reconciliationWithoutVersion = { ...previousReconciliation };
    delete reconciliationWithoutVersion.version;
    const terminalAt = terminal
      ? asNumber(row.terminal_at)
        || asNumber(previousReconciliation.terminalAt)
        || asNumber(row.updated_at)
      : null;
    const error = status === 'failed'
      ? asNullableString(row.error)
        || asNullableString(previousReconciliation.lastError)
        || asString(row.agent_output)
        || 'OpenClaw run failed'
      : null;
    const reconciliation = {
      ...reconciliationWithoutVersion,
      phase: terminal ? artifactSyncState : 'monitoring',
      artifactSync: terminal ? artifactSyncState : 'pending',
      terminalAt,
      artifactWarnings,
      lastError: error,
    };

    deleteArtifacts.run(interactionId);
    canonicalArtifacts.forEach((artifact, index) => {
      insertArtifact.run(
        interactionId,
        artifact.id || `${interactionId}:artifact:${index}`,
        artifact.backendArtifactId || null,
        artifact.name,
        artifact.mimeType || null,
        artifact.sizeBytes ?? null,
        artifact.uri,
        artifact.sourceUri || null,
        artifact.storage || null,
        artifact.available === false ? 0 : 1,
        artifact.warning || null,
        index,
        asNumber(row.updated_at),
      );
    });
    updateInteraction.run(
      executionState,
      artifactSyncState,
      terminalAt,
      error,
      JSON.stringify({ ...metadata, reconciliation }),
      interactionId,
    );
  }

  db.exec(`DELETE FROM artifact_sync_jobs;
    INSERT INTO artifact_sync_jobs
      (interaction_id, state, attempt_count, next_attempt_at, last_error, updated_at)
    SELECT id, 'observing', 0, NULL, error, updated_at
    FROM interactions
    WHERE execution_state IN ('running', 'unconfirmed') OR artifact_sync_state = 'observing';

    INSERT OR IGNORE INTO canvas_attachments
      (canvas_id, attachment_id, name, mime_type, size_bytes, created_at, updated_at)
    SELECT b.canvas_id,
      json_extract(attachment.value, '$.id'),
      COALESCE(json_extract(attachment.value, '$.name'), 'attachment'),
      COALESCE(json_extract(attachment.value, '$.mimeType'), 'application/octet-stream'),
      COALESCE(json_extract(attachment.value, '$.sizeBytes'), 0),
      i.created_at,
      i.updated_at
    FROM interactions i
    JOIN branches b ON b.id = i.branch_id
    JOIN json_each(i.attachments_json) AS attachment
    WHERE json_extract(attachment.value, '$.id') IS NOT NULL
      AND json_extract(attachment.value, '$.storage') = 'canvas';`);

  db.prepare(`INSERT INTO schema_migrations(id, applied_at, app_version)
    VALUES (?, ?, ?)`).run(V020_TO_V030_MIGRATION, Date.now(), appVersion);
  return true;
}
