export const V020_TO_V030_MIGRATION = '0.2.0_to_0.3.0_v1';
export const CANVAS_MEDIA_BACKFILL_MIGRATION = '0.3.0_media_derivatives_v1';
export const V032_TO_V040_AGENT_BACKEND_MIGRATION = '0.3.2_to_0.4.0_agent_backend_v1';

export const CANVAS_MIGRATION_PLAN = [
  {
    id: V020_TO_V030_MIGRATION,
    fromVersion: '0.2.0',
    toVersion: '0.3.0',
    kind: 'schema',
  },
  {
    id: CANVAS_MEDIA_BACKFILL_MIGRATION,
    fromVersion: '0.3.0',
    toVersion: '0.3.2',
    kind: 'maintenance',
  },
  {
    id: V032_TO_V040_AGENT_BACKEND_MIGRATION,
    fromVersion: '0.3.2',
    toVersion: '0.4.0',
    kind: 'schema',
  },
] as const;
