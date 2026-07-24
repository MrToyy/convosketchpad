# ConvoSketchpad Canvas design decisions

## Product direction

ConvoSketchpad is an independent, Canvas-only product for designers and other visual thinkers. It is not a second navigation mode inside a general OpenClaw dashboard. The product organizes alternative AI directions spatially and preserves the relationship between prompts, outputs, references, and generated work.

## Core model

```text
Canvas (one selected Agent)
  ├─ Root Branch
  │    ├─ Interaction → Interaction → Interaction
  │    └─ Fork Branch from a historical Interaction
  └─ Root Branch
```

- A Canvas is an owner-scoped visual workspace bound to one OpenClaw Agent.
- A Branch maps to one stable OpenClaw Session key.
- An Interaction is one complete user input → Agent output turn.
- A Root Branch starts without inherited context.
- A Fork Branch starts from an immutable snapshot through its source Interaction.
- Layout is product data and persists separately from transcript data.

## Agent decision

Canvas creation remains deliberately simple: the browser supplies a default name and the server resolves the Gateway's current default Agent from `agents.list`.

The Agent selector is available only before the first user interaction. The effective lock boundary is preparation of the first send, not acknowledgement, so an Agent cannot change while a send is in flight. A valid change updates the Canvas and rewrites every draft Branch session key transactionally. Every prepare request carries `expectedAgentId`; mismatches fail instead of silently routing a prompt to a different Agent.

After the lock, users create another Canvas when they need a different Agent. Mixing Agents within one Canvas would make Session ownership, workspace attachments, and Fork context ambiguous, so it is intentionally unsupported.

## Branch invariants

1. A Branch has at most one head Interaction.
2. Continue is valid only when the caller's expected head matches the stored head.
3. Only one prepared send may exist for a Branch.
4. A historical completed Interaction may be forked; the current head may not.
5. Draft Root and Fork composers are deduplicated.
6. Interactions are append-only from the user's perspective.
7. OpenClaw Sessions are created lazily on the first real send.
8. The first send after a predicted or observed OpenClaw Session reset carries
   the canonical Branch snapshot; recovery does not rewrite prior Canvas or
   OpenClaw data.

## Context strategy

Healthy Continue relies on the OpenClaw Session and does not replay Canvas history. Fork and Session recovery use a canonical snapshot assembled from persisted ancestor Interactions. Recovery is selected when the observed Session ID drifts or when the configured daily/idle OpenClaw reset policy predicts that the next send will create a replacement Session. The snapshot can include a resource manifest; readable files are resubmitted as OpenClaw attachments when materializing the new Session.

The Canvas database is authoritative for topology and immutable history. OpenClaw remains authoritative for execution and transcript completion. The reconciler joins the two without rewriting OpenClaw history.

## Attachment and Artifact durability

Workspace staging exists only to make the current upload readable to OpenClaw tools. Before the Interaction is committed, ConvoSketchpad creates an owner-scoped durable copy. Forks therefore never depend on the original workspace file still existing.

Generated OpenClaw media, local/data resources, and tool outputs are materialized into the Canvas Artifact store where possible. External HTTP(S) resources remain references. A missing Artifact degrades the file result but does not erase a successful text response.

## Reconciliation

Gateway terminal events are hints, not authoritative completion records. Reconciliation waits for the matching Session/transcript state, extracts the final assistant content and Artifacts, and stores reconciliation metadata. Unfinished and degraded records are retried after restart and when their Graph is loaded.

## Ownership and security

Every Canvas object and durable file is owner-scoped. When auth is disabled, a fixed Local User owns the data. The first managed user atomically adopts Local User Canvases; subsequent users remain isolated in ConvoSketchpad storage while sharing the configured Gateway capability boundary.

## Explicit non-goals

- General linear Chat UI or importing Chat history.
- Tasks/Kanban and project management.
- Session browsing or arbitrary Session mutation.
- Memory/config/workspace editing.
- Cron and Skills administration.
- Voice input, wake words, speech recognition, or speech synthesis.
- Multiple Agents in one Canvas.
- Rewriting OpenClaw transcripts.

## Product surface

The application contains the Canvas, connection/auth flows, appearance settings, Gateway restart, and small Log/Events/Usage observability drawers. Everything else must justify itself as a direct Canvas dependency.
