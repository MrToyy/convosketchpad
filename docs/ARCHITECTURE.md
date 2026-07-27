# 架构与运行时数据流

ConvoSketchpad 是 OpenClaw 之上的可视化 Canvas。运行时严格采用单链条：

```text
浏览器（React）
  ⇅ 同源 HTTP / SSE
ConvoSketchpad（Hono、SQLite、文件存储、发送协调器）
  ⇅ 单一持久 Gateway WebSocket
OpenClaw Gateway
```

浏览器不实现 OpenClaw 握手，不调用 Gateway RPC，不保存 Gateway URL、Gateway Token 或设备 Token。服务端是唯一的 OpenClaw 通信方。

浏览器先读取带持久 `cursor` 的 Graph 快照，再连接当前 Canvas 的 SSE。持久更新以完整实体 upsert 发送；流式文本使用不持久化的 `node.preview`，断线即丢弃。Gateway 全局连接状态与 Canvas 数据同步是两条独立产品契约，浏览器不接收或解释 OpenClaw 原始事件。

## 职责边界

OpenClaw 负责 Agent、工具、执行、Session、原生事件和权威对话记录。ConvoSketchpad 负责：

- Canvas、Branch、Interaction 的拓扑与布局；
- 发送预留、幂等派发、Branch 锁和恢复元数据；
- Canvas 中对话内容的持久化副本；
- 受管用户及所有者隔离；
- 上传附件与生成 Artifact 的持久化副本。

Artifact 持久化保持尽力而为：单文件上限为 25 MiB，无法读取、超过上限或不满足安全路径约束时记录降级警告，不会抹除已完成的文本输出。所有完成 Interaction 都由后端观察晚到 Artifact 至少 2 分钟；已发现 Artifact、同步失败或 Gateway Artifact 能力不完整时按 5、15、60 分钟继续退避观察。已发现 Artifact 全部持久化后，Interaction 立即显示 `synced`，后续晚到观察由 `artifact_sync_jobs` 静默继续；最终真实失败才显示 `degraded`。

Interaction 的 `executionState`（`running | completed | failed | unconfirmed`）与 `artifactSyncState`（`not_started | observing | synced | degraded`）独立。`observing` 只表示当前仍在等待首个 Artifact 或重试未完成副本；已知副本完整时，后台继续观察不会让节点保持“同步中”。执行失败只终止 Agent 执行，不会跳过同一套晚到 Artifact 观察；Artifact 降级也不会把已终止节点重新变成运行中。

## 产品模型与不变量

```text
Canvas（绑定一个 Agent）
  ├─ Branch → Interaction → Interaction
  └─ 从历史 Interaction 创建的 Branch
```

1. Branch 使用稳定的 OpenClaw Session key，并最多有一个头部 Interaction。
2. 继续 Branch 时，`expectedHeadInteractionId` 必须等于数据库中的头节点。
3. 一个 Branch 同时最多有一个 `prepared` 发送预留。
4. `reserved`、`dispatching`、`ambiguous` 状态都保持 Branch 锁定。
5. `ambiguous` 表示请求可能已经写入 Gateway；只能用同一预留 ID 作为幂等键重试，不能按超时解锁或取消。
6. Gateway 明确接受发送后，服务端在事务中创建 Interaction、推进 Branch 头节点并记录 `runId`。
7. 从用户视角看 Interaction 只追加，不改写历史。
8. Gateway 信号优先按 `runId` 关联；Session key 只在恰好存在一个候选节点时作为恢复后备，不允许猜测节点。

## 发送状态机

```text
reserved
  → dispatching
    → acknowledged
    → ambiguous ──同一 idempotencyKey──→ dispatching
    → failed
```

连接尚未就绪或确认没有写出 Frame 时回到 `reserved`。Frame 已写出后超时或断线进入 `ambiguous`。明确的 Gateway 拒绝进入 `failed`。重试间隔依次为 1、3、10、30 秒，之后每 60 秒持续重试。发送协调器不做固定频率数据库扫描：新预留和 Gateway 重连会主动唤醒；已有任务只按最早的 `next_attempt_at` 设置一次计时器，空闲时不保留扫描计时器。

服务启动和 Gateway 重连时都会扫描可派发预留。Graph 的 `pendingSends` 让刷新后的浏览器继续显示锁定状态。

## 发送流程

1. 浏览器把原始附件上传到 Canvas 文件存储；上传路由同时写入 `canvas_attachments` 登记表。
2. 图片压缩仍在浏览器执行，但压缩结果只作为“投递副本”上传给后端；浏览器不组装 `chat.send`。
3. 浏览器调用 `POST /api/canvas/branches/:id/send`，只提交用户文本、预期头节点、预期 Agent 和附件 ID。
4. 服务端从数据库解析附件名称、MIME、大小和文件位置，执行所有者、Agent、Branch 与排他性检查。
5. 服务端持久化发送预留，再由发送协调器调用原生 `chat.send`，预留 ID 同时作为 `idempotencyKey`。
6. Gateway 接受后，服务端创建 `running` Interaction；终态 Gateway 信号先幂等写入收件箱，再由后端关联和协调。
7. `canvas-reconciler` 读取 OpenClaw 权威对话记录，持久化最终文本和 Artifact。

Fork 或 Session 恢复所需的历史资源由服务端从 Canvas 自有副本读取。资源缺失会作为启动警告记录。

## Canvas 同步与后台协调

`GET /api/canvas/canvases/:id/graph` 是无副作用读取，不会启动或重启后台协调。新 Interaction 由发送协调器直接登记，未完成协调由服务启动和 Gateway 重连扫描恢复。

数据库事务通过 `canvas_changes` 同时记录可见实体变化。`GET /api/canvas/canvases/:id/events?after=<cursor>` 将 cursor 之后的变化按实体合并为 `CanvasSyncBatch`，发送最新完整投影而非中间事件序列。Interaction `version` 阻止旧批次覆盖新节点；内部检查时间和协调心跳不会增加版本。

`node.preview` 直接从后端 Gateway 适配层发送，不写 Interaction、change 表或日志。最终对话协调完成后，完整 Interaction upsert 替换 Preview。Canvas SSE 不可用且快照仍有未终止任务时，浏览器才每 15 秒降级读取 Graph，并遵循 `Retry-After`。

Gateway 终态信号保存在 `gateway_signal_inbox`；Artifact 观察状态、尝试次数和下一次执行时间保存在 `artifact_sync_jobs`。服务重启会扫描持久任务恢复协调，内存计时器只负责唤醒。Interaction 已显示 `synced` 时仍可存在静默观察任务。

## Gateway 连接

`server/lib/gateway-rpc.ts` 维护唯一连接，身份固定为：

- `client.id = "gateway-client"`
- `client.mode = "backend"`
- `client.platform = "node"`
- `role = "operator"`
- scopes 为 `operator.read`、`operator.write`

后端启动时即尝试连接 Gateway。首次连接、握手或已建立连接发生非主动中断时都进入同一个指数退避重连循环，间隔从 1 秒增长到最多 30 秒；成功握手后重置退避。浏览器仅订阅这一后端状态，不负责驱动 Gateway 重连。

连接鉴权按 Gateway 地址分为两种模式：

- loopback Gateway（`localhost`、`127.0.0.0/8`、`::1`）：使用共享 `GATEWAY_TOKEN`，不发送设备身份，也不触发设备配对；
- 远程 Gateway：持久 WebSocket 使用已审批且精确为 read/write 的设备 Token；没有设备 Token 时共享 Token 只用于发起配对；
- Gateway HTTP 路由始终使用共享 `GATEWAY_TOKEN`，设备 Token 只属于远程 WebSocket 身份。

Node 客户端不发送浏览器 `Origin` Header，因此 ConvoSketchpad 不需要修改 `gateway.controlUi.allowedOrigins`。该 OpenClaw 设置仍可能被原生 Control UI 使用，安装和更新流程不会删除已有值。

远程 Gateway 的 setup 创建唯一匹配 ConvoSketchpad 持久密钥的 request，审批必须在 Gateway 宿主机完成。已有本机设备凭据不会删除，但 loopback 模式不会读取或使用它们。

## 前端

| 区域 | 入口 |
|---|---|
| Canvas 数据控制、发送和完整实体更新 | `src/features/canvas/CanvasPanel.tsx` |
| Interaction/Composer 节点与节点布局适配 | `src/features/canvas/CanvasNodes.tsx`、`src/features/canvas/constants.ts` |
| 产品 HTTP 客户端与数据契约 | `src/features/canvas/api.ts`、`src/features/canvas/types.ts` |
| 图片压缩与附件投递副本 | `src/features/canvas/attachments.ts` |
| Gateway 运行状态上下文 | `src/contexts/RuntimeContext.tsx`、`src/hooks/useRuntimeEvents.ts` |
| Canvas SSE、实体合并与降级退避 | `src/hooks/useCanvasSync.ts`、`src/features/canvas/sync.ts`、`src/features/canvas/graph-refresh.ts` |
| 登录和外观设置 | `src/features/auth/`、`src/features/settings/` |

## 服务端

| 区域 | 入口 |
|---|---|
| Canvas API | `server/routes/canvas.ts` |
| Gateway 运行状态 SSE | `server/routes/runtime.ts`、`server/lib/runtime-events.ts` |
| Canvas cursor、SSE 与 Preview | `server/routes/canvas.ts`、`server/lib/canvas-sync.ts` |
| Schema、迁移和状态机 | `server/lib/canvas-db.ts`、`server/lib/canvas-migrations.ts` |
| 发送协调与恢复重试 | `server/lib/canvas-send-coordinator.ts`、`server/lib/canvas-send-retry.ts` |
| Gateway 唯一连接 | `server/lib/gateway-rpc.ts` |
| 对话与 Artifact 协调 | `server/lib/canvas-reconciler.ts`、`server/lib/canvas-artifact-watch.ts`、`server/lib/canvas-reconciliation-state.ts` |
| 附件和 Artifact 文件存储 | `server/routes/upload-reference.ts`、`server/lib/canvas-artifact-store.ts` |

## 数据模型与迁移

现有 `interactions.attachments_json`、`artifacts_json` 和 `session_metadata_json` 保持向下回滚兼容。Interaction 增量增加 `version`、执行状态、Artifact 同步状态、终止时间和错误字段；迁移完成后，运行时 Artifact 投影只由规范化表读取。

新增 `canvas_attachments` 作为上传登记与投递副本索引。旧 Interaction 中可识别的 Canvas 附件在启动迁移时使用 SQLite JSON1 回填；历史 JSON 保持不可变。

新增 `interaction_artifacts`、`artifact_sync_jobs`、`canvas_changes`、`gateway_signal_inbox` 和内部 `schema_migrations`。从 `0.2.0` 升级时，`0.2.0_to_0.3.0_v1` 在同一个 SQLite 事务中执行一次：

- 从 `0.2.0` 的 JSON 副本回填并合并等价 Artifact 来源，优先保留可用的 Canvas 持久化副本；
- 完成或失败的旧节点只依据本地持久数据计算 Artifact 状态，文本完成且没有 Artifact 的节点为 `synced`，真实不可用副本才为 `degraded`；
- 旧运行节点保守迁移为 `unconfirmed` / `observing`，并创建明确的恢复任务；
- 回填可识别的 Canvas 附件，移除旧协调版本字段，并在事务末尾写入迁移账本。

该数据迁移不连接 Gateway，也不重新读取可能已过期的 Transcript，因此结果不依赖升级时 OpenClaw 的保留窗口或在线状态。新版本服务首次打开 `0.2.0` 数据库时会自动执行；更新器也会在停服后显式运行 `npm run migrate` 并校验外键与 SQLite 完整性。迁移账本存在后不会再次扫描历史节点。此后服务启动只恢复 `running`、`unconfirmed`、`observing` 或仍有 `artifact_sync_jobs` 的明确任务，不使用全局协调版本重新打开已终止节点。

旧 `attachments_json`、`artifacts_json` 和 Session 元数据保留不改，供失败回滚到 `0.2.0` 时读取；新版本不会在后续启动中用旧 JSON 覆盖已规范化的数据。

`send_reservations` 增量新增：

- `dispatch_state`
- `attempt_count`
- `last_attempt_at`
- `next_attempt_at`

升级前未完成的 `prepared` 预留保守迁移为 `ambiguous`，避免把可能已经发出的消息误判为可安全解锁。迁移在事务中执行。

## Session 与持久化

ConvoSketchpad观察实际 `sessionId` 和重置策略。Session 漂移、缺失或即将重置时，下一次发送加入规范快照，但不改写历史。

| 数据 | 权威方或位置 |
|---|---|
| Agent、工具、执行、Session、原始对话记录 | OpenClaw |
| Canvas、Branch、Interaction、发送预留、附件与 Artifact 索引、同步任务、cursor、Gateway 信号、布局、用户 | `database/canvas.sqlite` |
| 持久化附件和 Artifact | `artifacts/` |
| 设备私钥和 Gateway 设备 Token | `~/.convosketchpad/` 或 `CONVOSKETCHPAD_DATA_DIR` |

备份时必须同时处理 `database/canvas.sqlite` 与 `artifacts/`。

后端诊断只写结构化 stdout/stderr，由部署环境采集；诊断日志不包含用户正文或凭据，也不承担产品状态、恢复或审计职责。旧 `agent-log.json` 不再读取或写入，升级时不会自动删除。
