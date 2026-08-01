# Agent Backend 抽象迁移工作笔记（临时）

> 状态：设计已确认，功能尚未实现。
>
> 本文件用于在两阶段迁移期间保存决策、边界和验收条件。第二阶段完成并把稳定内容合并进正式文档后，再删除本文件。不得把本文中的“目标状态”误认为当前 Release 已具备的能力。

## 背景与目标

ConvoSketchpad 当前只通过 OpenClaw Gateway 执行 Agent 工作，而且发送、Session、事件、恢复、上下文和 Artifact 代码中仍直接存在 `chat.send`、`sessionKey`、`runId`、`gatewayArtifactId` 等 OpenClaw 协议概念。

已确认的产品方向是：ConvoSketchpad 不再把“Agent Backend”等同于 OpenClaw，而是在 Canvas 领域模型与具体运行时之间增加统一的 `AgentBackend` 边界。OpenClaw 继续作为现有、默认且必须保持行为兼容的 Backend；第二阶段再直接接入本地 Codex App Server。未来其他 Backend 也必须复用相同边界，不得继续在 Canvas Worker、Route 或 Reconciler 中增加协议分支。

目标不是让 ConvoSketchpad 自己成为 Agent 运行时。Agent、模型调用、工具执行和原始运行记录仍由所选 Agent Backend 负责；ConvoSketchpad 继续负责 Canvas 拓扑、Branch/Interaction、发送协调、规范重放、附件和 Artifact 持久化副本以及所有者隔离。

## 已确认的设计结论

### 稳定的上层语义

以下产品语义在两个阶段中保持不变：

- Canvas 在首次执行前绑定一个稳定的 Agent Profile，执行后不可无提示切换。
- Branch 和 Interaction 只追加，不改写已有历史。
- `expectedHeadInteractionId`、单 Branch 发送锁、Send Reservation 和 `ambiguous` 不猜测原则继续成立。
- Fork 与失效 Conversation 恢复继续以 ConvoSketchpad 的 Canonical Replay Package 为跨 Backend 基准。
- Canvas 只持久化和公开自己管理的附件及 Artifact 副本，不把 Backend 临时路径作为产品数据。
- 浏览器不连接 Agent Backend，也不解释 Backend 原始协议事件。

“上层保持不变”指上述 Canvas 语义和现有用户流程保持稳定，不表示数据库可以继续把 OpenClaw 的标识符当成通用模型。

### Agent Profile

上层选择的是 ConvoSketchpad 的 `AgentProfile`，而不是某个 Backend 的原始 Agent 对象：

```ts
interface AgentProfile {
  id: string;              // ConvoSketchpad 稳定 ID
  backendId: string;       // Backend 实例
  displayName: string;
  backendProfileRef: BackendHandle;
}
```

- OpenClaw Profile 映射到 Gateway `agentId`。
- Codex Profile 将映射到受管配置模板，例如 model、cwd、sandbox、personality、Skills/Plugins 策略。
- 现有 Agent 选择 API 和 UI 在第一阶段保持兼容；内部改为投影 Agent Profile。

### 不透明 Backend Handle

Conversation、Turn、Artifact 和 Approval 使用可持久化但对上层不透明的 Handle：

```ts
interface BackendHandle {
  backendId: string;
  schemaVersion: number;
  opaque: Record<string, string>;
}
```

OpenClaw Adapter 可以在 `opaque` 中保存 `sessionKey`、物理 Session ID 或 `runId`；Codex Adapter 可以保存 `threadId`、`turnId` 或 Item ID。Canvas 通用层只能保存、比较 Backend 归属并原样交还适配器，不得读取 `opaque` 中的协议字段做业务判断。

### 语义化 Capabilities

上层不得再通过 `supports("chat.send")` 等协议方法名判断能力。统一能力至少覆盖：

- Conversation：resume、readHistory、nativeFork；
- Input：text、images、audio、arbitraryFiles；
- Output：textStreaming、imageGeneration、artifacts；
- Execution：interrupt、steer、interactiveApprovals；
- Reliability：idempotentDispatch、inspectAfterUnknownOutcome；
- Usage：turnTokens、contextWindow、accountQuota。

Capability 必须在 Backend 连接或重连后重新协商。功能降级由语义能力决定，不把某个协议的方法列表传播到 Canvas 上层。

## 统一 AgentBackend 边界

接口按职责可拆成多个小 Port，实现上可以由一个 Backend 对象组合提供：

```ts
interface AgentBackend {
  describe(): Promise<BackendDescriptor>;
  listAgentProfiles(owner: OwnerContext): Promise<AgentProfile[]>;
  getCapabilities(profile: AgentProfileRef): Promise<BackendCapabilities>;

  createConversation(input: CreateConversationInput): Promise<ConversationHandle>;
  inspectConversation(handle: ConversationHandle): Promise<ConversationSnapshot | null>;

  dispatchTurn(input: DispatchTurnInput): Promise<DispatchResult>;
  reconcileDispatch(input: ReconcileDispatchInput): Promise<DispatchReconciliation>;
  readTurn(input: ReadTurnInput): Promise<TurnSnapshot | null>;
  interruptTurn(input: InterruptTurnInput): Promise<void>;

  materializeArtifact(handle: BackendArtifactHandle): Promise<MaterializedArtifact>;
  resolveApproval(input: ResolveApprovalInput): Promise<ApprovalResolution>;

  subscribeEvents(listener: (event: BackendEvent) => void): () => void;
  subscribeStatus(listener: (status: BackendStatus) => void): () => void;
}
```

Canvas Coordinator 继续拥有 Send Reservation、Branch 锁、Interaction 生命周期和数据库事务；Backend Adapter 只返回协议事实和归一化事件，不直接推进 Canvas 头节点。

## 统一事件与审批

统一事件从第一阶段起必须包含审批，不能等到 Codex 接入时再破坏事件契约：

```ts
type BackendEvent =
  | TurnAcceptedEvent
  | TextDeltaEvent
  | MessageCompletedEvent
  | ArtifactAvailableEvent
  | UsageUpdatedEvent
  | ApprovalRequiredEvent
  | ApprovalResolvedEvent
  | InputRequiredEvent
  | TurnCompletedEvent
  | TurnFailedEvent
  | TurnInterruptedEvent
  | BackendDisconnectedEvent;
```

每个事件至少携带：

- `backendId`；
- `conversationRef`；
- 可选 `turnRef`；
- 可选、可去重的 `eventId` 与顺序信息；
- 事件类型和类型化 payload；
- 仅供诊断或适配器恢复使用的受限 Backend 元数据。

审批事件必须满足：

- `approval.required` 包含不透明 `approvalRef`、所属 Conversation/Turn、审批类别、可展示摘要、允许的决定集合和到期信息；
- `approval.resolved` 包含最终决定和解析来源，但不得包含凭据或未经过滤的命令环境；
- 决定通过 `resolveApproval()` 返回 Backend，不允许 Route 调用 OpenClaw/Codex 原始审批方法；
- 审批能力通过 `interactiveApprovals` 声明；不支持交互审批的部署必须采用明确的拒绝或安全自动审查策略，不能让 Turn 永久悬挂；
- 终态和待审批信号进入通用 `backend_event_inbox` 的持久化/去重路径。第一阶段建立领域与持久化边界，但不新增 Canvas 审批 UI；UI 和 HTTP 契约若后续需要，必须作为单独、显式的产品变化评审。

## 发送可靠性

统一派发结果不能只有“成功/抛错”：

```ts
type DispatchResult =
  | { outcome: 'accepted'; turnRef: TurnHandle }
  | { outcome: 'rejected'; error: BackendError }
  | { outcome: 'unknown'; recoveryRef?: BackendHandle };
```

- OpenClaw：继续用 Reservation ID 作为 `chat.send.idempotencyKey`，`runId` 映射为 Turn Handle；结果未知时可以用同一幂等键重试。
- Codex：JSON-RPC 请求 ID 只用于传输关联。`clientUserMessageId` 可用于恢复相关性，但在没有明确幂等保证前，结果未知时必须先用 `thread/read` 和持久化的前一 Turn 位置执行 `reconcileDispatch()`；无法唯一确认时保持 `ambiguous`，不得盲目重发。

通用 Coordinator 根据 Backend 返回的 `accepted/rejected/unknown` 推进现有状态机，具体的安全重试和核对策略由 Adapter 实现。

## Conversation、Fork 与恢复

- 通用模型使用 Conversation/Turn，不在上层使用 Session/Run 命名。
- OpenClaw Adapter 负责 Session 存在性、物理 Session 漂移和 Reset Policy。
- Codex Adapter 负责 Thread start/resume/read、Turn 读取和进程重启后的恢复。
- Canonical Replay 是跨 Backend 的默认 Branch 语义。
- Codex `thread/fork(lastTurnId)` 和其他 Backend 原生 Fork 只作为 `nativeFork` 能力保留；在证明与 Canonical Replay 的附件、Artifact、外部状态语义等价前，不作为默认路径。

## 附件、Artifact 与图片

- 通用输入以文本和 ConvoSketchpad 已持久化附件描述为准，由 Adapter 转换为 Backend 投递格式。
- OpenClaw 继续使用 `chat.send.attachments`。
- Codex 图片/音频可映射到结构化 UserInput；普通文件需要复制到按 owner/Conversation 隔离的安全 staging 目录并使用相对路径引用。
- OpenClaw Artifact 继续通过 `artifacts.list/download` 与 Transcript fallback 获取。
- Codex 图片生成通过 capability 检测和 `imageGeneration` 完成 Item 获取；`savedPath` 必须通过路径包含、符号链接、大小、MIME 和所有权检查后立即复制进 Canvas Artifact 存储。
- 不扫描整个 Codex Workspace 推断 Artifact。只有结构化 ImageGeneration、明确的 Tool/MCP 输出或未来显式声明的路径可以提升为 Canvas Artifact。

## 数据迁移方向

第一阶段采用可回滚的增量迁移，保留旧 OpenClaw 字段作为兼容别名，通用代码不再读取它们做决策：

- `canvases`：增加 `backend_id`、`agent_profile_id`；
- `branches`：增加 `conversation_ref_json`、通用 Conversation instance/观察字段；
- `interactions`：增加 `turn_ref_json`；
- `send_reservations`：增加 Backend/Conversation/派发恢复引用；
- `interaction_artifacts`：增加 `backend_artifact_ref_json`；
- 新建 `backend_event_inbox`，替代通用代码对 `gateway_signal_inbox` 的依赖；
- Context Snapshot 的来源改为 Backend 标识，并把上下文 Token、窗口和账户额度分开建模。

已有数据全部回填为 OpenClaw Backend。迁移期间公开 DTO 保持现有字段兼容，避免第一阶段顺带修改前端协议。

## 两个功能提交的严格边界

本文档修改先供评审，不计作以下功能提交。本轮不做功能开发。

### 功能提交一：建立统一 AgentBackend，并迁移现有 OpenClaw

必须完成：

1. 定义 Backend Descriptor、Agent Profile、Capabilities、不透明 Handles、派发结果、错误、状态和统一事件类型；统一事件包括审批 required/resolved 和 `resolveApproval()` Port。
2. 建立 Backend Registry/选择入口；当前只注册 OpenClaw。
3. 将现有 OpenClaw Gateway 调用收敛到 `OpenClawAgentBackend`，保持当前 Agent 目录、发送、Session 检查、Reset Policy、Transcript、上下文、Artifact、运行状态和恢复行为。
4. 让 Canvas Route、Send Service、Worker、Coordinator、事件消费、Reconciler、Context Snapshot 和 Artifact 物化只依赖统一 Backend Port，不直接调用 Gateway RPC 或检查 OpenClaw 方法名。
5. 增加并回填通用持久化字段与 `backend_event_inbox`；保留旧字段和公开 API 的兼容投影。
6. OpenClaw 原始事件先由 Adapter 归一化；Canvas 层只消费 `BackendEvent`。审批事件能够被类型化、去重、持久化并通过统一 Port 响应，但本提交不新增审批 UI。
7. 建立可复用的 Backend Contract Tests，并证明 OpenClaw Adapter 在发送确认、结果未知、重连、终态去重、恢复、Artifact 和所有者约束下保持现有行为。
8. 同步正式架构、代码地图、迁移和必要的 API 文档。

不得包含：

- Codex 子进程、Codex SDK/App Server 调用或 Codex 配置；
- 新的 Backend 选择 UI；
- Codex Thread/Turn、Codex 文件 staging 或 ImageGeneration；
- 改变现有 Canvas Branch、Retry、Replay 或 Artifact 用户语义；
- 删除旧 OpenClaw 数据列或打破回滚兼容。

提交一验收点：在只注册 OpenClaw 时，现有前端、HTTP API 和 Canvas 行为不变；服务端 Canvas 业务模块不再直接依赖 `gateway-rpc.ts`，OpenClaw 专有术语只存在于 Adapter、兼容迁移和诊断投影中。

### 功能提交二：接入本地 Codex App Server

开始条件：提交一经用户审阅并完成细节修改后，明确授权开始。

必须完成：

1. 使用受监督的本地 `codex app-server` 子进程和默认 stdio JSONL 传输；不接远程 Codex WebSocket。
2. 完成 initialize、版本化 Schema/Capabilities、模型与 Codex Agent Profile 投影。
3. 实现 Thread start/resume/read、Turn start/interrupt、流式 Item 事件、终态和上下文用量。
4. 使用 `clientUserMessageId`、前一 Turn 位置和 `thread/read` 实现结果未知后的核对；不能把 JSON-RPC ID 当成幂等键。
5. 接入统一审批事件和 `resolveApproval()`，并为不支持交互审批的运行方式设置明确安全策略。
6. 实现按 owner 隔离的附件 staging、图片输入和安全清理。
7. 接入运行时 imageGeneration capability、结构化 ImageGeneration Item 和 Canvas Artifact 持久化。
8. 通过与 OpenClaw 相同的 Backend Contract Tests，并补充子进程退出、协议损坏、Thread 恢复、审批等待、路径逃逸、超限文件和多用户隔离测试。
9. 增加所需配置、安装检查、排障、安全与产品文档。

明确不包含：

- 远程 Codex；
- 把 OpenClaw 作为 Codex 的中转层；
- 默认使用 Codex 原生 Thread Fork 代替 Canonical Replay；
- 扫描 Codex Workspace 自动收集全部输出文件；
- 读取 Codex 本地凭据文件，或调用 Codex CLI 查询 Provider 用量/配额。

## 第二阶段开始前仍需确认

- 本地 Codex Backend 的账户边界：默认只允许单操作员/本地所有者，还是允许受管用户显式共享宿主机 Codex 身份和额度。未明确前，Codex Profile 不应自动暴露给所有受管用户。
- 审批的首个用户入口：仅建立服务端统一模型，还是同时增加 Canvas 审批 UI/API。当前两提交边界按“提交一只建统一模型，提交二接入 Codex 审批，UI 另行评审”记录。
- Codex Agent Profile 的配置来源和允许的 cwd 根目录。

以上未决项不会阻塞第一阶段的 OpenClaw 抽象迁移。
