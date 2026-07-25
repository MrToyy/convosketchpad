# Canvas 功能与代码地图

## 不变量

- Canvas 是唯一的主要产品界面。
- 一个 Canvas 拥有一个 Agent，以及任意数量的主 Branch 或分支 Branch。
- 创建 Canvas 时使用 Gateway 默认 Agent；首次发送进入准备阶段前可以修改选择。
- Branch Session 在首次输入时才会延迟创建。
- “继续”复用健康 Session；Fork、检测到的漂移和预测到的重置恢复使用规范快照。
- SQLite 负责拓扑、状态和布局；OpenClaw 负责执行和对话记录。
- 附件和 Artifact 都会生成按所有者隔离的持久化副本。

## 前端

| 关注点 | 文件 |
|---|---|
| Canvas 图、节点、Agent 选择器和事件处理 | `src/features/canvas/CanvasPanel.tsx` |
| REST 客户端和数据契约 | `src/features/canvas/api.ts`、`src/features/canvas/types.ts` |
| 布局与测试 | `src/features/canvas/layout.ts`、`layout.test.ts` |
| 附件准备 | `src/features/canvas/attachments.ts`、`attachments.test.ts` |
| Canvas 本地化文案 | `src/features/canvas/messages.ts` |
| Gateway `chat.send` 传输 | `src/features/chat/operations/sendMessage.ts` |
| Gateway 流式事件分类 | `src/features/chat/operations/streamEventHandler.ts` |
| 通用图片压缩与灯箱 | `src/features/chat/image-compress.ts`、`ImageLightbox.tsx` |
| 仅 Canvas 使用的应用框架 | `src/App.tsx`、`src/components/TopBar.tsx`、`src/components/StatusBar.tsx` |

保留的 `features/chat` 路径只包含 Canvas 使用的协议和媒体基础能力，不包含 Chat 面板、输入栏、历史状态、恢复上下文或 Session 界面。

## 服务端

| 关注点 | 文件 |
|---|---|
| Canvas HTTP API 与 Agent 目录校验 | `server/routes/canvas.ts` |
| SQLite Schema 与 Branch 状态机 | `server/lib/canvas-db.ts` |
| 协调与 Session 漂移 | `server/lib/canvas-reconciler.ts` |
| OpenClaw 实际重置策略和时区边界预测 | `server/lib/openclaw-session-policy.ts` |
| 持久化文件 | `server/lib/canvas-artifact-store.ts` |
| Canvas 自有上传持久化与受限 Artifact 读取 | `server/routes/upload-reference.ts`、`server/lib/canvas-artifact-store.ts` |
| Gateway 服务端 RPC、浏览器中继和设备 Token 边界 | `server/lib/gateway-rpc.ts`、`server/lib/ws-proxy.ts`、`server/lib/device-identity.ts` |
| 路由挂载 | `server/app.ts` |

## Agent 流程

```text
POST Canvas {name}
  → agents.list → 保存 defaultId
  → 没有发送预留或 Interaction 时可选 PATCH {agentId}
  → 重写草稿 Branch Session key
  → prepare-send {expectedAgentId, ...}
  → 锁定 Agent
```

`server/lib/canvas-db.test.ts` 覆盖事务性重写和锁定行为，Canvas Route 测试覆盖持久化文件，完整行为通过 `npm test -- --run` 验证。

## 发送流程

```text
暂存文件
  → prepare-send
  → 检查 Session 身份和实际重置策略
  → 如果发送跨越每日或空闲过期边界，使用规范恢复快照
  → 持久化 Canvas 附件 ID
  → 原生 chat.send attachments
  → ack(runId) 并刷新实际 Session ID
  → Gateway agent/chat 事件
  → 协调对话记录和 Artifact
  → 完成 Interaction 并创建下一个输入框
```

Branch 在内部持久化基准和观测到的 Session 开始时间。如果无法检查策略，活动 Branch 会采用保守恢复路径；之前的 Interaction 和 OpenClaw 对话记录绝不会被重写。

## 文档维护

Canvas 组件移动时更新本文档。Agent、Branch、Interaction、附件、Artifact 或恢复语义发生变化时，同时更新 `docs/ARCHITECTURE.md`。
