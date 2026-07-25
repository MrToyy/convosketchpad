# 架构与运行时数据流

ConvoSketchpad 提供用于组织 OpenClaw 分支交互的可视化 Canvas。配套界面覆盖连接、认证、外观、Gateway 重启，以及精简的日志、事件和用量信息。

## 职责边界

OpenClaw 负责 Agent、工具、执行、Session、流式事件和对话记录。ConvoSketchpad 负责 Canvas、Branch 与 Interaction 的关系、布局、发送预留、Session 完整性观察、受管用户，以及持久化附件和 Artifact。

在 Gateway 契约涉及 `chat.send`、`chat` 事件等名称时，底层代码保留 OpenClaw 原生协议名。

## 进程模型

```text
浏览器
  ├─ React Flow Canvas
  ├─ WebSocket RPC → ConvoSketchpad WS 代理 → OpenClaw Gateway
  └─ 按所有者隔离的 HTTP API → Hono 服务端
                                 ├─ CanvasStore（SQLite）
                                 ├─ 附件与 Artifact 存储
                                 ├─ 受管用户认证
                                 └─ Gateway RPC 协调器 → OpenClaw 对话记录
```

浏览器从 Hono 服务端加载 React SPA，通过服务端 WebSocket 中继连接 OpenClaw，并使用 HTTP 路由访问 Canvas 状态和 Canvas 自有文件。服务端还保持 Gateway RPC 访问，用于发现 Agent、检查 Session、读取重置策略、下载 Artifact、查询用量以及协调对话记录。

两条 Gateway 链路使用同一个持久化 ConvoSketchpad 设备身份，并且只申请 `operator.read` 和 `operator.write` 权限。配对审批由 OpenClaw 管理。设备 Token 只保留在服务端；Gateway 的 hello 响应转发到浏览器前会移除设备 Token 字段。

## 产品模型

```text
Canvas（绑定一个 Agent）
  ├─ 主 Branch
  │    ├─ Interaction → Interaction → Interaction
  │    └─ 从历史 Interaction 创建的分支 Branch
  └─ 主 Branch
```

- Canvas 是按所有者隔离、绑定一个 OpenClaw Agent 的可视化工作区。
- Branch 对应一个稳定的 OpenClaw Session key。
- Interaction 表示一轮完整的用户输入和 Agent 输出。
- 主 Branch 从无继承上下文的状态开始。
- 分支 Branch 从截至源 Interaction 的不可变快照开始。
- 布局独立于对话记录数据持久化。

### Branch 不变量

1. 一个 Branch 最多只有一个头部 Interaction。
2. 继续 Branch 时，调用方提供的预期头节点必须与已存储头节点一致。
3. 一个 Branch 同时只能存在一个已预留发送。
4. 可以从已完成的历史 Interaction 创建分支，但不能从当前头节点创建。
5. 草稿状态的主 Branch 和分支输入框必须去重。
6. 从用户视角看，Interaction 只能追加，不能改写。
7. OpenClaw Session 在首次真实发送时才会延迟创建。
8. Session 恢复绝不改写早期 Canvas 数据或 OpenClaw 对话记录。

## 前端

| 区域 | 入口 |
|---|---|
| 应用框架和遥测抽屉 | `src/App.tsx`、`src/components/TopBar.tsx`、`src/components/StatusBar.tsx` |
| Canvas 图和 Interaction 生命周期 | `src/features/canvas/CanvasPanel.tsx` |
| Canvas REST 客户端和数据契约 | `src/features/canvas/api.ts`、`src/features/canvas/types.ts` |
| 附件准备 | `src/features/canvas/attachments.ts` |
| OpenClaw 发送与事件基础能力 | `src/features/chat/operations/` |
| 连接与 WebSocket | `src/contexts/GatewayContext.tsx`、`src/hooks/useWebSocket.ts` |
| 受管登录 | `src/features/auth/` |
| 外观和连接设置 | `src/features/settings/` |

保留的 `src/features/chat/` 模块是 Canvas 运行时使用的 Gateway 传输、事件分类、图片压缩和图片显示基础能力。

## 服务端

| 区域 | 入口 |
|---|---|
| 路由组装 | `server/app.ts` |
| Canvas API | `server/routes/canvas.ts` |
| Canvas Schema 和状态机 | `server/lib/canvas-db.ts` |
| 对话记录与 Artifact 协调 | `server/lib/canvas-reconciler.ts` |
| 持久化文件 | `server/lib/canvas-artifact-store.ts` |
| Canvas 自有 multipart 上传 | `server/routes/upload-reference.ts`、`server/lib/canvas-artifact-store.ts` |
| Gateway 服务端 RPC | `server/lib/gateway-rpc.ts` |
| 浏览器 WebSocket 中继 | `server/lib/ws-proxy.ts` |
| 受管用户 | `server/routes/auth.ts`、`server/lib/managed-users.ts` |

## Canvas 创建与 Agent 选择

1. 浏览器使用名称调用 `POST /api/canvas/canvases`。
2. 服务端调用 `agents.list` 并保存 Gateway 返回的 `defaultId`。
3. 空 Canvas 创建一个尚未绑定 OpenClaw Session 的草稿主 Branch。
4. 在任何发送预留或 Interaction 出现前，用户可以选择列表中的其他 Agent。
5. 服务端更新 Canvas，并在一个事务中把所有草稿 Branch key 重写为 `agent:<agentId>:canvas:<branchId>`。
6. 准备首次发送后，Agent 选择即被锁定。

每个 prepare 请求都携带 `expectedAgentId`；过期请求会直接失败，不会把工作路由到另一个 Agent。

## 发送流程

```text
准备原生附件载荷并遵守 Gateway `maxPayload`
  → 持久化 Canvas 自有附件
  → prepare-send（所有者、头节点、Agent 和排他性检查）
  → 检查 Session 身份和有效重置策略
  → 持久化发送预留
  → Gateway chat.send
  → 使用 runId 和当前 Session ID 确认预留
  → 消费 agent/chat 事件
  → 协调权威对话记录和 Artifact
  → 持久化已完成的 Interaction
```

健康的 Branch 会继续使用现有 Session，不会重放历史。分支 Branch 的首次发送携带不可变的规范快照，并引用可复用的祖先资源。

## Session 完整性与恢复

ConvoSketchpad 将 Branch Session key 视为稳定标识，同时观察实际 OpenClaw `sessionId` 和 Session 开始时间。

- Session 相同：正常继续。
- Session 已替换或缺失：将 Branch 标记为漂移，并在下一次发送时加入规范快照。
- 已到每日或空闲重置时间：在 OpenClaw 替换 Session 前主动加入快照。
- 无法读取重置策略：保守地使用恢复物化方式。

每日边界使用 `CONVOSKETCHPAD_GATEWAY_TIMEZONE`。该值默认取 ConvoSketchpad 宿主机时区；远程 Gateway 使用其他时区时必须显式配置。

## 附件、Artifact 与协调

上传内容直接持久化到按所有者隔离的 Canvas 存储，然后通过 OpenClaw `chat.send.attachments` 发送。ConvoSketchpad 不会写入所选 Agent 的工作区，分支会复用 Canvas 自有副本。

协调器优先使用 `artifacts.list/download`，之后才执行兼容性解析。Gateway 返回的字节和同 Gateway URL 会物化到 Canvas Artifact 存储；外部 HTTP(S) 资源仍保留为引用。相对路径仅在 Gateway 声明 `agents.workspace.get` 时读取。显式绝对路径只有在位于 `agents.list` 返回的工作区或系统临时目录之下，并通过 `realpath` 和符号链接检查时才允许读取。Artifact 缺失只会让文件结果降级，不会抹除已成功生成的文本回复。

Gateway 终止事件只作为完成提示。协调器读取权威对话记录，持久化输出和 Artifact，并在服务重启后或加载 Canvas 时重试未完成或已降级的记录。

## 持久化

| 数据 | 所有者或位置 |
|---|---|
| Agent、工具、执行、Session、对话记录 | OpenClaw |
| 配对审批和已配对设备记录 | OpenClaw |
| ConvoSketchpad 设备密钥和每个 Gateway 的设备 Token | `~/.convosketchpad/device-identity.json`、`~/.convosketchpad/gateway-auth.json` |
| Canvas、Branch、Interaction、发送预留、布局、受管用户 | `database/canvas.sqlite` |
| 持久化附件和 Artifact | `artifacts/` |
| 精简活动日志 | `agent-log.json` |

备份和恢复时必须同时处理 `database/canvas.sqlite` 与 `artifacts/`。

## 验证

```bash
npm test -- --run
npm run lint
npm run build
```
