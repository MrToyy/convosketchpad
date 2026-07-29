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
  ├─ 从历史 Interaction 创建的可编辑 Branch
  └─ 从目标 Interaction 上一节点直接提交复制输入的普通 Branch
```

1. Branch 使用稳定的 OpenClaw Session key，并最多有一个头部 Interaction。
2. 继续 Branch 时，`expectedHeadInteractionId` 必须等于数据库中的头节点。
3. 一个 Branch 同时最多有一个 `prepared` 发送预留。
4. `reserved`、`dispatching`、`ambiguous` 状态都保持 Branch 锁定。
5. `ambiguous` 表示请求可能已经写入 Gateway；只能用同一预留 ID 作为幂等键重试，不能按超时解锁或取消。
6. Gateway 明确接受发送后，服务端在事务中创建 Interaction、推进 Branch 头节点并记录 `runId`。
7. 从用户视角看 Interaction 只追加，不改写历史。
8. Gateway 信号优先按 `runId` 关联；Session key 只在恰好存在一个候选节点时作为恢复后备，不允许猜测节点。
9. UI 中的“重试”不是持久化实体：原 Interaction 和原执行保持不变，新结果只表现为一个普通 Root/Fork Branch。

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
2. 浏览器调用 `POST /api/canvas/branches/:id/send`，只提交用户文本、预期头节点、预期 Agent 和附件 ID。
3. 服务端从数据库解析附件名称、MIME、大小和文件位置，执行所有者、Agent、Branch 与排他性检查。
4. 服务端持久化发送预留；需要处理大图时进入可恢复的 `awaiting_media`，由后端生成版本化投递派生文件。
5. 发送协调器调用原生 `chat.send`，预留 ID 同时作为 `idempotencyKey`。
6. Gateway 接受后，服务端创建 `running` Interaction；终态 Gateway 信号先幂等写入收件箱，再由后端关联和协调。
7. `canvas-reconciler` 读取 OpenClaw 权威对话记录，持久化最终文本和 Artifact。

节点“重试”调用通用的原样重新提交用例：后端读取源 Interaction 的用户文本和已登记附件，在同一事务中从其
父 Interaction 创建 `direct-submit` Branch 和 Send Reservation；首节点创建新的 Root Branch。源 Interaction
可以处于任意执行状态，原 OpenClaw 执行不会停止。新 Branch 继续走上述发送状态机，后端不保存 Retry 类型或
Retry 来源。

Fork 与失效 Session 恢复共用一个后端 Replay Package 编译流程：

- 沿目标 Branch 从根到目标节点完整重放全部 Interaction 文本，不根据当前指令猜测或删减历史 Artifact；
- 每个可用历史附件和 Artifact 都在其原始 Interaction 旁保留逻辑引用，并分配稳定的 `F001`、`F002` 等引用；
- 相同内容在多个历史位置出现时保留每个逻辑引用，但按持久化内容 ID 只投递一个物理文件；
- 历史文件只通过原生 `chat.send.attachments` 发送，重放文本不包含 Canvas HTTP URI、数据库 ID 或资源 JSON；
- 历史资源先于本轮用户附件按确定顺序投递；大图由后端生成按内容哈希和策略版本复用的投递派生文件；
- 派生文件准备期间 Send Operation 保持 `awaiting_media`，浏览器无需上传压缩副本或接触重放资源；
- 文件副本缺失时不伪造成功，后端在重放消息中附加简短警告；完整 Replay Package 超出 Gateway
  `maxPayload` 时整次发送明确失败为 `replay_payload_too_large`，不会静默丢弃部分资源。

OpenClaw 在会话记录中可能把 RPC 的 `attachments` 规范化为 `MediaPaths` / `MediaTypes`，因此 Control UI
不一定显示原始 `attachments` 数组；这不代表 Agent 没有收到媒体。

## Canvas 同步与后台协调

`GET /api/canvas/canvases/:id/graph` 是无副作用读取，不会启动或重启后台协调。新 Interaction 由发送协调器直接登记，未完成协调由服务启动和 Gateway 重连扫描恢复。

数据库事务通过 `canvas_changes` 同时记录可见实体变化。`GET /api/canvas/canvases/:id/events?after=<cursor>` 将 cursor 之后的变化按实体合并为 `CanvasSyncBatch`，发送最新完整投影而非中间事件序列。Interaction `version` 阻止旧批次覆盖新节点；内部检查时间和协调心跳不会增加版本。

`node.preview` 直接从后端 Gateway 适配层发送，不写 Interaction、change 表或日志。最终对话协调完成后，完整 Interaction upsert 替换 Preview。Canvas SSE 不可用且快照仍有未终止任务时，浏览器才每 15 秒降级读取 Graph，并遵循 `Retry-After`。

Gateway 终态信号保存在 `gateway_signal_inbox`；Artifact 观察状态、尝试次数和下一次执行时间保存在 `artifact_sync_jobs`。服务重启会扫描持久任务恢复协调，内存计时器只负责唤醒。Interaction 已显示 `synced` 时仍可存在静默观察任务。

底部状态栏的 Branch 数和“工作中”数量直接从当前 Graph 投影；“工作中”按 Branch 去重，只包含
`prepared` 发送与 `running` Interaction。它不把 `unconfirmed`、失败或 Artifact 后台观察包装成用户可处理事项。
Interaction 首次从 `running`/`unconfirmed` 确认完成时，后端从 OpenClaw 读取该物理 Session 的新鲜累计
Token 与上下文上限，并把不可覆盖的 `contextSnapshot` 随 Interaction 保存。读取必须同时匹配完整 Session key
和物理 Session ID；失败不阻塞 Interaction 完成，后续 Artifact 观察也不会补写或覆盖，以免下一轮执行造成串算。
上下文 Meter 仅在 Compose 文本框获得焦点时读取其来源 Interaction 的快照：继续 Branch 使用当前头节点，草稿
Fork 使用分叉来源节点，空白根节点不显示。前端不查询 Gateway、不沿祖先节点求和，也不存在 Canvas 级聚合或周期轮询。

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
| Canvas 页面组合、状态栏投影 | `src/features/canvas/CanvasPanel.tsx`、`src/features/canvas/status.ts` |
| Graph/SSE 控制与 Composer/Send Operation 生命周期、失败草稿恢复 | `src/features/canvas/useCanvasGraphController.ts`、`src/features/canvas/useCanvasComposerDrafts.ts` |
| Graph 到节点和边的纯投影 | `src/features/canvas/canvas-flow-projection.ts` |
| Interaction/Composer 节点与节点布局适配 | `src/features/canvas/CanvasNodes.tsx`、`src/features/canvas/constants.ts` |
| 产品 HTTP 客户端与数据契约 | `src/features/canvas/api.ts`、`src/features/canvas/types.ts` |
| 图片缩略图、按需原图预览 | `src/features/canvas/CanvasNodes.tsx`、`src/features/chat/ImageLightbox.tsx` |
| Gateway 运行状态上下文 | `src/contexts/RuntimeContext.tsx`、`src/hooks/useRuntimeEvents.ts` |
| Canvas SSE、实体合并与降级退避 | `src/hooks/useCanvasSync.ts`、`src/features/canvas/sync.ts`、`src/features/canvas/graph-refresh.ts` |
| 登录和外观设置 | `src/features/auth/`、`src/features/settings/` |

## 服务端

| 区域 | 入口 |
|---|---|
| Canvas API、Branch、发送与原样重新提交应用用例 | `server/routes/canvas.ts`、`server/lib/canvas-branch-service.ts`、`server/lib/canvas-send-service.ts` |
| Interaction 上下文快照、发送判定与历史快照组装 | `server/lib/canvas-context-snapshot.ts`、`server/lib/canvas-domain.ts`、`server/lib/canvas-history-snapshot.ts` |
| Gateway 运行状态 SSE | `server/routes/runtime.ts`、`server/lib/runtime-events.ts` |
| Canvas cursor、SSE 与 Preview | `server/routes/canvas.ts`、`server/lib/canvas-sync.ts` |
| Schema、迁移和状态机 | `server/lib/canvas-db.ts`、`server/lib/canvas-migrations.ts` |
| Fork/Session 恢复 Replay Package 编译与资源物理去重 | `server/lib/canvas-replay-plan.ts`、`server/lib/canvas-resource-locator.ts` |
| 发送调度、单次 Worker、投递构建与恢复重试 | `server/lib/canvas-send-coordinator.ts`、`server/lib/canvas-send-worker.ts`、`server/lib/canvas-send-delivery.ts`、`server/lib/canvas-send-retry.ts` |
| Gateway 唯一连接、Canvas 适配与事件消费 | `server/lib/gateway-rpc.ts`、`server/lib/openclaw-canvas.ts`、`server/lib/canvas-gateway-events.ts` |
| 对话与 Artifact 协调 | `server/lib/canvas-reconciler.ts`、`server/lib/canvas-artifact-watch.ts`、`server/lib/canvas-reconciliation-state.ts` |
| 附件、Artifact、投递图与缩略图文件存储 | `server/routes/upload-reference.ts`、`server/lib/canvas-artifact-store.ts`、`server/lib/canvas-media-derivatives.ts` |

## 数据模型与迁移

现有 `interactions.attachments_json`、`artifacts_json` 和 `session_metadata_json` 保持向下回滚兼容。Interaction 增量增加 `version`、执行状态、Artifact 同步状态、终止时间和错误字段；迁移完成后，运行时 Artifact 投影只由规范化表读取。

此前的 Canvas 发送分层重构本身不改变 SQLite Schema：`CanvasStore` 继续作为共享连接和事务门面，应用服务、纯发送判定、
投递 Worker 与 OpenClaw 适配层只重新划分代码职责，不建立第二套状态或持久化来源。

原样重新提交为 Branch 增加通用 `creation_mode`（`composer | direct-submit`）。它只用于让普通手动草稿继续保持
单一性，同时允许同一分叉点存在多个直接提交；不记录 Retry 来源。Graph 的 `failedSends` 返回每个 draft Branch
最新的失败 Send Reservation，使刷新后可以用普通 Composer 恢复原文本、持久附件和错误。

Interaction 上下文快照复用 `session_metadata_json` 持久化并投影为 Graph 的 `contextSnapshot`，因此不新增
Schema 迁移。旧数据库和旧节点自然返回 `null`；只有新版本确认完成且 OpenClaw 提供可靠数据的节点才具有快照。

新增 `canvas_attachments` 作为上传登记，并为附件与规范化 Artifact 保存真实文件内容的 SHA-256。旧 Interaction
中可识别的 Canvas 附件在启动迁移时使用 SQLite JSON1 回填；历史 JSON 保持不可变。Artifact 的公开 ID
继续稳定标识来源，但 Replay 物理去重与媒体缓存只使用内容哈希，避免同一来源 URI 的不同内容被误合并。

新增 `interaction_artifacts`、`canvas_media_derivatives`、`artifact_sync_jobs`、`canvas_changes`、
`gateway_signal_inbox` 和内部 `schema_migrations`。`canvas_media_derivatives` 按 Canvas、源内容哈希、用途和
策略版本缓存后端生成的投递图与缩略图；原始附件和 Artifact 文件始终不可变。

从 `0.2.0` 升级时，`0.2.0_to_0.3.0_v1` 在同一个 SQLite 事务中执行一次：

- 从 `0.2.0` 的 JSON 副本回填并合并等价 Artifact 来源，优先保留可用的 Canvas 持久化副本；
- 完成或失败的旧节点只依据本地持久数据计算 Artifact 状态，文本完成且没有 Artifact 的节点为 `synced`，真实不可用副本才为 `degraded`；
- 旧运行节点保守迁移为 `unconfirmed` / `observing`，并创建明确的恢复任务；
- 回填可识别的 Canvas 附件，移除旧协调版本字段，并在事务末尾写入迁移账本。

该数据迁移不连接 Gateway，也不重新读取可能已过期的 Transcript，因此结果不依赖升级时 OpenClaw 的保留窗口或在线状态。新版本服务首次打开 `0.2.0` 数据库时会自动执行；更新器也会在停服后显式运行 `npm run migrate` 并校验外键与 SQLite 完整性。迁移账本存在后不会再次扫描历史节点。此后服务启动只恢复 `running`、`unconfirmed`、`observing` 或仍有 `artifact_sync_jobs` 的明确任务，不使用全局协调版本重新打开已终止节点。

`0.3.0_media_derivatives_v1` 在服务停止期间遍历所有 Canvas 本地文件，为历史上传和 Artifact 计算内容哈希，
并为其中的图片生成 `thumbnail-v1`。单文件格式无效或无法读取时记录警告并继续；文件系统或 SQLite
系统性错误会使迁移失败。
更新器为该阶段提供最长 60 分钟，迁移账本只在遍历结束并通过数据库完整性校验后保留。后续策略升级通过新的
`policy_version` 生成新派生文件，不覆盖原图。

Canvas Graph 对本地图片只公开版本化 `thumbnailUri`；外部 HTTP Artifact 不由后端抓取，因此只显示文件卡片。
节点加载缩略图，只有用户打开预览或下载时才请求原图。

旧 `attachments_json`、`artifacts_json` 和 Session 元数据保留不改，供失败回滚到 `0.2.0` 时读取；新版本不会在后续启动中用旧 JSON 覆盖已规范化的数据。

`send_reservations` 增量新增：

- `dispatch_state`
- `attempt_count`
- `last_attempt_at`
- `next_attempt_at`

升级前未完成的 `prepared` 预留保守迁移为 `ambiguous`，避免把可能已经发出的消息误判为可安全解锁。迁移在事务中执行。

## Session 与持久化

ConvoSketchpad观察实际 `sessionId` 和重置策略。Session 漂移、缺失或即将重置时，下一次发送加入同一套
Replay Package，但不改写历史。恢复发送的 Interaction 完成后，协调器以精确 Session key 观察到的物理
`sessionId` 原子更新 Branch 基线；即使新 ID 晚于 `chat.send` 确认才出现，也不会让 Branch 长期停留在
`unknown` / `drifted` 并在后续发送中重复恢复。

| 数据 | 权威方或位置 |
|---|---|
| Agent、工具、执行、Session、原始对话记录 | OpenClaw |
| Canvas、Branch、Interaction、发送预留、附件与 Artifact 索引、同步任务、cursor、Gateway 信号、布局、用户 | `database/canvas.sqlite` |
| 持久化附件和 Artifact | `artifacts/` |
| 设备私钥和 Gateway 设备 Token | `~/.convosketchpad/` 或 `CONVOSKETCHPAD_DATA_DIR` |

备份时必须同时处理 `database/canvas.sqlite` 与 `artifacts/`。

后端诊断只写结构化 stdout/stderr，由部署环境采集；诊断日志不包含用户正文或凭据，也不承担产品状态、恢复或审计职责。旧 `agent-log.json` 不再读取或写入，升级时不会自动删除。
