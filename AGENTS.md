# 仓库 Agent 指南

本仓库是独立维护的 ConvoSketchpad，包含 Canvas、OpenClaw 集成与受管用户认证。开始工作前必须先阅读本文，再按任务索引读取对应文档；不要依靠全仓搜索重新推断已有设计。

如果以后在子目录增加更具体的 `AGENTS.md`，以距离目标文件最近的规则为准。用户在当前任务中的明确要求优先于仓库约定。

## 产品与职责边界

- ConvoSketchpad 不是独立的 Agent 运行环境，必须连接到可访问的 OpenClaw Gateway。
- OpenClaw 负责 Agent、工具、执行、Session、事件和对话记录。
- ConvoSketchpad 负责 Canvas 拓扑与布局、Branch/Interaction 关系、发送协调、恢复元数据、受管用户隔离，以及附件和 Artifact 的持久化副本。
- 新能力优先使用 OpenClaw 原生 Gateway 或 CLI 能力，不得新增对 OpenClaw 本地配置文件或 Agent 工作区的直接读写依赖。
- 不得检查 Codex/Claude 本地凭据或调用它们的 CLI 获取 Provider、用量或配额数据；相关信息只使用 OpenClaw 原生接口。

## 任务索引

| 任务 | 首先阅读 | 说明 |
|---|---|---|
| 不确定从哪里开始、查看完整文档 | [`docs/README.md`](docs/README.md) | 全部产品、运维和维护者文档索引 |
| 产品目标、体验或职责边界 | [`docs/PRODUCT.md`](docs/PRODUCT.md) | 产品原则和 OpenClaw/ConvoSketchpad 分工 |
| 架构、Session、数据流或持久化 | [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | 运行时模型、发送、恢复和文件流 |
| Canvas 页面、节点、布局、Branch、Interaction、附件或 Artifact | [`docs/canvas/CANVAS-CODE-MAP.md`](docs/canvas/CANVAS-CODE-MAP.md) | Canvas 不变量、前后端入口与测试 |
| 登录、用户 Token、隔离、限流、Cookie 或 WS 鉴权 | [`docs/canvas/AUTH-CODE-MAP.md`](docs/canvas/AUTH-CODE-MAP.md) | 认证链路、CLI、SQLite 与会话撤销 |
| HTTP 路由或接口契约 | [`docs/API.md`](docs/API.md) | Canvas、认证、文件和遥测 API |
| 本地安装、开发环境或贡献流程 | [`docs/INSTALL.md`](docs/INSTALL.md)、[`CONTRIBUTING.md`](CONTRIBUTING.md) | 安装向导、统一开发命令和实现要求 |
| 环境变量或 Gateway 配置 | [`docs/CONFIGURATION.md`](docs/CONFIGURATION.md) | 配置来源、默认值和原生 OpenClaw 设置 |
| 部署、网络暴露或远程访问 | [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)、[`docs/SECURITY.md`](docs/SECURITY.md) | 部署拓扑、安全基线和信任模型 |
| 故障诊断 | [`docs/TROUBLESHOOTING.md`](docs/TROUBLESHOOTING.md) | 连接、Agent、Session、文件和认证问题 |
| 更新、Release 或版本记录 | [`docs/UPDATING.md`](docs/UPDATING.md)、[`CHANGELOG.md`](CHANGELOG.md) | 更新器、发布规则和变更记录 |
| 分支、Remote、提交或推送 | [`docs/canvas/GIT-WORKFLOW.md`](docs/canvas/GIT-WORKFLOW.md) | `main` 分支职责和 Git 安全步骤 |

## 开发流程

1. 运行 `git status --short --branch`，识别并保留用户已有修改。
2. 根据上表完整阅读任务相关文档，再检查对应代码、类型和测试。
3. 在现有子系统内完成最小且一致的修改，避免创建平行实现或重复事实来源。
4. 添加或更新与改动直接相关的测试，先运行针对性检查。
5. 评估文档影响并按下节同步更新；不要把文档维护留给后续任务。
6. 完成后检查差异、运行相称的验证，并报告修改、文档影响、测试结果和未解决限制。

## 实现与安全约定

- 使用现有 TypeScript、ES Module、React、Hono、Gateway 和数据访问模式；引入新抽象前先查找已有辅助模块。
- 将 Canvas 拓扑、Branch 头节点、发送预留、Agent 锁定、所有者边界和持久化文件视为数据完整性约束。
- 保留 `chat.send`、`agents.list` 等 OpenClaw 原生协议名，不把传输契约改写成产品文案。
- 所有写入入口必须校验输入，并保留认证、Origin、限流、路径和所有者检查。
- 不得记录或返回 Gateway Token、用户 Token、设备凭据、Cookie Secret 或其他敏感信息。
- 前端变更应清理计时器、监听器、Socket 和 Observer；服务端变更应考虑重启、重试和并发失败。
- 优先修复根因；不得通过吞掉错误、伪造成功结果或削弱测试断言完成任务。
- 未经用户明确要求，不升级依赖、不修改版本号、不扩大网络或权限范围。

## 文档同步约定

代码变更影响以下内容时，必须在同一次变更中更新对应文档：

- 新增、移动或重命名 Canvas/Auth 组件：更新对应 `*-CODE-MAP.md`。
- 改变 Agent、Branch、Interaction、附件、Artifact、用户、Session 或恢复语义：更新 `docs/ARCHITECTURE.md`。
- 改变产品目标、职责边界或核心体验：更新 `docs/PRODUCT.md`。
- 新增或修改 HTTP 路由、请求、响应或错误契约：更新 `docs/API.md`。
- 新增、删除或改变环境变量：同步更新 `.env.example` 和 `docs/CONFIGURATION.md`。
- 改变安装、开发、部署、认证、安全、排障或更新方式：更新对应运维文档。
- 用户可见或 Release 相关的重要变化：更新 `CHANGELOG.md`。

纯内部重构如果不影响上述文档内容，可以不制造无意义的文档差异，但交付说明必须明确写出“已评估，无文档影响”。Git 规则只在 `docs/canvas/GIT-WORKFLOW.md` 维护，本文只保留入口和通用安全边界。

## 验证要求

- 修改代码时至少运行直接相关的测试，并检查 TypeScript/ESLint 影响。
- 大范围变更、跨子系统改动或复杂分支整合必须运行：

```bash
npm test -- --run
npm run lint
npm run build
```

- 文档变更至少检查本地链接、命令、锚点、`git diff --check` 和受影响的自动化约束。
- 构建或测试出现与本次修改无关的既有失败时，记录准确命令和错误，不得隐瞒或擅自修改无关代码。

## Git 与交付安全

- 现有修改属于用户；未经明确许可不得丢弃、重置、覆盖或 Stash。
- 不得提交 `.env`、数据库、日志、依赖目录或构建产物。
- 不使用破坏性 Git 命令，不删除 `main`，也不向 `main` Force Push。
- 提交前按 Git 工作流核对暂存范围；只提交当前任务明确包含的文件。
