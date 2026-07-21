# Repository Agent Guide

本仓库在 OpenClaw Nerve 上维护独立的 Canvas 与受管用户认证功能。开始工作前，先按任务类型读取对应索引；不要依靠全仓搜索重新推断已经记录的结构。

## 功能导航

| 任务 | 首先阅读 | 用途 |
|---|---|---|
| Canvas 页面、节点、布局、Branch、Interaction、附件或 Artifact | [`docs/canvas/CANVAS-CODE-MAP.md`](docs/canvas/CANVAS-CODE-MAP.md) | 功能约束、前后端组件、数据流与测试入口 |
| 登录、用户 Token、用户隔离、限流、Cookie、WS/SSE 鉴权 | [`docs/canvas/AUTH-CODE-MAP.md`](docs/canvas/AUTH-CODE-MAP.md) | Auth 组件、CLI、SQLite 用户数据与会话撤销链路 |
| 分支、remote、同步 upstream、合并、提交或推送 | [`docs/canvas/GIT-WORKFLOW.md`](docs/canvas/GIT-WORKFLOW.md) | `master` / `feat/canvas` 职责和安全同步步骤 |
| 不确定从哪里开始 | [`docs/canvas/README.md`](docs/canvas/README.md) | Canvas 定制功能总索引和按任务阅读顺序 |

## 设计与运行机制

- Canvas MVP 的产品与架构决策：[`docs/OPENCLAW-CANVAS-MVP-DESIGN.md`](docs/OPENCLAW-CANVAS-MVP-DESIGN.md)
- Nerve 原有前后端、Session 和数据流：[`docs/NERVE-RUNTIME-AND-DATA-FLOW.md`](docs/NERVE-RUNTIME-AND-DATA-FLOW.md)
- 通用配置、安全与 API：[`docs/CONFIGURATION.md`](docs/CONFIGURATION.md)、[`docs/SECURITY.md`](docs/SECURITY.md)、[`docs/API.md`](docs/API.md)

## 文档维护约定

- 新增、移动或重命名 Canvas/Auth 组件时，同步更新对应 `*-CODE-MAP.md`。
- 改变 Branch、Interaction、附件、Artifact、用户或会话语义时，同时更新设计文档。
- Git 规则只在 `docs/canvas/GIT-WORKFLOW.md` 维护；本文件仅保留入口，避免规则出现多个版本。
