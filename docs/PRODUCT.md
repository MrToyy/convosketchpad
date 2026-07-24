# Product goal

**A branching AI workspace for visual thinkers**

ConvoSketchpad helps people explore AI-assisted work spatially instead of compressing every direction into one linear conversation. A Canvas keeps alternative ideas visible, preserves how each direction developed, and keeps the prompts, outputs, references, attachments, and generated work for that direction together.

## Core experience

- Start multiple independent directions on one visual Canvas.
- Continue a promising direction without replaying its history.
- Fork any completed historical Interaction to explore an alternative from that point.
- Move and arrange Branches as part of the work, with layout preserved between visits.
- Keep source attachments and generated Artifacts durable and associated with the correct Interaction.
- Choose an OpenClaw Agent before work starts, then keep execution ownership stable for the life of the Canvas.

## Product principles

### Spatial structure is durable data

Canvas topology and layout are not temporary presentation state. They are persisted alongside immutable Interaction history so the workspace can be reconstructed reliably.

### Branching is explicit

Continue extends the current Branch. Fork creates a new direction from a completed historical Interaction. The interface and data model keep those operations distinct.

### OpenClaw executes; ConvoSketchpad organizes

OpenClaw owns Agents, tools, Sessions, execution, events, and transcripts. ConvoSketchpad owns the visual graph, Branch relationships, send coordination, durable files, recovery metadata, and managed-user isolation.

### Recovery preserves history

If OpenClaw replaces or removes a Session, ConvoSketchpad restores the next send from its canonical Branch snapshot without rewriting earlier Interactions or OpenClaw transcripts.

### Ownership is explicit

Every Canvas object and durable file belongs to one ConvoSketchpad owner. Managed users share the configured Gateway capability boundary but do not share Canvas data.
