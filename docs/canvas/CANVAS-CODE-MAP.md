# Canvas 功能与代码地图

## 不变量

- 浏览器只呈现 Canvas、提交用户指令和上传原始附件。
- 后端唯一负责 OpenClaw 通信、发送状态机和 Canvas 数据持久化。
- Branch 同时只有一个未终止发送；`ambiguous` 不得超时解锁。
- OpenClaw 是执行、Session 和原始对话记录权威；SQLite 是 Canvas 拓扑及持久化副本权威。
- 附件按 ID 和所有者解析，Artifact 保持 25 MiB 上限及降级语义。
- Graph 读取无副作用；后台协调和晚到 Artifact 观察由服务端生命周期驱动。
- 已知 Artifact 完整后节点立即显示 `synced`；静默晚到观察任务独立持久化，不触发前端降级轮询。
- Fork 与 Session 恢复共用完整 Replay Package；逻辑资源引用不裁剪，物理文件只按内容去重。
- 原始图片不可变；投递图和缩略图由后端按内容哈希与策略版本生成，Canvas 节点不直接加载原图。
- 前端只应用当前 Canvas 的完整实体 upsert；瞬时 Preview 不持久化，SSE 不可用且 `hasPendingUpdates` 时才降级轮询。

## 前端

| 关注点 | 文件 |
|---|---|
| Canvas 数据控制、Agent、发送和完整节点投影 | `src/features/canvas/CanvasPanel.tsx` |
| Interaction/Composer 节点、节点注册与自动布局适配 | `src/features/canvas/CanvasNodes.tsx`、`src/features/canvas/constants.ts` |
| 状态栏 Branch/工作中计数与活跃 Compose 上下文 | `src/features/canvas/status.ts`、`src/components/StatusBar.tsx` |
| HTTP API 与数据契约 | `src/features/canvas/api.ts`、`src/features/canvas/types.ts` |
| Canvas SSE、实体合并、降级轮询和退避 | `src/hooks/useCanvasSync.ts`、`src/features/canvas/sync.ts`、`src/features/canvas/graph-refresh.ts` |
| 布局 | `src/features/canvas/layout.ts`、`layout.test.ts` |
| 图片缩略图与按需原图预览 | `src/features/canvas/CanvasNodes.tsx`、`src/features/chat/ImageLightbox.tsx` |
| Gateway 运行状态 | `src/contexts/RuntimeContext.tsx`、`src/hooks/useRuntimeEvents.ts` |
| Artifact 显示 | `src/features/chat/ImageLightbox.tsx` |

## 服务端

| 关注点 | 文件 |
|---|---|
| Canvas 与发送 HTTP API | `server/routes/canvas.ts` |
| Interaction 完成时的 OpenClaw Session 上下文快照 | `server/lib/canvas-context-snapshot.ts` |
| Canvas cursor、SSE 和 Preview | `server/routes/canvas.ts`、`server/lib/canvas-sync.ts` |
| Gateway 运行状态 SSE | `server/routes/runtime.ts`、`server/lib/runtime-events.ts` |
| SQLite Schema、迁移和 Branch 状态机 | `server/lib/canvas-db.ts`、`server/lib/canvas-migrations.ts` |
| `0.2.0` 迁移验证入口与原始 Schema fixture | `bin/convosketchpad-migrate.ts`、`server/lib/fixtures/canvas-v0.2.0.sql` |
| Fork/Session 恢复 Replay Package、文件引用与物理去重 | `server/lib/canvas-replay-plan.ts` |
| 后端发送、重试和 Gateway 事件关联 | `server/lib/canvas-send-coordinator.ts`、`server/lib/canvas-send-retry.ts` |
| Gateway 唯一连接与设备边界 | `server/lib/gateway-rpc.ts`、`server/lib/device-identity.ts` |
| Session/对话协调 | `server/lib/canvas-reconciler.ts`、`server/lib/openclaw-session-policy.ts` |
| Artifact 观察与 Interaction 终态策略 | `server/lib/canvas-artifact-watch.ts`、`server/lib/canvas-reconciliation-state.ts` |
| 文件持久化、媒体派生与历史缩略图回填 | `server/lib/canvas-artifact-store.ts`、`server/lib/canvas-media-derivatives.ts`、`server/routes/upload-reference.ts` |

## 发送流程

```text
原始上传 → canvas_attachments 登记
  → POST branch/send {attachmentIds}
  → 服务端校验并写 send_reservations
  → 后端按需生成/复用大图投递派生文件
  → 后端 chat.send（预留 ID = idempotencyKey）
  → ack 后事务创建 Interaction
  → canvas_changes + 完整 Interaction upsert
  → 权威记录和 Artifact 协调
```

相关测试位于 `server/lib/canvas-db.test.ts`、`server/lib/canvas-media-derivatives.test.ts`、`server/lib/canvas-replay-plan.test.ts`、`server/lib/canvas-reconciler.test.ts`、`server/lib/canvas-sync.test.ts`、`server/lib/canvas-context-snapshot.test.ts`、`server/lib/updater/snapshot.test.ts`、`server/lib/gateway-rpc.test.ts`、`server/routes/canvas-artifacts.test.ts`、`server/routes/upload-reference.test.ts`、`src/features/chat/ImageLightbox.test.tsx`、`src/features/canvas/sync.test.ts`、`src/features/canvas/status.test.ts`、`src/features/canvas/graph-refresh.test.ts` 和 `src/hooks/useCanvasSync.test.ts`。数据库测试会从完整的 `0.2.0` Schema fixture 建库，验证迁移账本、状态转换、Artifact 合并、附件回填及重启不重跑。
