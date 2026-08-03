# HTTP API

浏览器只使用以下产品级 HTTP/SSE API，不存在浏览器 Gateway RPC 或通用 WebSocket 转发路由。所有受保护路由都执行请求体限制、Origin、限流和所有者检查。

## Canvas

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | `/api/canvas/canvases` | 列出当前所有者的 Canvas |
| POST | `/api/canvas/canvases` | 创建 Canvas；服务端选择聚合目录中第一个可用 Agent，不弹选择窗 |
| PATCH | `/api/canvas/canvases/:id` | 更新名称，或在首次持久发送预留前更新 `agentRef` |
| DELETE | `/api/canvas/canvases/:id` | 删除 Canvas 和持久化文件 |
| GET | `/api/canvas/canvases/:id/graph` | 无副作用读取 Canvas、Branch、Interaction、布局和 `pendingSends` |
| PUT | `/api/canvas/canvases/:id/layout` | 完整保存节点位置、可选用户尺寸和视口 |
| POST | `/api/canvas/canvases/:id/root-branches` | 创建或返回草稿主 Branch |
| POST | `/api/canvas/interactions/:id/fork` | 从已完成历史 Interaction 创建 Branch |
| POST | `/api/canvas/interactions/:id/resubmit` | 从上一节点创建普通 Branch，并原样重新提交目标 Interaction 的输入 |
| GET | `/api/canvas/agents` | 读取所有已配置 Runtime 的扁平 Agent 目录和 `firstAvailable` |

Layout 节点兼容仅包含 `x/y` 的旧数据。用户缩放后的 `width/height` 必须同时提供；宽度范围为
`320–800`，高度范围为 `240–900`。重新排列会更新 `x/y`，但保留已有尺寸：

```json
{
  "nodes": {
    "interaction-id": {
      "x": 120,
      "y": 80,
      "width": 640,
      "height": 520
    }
  },
  "viewport": {
    "x": -40,
    "y": -20,
    "zoom": 0.8
  }
}
```

## 发送

| 方法 | 路径 | 用途 |
|---|---|---|
| POST | `/api/canvas/branches/:id/send` | 原子预留并由后端派发 |
| GET | `/api/canvas/send-operations/:id` | 读取发送状态 |
| POST | `/api/canvas/send-operations/:id/dispatch` | 派发尚未终止的预留 |
| POST | `/api/canvas/send-operations/:id/retry` | 使用相同幂等键立即重试 |
| POST | `/api/canvas/send-operations/:id/cancel` | 只取消确认尚未发出的 `reserved`/`awaiting_media` 预留 |

节点原样重新提交请求只接受当前 Canvas Agent，用于检测并发页面中的 Agent 变化：

```json
{
  "expectedAgentRef": { "runtimeId": "openclaw", "profileId": "main" }
}
```

服务端读取源 Interaction 的用户文本和已登记附件，客户端不能替换内容。非首节点从其
`parentInteractionId` 创建普通 Fork Branch，首节点创建新的 Root Branch；原节点和原 OpenClaw 执行均保持
不变。源节点可以是 `running`、`completed`、`failed` 或 `unconfirmed`。响应与 Branch 发送一致：
即时接受返回 `201 { interaction }`，排队或结果不确定返回 `202 { operation }`，明确拒绝返回包含 operation 的
`422`/`503`。

发送请求：

```json
{
  "expectedHeadInteractionId": null,
  "expectedAgentRef": { "runtimeId": "openclaw", "profileId": "main" },
  "userInput": "请分析这些资料",
  "attachmentIds": ["40-character-content-hash"]
}
```

服务端不接受附件路径或可变元数据。即时接受返回 `201 { interaction }`；已排队或结果不确定返回 `202 { operation }`；头节点、Agent 或并发冲突返回 `409`；附件问题返回 `422`；所选 Runtime 缺少文本输入能力返回 `503`。首次成功写入 Send Reservation 时 Canvas 的 `agentMutable` 变为 `false`，即使派发随后失败也不会解锁。

公开的 Send Operation 只包含状态和原始用户输入/附件元数据。内部 `outgoingMessage`、完整历史资源清单、
内容哈希和媒体派生信息不返回浏览器。`awaiting_media` 表示后端正在生成或读取发送所需的大图派生文件，
浏览器无需上传压缩副本；服务重启后协调器会从该状态恢复。

Fork 和 Session 恢复使用同一完整 Replay Package。历史逻辑引用不会按当前指令裁剪；内容相同的历史文件
只物理投递一次，已生成的大图投递派生文件可在同一 Canvas 的后续重放中复用。完整载荷超过 Gateway
`maxPayload` 时，初始发送返回 `422` 且 operation 的错误为 `replay_payload_too_large`，不会只发送部分历史。

Graph 响应额外包含持久化 `cursor`、`hasPendingUpdates` 和通用 `failedSends`。`failedSends` 只包含每个仍为
draft 的 Branch 最新一次失败 Send Operation，用于刷新后恢复普通 Composer 的原文本、持久附件和错误；
它不表示后台仍在工作。Branch 的 `creationMode` 为 `composer | direct-submit`，只区分手动草稿和创建后立即
发送的通用方式，不记录“重试来源”。

Interaction 同时返回 `version`、`executionState`（`running | completed | failed | unconfirmed`）、`artifactSyncState`（`not_started | observing | synced | degraded`）、`terminalAt`、安全错误信息，以及可空的 `contextSnapshot`。后端仅在 Interaction 首次确认完成时尝试记录 OpenClaw 对该物理 Session 的累计上下文快照：

```json
{
  "usedTokens": 12000,
  "contextLimit": 100000,
  "runtimeId": "openclaw",
  "conversationInstanceId": "physical-session-id",
  "capturedAt": 1785147159265,
  "source": "agent-runtime"
}
```

只有 Runtime 明确返回新鲜 Token 数据，且 Conversation Handle 与物理 instance 都匹配时才保存；否则为 `null`。这是节点完成时的累计值，不是该节点单独消耗量，客户端不得沿祖先节点求和。已知 Artifact 全部持久化后 `artifactSyncState` 即为 `synced`；可能仍在运行的晚到 Artifact 静默观察任务不属于用户可见 pending 状态。`hasPendingUpdates` 仅用于 Canvas SSE 不可用时决定是否启用降级轮询。数据库迁移版本和不透明 Runtime Handle 不通过产品 API 暴露。

Interaction 的 `approvals` 是已净化的节点内审批列表，包含风险、权限、选择、作用域、到期与状态，但不包含原生 Approval Handle、命令环境或凭据。处理审批：

| 方法 | 路径 | 用途 |
|---|---|---|
| POST | `/api/canvas/approvals/:id/resolve` | 对当前所有者的 pending 审批提交统一 Resolution |

```json
{
  "choiceId": "allow-once",
  "grantedPermissionIds": ["execute-command"]
}
```

明确接受返回 `200 { approval }`；Runtime 结果未知返回 `202` 且状态为 `unconfirmed`；明确拒绝/冲突返回 `409`；过期返回 `410`。服务端验证 choice 与权限子集，防止客户端扩大 Adapter 声明的权限。

Canvas 本地图片附件和 Artifact 额外返回版本化 `thumbnailUri`，但不返回 `contentHash`。外部 HTTP Artifact
不提供缩略图 URI，也不会被 ConvoSketchpad 后端主动抓取。

## Canvas 文件

| 方法 | 路径 | 用途 |
|---|---|---|
| POST | `/api/canvas/canvases/:canvasId/attachments` | 持久化最多四个原始附件并登记元数据 |
| GET | `/api/canvas/attachments/:canvasId/:attachmentId` | 读取原始附件 |
| GET | `/api/canvas/attachments/:canvasId/:attachmentId/thumbnail` | 生成或读取 Canvas 本地图片附件的版本化缩略图 |
| GET | `/api/canvas/artifacts/:canvasId/:interactionId/:artifactId` | 读取持久化 Artifact |
| GET | `/api/canvas/artifacts/:canvasId/:interactionId/:artifactId/thumbnail` | 生成或读取 Canvas 本地图片 Artifact 的版本化缩略图 |

缩略图路由执行与原文件相同的认证、所有者和 Canvas 边界检查，返回私有、不可变缓存响应。当前
`thumbnail-v1` 输出 WebP，最大边长 768 px、最大 160 KiB；格式不支持或源文件缺失时返回 404。
原文件端点不做压缩，供用户打开预览或下载。

## Canvas 同步

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | `/api/canvas/canvases/:id/events?after=<cursor>` | 当前 Canvas 的持久状态更新与瞬时预览 SSE |

持久事件名为 `canvas.sync`，数据为 `CanvasSyncBatch`：包含递增 `cursor`、完整 Canvas/Branch/Interaction/Send Operation upsert 和删除 ID。服务端按实体合并 cursor 之后的变化；客户端不得从事件名推断节点状态。

瞬时事件名为 `node.preview`，只包含 `interactionId` 和当前文本。Preview 不写数据库、不重放，SSE 断线后应立即丢弃。SSE 使用 `Last-Event-ID` 恢复持久 cursor，并每 15 秒发送心跳。

## Agent Runtime 运行状态

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | `/api/runtime/status` | 所有已配置 Runtime 的状态明细和聚合总态 |
| GET | `/api/runtime/events` | 只发布 `runtime.status_changed` 的全局 SSE；15 秒心跳 |

响应含 `overallState: ready | degraded | connecting | unavailable`、`updatedAt` 和 `runtimes[]`。每项只包含 `runtimeId`、`state`、可选版本/错误/`restartSupported`；原生 Capability、方法表和诊断不发给浏览器。部分故障不会隐藏健康 Runtime。状态流不包含 Canvas、Interaction、发送、Artifact 或审批事件；受管用户被禁用或 Session 被撤销后，心跳检查会关闭两个 SSE。

## 认证与运维

| 方法 | 路径 | 用途 |
|---|---|---|
| POST | `/api/auth/login` | 使用受管用户 Token 换取 HttpOnly Cookie |
| POST | `/api/auth/logout` | 清除 Cookie |
| GET | `/api/auth/status` | 当前认证状态 |
| GET | `/health` | 进程状态和不含错误细节的 Runtime 聚合状态 |
| GET | `/api/runtime/usage` | 每 Runtime 的账户用量与 Provider 额度，以及可选可比较费用合计 |
| POST | `/api/runtime/runtimes/:runtimeId/restart` | 请求重启声明支持该操作的 Runtime |

重启接口使用 `runtime_not_found`、`runtime_restart_unsupported` 和 `runtime_restart_failed` 错误码，不保留 Backend 命名别名。

`GET /api/runtime/usage` 并行读取全部 Runtime；当前 OpenClaw Adapter 调用 `usage.cost`/`usage.status`。响应保留来源边界：

```json
{
  "runtimes": [{
    "runtimeId": "openclaw",
    "displayName": "OpenClaw",
    "available": true,
    "usage": {
      "totalCost": 1.25,
      "totalInput": 12049475,
      "totalOutput": 657434,
      "totalCacheRead": 132034816,
      "currency": "USD",
      "period": "all-time",
      "additive": true,
      "updatedAt": 1785147159265,
      "source": "openclaw-gateway"
    },
    "quotas": { "available": true, "providers": [] }
  }],
  "comparableCostTotal": { "currency": "USD", "amount": 1.25 },
  "updatedAt": 1785147159265
}
```

Token、Provider 和额度窗口不跨 Runtime 合并。只有所有 Runtime 在线、所有声明支持账户费用的 Runtime 都成功返回 `additive=true` 的数据，且币种、统计周期一致时才返回 `comparableCostTotal`；否则 UI 只显示各 Runtime 明细。单个 Runtime 失败返回局部 `available: false`，不使其他数据丢失，也不会把残缺费用伪装成全局合计。

用户只能通过 `npm run users -- ...` 管理，不提供注册 API。
