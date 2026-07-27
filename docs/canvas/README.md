# ConvoSketchpad 功能索引

ConvoSketchpad 提供聚焦的 Canvas 交互环境和受管用户认证。

| 任务 | 首先阅读 |
|---|---|
| Canvas 界面、节点、布局、Branch/Fork、Agent 选择、附件或 Artifact | [Canvas 功能与代码地图](CANVAS-CODE-MAP.md) |
| 登录、用户 Token、所有者隔离、Cookie 或 SSE 认证 | [认证功能与代码地图](AUTH-CODE-MAP.md) |
| 分支、Remote、Upstream 同步、合并、提交或推送 | [Git 与 Upstream 同步工作流](GIT-WORKFLOW.md) |

详细参考：

- [产品目标与原则](../PRODUCT.md)
- [架构与运行时数据流](../ARCHITECTURE.md)
- [HTTP API](../API.md)
- [配置](../CONFIGURATION.md)
- [安全](../SECURITY.md)

关键路径：

```text
src/features/canvas/       Canvas 产品界面
src/features/chat/         Canvas 使用的 OpenClaw 协议与媒体基础能力
src/features/auth/         受管登录
server/routes/canvas.ts    Canvas HTTP API
server/lib/canvas-*.ts     数据、文件、认证身份与协调
database/canvas.sqlite     运行时数据库（已忽略）
artifacts/                 持久化 Canvas 文件（已忽略）
```
