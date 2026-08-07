# 架构与运行时数据流

ConvoSketchpad 是 Agent 运行端（Agent Runtime）之上的可视化 Canvas。目标架构采用单一领域链条和可替换的 Adapter：

```text
浏览器（React）
  ⇅ 同源 HTTP / SSE
ConvoSketchpad（Hono、SQLite、文件存储、发送协调器）
  ⇅ AgentRuntime（统一 Handles、Capabilities、事件、审批和恢复）
  ├─ OpenClaw Adapter ⇄ 单一持久 Gateway WebSocket
  └─ Codex Adapter    ⇄ 受监督的本地 app-server stdio JSONL
```

v0.4.1 的 Canvas 通用运行路径全部通过 `AgentRuntime`，Registry 可同时注册 OpenClaw 与 Codex Adapter，HTTP、前端和数据库均使用通用 Agent/Conversation/Turn/Approval 语义。Codex 直接连接本机 App Server，不经过 OpenClaw。

浏览器不实现 Runtime 握手，不调用 Gateway RPC 或 Codex App Server，不保存 Runtime URL、Token、设备凭据或本地运行时凭据。服务端是唯一的 Agent Runtime 通信方。

浏览器先读取带持久 `cursor` 的 Graph 快照，再连接当前 Canvas 的 SSE。持久更新以完整实体 upsert 发送；流式文本先在服务端将增量片段、累计快照和已完成消息组装为当前 Turn 的完整预览，再使用不持久化的 `node.preview` 发送，断线即丢弃。Runtime 全局连接状态与 Canvas 数据同步是两条独立产品契约，浏览器不接收或解释 OpenClaw/Codex 原始事件。

## Agent Runtime 边界

Canvas 通用层只使用以下语义：

- `AgentProfile`：ConvoSketchpad 稳定的执行配置；
- `ConversationHandle`、`TurnHandle`、`ArtifactHandle`、`ApprovalHandle`：带 Runtime 归属和版本的不透明、可持久化引用；
- `RuntimeCapabilities`：Conversation、输入、输出、执行、可靠性和用量等语义能力；
- `dispatchTurn` 与 `reconcileDispatch`：明确区分 accepted、rejected 和 outcome unknown；
- `RuntimeEvent`：归一化文本、Artifact、用量、审批、补充输入、终态和连接事件；
- `resolveApproval`：以统一决定响应 Runtime 审批，不由 Route 调用原始审批 RPC。

统一事件至少覆盖：

```text
turn.accepted
output.text.delta
output.text.snapshot
output.message.completed
artifact.available
usage.updated
approval.required
approval.resolved
input.required
turn.completed | turn.failed | turn.interrupted
runtime.disconnected
```

`output.imageGeneration` 使用 `supported | unsupported | unknown` 三态；无法从原生协议可靠判断时必须保留 `unknown`。`approval.required` 必须带不透明 Approval Handle、所属 Conversation/Turn、审批类别、可展示摘要、风险、权限、选择、作用域和到期时间；`approval.resolved` 记录最终决定及来源。审批和终态信号使用统一持久化 Inbox 去重。全局断线只走 Runtime Status/SSE，不写 Canvas Inbox。审批摘要保存前移除原始环境等敏感字段，前端只在所属 Interaction 节点内处理；持久/会话级授权需由 UI 确认且服务端再次校验 `confirmed: true`。原生 resolved 事件的 Choice 和权限子集也以已持久化摘要为准再次校验，未知或越权结果进入 `unconfirmed`，不能默认成功。HTTP Route 只调用统一 `resolveApproval`。

无副作用的 `manifest.ts` 是 Runtime ID 与展示名的支持清单，供服务启动和 setup 共同读取；`configuration.ts` 负责已配置 Runtime 的选择与通用校验，`definitions.ts` 必须对清单逐项提供实例工厂，`registry.ts` 不包含按类型分支。`server/application-context.ts` 是进程组合根，显式创建 Registry 与 Canvas Store，并负责后台协调器和资源的启动/关闭；Worker、投递、事件消费和 Reconciler 使用同一显式 Store 依赖。关闭时 ApplicationContext 先同步触发内部 AbortSignal，让 Canvas/Runtime SSE 取消订阅和定时器，再关闭 Runtime 与 SQLite，避免停机窗口继续访问已关闭数据库。模块导入不会隐式创建全局 Registry、Store 或连接 Runtime。OpenClaw Adapter 独占 Gateway 方法名、Session Reset Policy、CLI 定位和原始事件投影；Codex Adapter 独占 App Server 子进程、JSONL、Thread/Turn/Item、原生审批和受管交付物目录。Canvas Route、Service、Worker、Coordinator、Reconciler、Context Snapshot 和 Artifact 逻辑不得根据 Runtime 类型增加协议分支；ESLint 边界规则会阻止全部通用 Canvas 模块和 Route 直接导入具体 Adapter。

setup 先以只读方式执行各 Adapter 的本机发现，只确认入口和版本，把已探测和未探测项分组展示，再把用户多选结果写入 `AGENT_RUNTIMES`；之后仅调用已选 Runtime 的 `RuntimeSetupDriver` 完成配置、校验与摘要。发现 Driver 只接收净化后的配置状态和可执行文件路径，不接收凭据；未选 Runtime 不调用原生配置命令、不发起连接或配对。OpenClaw 可在 CLI 未探测到时手工配置远程 Gateway；Codex 当前只接受本机 CLI/App Server。Codex 被选择后才启动临时 App Server 读取 `account/read`；未登录只提示运行 `codex login` 后重跑 setup，不由本项目处理登录。当前每种 Adapter 最多一个实例。Registry 按配置顺序组合实例，Catalog 并行发现 Profile，并按 Runtime 顺序、默认 Profile、原生顺序生成扁平 Agent 目录。setup 配置与配对完成后通过同一个 Runtime Port 读取 Profile，让用户选择产品级默认 Agent，并写入 `CONVOSKETCHPAD_DEFAULT_AGENT_RUNTIME` 与 `CONVOSKETCHPAD_DEFAULT_AGENT_PROFILE`。所有 Agent 平权，不存在运行时 Runtime 切换器。新建 Canvas 优先绑定可用的配置默认项，否则回退到第一个可用 Agent；首次持久 Send Reservation 前可以更新，Reservation 创建事务同时写 `agent_locked_at`，此后不因失败、刷新或重启解锁。

全局状态保留每个 Runtime 明细，并投影 `ready/degraded/connecting/unavailable` 总态；单点失败不隐藏健康 Runtime。账户用量和 Provider 额度按 Runtime 分组，Token 与额度窗口不合并；只有所有 Runtime 在线、所有声明支持费用的 Runtime 都成功返回可加数据且币种/周期一致时计算合计。当前 Canvas 的 Branch、工作中和上下文 Meter 始终来自当前 Graph，不参与账户聚合。

持久化模型为 Canvas 保存 Runtime 归属和不透明引用，而不是把某个协议的标识符提升为产品字段：Canvas 绑定 `runtime_id + agent_profile_id` 并在首次预留时写 `agent_locked_at`，Branch 保存 Conversation Handle，Interaction 保存 Turn Handle 与审批，Artifact 保存 Runtime Artifact Handle，Send Reservation 保存派发与恢复引用。终态和审批信号进入 `runtime_event_inbox`。旧 `agent_id`、`session_key`、`run_id`、`gateway_artifact_id`、`session_metadata_json` 与 `gateway_signal_inbox` 只作为迁移输入，成功后物理移除且不双写。

## 职责边界

所选 Agent Runtime 负责 Agent、模型与工具执行、Conversation、原生事件和权威运行记录。ConvoSketchpad 负责：

- Canvas、Branch、Interaction 的拓扑与布局；
- 发送预留、幂等派发、Branch 锁和恢复元数据；
- Canvas 中对话内容的持久化副本；
- 受管用户及所有者隔离；
- 上传附件与生成 Artifact 的持久化副本。

Artifact 持久化保持尽力而为：单文件上限为 25 MiB，无法读取、超过上限或不满足安全路径约束时记录降级警告，不会抹除已完成的文本输出。所有完成 Interaction 都由后端观察晚到 Artifact 至少 2 分钟；已发现 Artifact、同步失败或 Gateway Artifact 能力不完整时按 5、15、60 分钟继续退避观察。已发现 Artifact 全部持久化后，Interaction 立即显示 `synced`，后续晚到观察由 `artifact_sync_jobs` 静默继续；最终真实失败才显示 `degraded`。

Interaction 的 `executionState`（`running | completed | failed | unconfirmed`）与 `artifactSyncState`（`not_started | observing | synced | degraded`）独立。`observing` 只表示当前仍在等待首个 Artifact 或重试未完成副本；已知副本完整时，后台继续观察不会让节点保持“同步中”。执行失败只终止 Agent 执行，不会跳过同一套晚到 Artifact 观察；Artifact 降级也不会把已终止节点重新变成运行中。

## 产品模型与不变量

```text
Canvas（绑定一个 Agent Profile 和 Runtime）
  ├─ Branch → Interaction → Interaction
  ├─ 从历史 Interaction 创建的可编辑 Branch
  └─ 从目标 Interaction 上一节点直接提交复制输入的普通 Branch
```

1. Branch 使用稳定、不透明的 Runtime Conversation Handle，并最多有一个头部 Interaction；公开 API 不暴露原生 Session/Thread 标识。
2. 继续 Branch 时，`expectedHeadInteractionId` 必须等于数据库中的头节点。
3. 一个 Branch 同时最多有一个 `prepared` 发送预留。
4. `reserved`、`dispatching`、`ambiguous` 状态都保持 Branch 锁定。
5. `ambiguous` 表示请求可能已经写入 Runtime；只能按 Runtime 声明的可靠性能力安全重试或先执行 `reconcileDispatch`，不能按超时解锁、取消或猜测。
6. Runtime 明确接受发送后，服务端在事务中创建 Interaction、推进 Branch 头节点并记录不透明 Turn Handle；原生 `runId`/`turnId` 只存在于 Handle 内。
7. 从用户视角看 Interaction 只追加，不改写历史。
8. Runtime 事件带 Turn Handle 时严格按 Turn 关联，未命中不回退；只有事件缺少 Turn Handle 时，Conversation Handle 才能在恰好存在一个候选节点时作为恢复后备，不允许猜测节点。审批 resolved 独立按 Approval Handle 收敛，允许晚于 Interaction 终态到达。
9. UI 中的“重试”不是持久化实体：原 Interaction 和原执行保持不变，新结果只表现为一个普通 Root/Fork Branch。
10. Layout 中的节点尺寸只表示用户显式缩放；内容自然测量不持久化。重新排列使用这些尺寸计算间距，但只更新位置。

## 发送状态机

```text
reserved
  → dispatching
    → acknowledged
    → ambiguous ──安全重试或 reconcileDispatch──→ dispatching
    → failed
```

连接尚未就绪或确认没有写出请求时回到 `reserved`。请求可能写出后超时或断线进入 `ambiguous`，并把 Adapter 返回的 `recoveryRef` 保存到既有 `dispatch_recovery_ref_json`。明确的 Runtime 拒绝进入 `failed`。声明幂等的 Runtime 可使用同一 Reservation ID 重试；非幂等 Runtime 必须先 `reconcileDispatch`，`accepted` 直接确认、`not_found` 才重新派发、`unknown` 保持锁定；不具备权威核对能力时永不盲目重发。OpenClaw 使用 `chat.send.idempotencyKey` 走幂等重试；Codex App Server 不提供服务端 `turn/start` 幂等保证，Adapter 在传输结果未知时通过 `thread/read` 和本次交付 Token 核对，只有确认 `not_found` 才允许重发。重试间隔依次为 1、3、10、30 秒，之后每 60 秒持续重试。发送协调器不做固定频率数据库扫描：新预留和 Runtime 重连会主动唤醒；已有任务只按最早的 `next_attempt_at` 设置一次计时器，空闲时不保留扫描计时器。

服务启动和任一 Runtime 重连时都会扫描可派发预留。Graph 的 `pendingSends` 让刷新后的浏览器继续显示锁定状态。

## 发送流程

1. 浏览器把原始附件上传到 Canvas 文件存储；上传路由同时写入 `canvas_attachments` 登记表。
2. 浏览器调用 `POST /api/canvas/branches/:id/send`，只提交用户文本、预期头节点、预期 Agent 和附件 ID。
3. 服务端从数据库解析附件名称、MIME、大小和文件位置，执行所有者、Agent、Branch 与排他性检查。
4. 服务端持久化发送预留；需要处理大图时进入可恢复的 `awaiting_media`，由后端生成版本化投递派生文件。
5. 发送协调器调用所选 Runtime 的 `dispatchTurn`；OpenClaw Adapter 投影为原生 `chat.send` 并使用预留 ID 作为 `idempotencyKey`，Codex Adapter 投影为 `turn/start` 并保存未知结果核对引用。
6. Runtime 返回 `accepted` 后，服务端创建 `running` Interaction、推进 Branch 头节点并立即发布 Canvas 变更；提交前已完成的头节点因此成为可分叉历史节点，无需等待新 Interaction 终止。`rejected` 明确失败，`unknown` 保持安全的 `ambiguous` 状态。
7. `canvas-reconciler` 通过 Runtime 的 `readTurn` / `inspectTurn` 读取权威记录，Artifact Store 再通过 `materializeArtifact` 持久化最终文本和 Artifact。

节点“重试”调用通用的原样重新提交用例：后端读取源 Interaction 的用户文本和已登记附件，在同一事务中从其
父 Interaction 创建 `direct-submit` Branch 和 Send Reservation；首节点创建新的 Root Branch。源 Interaction
可以处于任意执行状态，原 Runtime 执行不会停止。新 Branch 继续走上述发送状态机，后端不保存 Retry 类型或
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

`GET /api/canvas/canvases/:id/graph` 是无副作用读取，不会启动或重启后台协调。新 Interaction 由发送协调器直接登记，未完成协调由服务启动和任一 Runtime 重连扫描恢复。

数据库事务通过 `canvas_changes` 同时记录可见实体变化。`GET /api/canvas/canvases/:id/events?after=<cursor>` 将 cursor 之后的变化按实体合并为 `CanvasSyncBatch`，发送最新完整投影而非中间事件序列。Interaction `version` 阻止旧批次覆盖新节点；内部检查时间和协调心跳不会增加版本。

`node.preview` 由统一 Runtime 事件消费层发送，其 `text` 始终是当前 Turn 可见文字的完整快照，前端整体替换而不再追加。`RuntimeTextPreviewAssembler` 使用可选 `messageId` 处理同一 Turn 的多段文字；`output.text.delta` 只追加、`output.text.snapshot` 替换当前段，`output.message.completed` 以原生完成值收敛。Preview 不写 Interaction、change 表或日志。最终对话协调完成后，完整 Interaction upsert 替换 Preview。Canvas SSE 不可用且快照仍有未终止任务时，浏览器才每 15 秒降级读取 Graph，并遵循 `Retry-After`。

Runtime 终态与审批信号在 `runtime_event_inbox` 中持久化并去重；全局断线状态不进入 Canvas Inbox。Artifact 观察状态、尝试次数和下一次执行时间保存在 `artifact_sync_jobs`。服务重启会扫描持久任务恢复协调，内存计时器只负责唤醒。Interaction 已显示 `synced` 时仍可存在静默观察任务。审批写入 `interaction_approvals` 并通过 Graph/SSE 投影到所属节点；accepted、rejected 和 unknown 结果分别收敛为 resolved/denied、可重试 pending 和待原生事件确认的 unconfirmed。

底部状态栏的 Branch 数和“工作中”数量直接从当前 Graph 投影；“工作中”按 Branch 去重，只包含
`prepared` 发送与 `running` Interaction。它不把 `unconfirmed`、失败或 Artifact 后台观察包装成用户可处理事项。
Interaction 首次从 `running`/`unconfirmed` 确认完成时，后端从 OpenClaw 读取该物理 Session 的新鲜累计
Token 与上下文上限，并把不可覆盖的 `contextSnapshot` 随 Interaction 保存。读取必须匹配完整 Conversation Handle
和物理 instance ID；失败不阻塞 Interaction 完成，后续 Artifact 观察也不会补写或覆盖，以免下一轮执行造成串算。
上下文快照必须满足 `0 <= usedTokens <= contextLimit`；累计账户或 Thread 用量不得冒充当前上下文，超出窗口的无效快照不向前端暴露。Codex 使用 `thread/tokenUsage/updated.last.totalTokens` 与 `modelContextWindow`，不使用可能超过窗口的 Thread 累计 `total.totalTokens`。上下文 Meter 仅在 Compose 文本框获得焦点时读取其来源 Interaction 的快照：继续 Branch 使用当前头节点，草稿
Fork 使用分叉来源节点，空白根节点不显示。前端不查询 Gateway、不沿祖先节点求和，也不存在 Canvas 级聚合或周期轮询。

## Gateway 连接

OpenClaw Adapter 的 `server/lib/agent-runtimes/adapters/openclaw/gateway-rpc.ts` 维护唯一连接，身份固定为：

- `client.id = "gateway-client"`
- `client.mode = "backend"`
- `client.platform = "node"`
- `role = "operator"`
- scopes 为 `operator.read`、`operator.write`、`operator.approvals`

后端启动时即尝试连接 Gateway。首次连接、握手或已建立连接发生非主动中断时都进入同一个指数退避重连循环，间隔从 1 秒增长到最多 30 秒；成功握手后重置退避。`getStatus()` 和聚合状态读取是纯读操作，不得创建连接或绕过既有重连计时器；只有 Adapter 生命周期订阅、显式 RPC 与退避计时器可以驱动连接。浏览器仅订阅这一后端状态，不负责驱动 Gateway 重连。

连接鉴权按 Gateway 地址分为两种模式：

- loopback Gateway（`localhost`、`127.0.0.0/8`、`::1`）：使用共享 `OPENCLAW_GATEWAY_TOKEN`，不发送设备身份，也不触发设备配对；
- 远程 Gateway：持久 WebSocket 使用已审批且精确为 read/write/approvals 的设备 Token；没有设备 Token、或旧设备 Token 缺少审批 scope 时，共享 Token 只用于发起配对或 scope upgrade；
- Gateway HTTP 路由始终使用共享 `OPENCLAW_GATEWAY_TOKEN`，设备 Token 只属于远程 WebSocket 身份。

Node 客户端不发送浏览器 `Origin` Header，因此 ConvoSketchpad 不需要修改 `gateway.controlUi.allowedOrigins`。该 OpenClaw 设置仍可能被原生 Control UI 使用，安装和更新流程不会删除已有值。

远程 Gateway 的 setup 创建唯一匹配 ConvoSketchpad 持久密钥的 request，审批必须在 Gateway 宿主机完成。已有本机设备凭据不会删除，但 loopback 模式不会读取或使用它们。

## Codex App Server

Codex Adapter 支持并验证 Codex CLI `0.146.0`，启动时先检查最低版本，再监督 `codex app-server` 子进程并完成 `initialize` / `initialized` 握手。服务端独占 stdio JSONL，浏览器不接触 App Server。Adapter 暴露单一 `codex/default` Profile，不覆盖 Codex 当前账户的模型、Sandbox、审批策略或 Reviewer 设置；同一部署中的受管用户共享宿主机 Codex 账户与 `CODEX_WORKING_DIRECTORY`，Canvas 数据仍按 ConvoSketchpad 所有者隔离。

每个 Branch Conversation 对应持久 Codex Thread。继续发送前 Adapter 调用 `thread/resume` / `thread/read`；`notLoaded` 表示可恢复，不是超时失效，因此继续原 Thread，不做 Canonical Replay。只有 Thread 权威读取确认不存在时，通用发送层才获得 `recreated` 结果并使用项目既有 Replay Package。OpenClaw 的 Session 重置/漂移判断同样留在 OpenClaw Adapter，通用层不解释不同 Runtime 的失效机制。

Codex Turn 使用 Default 模式，继承宿主机配置。图片附件先复制到本次受管输入目录，再以 `localImage` Item 发送；任意文件输入、音频输入和 Steer 当前不提供。原生 `imageGeneration` Item 作为图片 Artifact 读取；其他下载交付物必须由 Codex 写入 `<CODEX_WORKING_DIRECTORY>/.convosketchpad-artifacts/<turn-token>/outputs/`。Adapter 不扫描整个 Workspace，也不把普通 `fileChange` 当成 Artifact。受管目录只接受真实路径仍在目录内、单链接的普通文件，最多 100 个、单文件 25 MiB、本轮总计 100 MiB；经通用 Artifact Store 持久化后释放临时副本。失败或中断 Turn 已写出的文件仍会保留并标注“可能不完整”，路径或限额拒绝只降级 Artifact，不抹除文本结果。安全栅格图片可内联预览；SVG、HTML、文档、压缩包等其他 Artifact 只能下载。

Codex 的命令执行、文件修改和权限请求投影到既有节点内审批；会话级允许仍需二次确认。当前统一审批模型不承载 Codex execpolicy amendment、网络策略 amendment 或更细的持久授权变更，因此不会持久修改这些原生策略；结构化 `item/tool/requestUserInput` 和 MCP elicitation 在本版本的 Default 模式中不提供回答通道，前者明确失败并发出 `input.required` 提示，后者明确拒绝。由此会损失依赖结构化追问、MCP 表单、持久命令规则或持久网络例外的 Codex 工作流，但普通文本交互与节点内一次性/会话级审批仍可使用。

账户用量和额度只从初始化后的 App Server `account/usage/read` 与 `account/rateLimits/read` 获取，不调用 CLI 或读取本地凭据文件。App Server 异常退出会拒绝挂起请求、发布断线状态，并按 1–30 秒指数退避自动重启；状态快照读取不触发额外连接。进程退出或重启不代表 Thread 失效。

## 前端

| 区域 | 入口 |
|---|---|
| Canvas 页面与列表组合、状态栏投影 | `src/features/canvas/CanvasPanel.tsx`、`src/features/canvas/CanvasSidebar.tsx`、`src/features/canvas/status.ts` |
| Graph/SSE 控制与 Composer/Send Operation 生命周期、失败草稿恢复 | `src/features/canvas/useCanvasGraphController.ts`、`src/features/canvas/useCanvasComposerDrafts.ts` |
| Graph 到节点和边的纯投影 | `src/features/canvas/canvas-flow-projection.ts` |
| Interaction/Composer 节点与节点注册 | `src/features/canvas/CanvasNodes.tsx`、`src/features/canvas/node-types.ts`、`src/features/canvas/constants.ts` |
| Flow 类型、节点边界与自动布局 | `src/features/canvas/flow-model.ts` |
| 产品 HTTP 客户端与数据契约 | `src/features/canvas/api.ts`、`src/features/canvas/types.ts` |
| 图片缩略图、按需原图预览 | `src/features/canvas/CanvasNodes.tsx`、`src/features/chat/ImageLightbox.tsx` |
| Agent Runtime 聚合状态上下文 | `src/contexts/RuntimeContext.tsx`、`src/hooks/useRuntimeEvents.ts` |
| Canvas SSE、实体合并与降级退避 | `src/hooks/useCanvasSync.ts`、`src/features/canvas/sync.ts`、`src/features/canvas/graph-refresh.ts` |
| 登录和外观设置 | `src/features/auth/`、`src/features/settings/` |

## 服务端

| 区域 | 入口 |
|---|---|
| Canvas API 与应用用例 | `server/routes/canvas.ts`、`server/lib/canvas/application/` |
| Canvas 持久模型、发送判定与历史快照 | `server/lib/canvas/model.ts`、`server/lib/canvas/domain/` |
| Agent Runtime 聚合状态、用量、生命周期操作与 SSE | `server/routes/runtime.ts`、`server/routes/runtime-usage.ts`、`server/routes/runtime-actions.ts`、`server/lib/runtime-status-events.ts` |
| Canvas cursor、SSE 与 Preview | `server/routes/canvas.ts`、`server/lib/canvas-sync.ts` |
| Store、Schema、迁移清单和状态机 | `server/lib/canvas/persistence/` |
| Fork/Session 恢复 Replay Package 编译与资源物理去重 | `server/lib/canvas/domain/replay-plan.ts`、`server/lib/canvas-resource-locator.ts` |
| 发送调度、单次 Worker、投递构建与恢复重试 | `server/lib/canvas-send-coordinator.ts`、`server/lib/canvas-send-worker.ts`、`server/lib/canvas-send-delivery.ts`、`server/lib/canvas/domain/send-retry.ts` |
| Agent Runtime 组合根、配置、契约、Definition、Registry 与聚合目录 | `server/application-context.ts`、`server/lib/agent-runtimes/configuration.ts`、`contract.ts`、`definitions.ts`、`registry.ts`、`catalog.ts` |
| OpenClaw Adapter、传输与 Transcript/Artifact | `server/lib/agent-runtimes/adapters/openclaw/` |
| Codex Adapter、App Server 与受管 Artifact | `server/lib/agent-runtimes/adapters/codex/` |
| 统一 Runtime 事件消费与审批关联 | `server/lib/canvas/runtime-event-consumer.ts` |
| 对话与 Artifact 协调 | `server/lib/canvas-reconciler.ts`、`server/lib/canvas/domain/artifact-watch.ts`、`server/lib/canvas/domain/reconciliation-state.ts` |
| 附件、Artifact、投递图与缩略图文件存储 | `server/routes/upload-reference.ts`、`server/lib/canvas-artifact-store.ts`、`server/lib/canvas-media-derivatives.ts` |

## 数据模型与迁移

Agent Runtime 迁移重建核心表：Canvas 保存 `runtime_id` / `agent_profile_id` / `agent_locked_at`，Branch 保存
Conversation ID、Handle、物理 instance 与完整性，Interaction 保存 `runtime_turn_id` / `turn_ref_json` /
`execution_metadata_json`，Send Reservation 保存 Runtime、Conversation 与派发恢复引用，Artifact 保存
`runtime_artifact_id` / `runtime_artifact_ref_json`。Handle 是带 Runtime 归属与 Schema 版本的不透明 JSON；通用运行路径不得解析其中协议字段。

`runtime_event_inbox` 是终态和审批事件的唯一持久化/去重来源，事件键以 `runtimeId` 命名空间隔离；`interaction_approvals` 保存已净化摘要和解析状态；断线是全局瞬时 Runtime 状态。启动迁移将既有数据回填为 OpenClaw Handle，然后删除旧 OpenClaw 列和 `gateway_signal_inbox`；不存在双写或公开兼容别名。

原样重新提交为 Branch 增加通用 `creation_mode`（`composer | direct-submit`）。它只用于让普通手动草稿继续保持
单一性，同时允许同一分叉点存在多个直接提交；不记录 Retry 来源。Graph 的 `failedSends` 返回每个 draft Branch
最新的失败 Send Reservation，使刷新后可以用普通 Composer 恢复原文本、持久附件和错误。

Interaction 上下文快照保存在 `execution_metadata_json` 并以通用 `runtimeId`、`conversationInstanceId`、`source: agent-runtime` 投影。旧 OpenClaw Snapshot 在迁移时转换；无法确认的数据为 `null`。

新增 `canvas_attachments` 作为上传登记，并为附件与规范化 Artifact 保存真实文件内容的 SHA-256。旧 Interaction
中可识别的 Canvas 附件在启动迁移时使用 SQLite JSON1 回填；历史 JSON 保持不可变。Artifact 的公开 ID
继续稳定标识来源，但 Replay 物理去重与媒体缓存只使用内容哈希，避免同一来源 URI 的不同内容被误合并。

核心辅助表包括 `interaction_artifacts`、`interaction_approvals`、`runtime_event_inbox`、`canvas_media_derivatives`、`artifact_sync_jobs`、`canvas_changes` 和内部 `schema_migrations`。`canvas_media_derivatives` 按 Canvas、源内容哈希、用途和
策略版本缓存后端生成的投递图与缩略图；原始附件和 Artifact 文件始终不可变。

从 `0.2.0` 升级时，`0.2.0_to_0.3.0_v1` 在同一个 SQLite 事务中执行一次：

- 从 `0.2.0` 的 JSON 副本回填并合并等价 Artifact 来源，优先保留可用的 Canvas 持久化副本；
- 完成或失败的旧节点只依据本地持久数据计算 Artifact 状态，文本完成且没有 Artifact 的节点为 `synced`，真实不可用副本才为 `degraded`；
- 旧运行节点保守迁移为 `unconfirmed` / `observing`，并创建明确的恢复任务；
- 回填可识别的 Canvas 附件，移除旧协调版本字段，并在事务末尾写入迁移账本。

该数据迁移不连接 Gateway，也不重新读取可能已过期的 Transcript，因此结果不依赖升级时 OpenClaw 的保留窗口或在线状态。新版本服务首次打开 `0.2.0` 数据库时会自动执行；从 `0.3.0` 开始的更新器会在停服后显式运行目标版本的 `npm run migrate` 并校验外键与 SQLite 完整性。迁移账本存在后不会再次扫描历史节点。此后服务启动只恢复 `running`、`unconfirmed`、`observing` 或仍有 `artifact_sync_jobs` 的明确任务，不使用全局协调版本重新打开已终止节点。

`server/lib/canvas/persistence/migration-plan.ts` 是发布迁移边界和 ID 的唯一事实来源。截至 `0.4.1` 恰有三项连续迁移：`0.2.0 → 0.3.0` 结构桥接、`0.3.0 → 0.3.2` 媒体维护迁移，以及 `0.3.2 → 0.4.0` Agent Runtime 结构迁移；`0.4.1` 不增加数据库迁移。显式迁移共用维护锁，且只有当前安装的受管服务明确离线或操作者对无管理器场景显式确认离线时才打开 SQLite；setup/update 无法确认离线时推迟到下次服务启动。launchd 维护停服使用 `bootout gui/<uid>/<label>` 真正卸载 KeepAlive Job，恢复时使用 plist `bootstrap` 并以 `kickstart -k` 启动；状态读取针对精确 Domain/Label，不依赖宽泛的 Job 列表。

`0.3.2_to_0.4.0_agent_runtime_v1` 是 `0.4.0` 的结构迁移：在同一迁移边界创建审批与通用事件 Inbox，重建 Canvas、Branch、Interaction、Send Reservation 和 Artifact 表，把 OpenClaw 标识投影成版本化 Runtime Handle，将 Gateway 事件迁入 `runtime_event_inbox`，并物理删除旧 OpenClaw 列与 `gateway_signal_inbox`。旧 Canvas 的 `agent_locked_at` 优先回填为最早 Send Reservation 时间，没有 Reservation 的历史数据再以最早 Interaction 时间兜底；已经完成通用 Schema 但缺失锁定状态的数据库也会幂等修复。修改 Agent 的领域入口还会独立检查历史 Reservation/Interaction，避免异常空锁破坏 Runtime/Conversation 归属。结构事务、触发器安装、外键检查和 `integrity_check` 全部成功后才写入迁移账本；已完成结构但尚未写账本的中断状态可在下次启动幂等补全。全新数据库直接创建当前 Schema 并记录三条既定迁移，不先构造或重建旧 OpenClaw Schema。

`0.3.0_media_derivatives_v1` 遍历所有 Canvas 本地文件，为历史上传和 Artifact 计算内容哈希，并为其中的图片
生成 `thumbnail-v1`。`0.3.0` 及以后版本的更新器在服务停止期间显式执行它，并提供最长 60 分钟；由
`0.2.0` 旧更新器或手动启动触发首次迁移时，HTTP 在结构与 Interaction 数据迁移完成后先开始监听，媒体回填再于
后台继续。缩略图缺失时由现有路由按需生成，因此回填不是服务就绪条件。

单文件格式无效或无法读取时记录警告并继续；文件系统或 SQLite 系统性错误不会写入迁移账本。显式停服迁移会让
更新器回滚，后台启动迁移则记录结构化错误并在下次启动重试。迁移账本只在遍历结束后保留。后续策略升级通过新的
`policy_version` 生成新派生文件，不覆盖原图。

`0.2.0 → 0.3.0` 是一次性桥接迁移。从已经安装的 `0.3.0` 开始，后续目标版本必须累计保留基线之后所有已发布的
迁移，使更新器可以直接安装目标 Release 而不要求中间版本。迁移 ID 只追加、不改名也不复用；耗时且不影响核心
数据正确性的历史回填保持幂等、可重试，并与服务启动就绪路径分离。

Canvas Graph 对本地图片只公开版本化 `thumbnailUri`；外部 HTTP Artifact 不由后端抓取，因此只显示文件卡片。
节点加载缩略图，只有用户打开预览或下载时才请求原图。

`0.4.0` 不保留旧 OpenClaw 物理列或双写 JSON 兼容源。失败回滚依赖 setup/更新器在停服后创建的完整 SQLite 快照，而不是让旧版本反向读取已经迁移的数据库。Setup 使用完成即删除的临时数据库快照，不登记到更新器正式 `last-good` 账本；更新器状态根目录从项目 `.env` 的 `CONVOSKETCHPAD_DATA_DIR` 解析，确保自定义数据目录下的锁、快照与回滚目标一致。

`send_reservations` 增量新增：

- `dispatch_state`
- `attempt_count`
- `last_attempt_at`
- `next_attempt_at`

升级前未完成的 `prepared` 预留保守迁移为 `ambiguous`，避免把可能已经发出的消息误判为可安全解锁。迁移在事务中执行。

## OpenClaw Session 与持久化

ConvoSketchpad观察实际 `sessionId` 和重置策略。Session 漂移、缺失或即将重置时，下一次发送加入同一套
Replay Package，但不改写历史。恢复发送的 Interaction 完成后，协调器以精确 Session key 观察到的物理
`sessionId` 原子更新 Branch 基线；即使新 ID 晚于 `chat.send` 确认才出现，也不会让 Branch 长期停留在
`unknown` / `drifted` 并在后续发送中重复恢复。

| 数据 | 权威方或位置 |
|---|---|
| Agent、工具、执行、Conversation、原始对话记录 | 所选 Agent Runtime（OpenClaw 或 Codex） |
| Canvas、Branch、Interaction、发送预留、附件与 Artifact 索引、同步任务、cursor、Runtime 事件、审批、布局、用户 | `database/canvas.sqlite` |
| 持久化附件和 Artifact | `artifacts/` |
| OpenClaw Adapter 管理的本地设备身份和 Token | `~/.convosketchpad/` 或 `CONVOSKETCHPAD_DATA_DIR` |
| Codex 临时输入与交付物 | `<CODEX_WORKING_DIRECTORY>/.convosketchpad-artifacts/`，持久化后释放 |

备份时必须同时处理 `database/canvas.sqlite` 与 `artifacts/`。

后端诊断只写结构化 stdout/stderr，由部署环境采集；诊断日志不包含用户正文或凭据，也不承担产品状态、恢复或审计职责。旧 `agent-log.json` 不再读取或写入，升级时不会自动删除。
