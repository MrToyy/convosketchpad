# OpenClaw Canvas（MVP）基础设计说明

> 状态：MVP 实现基线 v4
>
> 范围：产品边界、领域模型、持久化、OpenClaw/Nerve 接入点与核心数据流
>
> 实现位置：`src/features/canvas/`、`server/routes/canvas.ts`、`server/lib/canvas-db.ts`
>
> 当前实现索引：[`Canvas 代码地图`](canvas/CANVAS-CODE-MAP.md)；认证与用户隔离索引：[`Auth 代码地图`](canvas/AUTH-CODE-MAP.md)

## 1. 项目目标

在尽量复用 OpenClaw Nerve 和 OpenClaw 原生架构的前提下，为 OpenClaw 增加一个面向 AI 交互的 Canvas。

Canvas 不替代 Chat，而是提供一种更适合浏览、组织和分支 AI 对话的交互方式。应用启动后默认进入 Canvas，用户仍可切换到现有 Chat 和 Tasks。

设计原则：

- 最大程度复用 OpenClaw Gateway、Agent、Session、Tool、Streaming、Artifact 和 Workspace；
- 最大程度保持 OpenClaw Nerve 可持续同步官方更新；
- 优先新增独立模块，只在应用入口和公共基础设施做少量接线；
- 不修改、截断或重写 OpenClaw 原始 Transcript；
- Canvas 历史只追加，不允许修改既有 Interaction；
- Canvas 完全独立于普通 Chat，不从普通 Chat/Session 导入数据；
- Canvas 结构化数据独立持久化；用户输入附件和 OpenClaw 本地 Artifact 固化到项目 `artifacts/`，外部链接保留引用；
- Canvas 数据按稳定用户身份隔离，所有读取和写入都必须经过 owner scope。

## 2. 产品概念

### 2.1 Canvas

- 支持创建多个独立 Canvas；
- 每个 Canvas 固定绑定一个 OpenClaw Agent，创建后不可更改；
- 一个 Canvas 可以包含多个从头开始的独立会话；
- 每个独立会话表现为一个 Root Branch，并绑定一个独立 OpenClaw Session；
- Root Branch 还可以从任意历史 Interaction 派生 Fork Branch；
- 所有 Root Branch、Fork Branch 和 Interaction 共同展示在一张可平移、缩放的图中；
- Canvas 保存节点位置、视口、折叠状态和当前选中 Branch。

### 2.2 Interaction

一个 Interaction 表示一次完整的人机交互，而不是一条单独的角色消息：

```text
Interaction
├── User Input       默认折叠，可展开
├── Agent Output     默认展示
├── Artifacts        图片、文件、代码、Tool 结果等
├── Agent Status     思考、Tool、输出、完成或失败
└── Session Metadata 本次运行对应的 OpenClaw 元数据
```

Agent Output 支持：

- 文本与 Markdown；
- 代码；
- 图片；
- 文件；
- Tool 调用与 Tool 结果；
- 错误、中止和部分输出。

Interaction 的重点是完整呈现“一次输入最终产生了什么”。Canvas 内不把 User、Assistant、Tool 拆成传统聊天气泡。

### 2.3 Branch

Branch 分为两种：

```ts
type BranchKind = 'root' | 'fork'
```

Root Branch：

- 表示一个从头开始的新会话；
- `parentBranchId = null`，没有 fork point 和继承上下文；
- 创建时获得新的空 OpenClaw Session；
- 一个 Canvas 可以有任意多个 Root Branch。

Fork Branch：

- 从任意已完成的历史 Interaction 创建；
- 创建新的 OpenClaw Session；
- 固定记录父 Branch、fork Interaction 和 Context Snapshot；
- 后续 Interaction 全部进入新 Session；
- 父 Branch 和原 Transcript 保持不变。

所有 Branch 都可长期保留、随时切换并继续。Branch 中的历史 Interaction 不支持改写或单独删除。

### 2.4 图关系

React Flow 图中的主要节点是 Interaction：

- 同一 Branch 中相邻 Interaction 使用 `continuation` edge 连接；
- Fork Branch 的首个 Interaction 从 fork point 使用 `fork` edge 连接；
- Root Branch 的首个 Interaction 没有入边；
- 空 Branch 显示临时 Composer Node；
- 从历史 Interaction 创建但尚未发送消息的 Fork Branch，以 fork point 到 Composer Node 的连线表示；
- 不增加所有会话共享的虚拟根节点。

```text
Root Branch A: I1 ── I2 ── I3 ── I4
                           └──── I5 ── I6  Fork Branch B

Root Branch C: I7 ── I8
```

## 3. MVP 范围

### 3.1 MVP 包含

- 创建、重命名、归档多个 Canvas；
- 创建 Canvas 时绑定一个已有 OpenClaw Agent；
- 在同一 Canvas 中创建多个从头开始的 Root Branch；
- 每个 Root/Fork Branch 使用独立 OpenClaw Session；
- 在 Branch 中持续发送输入并接收流式输出；
- 将一次完整运行聚合成一个 Interaction；
- 使用 React Flow 展示 Interaction 节点和前后关系；
- 从任意已完成 Interaction 创建 Fork Branch；
- 保存不可变 Canonical Snapshot，并按能力生成 Bootstrap Context；
- 展示文本、Markdown、代码、图片、文件、Tool 调用和 Tool 结果；
- 展示 Agent 的思考、Tool、流式输出、完成和失败状态；
- 自动保存节点位置、视口和折叠状态；
- 页面刷新或短暂断线后的 Interaction 恢复；
- Canvas、Branch、Interaction、Artifact 引用和 Session Mapping 的 SQLite 持久化；
- 无鉴权的本机单用户模式；
- 可选的 Nerve Token 账号模式；
- 登录用户只能在正常 Nerve UI/API 中看到自己的 Canvas。

### 3.2 MVP 不包含

- 修改或删除历史 Interaction；
- 修改、截断或重写 OpenClaw Transcript；
- 多人实时协作或共享 Canvas；
- 跨设备云同步；
- 合并两个 Branch；
- 对比两个 Branch 的语义差异；
- 从已有普通 Chat Session 创建或导入 Canvas；
- 将已有 Canvas 重新绑定到另一个 Agent；
- 自动删除 Canvas 对应的 OpenClaw Session；
- Canvas 自己生成上下文摘要或实施第二套 compaction；
- 镜像外部 HTTP(S) Artifact；
- 完整全文搜索和向量检索；
- 抵御已登录用户绕过 UI 直接访问共享 Gateway 的安全多租户隔离。

## 4. 总体架构

```text
┌─────────────────────────────────────────────────────────────┐
│ Browser / React                                             │
│                                                             │
│  Canvas（默认）       Chat（现有）       Tasks（现有）      │
│       │                                                     │
│  React Flow / Canvas Runtime / Interaction Assembler        │
│       │                                                     │
│  GatewayContext.rpc / subscribe（复用）                     │
└───────┬───────────────────────────────┬─────────────────────┘
        │ /ws                           │ /api/canvas/*
        ▼                               ▼
┌────────────────────────────┐  ┌─────────────────────────────┐
│ OpenClaw Gateway           │  │ Nerve Server                │
│ Agent / Session / Tool     │  │ Token Auth / Principal      │
│ Streaming / Model          │  │ Canvas API / SQLite         │
│ Transcript / Compaction    │  │ Session Mapping             │
│ Artifact API / Workspace   │  │ Snapshot / Reconciler       │
└────────────────────────────┘  └─────────────────────────────┘
```

### 4.1 OpenClaw 继续负责

- Agent 定义、身份和 Workspace；
- Session 生命周期和 Transcript；
- 模型调用和 Tool 调用；
- 流式 assistant、tool、lifecycle 和 chat 事件；
- 自动 compaction、overflow recovery 和模型重试；
- Token、模型、thinking 等运行元数据；
- Artifact 发现、内容读取和下载；
- Workspace 文件的实际读写。

### 4.2 Canvas 负责

- Canvas、Root Branch 和 Fork Branch 的组织关系；
- Interaction 聚合与稳定展示模型；
- Branch 到 OpenClaw Session 的一对一映射；
- 分叉点、Canonical Snapshot 和 Bootstrap Plan；
- OpenClaw compaction checkpoint 的长期索引；
- React Flow 节点、边和布局；
- Artifact 元数据与 OpenClaw 引用；
- Canvas Session 的 owner scope 和一致性检查；
- 从 OpenClaw history 恢复未完成 Interaction。

### 4.3 事实来源

| 数据 | 事实来源 |
|---|---|
| Agent、模型执行、Tool、原生消息 | OpenClaw |
| OpenClaw Session Transcript | OpenClaw |
| Agent 实时工作状态 | OpenClaw agent/chat events |
| Artifact 内容与下载能力 | Canvas Artifact Store；旧引用回退到 OpenClaw Artifact API |
| Token 用户、`auth_version` | Nerve Auth SQLite |
| Canvas、Branch、布局 | Canvas SQLite |
| Branch ↔ Session Mapping | Canvas SQLite |
| Interaction 的 Canvas 展示版本 | Canvas SQLite |
| Canonical Snapshot | Canvas SQLite |
| 已捕获的 compaction checkpoint 元数据 | Canvas SQLite |

Canvas 可以读取 OpenClaw history 做恢复和校验，但正常展示不应每次重新解析整个 Transcript。Artifact 元数据由 Canvas 长期保留；OpenClaw 受管媒体、本地文件和 data URI 在 reconcile 时固化，外部 HTTP(S) 字节仍由来源负责。

## 5. 核心不变量

1. 一个 Canvas 只能绑定一个 `agentId`，创建后不可更改；
2. 一个 Canvas 可以有多个 `parentBranchId = null` 的 Root Branch；
3. 一个 Branch 在任意时刻只有一个当前 OpenClaw Session；
4. 一个 OpenClaw Session 最多只能由一个 Canvas Branch 管理；
5. Root Branch 不继承任何 Canvas 历史；
6. Interaction 只能追加，完成后内容不可修改；
7. Fork Branch 只能从已完成的 Interaction 创建；
8. Canonical Snapshot 创建后不可修改；
9. 父 Branch 在 fork 后新增的 Interaction 不得进入已有子 Branch 上下文；
10. Canvas 不调用 `sessions.reset` 清空 Branch Session；
11. 归档 Canvas 或 Branch 不自动删除 OpenClaw Session 或 Transcript；
12. Canvas 不静默裁剪 Canonical Snapshot；最终 overflow 由 OpenClaw 报错；
13. Canvas 所有发送请求都使用 `deliver: false`；
14. 所有创建和发送操作都带 idempotency key；
15. 每条 Canvas 领域记录都属于稳定 `ownerId`；
16. API 查询必须同时使用当前 `ownerId` 和资源 ID；
17. Canvas-managed Session 不出现在普通 Sessions 列表；
18. 客户端不能指定或切换 `ownerId`；
19. Canvas 持久化 OpenClaw 本地产物，但不镜像外部 HTTP(S) Artifact；
20. React Flow edge 是领域关系的只读投影，用户拖线不能修改历史关系。
21. Canvas 不能把 `sessionKey` 等同于永不变化的 OpenClaw Session 身份；必须记录并核对 `sessionId`。
22. 用户附件进入 Interaction 前必须拥有 Canvas 管理的持久副本，后续 Fork 不依赖 Agent Workspace 原件。

## 6. 领域数据模型

以下为概念模型，不是最终 TypeScript 文件布局。

### 6.1 CanvasRecord

```ts
type CanvasRecord = {
  id: string
  ownerId: string
  schemaVersion: number
  title: string
  description?: string

  agent: {
    agentId: string
    rootSessionKey: string
    displayName?: string
  }

  activeBranchId?: string
  status: 'active' | 'archived'
  layout: CanvasLayout

  createdAt: number
  updatedAt: number
  version: number
}
```

Canvas 不保存唯一 `rootBranchId`。所有 `parentBranchId = null` 的 Branch 都是该 Canvas 的 Root Branch。

### 6.2 BranchRecord

```ts
type BranchRecord = {
  id: string
  ownerId: string
  canvasId: string
  kind: 'root' | 'fork'
  title: string
  status: 'active' | 'archived' | 'session-missing' | 'diverged'

  parentBranchId?: string
  forkedFrom?: {
    branchId: string
    interactionId: string
    snapshotId: string
  }

  session: {
    agentId: string
    sessionKey: string
    sessionId?: string
    observedSessionId?: string
    integrity: 'unknown' | 'healthy' | 'drifted'
    state: 'draft' | 'active' | 'missing' | 'replaced'
    createdAt: number
    lastVerifiedAt?: number
  }

  bootstrap: {
    state: 'none' | 'pending' | 'injected'
    snapshotId?: string
    mode?: 'checkpoint-delta' | 'canonical-replay' | 'session-recovery'
    checkpointId?: string
    injectedAt?: number
  }

  headInteractionId?: string
  nextOrdinal: number
  createdAt: number
  updatedAt: number
  version: number
}
```

Root Branch 的 `bootstrap.state` 固定从 `none` 开始。Fork Branch 创建时根据 Gateway 能力确定 bootstrap mode。

### 6.3 InteractionRecord

```ts
type InteractionRecord = {
  id: string
  ownerId: string
  canvasId: string
  branchId: string
  ordinal: number

  status:
    | 'pending'
    | 'streaming'
    | 'completed'
    | 'error'
    | 'aborted'
    | 'recovery-required'

  userInput: {
    blocks: CanvasContentBlock[]
    displayText?: string
  }

  agentOutput: {
    blocks: CanvasContentBlock[]
    displayText?: string
    partial: boolean
  }

  artifactIds: string[]

  session: {
    agentId: string
    sessionKey: string
    sessionId?: string
    runId?: string
    idempotencyKey: string
    model?: string
    thinking?: string
    inputTokens?: number
    outputTokens?: number
    totalTokens?: number
    startedAt: number
    completedAt?: number
    stopReason?: string
  }

  transcriptCursor?: {
    beforeEntryId?: string
    userEntryId?: string
    firstAgentEntryId?: string
    lastEntryId?: string
  }

  error?: { code: string; message: string }
  createdAt: number
  completedAt?: number
  version: number
}
```

失败或中止仍然生成 Interaction。重试创建新的 Interaction，不覆盖原记录。

### 6.4 CanvasContentBlock

```ts
type CanvasContentBlock =
  | { type: 'text'; text: string }
  | { type: 'markdown'; markdown: string }
  | { type: 'code'; code: string; language?: string; filename?: string }
  | { type: 'image'; artifactId: string; alt?: string }
  | { type: 'file'; artifactId: string; name: string }
  | { type: 'tool-call'; toolCallId: string; name: string; input?: unknown }
  | { type: 'tool-result'; toolCallId: string; name?: string; output?: unknown; artifactIds?: string[] }
  | { type: 'notice'; level: 'info' | 'warning' | 'error'; text: string }
```

Canvas 使用稳定内容类型，不把 provider/Gateway 的原始 block shape 直接暴露给 UI。模型私有 thinking 内容不持久化。

### 6.5 ArtifactRecord

```ts
type ArtifactRecord = {
  id: string
  ownerId: string
  canvasId: string
  interactionId: string

  openClawArtifactId: string
  sessionKey: string
  runId?: string
  messageSeq?: number

  type: string
  title: string
  mimeType?: string
  sizeBytes?: number
  source?: string
  downloadMode: 'url' | 'bytes' | 'unsupported'

  createdAt: number
}
```

Canvas 不向客户端暴露 Artifact 的持久化绝对路径。`artifactId + ownerId/canvasId/interactionId` 是读取持久副本的依据，`sourceUri` 保留 OpenClaw 溯源信息。

### 6.6 CanonicalSnapshotRecord

```ts
type CanonicalSnapshotRecord = {
  id: string
  ownerId: string
  canvasId: string
  sourceBranchId: string
  throughInteractionId: string

  lineage: Array<{
    branchId: string
    interactionId: string
    ordinal: number
  }>

  interactions: SnapshotInteraction[]
  resourceManifest: Array<{
    id: string
    sourceInteractionId: string
    source: 'user_attachment' | 'agent_artifact'
    name: string
    mimeType: string
    sizeBytes?: number
    uri: string
  }>

  compiler: {
    formatVersion: 2
    policy: 'full'
  }

  canonicalSha256: string
  createdAt: number
}
```

Canonical Snapshot 永远保存完整的 Canvas 可见历史。它用于审计、浏览、恢复和 bootstrap 生成，但不代表每次都要完整发送给模型。

### 6.7 CompactionCheckpointRecord

```ts
type CompactionCheckpointRecord = {
  id: string
  ownerId: string
  canvasId: string
  branchId: string
  sessionKey: string

  openClawCheckpointId: string
  summary?: string
  firstKeptEntryId?: string
  preCompactionLeafId?: string
  postCompactionLeafId?: string
  throughInteractionId?: string
  tokensBefore?: number
  tokensAfter?: number

  createdAt: number
  capturedAt: number
}
```

Canvas 复制的是 checkpoint 摘要和边界元数据，不复制 OpenClaw Transcript。这样即使 OpenClaw 清理旧 checkpoint，Canvas 仍能知道历史节点对应的压缩边界。

### 6.8 CanvasLayout

```ts
type CanvasLayout = {
  viewport: { x: number; y: number; zoom: number }
  nodes: Record<string, {
    x: number
    y: number
    collapsed?: boolean
  }>
  version: number
}
```

`nodes` 同时支持 Interaction Node 和空 Branch Composer Node。Edges 从领域关系实时推导，不单独作为可编辑事实保存。

### 6.9 CanvasAgentStatus

```ts
type CanvasAgentStatus =
  | { state: 'idle' }
  | { state: 'thinking'; since: number }
  | { state: 'using-tool'; toolName: string; description?: string; since: number }
  | { state: 'streaming'; since: number }
  | { state: 'done'; completedAt: number }
  | { state: 'error'; message?: string; occurredAt: number }
  | { state: 'aborted'; occurredAt: number }
```

这是前端运行态，不作为不可变 Agent Output 保存。Interaction 只保存最终状态、时间和必要错误信息。

## 7. 多会话与 Branch 历史语义

### 7.1 新建 Canvas

创建 Canvas 时：

1. 绑定一个 Agent；
2. 只保存 Canvas 元数据；
3. 用户点击“新会话”后创建未物化的 Root Branch 和 Composer；
4. 用户真正发送第一条消息时，才通过 `chat.send` 让 OpenClaw 建立 Session；
5. 创建 Canvas、Branch 或 Composer 均不调用 Gateway。

### 7.2 在 Canvas 中开始新会话

用户可以随时执行“新会话”：

1. 创建新的 Root Branch；
2. 只预留新的 OpenClaw Session key，不创建空 Session；
3. `parentBranchId` 和 `forkedFrom` 均为空；
4. 不读取其他 Branch 的 Snapshot；
5. 在同一张 React Flow 图中新增独立 Composer Node。

因此“一个 Canvas 包含多个会话”的含义是：同一个 Agent 和同一个可视化空间下，存在多个互不继承上下文的 Root Branch，以及它们各自派生的 Fork Branch。

### 7.3 Fork 历史

假设：

```text
Branch A: I1 → I2 → I3 → I4
                    └─ fork → Branch B: I5 → I6
```

- I1、I2、I3 仍属于 Branch A；
- Branch B 可见继承历史为 I1、I2、I3；
- Branch B 自己拥有 I5、I6；
- I4 在 fork 后继续留在 A，不属于 B；
- Branch B 的模型上下文在创建时冻结，不实时读取 A；
- 再从 B 的 I6 分叉时，新 Snapshot 展开继承历史和 B 自己的历史。

## 8. OpenClaw Session Mapping

### 8.1 Session key

Canvas Session 使用保留命名空间：

```text
agent:<agentId>:canvas:<branchId>
```

Session label 使用便于诊断的前缀：

```text
canvas/<canvasId-short>/<branch-title>
```

真正映射保存在 `BranchRecord.session.sessionKey`。key/label 前缀用于 UI 全局过滤、诊断和孤儿识别，不能代替数据库所有权校验。

### 8.2 Root Branch Session

Root Branch 只在 SQLite 中创建 `draft` Mapping。第一次真实输入调用 `chat.send`，使用预留的 Session key；OpenClaw 在收到真实消息时创建 Session，避免空 Transcript。

### 8.3 Fork Branch Session

Fork Branch 创建时冻结 Canonical Snapshot，但不创建 OpenClaw Session。第一次真实输入将 Snapshot 和本轮输入一起发送到新的预留 Session key。任何方案都不得修改父 Session Transcript。

### 8.4 Session 所有权

- 普通 Chat 不选择或写入 Canvas Session；
- 普通 Sessions 列表、未读标记和事件投影过滤 `agent:<agentId>:canvas:*`；
- 仍使用 SQLite Mapping 校验 reset/delete/restore 等行为；
- 检测到无法映射的外部消息时标记 `diverged`，不静默并入 Interaction；
- Session 丢失时不能静默创建空 Session，应显式执行 Restore；
- 归档不删除 Session 或 Transcript。

`prepare-send` 对 active Branch 读取完整 `sessions.list` 并比较 SQLite 中的预期 `sessionId`。相同 key 返回不同 ID，或已记录 ID 的 Session 消失，均标记为 `drifted`；本次发送采用 `session-recovery`，把截至当前 Head 的 Canonical Snapshot 与资源重新注入 replacement Session。ACK 后以观察到的新 ID 更新映射；若 Session 是发送时才重建，则暂置为 `unknown`，由后续 monitor/Transcript 读取补记新 ID。

隐藏是产品行为，不是共享 Gateway 下的强授权边界。

## 9. Interaction 运行流程

### 9.1 独立 Runtime

Canvas 复用 `GatewayContext.rpc()`、`subscribe()` 和纯解析函数，但不复用 ChatContext 的全局消息数组或 `currentSession`。Canvas 同时管理多个 Branch Session，并将多条 Gateway 消息聚合为一个 Interaction。

### 9.2 一次 Interaction

```text
1. 用户在 Branch 输入内容
2. POST /api/canvas/branches/:branchId/prepare-send
   ├── 校验 Root / Continue / Fork 唯一合法状态转换
   ├── 将用户附件复制到 Canvas Artifact Store
   ├── 校验 active Branch 的 OpenClaw sessionId，必要时选择 session-recovery
   ├── 分配 reservationId，并将其作为 idempotencyKey
   └── 返回 sessionKey 与 Bootstrap Plan
3. Canvas Runtime 调用 chat.send
   ├── sessionKey = Branch Session
   ├── deliver = false
   ├── message = bootstrap（可选）+ 当前真实输入
   └── idempotencyKey = 后端分配值
4. Gateway 返回 runId，并发送 chat/agent events
5. Interaction Assembler 按 sessionKey + runId 聚合
   ├── assistant delta
   ├── tool start/result
   ├── image/file artifacts
   └── final/error/aborted
6. Gateway ACK 后创建 streaming Interaction 并推进 Branch Head
7. final/error/aborted 只向服务端发送带 `runId` 的终态提示，不由 Browser 直接判定完成或丢弃 active Run 映射
8. 服务端验证 `sessions.list` 的终态活动属于当前 Interaction；若状态存在时序歧义，则以 `sessions.get` 中已出现当前轮有效回复作为兜底确认
9. Transcript 连续稳定后写入最终 Agent Output 和 Artifact references
```

Browser 只负责低延迟 Streaming；Server 是 Interaction 终态和最终内容的唯一事实来源。浏览器刷新、WebSocket 重连或漏掉 `chat_final` 都不会使 Interaction 永久卡住。

终态后的 Transcript 收敛规则：

- Browser 终态事件是不可信提示；只有确认终态属于当前 Run，或 Transcript 已有当前轮有效回复后，才开始 settling；
- 相对已确认终态在 `0.5 / 1.5 / 3 / 4 / 6 / 9 / 12 / 15` 秒读取 `sessions.get`；
- 至少等待 4 秒、当前轮已有非空文本或 Artifact，并且连续两次内容指纹一致后，才提前完成；
- 15 秒仍未稳定但已有有效回复时，用当前最佳内容完成 Interaction，并将 `artifactSync` 标为 `pending`；若 Transcript 仍为空，Interaction 保持 streaming 并进入长尾复查；
- 在终态后 30 秒、1 分钟、2 分钟、5 分钟、15 分钟和 1 小时后台复查，只更新 Agent Output 和 Artifact references；
- 长尾结束仍不可读的本地 Artifact 标记为 `artifactSync=degraded`，保留源引用与 warning；页面加载、手动 reconcile 和服务重启可再次尝试；
- 服务重启后恢复未完成、旧版本、错误 synced 的空记录及 `artifactSync=pending/degraded` 的 Interaction；
- 对已经结束超过 15 秒的历史 Session，约间隔 1 秒读取两次后直接恢复，不重新等待完整 15 秒。

### 9.3 并发与事件归属

- 同一 Branch 同时最多一个 active Interaction；
- 不同 Branch 可以并行；
- `sessionKey` 定位 Branch；
- `runId` 定位 Interaction；
- `idempotencyKey` 防止重复发送；
- 事件缺少 runId 时只能落到该 Branch 唯一 pending Interaction；
- 无法可靠归属时进入 `recovery-required`，不猜测合并。

### 9.4 页面刷新恢复

1. 从 SQLite 恢复 Canvas 和已完成 Interaction；
2. 服务端恢复 pending/streaming Interaction 的 Session monitor；
3. 结合 transcript cursor、runId、时间和 sessionKey 定位本轮；
4. 已完成则通过 `sessions.get` 补建 Agent Output 与 Artifact references；
5. 仍在运行则恢复订阅和 Agent 状态；
6. 无法确定时显示恢复提示。

## 10. Context Snapshot、Compaction 与 Fork

### 10.1 两层 Context

Canvas 明确区分：

```text
Canonical Snapshot
  完整、不可变、永久保存，用于 UI / 审计 / 恢复

Bootstrap Context
  为一次 Fork 派生，实际交给模型，可利用 OpenClaw 压缩状态
```

OpenClaw 会将旧历史压缩成 summary，同时保留近期消息并在 overflow 时自动恢复。Canvas 不重新实现 token budgeting、滚动窗口或摘要算法。

### 10.2 Fork 策略

前端把 Branch 末尾添加固定解释为 Continue，把非 Head 历史 Interaction 添加固定解释为 Fork。后端拒绝从当前 Head Fork，因此无需 native fork 分支和对应竞态处理。

#### A. `checkpoint-delta`（预留）

用于任意历史 Interaction：

1. 找到 fork point 之前或正好对应它的最新 checkpoint；
2. 使用 checkpoint summary；
3. 从 `firstKeptEntryId` 映射到 Canvas Interaction；
4. 追加 checkpoint 边界后到 fork point 的 canonical Interaction；
5. 与新 Branch 第一次真实输入一起发送。

绝不能使用 fork point 之后的 checkpoint，否则会泄漏父 Branch 的未来内容。

#### B. `canonical-replay`（当前 MVP）

当没有可用 checkpoint，或只有无法导出的 provider 原生压缩状态时：

- 完整回放 Canonical Snapshot；
- 与第一次真实输入一起发送；
- 交给 OpenClaw 自动 compaction/overflow recovery；
- 最终仍失败时保存普通 error Interaction，Branch 保持可重试；
- 不在 Canvas 内生成摘要。

#### C. Fork 附件与 Artifact 继承

Canonical Snapshot v2 除文本外，还冻结截至 fork point 的全部用户输入附件和 Agent Artifact 引用。Fork Branch 仍保持惰性：创建 Branch 时不调用 OpenClaw，第一次真实发送时才完成以下工作：

1. 回放 Snapshot 文本；
2. 按 lineage 收集 fork point 之前的用户附件与 Agent Artifacts，排除父 Branch 的未来资源；
3. 对规范化后的本地路径、`file://`、Nerve 文件地址和 OpenClaw Media URI 去重；
4. 将可读取资源重新通过 `chat.send.attachments` 提交到新 Session；
5. 将无法读取、已失效或超限的资源同时告知用户和 Agent，但不阻止其余上下文发送。

Continue Branch 不重放历史附件，因为当前 OpenClaw Session 已保存其 Transcript 与媒体上下文；Root Branch 也只发送本轮新增附件。OpenClaw 当前没有面向 Gateway 的任意历史节点 Session Fork API，因此 Canvas 不依赖内部私有 fork 模块。

### 10.3 Checkpoint 捕获（后续增强）

- Interaction finalize/reconcile 后调用 `sessions.compaction.list/get`；
- 复制 summary、`firstKeptEntryId`、pre/post leaf 和 token 元数据到 Canvas SQLite；
- 通过 Interaction transcript cursor 建立 checkpoint 到 Interaction 的边界映射；
- 不直接读取 OpenClaw SQLite 或本地 Transcript 文件，以兼容远程 Gateway；
- 不使用 `sessions.compaction.branch` 作为主要方案，因为它不保证使用压缩后的有效上下文。

### 10.4 Bootstrap 注入

空 Fork Session 创建时不发送消息，避免产生用户未请求的 Agent 回复。第一次真实输入到来时才发送 Bootstrap Context：

```text
[OpenClaw Canvas Prior Context]
...checkpoint summary + delta，或 canonical replay...
[End Prior Context]

[Current User Input]
...用户本次真实输入...
```

UI 只显示真实 User Input。成功后记录 bootstrap state，后续 Interaction 不再注入。

## 11. Artifact 策略

### 11.1 OpenClaw 原生能力

MVP 从 `sessions.get` 返回的 Transcript 消息中读取 OpenClaw 已导出的 Artifact 引用，包括 `image.url/openUrl`、`MediaUrl(s)`、文件块、Markdown 链接和 Tool result 中的结构化文件引用。Canvas 随后固化其中可读取的 OpenClaw 本地产物。

### 11.2 保存规则

- Canvas SQLite 保存 Artifact ID、名称、MIME、大小、持久 URI、源 URI、存储状态和可用性；
- 文件字节保存到项目根目录 `artifacts/<owner-hash>/<canvasId>/<interactionId>/<artifactId>`，不进入 `database/`；
- 用户输入附件按内容哈希保存到 `artifacts/<owner-hash>/<canvasId>/attachments/<attachmentId>`；Interaction 记录稳定的 owner-scoped URI，同时保留 `sourceUri` 仅供溯源；
- 持久化 OpenClaw 受管媒体、Workspace/临时本地文件和 data URI；外部 HTTP(S) 链接只保存引用；
- 单文件上限为 25 MiB，超限或读取失败时保留源引用与 warning；
- 只接受结构化字段、Markdown 链接和带明确文件扩展名的 Tool 文件路径，不把普通自然语言猜成 Artifact；
- Snapshot 只引用输入附件和 Artifact 元数据，不嵌入内容；
- 已持久化 Artifact 不再依赖 OpenClaw retention；未持久化源引用仍取决于来源可用性；
- Artifact 不可用不影响 Interaction 文本历史继续浏览。

### 11.2.1 输入附件发送规则

- 所有本轮新文件均使用 OpenClaw 原生 `chat.send.attachments`，字段为 `fileName + mimeType + base64 content`；
- 图片控制在 1.8 MB 以内作为模型视觉输入，同时在 Agent Workspace 的 `.nerve/canvas-uploads/<canvasId>/` 保留原始文件引用，供图片编辑工具使用；
- `prepare-send` 同步复制原始字节到 Canvas Artifact Store；`.nerve/canvas-uploads` 仅服务本轮 OpenClaw/工具访问，不再是 Canvas 历史或 Fork 的事实来源；
- 非图片保持原始字节，由 OpenClaw 原生转换为 Agent 可访问的 `MediaPath(s)`；
- Manifest 只提供名称、类型、大小和原始路径等溯源信息，不能代替 Gateway attachment；
- Canvas SQLite 不保存 Base64 或文件内容；用户输入原件和可读取的 Agent 本地产物由 Canvas Artifact Store 保存，数据库只保存稳定 URI 与溯源元数据。

### 11.3 获取规则

- Canvas 持久 URI：由 owner-scoped API 读取固定副本；
- 旧 OpenClaw URL：由 Nerve 做同源流式转发，供迁移失败时兼容；
- Nerve/HTTP URL：前端直接预览或下载；
- Workspace 文件路径：转换为现有文件读取入口，不复制内容；
- 不把 Gateway token 暴露给浏览器下载 URL；
- Nerve 转发必须验证当前 owner 是否拥有对应 Canvas/Branch/Session Mapping。

### 11.4 Interaction 展示

| 类型 | 展示行为 |
|---|---|
| 图片 | 在 Interaction 卡片中直接显示缩略图，可查看大图和下载 |
| 纯文本/Markdown/JSON/代码 | 文件图标、内容预览、展开和下载 |
| PDF | PDF 图标、浏览器支持时预览、下载 |
| 音频/视频 | 对应媒体图标、浏览器支持时播放、下载 |
| Office/压缩包/其他二进制 | 对应文件图标、名称、大小和下载 |
| unsupported | 元数据、文件图标和不可用提示 |

SVG 默认作为下载处理，除非经过安全净化，避免脚本内容进入页面。

## 12. 持久化设计

### 12.1 路径

结构化数据使用 SQLite，默认位于项目根目录：

```text
database/
├── canvas.sqlite
├── canvas.sqlite-wal
└── canvas.sqlite-shm
artifacts/
└── <owner-hash>/<canvasId>/<interactionId>/<artifactId>
```

- 项目根通过向上查找 `package.json` 解析，不依赖编译产物的目录嵌套深度；
- 数据库路径和文件名固定为项目根目录下的 `database/canvas.sqlite`，不提供环境变量覆盖；
- 用户、Canvas、Branch、Interaction 和布局等结构化数据共用该数据库；
- Docker 部署时将宿主机目录整体映射到容器的项目 `database/` 目录，不单独映射 SQLite 主文件；
- SQLite、WAL、SHM 和备份文件全部忽略 Git；
- 目录中只跟踪说明文件；
- `artifacts/` 内容忽略 Git，只跟踪 `.gitkeep`；删除 Canvas 时同步清理对应目录，启动时清理数据库中已不存在的孤儿目录。

### 12.2 SQLite 选择

- 使用 Node 内置 `node:sqlite`，不增加 native addon；
- Canvas 有效最低 Node 版本为 `22.13.0`；
- 低版本启动时明确报告 Canvas 不可用，不延迟到首次请求失败；
- 通过 Repository 接口访问数据库，route、Gateway adapter 和 React 不直接写 SQL。

建议配置：

```sql
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;
PRAGMA synchronous = NORMAL;
```

### 12.3 逻辑表

```text
schema_migrations
canvases
branches
interactions
interaction_blocks
artifacts
canonical_snapshots
snapshot_interactions
compaction_checkpoints
idempotency_keys
fork_reservations
orphan_sessions
owner_claims
```

关键约束：

- `UNIQUE(owner_id, branch_id, ordinal)`；
- `UNIQUE(session_key)`；
- `UNIQUE(owner_id, operation, idempotency_key)`；
- 所有父子引用同时校验 `owner_id`；
- Root Branch 允许多个，不设置 Canvas 级唯一根约束；
- 列表索引以 `owner_id` 开头；
- Artifact 唯一约束覆盖 owner、Interaction 和 OpenClaw artifact ID。

### 12.4 事务与保留

- schema 通过顺序 migration 演进；
- Canvas、Branch 和 Layout 使用 version 做 optimistic concurrency control；
- Interaction start/finalize/reconcile 保持幂等；
- Gateway Session 创建是外部副作用，使用 reservation/outbox 风格恢复；
- 外部副作用成功、本地提交失败时记录 orphan session；
- Archive 只改变可见状态，不硬删除；
- Session 被外部删除后，Canvas 历史仍可浏览；
- 恢复丢失 Session 时创建 replacement Session，并记录 replacement，而不是伪装成旧 Session。

## 13. Token 身份与用户隔离

### 13.1 现有 Nerve 能力

原 Nerve auth 只判断“已登录/未登录”。Canvas MVP 将登录 Cookie 扩展为带稳定 `sub` 的用户会话，以便所有 Canvas 查询按 owner 隔离。

### 13.2 身份模式

```ts
type CanvasPrincipal = { ownerId: string; mode: 'local' | 'token-account' }
```

| 模式 | Principal | 行为 |
|---|---|---|
| `NERVE_AUTH=false` | `local` | 无登录页，本机单用户 |
| Token account mode | cookie 中稳定 `sub` | 多个可信用户的产品级隔离 |

### 13.3 Token 账号

MVP 登录页只有一个 Token 输入框，但不允许自注册。用户只能由服务器管理员通过本地 `npm run users` 命令创建、轮换、禁用或启用；未知 Token 必须拒绝。

```text
canvas_users
  id
  display_name
  token_hash
  token_version
  status
  created_at
  updated_at
```

规则：

- `id` 是随机且稳定的 Canvas `owner_id`，Token 轮换不改变它；
- Token 去除首尾空格后按大小写精确匹配；
- 数据库只保存 scrypt 加盐 hash，不保存 Token 明文；
- 登录成功签发 `{ sub, name, ver, iat, exp }` 的 HttpOnly cookie；
- Token 轮换或禁用账号时提升 `token_version`，旧 cookie 随即失效；
- 同一 IP 30 分钟内失败 3 次后锁定 30 分钟，失败状态仅保存在内存；
- HTTP middleware 和 WebSocket upgrade 解析同一个 principal；
- 不引入角色、组织、共享 Canvas 或管理员网页。

### 13.4 本地模式

`NERVE_AUTH=false` 时使用固定 `local` owner；创建第一个受管用户时，在同一事务中自动把全部本地 Canvas 转给该用户，且只执行一次。

### 13.5 隔离边界

- 所有 Canvas Repository 方法显式接收 `ownerId`；
- 不属于当前 owner 的资源统一返回 `404`；
- Artifact 请求必须同时校验 owner 和 Session Mapping；
- 客户端不能传入 `ownerId`；
- 普通 Session UI 隐藏全部 Canvas-managed Session，而不仅是当前用户的 Session。

MVP 面向受控环境中的少量可信用户，只提供产品级隔离。共享 Gateway 的已登录用户若主动构造原始 Gateway RPC，仍可能绕过 Nerve Canvas API；安全多租户需要 Gateway ACL 或独立 Gateway，不属于 MVP。

## 14. Canvas API 草案

### 14.1 Canvas

```text
GET    /api/canvas/canvases
POST   /api/canvas/canvases
PATCH  /api/canvas/canvases/:canvasId
DELETE /api/canvas/canvases/:canvasId
GET    /api/canvas/canvases/:canvasId/graph
```

创建 Canvas 不自动创建 Branch 或 Session。

### 14.2 Branch 与新会话

```text
POST   /api/canvas/canvases/:canvasId/root-branches
POST   /api/canvas/interactions/:interactionId/fork
```

`POST .../branches/root` 表示在已有 Canvas 中从头开始一个新会话，不接收 parent/fork/snapshot 参数。

Root 和 Fork 接口幂等返回已有的未发送草稿，防止同一位置生成多个 Composer。

### 14.3 Interaction

```text
POST   /api/canvas/branches/:branchId/prepare-send
POST   /api/canvas/send-reservations/:reservationId/ack
POST   /api/canvas/send-reservations/:reservationId/fail
POST   /api/canvas/interactions/:interactionId/reconcile
GET    /api/canvas/openclaw-artifact?uri=...
```

### 14.4 Artifact

```text
Artifact 地址和元数据随 Interaction Graph 返回。
GET /api/canvas/artifacts/:canvasId/:interactionId/:artifactId
GET /api/canvas/attachments/:canvasId/:attachmentId
```

持久内容路由校验当前 owner 的 Canvas/Interaction/Attachment 所有权；旧的 OpenClaw media URL 仍通过同源代理兼容。绝对持久路径和 Gateway token 都不暴露给浏览器。

### 14.5 Layout

```text
PUT    /api/canvas/canvases/:canvasId/layout
```

请求包含完整 viewport、变化节点和 layout version。版本冲突返回当前布局，前端不得用旧版本覆盖新版本。

## 15. React Flow 前端设计

### 15.1 库与组件

使用官方当前包：

```text
@xyflow/react
```

参考：[React Flow Building a Flow](https://reactflow.dev/learn/concepts/building-a-flow)。

建议模块：

```text
src/features/canvas/
├── CanvasView.tsx
├── CanvasList.tsx
├── CanvasFlow.tsx
├── nodes/
│   ├── InteractionNode.tsx
│   └── ComposerNode.tsx
├── edges/
│   ├── ContinuationEdge.tsx
│   └── ForkEdge.tsx
├── InteractionCard.tsx
├── ArtifactRenderer.tsx
├── AgentStatusIndicator.tsx
├── CanvasProvider.tsx
├── hooks/
│   ├── useCanvasStore.ts
│   ├── useCanvasRuntime.ts
│   ├── useInteractionAssembler.ts
│   └── useCanvasLayout.ts
└── adapters/
    ├── gatewayContentAdapter.ts
    └── artifactAdapter.ts
```

### 15.2 Node 与 Edge

- Interaction 对应自定义 Interaction Node；
- 空 Branch 对应 Composer Node；
- continuation/fork edge 根据 Branch lineage 生成；
- 用户可以移动节点、平移、缩放和选择；
- 用户不能通过连接、删除 edge 修改历史；
- 新节点根据父节点、同层兄弟和节点尺寸计算初始位置；
- 用户手动移动后，持久化坐标优先于自动布局。

### 15.3 自动保存布局

- `onNodeDragStop` 后保存节点位置；
- `onMoveEnd` 后保存 viewport；
- 展开/折叠节点后保存状态；
- 连续变化约 500ms debounce；
- 页面 unload 不作为唯一保存机会；
- 请求携带 layout version；
- 内容写入与布局写入使用不同锁，布局失败不影响 Interaction。

### 15.4 导航与默认页

顶部导航顺序固定为：

1. Canvas
2. Chat
3. Tasks

Canvas 是应用启动默认页面：

- 启动时不让旧 `nerve:viewMode` 覆盖默认页；
- 用户可在当前运行中自由切换；
- 没有 Canvas 时显示创建引导，不自动跳到 Chat；
- Canvas Branch 切换不修改 Chat 的 `currentSession`。

### 15.5 可复用能力

Canvas 可复用：

- GatewayContext RPC 与订阅；
- Chat 的纯 event classifier；
- Markdown renderer 和代码高亮；
- 主题、响应式布局和错误边界；
- 文件 MIME/icon 工具。

Canvas 不复用：

- ChatContext 的全局消息状态；
- ChatContext 的 currentSession；
- Chat 气泡模型；
- Kanban Store 或任务状态机。

## 16. Agent 工作状态

### 16.1 OpenClaw 状态来源

OpenClaw agent loop 提供：

- `stream=lifecycle`：`start | end | error`；
- `stream=assistant`：assistant 输出增量；
- `stream=tool`：Tool `start | result`；
- chat state：`started | delta | final | error | aborted`。

参考：[OpenClaw Agent Loop](https://docs.openclaw.ai/concepts/agent-loop)。

### 16.2 映射规则

| OpenClaw 事件 | Canvas 状态 |
|---|---|
| lifecycle start / chat started | thinking |
| tool start | using-tool |
| tool result | thinking |
| assistant stream / chat delta | streaming |
| lifecycle end / chat final | done |
| lifecycle error / chat error | error |
| chat aborted | aborted |

Tool description 复用 Nerve 的安全格式化逻辑，只显示 Tool 名称和经过清理的简短描述。

### 16.3 页面反馈

- 当前 Branch 和 Composer 显示 Agent 是否工作；
- 当前 Interaction 卡片显示 thinking、tool、streaming 状态；
- Tool 状态可显示例如“正在读取文件”或“正在执行命令”；
- 流式内容直接进入当前 Interaction；
- 完成、失败和中止有明确终态；
- 状态变化不创建额外 Interaction。

### 16.4 刷新与卡住状态

- 刷新后先读取 `sessions.list` 的 `busy/processing/state/agentState` 恢复粗粒度状态；
- 实时事件到达后覆盖粗粒度状态；
- pending Interaction 结合 history reconcile；
- 长时间没有终态时显示“仍在运行/等待状态确认”；
- 不因单次事件遗漏误报完成。

## 17. Nerve 后端接入点

建议新增独立模块：

```text
server/routes/canvas.ts
server/lib/auth-principal.ts
server/lib/token-account-repository.ts
server/lib/token-account-sqlite.ts
server/lib/canvas-principal.ts
server/lib/canvas-repository.ts
server/lib/canvas-sqlite.ts
server/lib/canvas-session-adapter.ts
server/lib/canvas-context-compiler.ts
server/lib/canvas-interaction-projector.ts
server/lib/canvas-artifact-adapter.ts
server/lib/canvas-reconciler.ts
```

原则：

- `server/app.ts` 只增加 route 注册；
- auth route、session cookie、middleware 和 WS proxy 只做 principal 薄扩展；
- Gateway 版本差异集中在 `CanvasSessionAdapter`；
- Artifact RPC 差异集中在 `CanvasArtifactAdapter`；
- Repository 负责 SQL、migration、transaction 和 owner scope；
- 不直接读取 OpenClaw 内部 SQLite/Transcript 文件。

## 18. 与 Chat、Tasks、Sessions 的关系

### 18.1 Chat

- Chat 保持现有能力；
- Canvas 是默认但不替换 Chat；
- Canvas 不读取 ChatContext 状态；
- 不支持从 Chat 创建或导入 Canvas；
- 两套会话入口完全独立。

### 18.2 Tasks

- Canvas 不建立在 Tasks 上；
- Tasks 是 Kanban + Agent job runner；
- Canvas 是长期、多会话、多分支交互图；
- 两者只共享 Gateway 和部分渲染基础设施。

### 18.3 Sessions

- 每个 Branch 都是真实 OpenClaw Session；
- 同一 Canvas 可以映射多个 Root Session 和多个 Fork Session；
- Canvas 切换不改变 Chat 当前 Session；
- 普通 Session 列表不展示任何 Canvas Session；
- 普通 Chat 不写入、reset 或删除 Canvas Session；
- Canvas Runtime 自己维护状态和历史。

## 19. 并发、幂等和一致性

- 同一 Branch 同时最多一个 active Interaction；
- 不同 Branch，包括不同 Root Branch，可以并行；
- start/finalize/reconcile/fork/root-create 都必须幂等；
- 重复请求返回同一资源；
- 布局保存使用 version，不影响内容事务；
- fork/root session 创建使用 reservation；
- Gateway 创建成功但本地提交失败时记录 orphan session；
- 不自动删除孤儿 Session；
- Artifact list/download 失败不回滚已经完成的文本 Interaction；
- checkpoint 捕获失败可重试，不改变 Interaction 完成状态。

## 20. 保持 upstream 可同步

- 前端主体限制在 `src/features/canvas/`；
- 后端主体限制在 Canvas/Token 新模块；
- 不修改 ChatContext、Kanban Store 和 OpenClaw Transcript reader 核心逻辑；
- 对现有组件通过 import/adapter 复用；
- App、TopBar、commands、server/app 保持薄接线；
- 普通 Session 过滤逻辑集中在一个可测试的 key predicate；
- Canvas 开发只在 `feat/canvas`；
- upstream 同步方向保持 `upstream/master → master → feat/canvas`。

## 21. 已确认决策

- Canvas 是顶部第一个导航项和启动默认页面；
- 一个 Canvas 固定绑定一个 Agent；
- 一个 Canvas 可以有多个从头开始、上下文互不继承的 Root Branch；
- 每个 Branch 映射独立 OpenClaw Session；
- Interaction 是 React Flow 节点，前后关系通过 edge 展示；
- 节点位置、视口和折叠状态自动保存；
- Canvas 不实现自己的摘要或 compaction；
- Branch 末尾只能 Continue；只有非 Head 的已完成历史 Interaction 可以 Fork；
- Continue 直接复用当前 Session，Root/Fork 只在首次发送时物化 Session；
- 当前 MVP 使用 canonical replay，预留 checkpoint-delta 增强点；
- OpenClaw 本地 Artifact 优先使用 Canvas 持久副本，外部 HTTP(S) 只使用源引用；
- Artifact 持久化或下载失败时显示明确不可用原因，不回退猜测任意路径；
- 图片直接显示，其他文件按类型提供图标、预览和/或下载；
- OpenClaw Agent 工作状态反馈到 Branch、Composer 和当前 Interaction；
- 用户使用管理员命令创建的 Token 登录，不使用账号密码且不允许登录页自注册；
- 用户隔离只做到受控可信环境下的产品级；
- Canvas-managed Session 不展示在普通 Sessions 列表；
- Canvas 完全独立，不从现有 Chat 或普通 Session 创建/导入。

## 22. 技术验证项

1. 当前 Gateway 对 Canvas Session key 和延迟 `chat.send` 建立 Session 的真实返回 shape；
2. `sessions.compaction.list/get` 与 Interaction entry ID 的映射；
3. `artifacts.list/get/download` 在 image、text、PDF、binary 和 unsupported 下的返回；
4. OpenClaw managed media URL 的鉴权和过期行为；
5. `chat.history` 的 message ID、runId、cursor 和截断行为；
6. lifecycle、assistant、tool、chat 事件在不同 agent runtime 下的一致性；
7. 刷新时 `sessions.list` 对 busy/processing 状态的准确性；
8. 多 Root Branch 并行运行时事件是否可靠按 sessionKey 隔离；
9. Canvas Session 过滤是否覆盖列表、缓存、未读和普通 Chat 选择；
10. Token principal 在 HTTP 与 WebSocket 中是否完全一致；
11. 接近上下文上限时 checkpoint-delta 和 canonical-replay 的行为；
12. Node 22.13 上所用 `node:sqlite` API 的兼容性。

这些验证允许调整 Adapter，不应改变 Canvas、Root Branch、Fork Branch、Interaction 和 Snapshot 的核心领域语义。

## 23. MVP 验收标准

- 应用启动默认进入 Canvas，顶部顺序为 Canvas、Chat、Tasks；
- 没有 Canvas 时显示创建入口；
- 可以创建多个绑定不同 Agent 的 Canvas；
- 同一 Canvas 可以创建至少两个互不继承历史的 Root Branch；
- 每个 Root/Fork Branch 都有独立且可验证的 OpenClaw Session Mapping；
- 在 Branch 中连续交互复用同一 Session；
- 一次 User → Agent 运行只生成一个 Interaction；
- Interaction 节点通过 continuation/fork edge 正确连接；
- 节点拖动、缩放、平移和折叠在刷新后恢复；
- 从任意已完成 Interaction fork 后，只继承 fork point 之前的上下文；
- fork 不改变父 Branch 或旧 Transcript；
- 父 Branch 后续内容不会进入已有子 Branch；
- 文本、Markdown、代码和 Tool 结果正确展示；
- 图片在 Interaction 内直接显示；
- 文本文件可预览/下载，其他文件显示图标并按能力下载；
- Canvas 为 OpenClaw 本地产物创建 owner-scoped 持久副本；
- unsupported Artifact 显示明确不可用状态；
- Agent thinking、using-tool、streaming、done、error、aborted 状态可感知；
- 页面刷新后已完成 Interaction 直接从 SQLite 恢复；
- Streaming 中刷新可恢复或明确进入 recovery-required；
- Session 被外部删除后 Canvas 历史仍可浏览；
- Canvas Session 不出现在普通 Session 列表；
- `NERVE_AUTH=false` 无额外配置可使用 local owner；
- 两个 Token 用户获得不同稳定 owner，正常 Canvas UI/API 互不可见；
- Token rotate/disable 后旧 cookie 失效；
- 第一个 Token 用户能幂等继承 local/legacy Canvas；
- SQLite 事务中断和重复 idempotency key 不产生重复 Branch/Interaction；
- Canvas 代码边界不要求重写现有 Chat 或 Tasks。

## 24. 参考依据

- Nerve 本仓库 `docs/SECURITY.md`、认证、Session、WebSocket 和 Chat event 相关代码；
- [OpenClaw Gateway Protocol](https://docs.openclaw.ai/gateway/protocol)；
- [OpenClaw Control UI](https://docs.openclaw.ai/control-ui)；
- [OpenClaw Agent Loop](https://docs.openclaw.ai/concepts/agent-loop)；
- [OpenClaw Compaction](https://docs.openclaw.ai/concepts/compaction)；
- [OpenClaw Session Management and Compaction](https://docs.openclaw.ai/reference/session-management-compaction)；
- [React Flow](https://reactflow.dev/learn/concepts/building-a-flow)；
- [Node.js SQLite](https://nodejs.org/api/sqlite.html)。
