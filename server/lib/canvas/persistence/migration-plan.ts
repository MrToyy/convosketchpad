export const V020_TO_V030_MIGRATION = '0.2.0_to_0.3.0_v1';
export const CANVAS_MEDIA_BACKFILL_MIGRATION = '0.3.0_media_derivatives_v1';
export const V032_TO_V040_AGENT_RUNTIME_MIGRATION = '0.3.2_to_0.4.0_agent_runtime_v1';
export const V040_TO_V050_RESOURCE_REFERENCES_MIGRATION = '0.4.0_to_0.5.0_resource_references_v1';
export const V050_TO_V060_CANVAS_COMPOSITION_MIGRATION = '0.5.0_to_0.6.0_canvas_composition_v1';

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
    id: V032_TO_V040_AGENT_RUNTIME_MIGRATION,
    fromVersion: '0.3.2',
    toVersion: '0.4.0',
    kind: 'schema',
  },
  {
    id: V040_TO_V050_RESOURCE_REFERENCES_MIGRATION,
    fromVersion: '0.4.0',
    toVersion: '0.5.0',
    kind: 'schema',
  },
  {
    id: V050_TO_V060_CANVAS_COMPOSITION_MIGRATION,
    fromVersion: '0.5.0',
    toVersion: '0.6.0',
    kind: 'schema',
  },
] as const;
