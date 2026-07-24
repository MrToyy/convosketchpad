# ConvoSketchpad feature index

ConvoSketchpad maintains a focused Canvas interaction environment plus managed-user authentication.

| Task | Read first |
|---|---|
| Canvas UI, nodes, layout, Branch/Fork, Agent selection, attachments, Artifacts | [Canvas code map](CANVAS-CODE-MAP.md) |
| Login, user Tokens, owner isolation, Cookies, WebSocket auth | [Auth code map](AUTH-CODE-MAP.md) |
| Branches, remotes, upstream sync, commits, pushes | [Git workflow](GIT-WORKFLOW.md) |

Detailed references:

- [Product goal](../PRODUCT.md)
- [Architecture and runtime data flow](../ARCHITECTURE.md)
- [API](../API.md)
- [Configuration](../CONFIGURATION.md)
- [Security](../SECURITY.md)

Key paths:

```text
src/features/canvas/       Canvas product UI
src/features/chat/         Canvas-used OpenClaw protocol and media primitives
src/features/auth/         Managed login
server/routes/canvas.ts    Canvas HTTP API
server/lib/canvas-*.ts     Data, files, auth identity, reconciliation
database/canvas.sqlite     Runtime database (ignored)
artifacts/                 Durable Canvas files (ignored)
```
