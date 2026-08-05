# Agent Runtime 两阶段迁移工作笔记（临时）

> 状态：第一阶段已在 `dev` 完成，当前命名统一为 Agent 运行端（Agent Runtime）；第二阶段 Codex 尚未开始。本文件在两阶段完成、结论并入正式文档后删除。

## 目标与产品边界

ConvoSketchpad 在 Canvas 领域模型和 Agent 运行端之间建立统一 `AgentRuntime` Port。OpenClaw 是第一阶段唯一 Adapter；第二阶段直接连接受监督的本地 Codex App Server，不通过 OpenClaw。未来运行端复用同一边界。

Agent、工具、执行、Conversation、原始事件和权威运行记录由 Runtime 负责。ConvoSketchpad 负责 Canvas 拓扑与布局、Branch/Interaction、Send Reservation、恢复元数据、受管用户隔离、附件和 Artifact 持久化副本。

## 已确认的产品决策

- setup 配置需要启用的 Runtime；当前同一 Adapter 类型最多配置一个实例。
- 配置完成后，各 Runtime 提供的 Profile 合并成一个扁平、平权的 Agent 目录，不存在产品级“切换 Runtime”。
- Agent 排序稳定：Runtime 配置顺序 → 各 Runtime 默认 Profile → 原生目录顺序。
- 新建 Canvas 保持现有一键交互，不弹选择窗；优先绑定 setup 配置的可用默认 Agent，否则绑定第一个可用项。
- 在首次持久 Send Reservation 前可以从 Canvas 顶部更换 Agent；预留创建后即锁定 Runtime + Profile，失败或刷新也不解锁。
- Runtime 断开时最后一次发现的 Agent 可继续显示但不可选择发送；只要至少一个 Runtime/Agent 可用，其他 Runtime 故障不阻断创建。
- 状态、Agent、用量和额度按 Runtime 聚合；当前 Canvas 的 Branch、工作中数量和上下文不跨 Canvas/Runtime 聚合。
- 审批从第一阶段进入统一事件、持久化、HTTP 和节点内 UI，不能留到 Codex 阶段再改变契约。

## 统一上层模型

上层使用显式 `{ runtimeId, profileId }` 的 Agent Profile Ref。Conversation、Turn、Artifact、Approval 使用版本化 Handle：

```ts
interface RuntimeHandle {
  runtimeId: string;
  schemaVersion: number;
  opaque: Record<string, string>;
}
```

OpenClaw 可在 `opaque` 中保存 `sessionKey`、`sessionId`、`runId`；Codex 可保存 `threadId`、`turnId`、Item ID。Canvas 通用代码不得解析这些字段。

Capabilities 以产品语义表达：Conversation resume/history/fork，文本/图片/音频/文件输入，文本流/图片生成/Artifact 输出，中断/steer/审批，幂等与未知结果核对，以及上下文、账户用量和额度。无法从原生协议可靠判断的图片生成能力必须返回 `unknown`，不能当作 `unsupported`；`imageGeneration` 使用 `supported | unsupported | unknown` 三态。

## 统一事件和审批

统一事件至少包含：

```text
turn.accepted
output.text.delta
output.message.completed
artifact.available
usage.updated
approval.required
approval.resolved
input.required
turn.completed | turn.failed | turn.interrupted
runtime.disconnected
```

`approval.required` 包含不透明 Handle、类别、可展示摘要、风险、细粒度权限、选择、作用域、二次确认要求和到期时间。`approval.resolved` 包含统一 Resolution 与来源。原始命令环境、Token 和凭据不得进入事件或浏览器 DTO。

审批 UI 位于所属 Interaction 节点内，用户可逐项取消权限；持久/会话级选择必须二次确认。审批结果使用 `accepted | rejected | unknown`：明确拒绝可重试，结果未知进入 `unconfirmed` 并等待原生 resolved 事件，不能盲目重发。原生 resolved 事件仍须根据持久化的 Choice 与权限集合做拒绝默认成功的校验；未知 Choice、越权权限或拒绝时携带授权都保持 `unconfirmed`。

终态与审批进入 `runtime_event_inbox` 持久化、去重，事件键以 Runtime ID 命名空间隔离。带显式 Turn Handle 的事件必须严格关联，未命中不能回退到 Conversation 中的其他 Turn；审批 resolved 通过 Approval Handle 收敛，允许晚于 Interaction 终态到达。Preview 不持久化。

## 派发与恢复

`dispatchTurn` 必须返回 `accepted | rejected | unknown`。`unknown` 可附带不透明 `recoveryRef`，Canvas 保存到既有 `dispatch_recovery_ref_json`；恢复时只有声明 `idempotentDispatch` 的 Runtime 可以用同一 Reservation ID 重发，否则必须声明 `inspectAfterUnknownOutcome` 并通过 `reconcileDispatch` 得到 `accepted | not_found | unknown`。`accepted` 直接确认 Interaction，`not_found` 才允许新派发，`unknown` 保持锁定并继续等待；两项可靠性能力都没有时绝不盲目重发。OpenClaw 使用 Reservation ID 作为 `chat.send.idempotencyKey`，因此走幂等重试；Codex 的 JSON-RPC ID 只用于传输关联，未知结果必须先通过权威读取和持久相关性核对。

Fork 与失效 Conversation 恢复继续使用 Canonical Replay。原生 Fork 只有在证明附件、Artifact 和外部状态语义一致后才可作为优化。

## 图片与 Artifact

- 输入只来自 Canvas 持久化附件，由 Adapter 转换原生格式。
- OpenClaw 通过原生 Artifact/Transcript；Codex 通过结构化 ImageGeneration/Tool/MCP Item。
- 不扫描 Codex 或 OpenClaw 工作区猜测生成物。
- Adapter 返回的本地路径仍需路径包含、符号链接、大小、MIME 和所有者检查，并立即复制到 Canvas Artifact 存储。
- `imageGeneration` 是 `supported | unsupported | unknown` 三态 Capability；第一阶段建立契约，OpenClaw 在无法可靠判断时返回 `unknown`，当前没有依赖该字段启停的独立图片生成入口。后续新增此类上层操作时，明确不支持必须由 UI/协调器降级，未知时不得伪装为支持或不支持。

## 目录结构

统一代码位于 `server/lib/agent-runtimes/{contract,manifest,configuration,definitions,registry,catalog,default-agent,usage-service}.ts`；无副作用 `manifest.ts` 是 Runtime ID/展示名支持清单，`configuration.ts` 负责选择和校验已配置 Runtime，`definitions.ts` 对清单逐项提供 Adapter 实例工厂。每个实现位于 `server/lib/agent-runtimes/adapters/<runtime-id>/`，其配置、传输、进程和 setup 支持面都留在该目录。`server/application-context.ts` 是进程组合根，显式创建 Registry 与 Canvas Store，并统一启动/关闭后台协调器与资源；Store 沿 Worker、投递、事件消费和 Reconciler 显式注入，不提供全局 Registry 单例。setup 使用 `scripts/lib/agent-runtimes/types.ts` 的 `RuntimeSetupDriver`，只编排用户选择项。Canvas Runtime 事件消费位于 `server/lib/canvas/runtime-event-consumer.ts`，全局状态 SSE 位于 `server/lib/runtime-status-events.ts`。完整约束见 [`agent-runtimes/ADAPTER-DEVELOPMENT.md`](agent-runtimes/ADAPTER-DEVELOPMENT.md)。

## 数据库迁移决策

本阶段采用彻底迁移，不保留旧 OpenClaw 物理列、不双写：

- `canvases`: `runtime_id`, `agent_profile_id`, `agent_locked_at`；
- `branches`: `conversation_id`, Handle、instance、integrity/state 字段；
- `interactions`: `runtime_turn_id`, `turn_ref_json`, `execution_metadata_json`；
- `send_reservations`: Runtime、Conversation Handle、恢复 Handle、`runtime_turn_id`；
- `interaction_artifacts`: `runtime_artifact_id`, `runtime_artifact_ref_json`；
- `runtime_event_inbox` 取代 `gateway_signal_inbox`；
- `interaction_approvals` 保存已净化摘要和解析状态。

已有数据一次性映射为 OpenClaw Handle，审批表与通用事件 Inbox 在同一个 `0.3.2 → 0.4.0` 结构迁移中创建，旧 `agent_id`、`session_key`、`run_id`、`gateway_artifact_id`、`session_metadata_json` 和 `gateway_signal_inbox` 在成功迁移后物理移除。全新数据库直接创建当前 Schema，不构造旧 OpenClaw 表再重建。公开 DTO 也使用通用 Agent/Conversation/Context/Approval 语义。

setup 的选择页只用无凭据命令确认 Runtime 入口与版本；发现 Driver 只接收净化后的配置状态和可执行文件路径，选中后才进入读取 URL/Token 等预填值的配置阶段。安装器不得越过该流程读取原生配置或直接写 Runtime `.env`。setup/update 只把名称、工作目录和启动命令都属于当前安装的服务视为可管理对象，服务状态未知时失败关闭；仅在服务明确离线后创建或恢复 SQLite 快照。setup 重启后验证服务状态、健康和版本，没有匹配服务管理器时推迟数据库迁移。更新器仍会在无管理器或 `--no-restart` 时迁移环境配置，但不打开、快照或回滚 SQLite；数据库由下次手动启动在监听前自动迁移。独立 migrate 共用维护锁，并在无匹配管理器时要求操作者显式确认所有手工进程已经停止。

截至 `0.4.0`，迁移清单固定为三项连续边界：`0.2.0_to_0.3.0_v1`、覆盖 `0.3.0 → 0.3.2` 小版本维护的历史 ID `0.3.0_media_derivatives_v1`，以及 `0.3.2_to_0.4.0_agent_runtime_v1`。迁移 ID 发布后保持不变，版本边界由统一清单声明。`npm run migrate` 必须显式验证三项都已记录。发布安装流程仍要求 `0.2.0` 先固定升级到 `v0.3.0`，因为旧更新器不具备 `0.3.0` 引入的停服 SQLite 快照和失败回滚能力。

本轮收敛不增加第四条数据库迁移：派发恢复复用 `0.4.0` Schema 已有的 `dispatch_recovery_ref_json`，审批确认属于请求与状态机校验，目录/配置改名不改变持久结构。只有已发布 `0.4.0` Schema 之后出现新的持久字段或不可由现有幂等修复覆盖的数据变换，才创建新的迁移 ID。

## 聚合规则

- Agent：扁平列表、稳定排序、局部失败隔离、最后已知目录只读展示。
- 状态：每 Runtime 明细；全部连接为 `ready`，部分连接为 `degraded`，仅连接中为 `connecting`，无连接为 `unavailable`。
- 用量：每 Runtime 分组；Token 和 Provider 额度不跨 Runtime 相加。
- 费用：只有所有 Runtime 在线、所有声明支持费用的 Runtime 都成功返回可加数据，且币种/周期一致时才返回 `comparableCostTotal`。
- Canvas 状态栏：仅投影当前 Canvas 的 Branch、工作中和活跃 Composer 上下文。

## 功能提交边界

### 提交一：统一 Runtime + OpenClaw Adapter

必须完成：

1. 通用契约、Capability、Handle、事件、审批、错误和派发三态。
2. 配置、Registry、扁平 Agent 目录、聚合状态/用量。
3. 清晰 Adapter 目录，并将所有 Gateway/Session/原生 Artifact 逻辑收敛到 OpenClaw Adapter。
4. Canvas Route、Service、Worker、Coordinator、Reconciler、Context 和 Artifact 只依赖 Port。
5. 新建 Canvas 默认 setup 选择的可用 Agent，不可用时回退到首个可用项；首次预留前可改，之后锁定。
6. Interaction 节点内审批 UI、统一审批 API、持久化与去重。
7. 数据库彻底迁移，setup/update/启动自动迁移与校验。
8. Adapter 开发规范、正式产品/架构/API/配置/安装/更新/安全/排障文档和相称测试。

不得包含：Codex 子进程、App Server、Codex 配置/Thread/图片实现、远程 Codex，或读取本地 Provider 凭据。

### 提交二：本地 Codex App Server Adapter

开始条件：提交一经用户确认并完成细节调整后明确授权。

必须完成：受监督 stdio JSONL 进程、initialize/Schema/Capability、Codex Profile、Thread/Turn/Item、未知结果核对、统一审批、owner 隔离 staging、图片输入与 ImageGeneration Artifact、用量能力（仅 App Server 正式提供的安全数据）、子进程和路径安全测试，以及对应文档。

不包含：远程 Codex、经 OpenClaw 中转、读取 Codex/Claude 凭据文件、调用 CLI 猜测 Provider 额度、默认原生 Thread Fork 或 Workspace 全盘扫描。

## 第二阶段前待确认

- 宿主机 Codex 身份如何向受管用户授权；未明确前不得默认共享给所有用户。
- Codex Profile 配置来源、允许的 cwd 根目录与 Sandbox 基线。
- Codex App Server 当前版本对用量、图片生成和审批的实际 Capability；必须运行时协商，不能假设存在。
