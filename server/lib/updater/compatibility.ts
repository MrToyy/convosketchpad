import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface ReleaseCompatibility {
  schemaVersion: 1;
  packageName: 'convosketchpad';
  applicationVersion: string;
  databaseSchemaEpoch: number;
  minimumReadableDatabaseSchemaEpoch: number;
  maximumReadableDatabaseSchemaEpoch: number;
}

export function loadReleaseCompatibility(
  cwd: string,
  expectedVersion?: string,
): ReleaseCompatibility {
  return parseReleaseCompatibility(
    readFileSync(join(cwd, 'update-compatibility.json'), 'utf8'),
    expectedVersion,
  );
}

export function parseReleaseCompatibility(
  raw: string,
  expectedVersion?: string,
): ReleaseCompatibility {
  const parsed = JSON.parse(raw) as Partial<ReleaseCompatibility>;
  if (
    parsed.schemaVersion !== 1
    || parsed.packageName !== 'convosketchpad'
    || typeof parsed.applicationVersion !== 'string'
    || !isEpoch(parsed.databaseSchemaEpoch)
    || !isEpoch(parsed.minimumReadableDatabaseSchemaEpoch)
    || !isEpoch(parsed.maximumReadableDatabaseSchemaEpoch)
    || parsed.minimumReadableDatabaseSchemaEpoch > parsed.databaseSchemaEpoch
    || parsed.maximumReadableDatabaseSchemaEpoch < parsed.databaseSchemaEpoch
  ) {
    throw new Error('invalid ConvoSketchpad update compatibility manifest');
  }
  if (expectedVersion && parsed.applicationVersion !== expectedVersion) {
    throw new Error(
      `compatibility manifest version ${parsed.applicationVersion} does not match ${expectedVersion}`,
    );
  }
  return parsed as ReleaseCompatibility;
}

export function canReadDatabaseSchema(
  compatibility: ReleaseCompatibility,
  databaseSchemaEpoch: number,
): boolean {
  return databaseSchemaEpoch >= compatibility.minimumReadableDatabaseSchemaEpoch
    && databaseSchemaEpoch <= compatibility.maximumReadableDatabaseSchemaEpoch;
}

function isEpoch(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}
