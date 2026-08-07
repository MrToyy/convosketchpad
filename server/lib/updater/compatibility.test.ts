import { describe, expect, it } from 'vitest';
import { canReadDatabaseSchema, parseReleaseCompatibility } from './compatibility.js';

const manifest = JSON.stringify({
  schemaVersion: 1,
  packageName: 'convosketchpad',
  applicationVersion: '0.4.1',
  databaseSchemaEpoch: 3,
  minimumReadableDatabaseSchemaEpoch: 3,
  maximumReadableDatabaseSchemaEpoch: 3,
});

describe('release compatibility manifest', () => {
  it('validates the package version and readable schema range', () => {
    const parsed = parseReleaseCompatibility(manifest, '0.4.1');
    expect(canReadDatabaseSchema(parsed, 3)).toBe(true);
    expect(canReadDatabaseSchema(parsed, 4)).toBe(false);
  });

  it('rejects mismatched versions and invalid epoch ranges', () => {
    expect(() => parseReleaseCompatibility(manifest, '0.5.0')).toThrow(/does not match/);
    expect(() => parseReleaseCompatibility(JSON.stringify({
      ...JSON.parse(manifest),
      minimumReadableDatabaseSchemaEpoch: 4,
    }))).toThrow(/invalid/);
  });
});
