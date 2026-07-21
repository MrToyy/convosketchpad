# Canvas 定制功能索引

此目录是 OpenClaw Canvas 定制代码的导航层。目标是先根据任务定位到一份短文档，再从该文档直接进入代码、测试或详细设计，避免每次重新搜索整个 Nerve 仓库。

## 按任务选择文档

| 你要处理的任务 | 阅读入口 |
|---|---|
| Canvas UI、Interaction 卡片、编辑节点、自动布局、Fork、附件、图片预览 | [Canvas 代码地图](./CANVAS-CODE-MAP.md) |
| Canvas API、SQLite、Session Mapping、Context Snapshot、落盘协调、Artifact | [Canvas 代码地图](./CANVAS-CODE-MAP.md) |
| 登录页、用户 Token、CLI 用户管理、Canvas owner 隔离、暴力破解限制 | [Auth 代码地图](./AUTH-CODE-MAP.md) |
| HTTP Cookie、WebSocket、SSE 的登录校验或用户禁用后撤销 | [Auth 代码地图](./AUTH-CODE-MAP.md) |
| 同步 Nerve upstream、维护 `master`、合并到 `feat/canvas`、提交或推送 | [Git 工作流](./GIT-WORKFLOW.md) |

## 详细资料

- [OpenClaw Canvas MVP 设计说明](../OPENCLAW-CANVAS-MVP-DESIGN.md)：产品目标、数据模型、分支语义、上下文和架构决策。
- [Nerve 运行机制与数据流](../NERVE-RUNTIME-AND-DATA-FLOW.md)：Nerve 原有前后端、Chat、Tasks、Session 与文件结构。
- [API](../API.md)：完整 HTTP API 参考。
- [Configuration](../CONFIGURATION.md)：环境变量、网络访问与用户管理命令。
- [Security](../SECURITY.md)：认证、Origin、CSP、Gateway Token 注入与部署风险。

## 关键目录

```text
src/features/canvas/       Canvas 前端主体
src/features/auth/         登录与前端 Auth 状态
server/routes/canvas.ts    Canvas HTTP API
server/routes/auth.ts      登录、登出和状态 API
server/lib/canvas-*.ts     Canvas 数据库、身份和落盘协调
server/lib/managed-users.ts
server/lib/user-management.ts
bin/nerve-users.ts         仅限本机命令行的用户管理
database/canvas.sqlite     运行时数据；被 Git 忽略
```

## 更新规则

代码入口变化时优先更新本目录中的代码地图。只有产品语义或架构决策变化时，才需要同步修改完整设计说明。
