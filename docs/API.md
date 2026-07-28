# HTTP API

浏览器只使用以下产品级 HTTP/SSE API，不存在浏览器 Gateway RPC 或通用 WebSocket 转发路由。所有受保护路由都执行请求体限制、Origin、限流和所有者检查。

## Canvas

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | `/api/canvas/canvases` | 列出当前所有者的 Canvas |
| POST | `/api/canvas/canvases` | 创建 Canvas；服务端选择 Gateway 默认 Agent |
| PATCH | `/api/canvas/canvases/:id` | 更新名称，或在首次发送前更新 Agent |
| DELETE | `/api/canvas/canvases/:id` | 删除 Canvas 和持久化文件 |
| GET | `/api/canvas/canvases/:id/graph` | 无副作用读取 Canvas、Branch、Interaction、布局和 `pendingSends` |
| PUT | `/api/canvas/canvases/:id/layout` | 保存节点位置和视口 |
| POST | `/api/canvas/canvases/:id/root-branches` | 创建或返回草稿主 Branch |
| POST | `/api/canvas/interactions/:id/fork` | 从已完成历史 Interaction 创建 Branch |
| GET | `/api/canvas/agents` | 读取服务端代理的 Agent 目录 |

## 发送

| 方法 | 路径 | 用途 |
|---|---|---|
| POST | `/api/canvas/branches/:id/send` | 原子预留并由后端派发 |
| GET | `/api/canvas/send-operations/:id` | 读取发送状态 |
| POST | `/api/canvas/send-operations/:id/dispatch` | 派发尚未终止的预留 |
| POST | `/api/canvas/send-operations/:id/retry` | 使用相同幂等键立即重试 |
| POST | `/api/canvas/send-operations/:id/cancel` | 只取消确认尚未发出的 `reserved`/`awaiting_media` 预留 |

发送请求：

```json
{
  "expectedHeadInteractionId": null,
  "expectedAgentId": "main",
  "userInput": "请分析这些资料",
  "attachmentIds": ["40-character-content-hash"]
}
```

服务端不接受附件路径或可变元数据。即时接受返回 `201 { interaction }`；已排队或结果不确定返回 `202 { operation }`；头节点、Agent 或并发冲突返回 `409`；附件问题返回 `422`；缺少 `chat.send` 能力返回 `503`。

Graph 响应额外包含持久化 `cursor` 和 `hasPendingUpdates`。Interaction 同时返回 `version`、`executionState`（`running | completed | failed | unconfirmed`）、`artifactSyncState`（`not_started | observing | synced | degraded`）、`terminalAt`、安全错误信息，以及可空的 `contextSnapshot`。后端仅在 Interaction 首次确认完成时尝试记录 OpenClaw 对该物理 Session 的累计上下文快照：

```json
{
  "usedTokens": 12000,
  "contextLimit": 100000,
  "sessionKey": "agent:main:canvas:branch-id",
  "sessionId": "physical-session-id",
  "capturedAt": 1785147159265,
  "source": "openclaw-session"
}
```

只有 Gateway 明确返回新鲜 Token 数据，且 Session key 与物理 Session ID 都匹配时才保存；否则为 `null`。这是节点完成时的累计值，不是该节点单独消耗量，客户端不得沿祖先节点求和。已知 Artifact 全部持久化后 `artifactSyncState` 即为 `synced`；可能仍在运行的晚到 Artifact 静默观察任务不属于用户可见 pending 状态。`hasPendingUpdates` 仅用于 Canvas SSE 不可用时决定是否启用降级轮询。数据库迁移版本属于后端内部实现，不通过产品 API 暴露。

## Canvas 文件

| 方法 | 路径 | 用途 |
|---|---|---|
| POST | `/api/canvas/canvases/:canvasId/attachments` | 持久化最多四个原始附件并登记元数据 |
| POST | `/api/canvas/attachments/:attachmentId/delivery-variant` | 为已登记附件上传浏览器压缩的投递副本；multipart 同时提供 `canvasId` |
| GET | `/api/canvas/send-operations/:id/resources/:resourceId` | 读取当前所有者发送操作所需的 Fork/恢复资源 |
| POST | `/api/canvas/send-operations/:id/resources/:resourceId/delivery-variant` | 上传该资源的浏览器压缩投递副本 |
| GET | `/api/canvas/attachments/:canvasId/:attachmentId` | 读取原始附件 |
| GET | `/api/canvas/artifacts/:canvasId/:interactionId/:artifactId` | 读取持久化 Artifact |

## Canvas 同步

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | `/api/canvas/canvases/:id/events?after=<cursor>` | 当前 Canvas 的持久状态更新与瞬时预览 SSE |

持久事件名为 `canvas.sync`，数据为 `CanvasSyncBatch`：包含递增 `cursor`、完整 Canvas/Branch/Interaction/Send Operation upsert 和删除 ID。服务端按实体合并 cursor 之后的变化；客户端不得从事件名推断节点状态。

瞬时事件名为 `node.preview`，只包含 `interactionId` 和当前文本。Preview 不写数据库、不重放，SSE 断线后应立即丢弃。SSE 使用 `Last-Event-ID` 恢复持久 cursor，并每 15 秒发送心跳。

## Gateway 运行状态

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | `/api/runtime/status` | 后端 Gateway 连接状态、版本、方法和 `maxPayload` |
| GET | `/api/runtime/events` | 只发布 `runtime.connection_changed` 的全局 SSE；15 秒心跳 |

Gateway 运行状态流不包含 Canvas、Interaction、发送或 Artifact 事件。受管用户被禁用或 Session 被撤销后，心跳检查会关闭两个 SSE。`/api/agentlog` 已移除。

## 认证与运维

| 方法 | 路径 | 用途 |
|---|---|---|
| POST | `/api/auth/login` | 使用受管用户 Token 换取 HttpOnly Cookie |
| POST | `/api/auth/logout` | 清除 Cookie |
| GET | `/api/auth/status` | 当前认证状态 |
| GET | `/health`、`/api/health` | 进程和 Gateway 可达性 |
| GET | `/api/tokens` | Gateway 原生用量汇总 |
| GET | `/api/provider-limits` | Gateway 原生 Provider 配额窗口 |
| POST | `/api/gateway/restart` | 重启本机 Gateway；远程 Gateway 返回 409 |

`GET /api/tokens` 按需调用 OpenClaw `usage.cost`，返回整个 Gateway 在当前保留记录中的累计用量：

```json
{
  "totalCost": 0,
  "totalInput": 12049475,
  "totalOutput": 657434,
  "totalCacheRead": 132034816,
  "updatedAt": 1785147159265,
  "source": "openclaw-gateway"
}
```

`totalCost` 直接使用 OpenClaw 汇总值，只统计计费 Token；Provider 配额由独立的 `/api/provider-limits` 提供。该接口不扫描 `sessions.usage`，也不返回 Provider 历史明细、消息数或错误数。

用户只能通过 `npm run users -- ...` 管理，不提供注册 API。
