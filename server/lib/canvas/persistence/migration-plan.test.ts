import { describe, expect, it } from 'vitest';
import { packageMetadata } from '../../package-metadata.js';
import { CANVAS_MIGRATION_PLAN } from './migration-plan.js';

describe('Canvas migration plan', () => {
  it('contains exactly the three continuous migrations required by v0.4.0', () => {
    expect(CANVAS_MIGRATION_PLAN).toEqual([
      {
        id: '0.2.0_to_0.3.0_v1',
        fromVersion: '0.2.0',
        toVersion: '0.3.0',
        kind: 'schema',
      },
      {
        id: '0.3.0_media_derivatives_v1',
        fromVersion: '0.3.0',
        toVersion: '0.3.2',
        kind: 'maintenance',
      },
      {
        id: '0.3.2_to_0.4.0_agent_runtime_v1',
        fromVersion: '0.3.2',
        toVersion: '0.4.0',
        kind: 'schema',
      },
    ]);
  });

  it('has no gaps, duplicate IDs, or target beyond the package version', () => {
    for (let index = 1; index < CANVAS_MIGRATION_PLAN.length; index += 1) {
      expect(CANVAS_MIGRATION_PLAN[index].fromVersion)
        .toBe(CANVAS_MIGRATION_PLAN[index - 1].toVersion);
    }
    expect(new Set(CANVAS_MIGRATION_PLAN.map(({ id }) => id)).size)
      .toBe(CANVAS_MIGRATION_PLAN.length);
    expect(CANVAS_MIGRATION_PLAN.at(-1)?.toVersion).toBe(packageMetadata.version);
  });
});
