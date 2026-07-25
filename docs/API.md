# HTTP API

所有 `/api/*` 路由都受通用请求体大小限制、安全 Header、声明的限流规则和受管用户 Middleware 约束。启用 `CONVOSKETCHPAD_AUTH=true` 后，客户端使用登录接口返回的 HttpOnly Session Cookie 认证。

## Canvas

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | `/api/canvas/canvases` | 列出当前所有者的 Canvas |
| POST | `/api/canvas/canvases` | 根据 `{ name }` 创建 Canvas；服务端选择 Gateway 默认 Agent |
| PATCH | `/api/canvas/canvases/:id` | 更新 `name`，或在首次发送前更新 `agentId` |
| DELETE | `/api/canvas/canvases/:id` | 删除 Canvas 记录和持久化文件 |
| GET | `/api/canvas/canvases/:id/graph` | 读取 Canvas、Branch、Interaction 和布局 |
| PUT | `/api/canvas/canvases/:id/layout` | 保存节点位置和视口 |
| POST | `/api/canvas/canvases/:id/root-branches` | 创建或返回尚未解析的主分支输入框 |
| POST | `/api/canvas/interactions/:id/fork` | 从已完成的历史 Interaction 创建分支 |
| POST | `/api/canvas/branches/:id/prepare-send` | 使用已校验的 Canvas 附件 ID 预留发送 |
| POST | `/api/canvas/send-reservations/:id/ack` | Gateway 接受后物化 Interaction |
| POST | `/api/canvas/send-reservations/:id/fail` | 将尚未确认的发送预留标记为失败 |
| POST | `/api/canvas/interactions/:id/complete` | 兼容性完成提示 |
| POST | `/api/canvas/interactions/:id/reconcile` | 调度对话记录和 Artifact 协调 |

`prepare-send` 要求提供 `expectedAgentId`、`userInput`，可以提供 `expectedHeadInteractionId`，并最多携带四个附件。Agent 不匹配时返回 `409 agent_changed`；尝试修改已经使用过的 Canvas Agent 时返回 `409 agent_locked`。

## Canvas 文件

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | `/api/canvas/attachments/:canvasId/:attachmentId` | 读取按所有者隔离的持久化附件 |
| GET | `/api/canvas/artifacts/:canvasId/:interactionId/:artifactId` | 读取按所有者隔离的持久化 Artifact |
| GET | `/api/canvas/send-reservations/:id/resources/:resourceId` | 读取规范 Fork 启动资源 |
| POST | `/api/canvas/canvases/:canvasId/attachments` | 持久化按所有者隔离的 multipart 上传，不暴露宿主机路径 |

## 认证

| 方法 | 路径 | 用途 |
|---|---|---|
| POST | `/api/auth/login` | 使用受管用户 Token 换取签名 Cookie |
| POST | `/api/auth/logout` | 清除 Cookie |
| GET | `/api/auth/status` | 返回当前认证状态 |

用户只能在本机通过 `npm run users -- ...` 管理，不提供注册 API。

## 运行时与遥测

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | `/health` | 进程健康状态 |
| GET/POST | `/api/agentlog` | 读取或追加有长度上限的 Canvas 活动日志 |
| GET | `/api/tokens` | 读取 `usage.cost` 提供的 Gateway 原生汇总，以及 `sessions.usage` 可选提供的 Provider/消息明细 |
| GET | `/api/provider-limits` | 读取 Gateway 原生 `usage.status` 提供的 Provider 配额窗口 |
| GET | `/api/server-info` | 服务端时间、时区和 Gateway 运行时间 |
| GET | `/api/version` | 已安装版本 |
| GET | `/api/version/check` | 本机模式下检查官方稳定 Release；启用受管认证时返回 `disabled` |
| GET | `/api/connect-defaults` | 浏览器 Gateway 连接默认值 |
| POST | `/api/gateway/restart` | 通过 CLI 重启回环地址的 OpenClaw Gateway；远程 Gateway 返回 409 |
