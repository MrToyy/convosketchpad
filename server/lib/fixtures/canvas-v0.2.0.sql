PRAGMA foreign_keys = ON;

CREATE TABLE canvas_users (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  token_hash TEXT,
  token_version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'unmanaged'
);

CREATE TABLE canvases (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES canvas_users(id),
  name TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE branches (
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

CREATE TABLE interactions (
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

CREATE TABLE canvas_layouts (
  canvas_id TEXT PRIMARY KEY REFERENCES canvases(id) ON DELETE CASCADE,
  layout_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE send_reservations (
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
  updated_at INTEGER NOT NULL,
  bootstrap_resources_json TEXT NOT NULL DEFAULT '[]'
);

CREATE UNIQUE INDEX one_draft_root_per_canvas
  ON branches(canvas_id) WHERE kind = 'root' AND session_state = 'draft';
CREATE UNIQUE INDEX one_draft_fork_per_source
  ON branches(forked_from_interaction_id) WHERE kind = 'fork' AND session_state = 'draft';
CREATE UNIQUE INDEX one_prepared_send_per_branch
  ON send_reservations(branch_id) WHERE status = 'prepared';
CREATE INDEX canvas_owner_updated ON canvases(owner_id, updated_at DESC);
CREATE INDEX interaction_branch_created ON interactions(branch_id, created_at);
