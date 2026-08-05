# Canvas 功能与代码地图

## 不变量

- 浏览器只呈现 Canvas、提交用户指令和上传原始附件。
- 后端唯一负责 Agent Runtime 通信、发送状态机和 Canvas 数据持久化；当前 Registry 只注册 OpenClaw。
- Branch 同时只有一个未终止发送；`ambiguous` 不得超时解锁。
- 所选 Agent Runtime 是执行、Conversation 和原始对话记录权威；SQLite 是 Canvas 拓扑及持久化副本权威。
- 附件按 ID 和所有者解析，Artifact 保持 25 MiB 上限及降级语义。
- Graph 读取无副作用；后台协调和晚到 Artifact 观察由服务端生命周期驱动。
- 已知 Artifact 完整后节点立即显示 `synced`；静默晚到观察任务独立持久化，不触发前端降级轮询。
- Fork 与 Session 恢复共用完整 Replay Package；逻辑资源引用不裁剪，物理文件只按内容去重。
- 节点“重试”只是一项原样重新提交操作：从上一节点创建普通 Branch，保留原 Interaction 和原执行，不建立 Retry 实体。
- “继续分支”只有在所选 Agent Runtime 明确接受后才推进头节点并主动同步 Canvas；原头节点随即开放普通 Fork，新运行节点本身仍不可分叉。
- 原始图片不可变；投递图和缩略图由后端按内容哈希与策略版本生成，Canvas 节点不直接加载原图。
- 前端只应用当前 Canvas 的完整实体 upsert；瞬时 Preview 不持久化，SSE 不可用且 `hasPendingUpdates` 时才降级轮询。
- Interaction 和 Composer 通过右下角单一控制柄缩放；用户尺寸与位置、视口一起保存，Composer 转成 Interaction 时迁移尺寸。
- 显式重新排列只在没有可见发送或运行任务时执行；按用户尺寸或实际测量尺寸进行左到右拓扑布局，只改变位置，并把完整布局和适应后的视口一起保存。
- setup 配置 Runtime 和产品级默认 Agent，目录按 Runtime 配置/默认 Profile/原生顺序扁平聚合；新建 Canvas 优先选择可用的配置默认项，否则回退到第一个可用 Agent，首次 Send Reservation 前可改，之后由 `agent_locked_at` 永久锁定。
- 审批只在所属 Interaction 节点内呈现；选择、权限子集、作用域与二次确认来自统一事件，前端不接触原生 Approval Handle。
- Runtime 状态和账户用量在导航/设置中按 Runtime 聚合；当前 Canvas 的 Branch、工作中和上下文数据保持局部语义。

## 前端

| 关注点 | 文件 |
|---|---|
| Canvas 页面组合与 Agent/Canvas 操作 | `src/features/canvas/CanvasPanel.tsx` |
| Canvas 列表、重命名与删除交互 | `src/features/canvas/CanvasSidebar.tsx` |
| Graph 快照、SSE、Preview 与降级刷新控制 | `src/features/canvas/useCanvasGraphController.ts`、`src/hooks/useCanvasSync.ts` |
| Composer 草稿、浏览器文件、持久附件和 Send Operation 失败恢复 | `src/features/canvas/useCanvasComposerDrafts.ts` |
| Graph 到 Interaction/Composer 节点与边的纯投影 | `src/features/canvas/canvas-flow-projection.ts` |
| Interaction/Composer 节点与节点注册 | `src/features/canvas/CanvasNodes.tsx`、`src/features/canvas/node-types.ts`、`src/features/canvas/constants.ts` |
| React Flow 节点类型、边界计算与自动布局 | `src/features/canvas/flow-model.ts` |
| 状态栏 Branch/工作中计数与活跃 Compose 上下文 | `src/features/canvas/status.ts`、`src/components/StatusBar.tsx` |
| HTTP API 与数据契约 | `src/features/canvas/api.ts`、`src/features/canvas/types.ts` |
| Canvas 实体合并、降级轮询和退避 | `src/features/canvas/sync.ts`、`src/features/canvas/graph-refresh.ts` |
| 布局、拖拽保存与显式重新排列 | `src/features/canvas/CanvasPanel.tsx`、`src/features/canvas/flow-model.ts`、`src/features/canvas/layout.ts` |
| 图片缩略图与按需原图预览 | `src/features/canvas/CanvasNodes.tsx`、`src/features/chat/ImageLightbox.tsx` |
| Runtime 聚合状态、生命周期操作、设置与账户用量 | `src/contexts/RuntimeContext.tsx`、`src/hooks/useRuntimeEvents.ts`、`src/hooks/useRuntimeRestart.ts`、`src/features/settings/SystemSettings.tsx`、`src/features/dashboard/RuntimeUsage.tsx` |
| Artifact 显示 | `src/features/chat/ImageLightbox.tsx` |

## 服务端

| 关注点 | 文件 |
|---|---|
| Canvas 与发送 HTTP API | `server/routes/canvas.ts` |
| Canvas、Root/Fork、发送、审批应用用例与 Port | `server/lib/canvas/application/` |
| Canvas 持久模型 | `server/lib/canvas/model.ts` |
| 发送判定、历史快照、Replay 与协调状态机 | `server/lib/canvas/domain/` |
| 公开 DTO 与内部资源定位 | `server/lib/canvas-public-dto.ts`、`server/lib/canvas-resource-locator.ts` |
| Interaction 完成时的 Runtime Conversation 上下文快照 | `server/lib/canvas-context-snapshot.ts` |
| Canvas cursor、SSE 和 Preview | `server/routes/canvas.ts`、`server/lib/canvas-sync.ts` |
| Runtime 聚合状态/用量、生命周期 API 与 SSE | `server/routes/runtime.ts`、`server/routes/runtime-usage.ts`、`server/routes/runtime-actions.ts`、`server/lib/runtime-status-events.ts` |
| SQLite Store、Schema、彻底 Runtime 字段迁移与三项迁移清单 | `server/lib/canvas/persistence/`、`bin/convosketchpad-migrate.ts` |
| `0.4.0` Runtime Schema 与原始 Schema fixture | `server/lib/canvas/persistence/agent-runtime-schema.ts`、`server/lib/fixtures/canvas-v0.2.0.sql` |
| Fork/Session 恢复 Replay Package、文件引用与物理去重 | `server/lib/canvas/domain/replay-plan.ts`、`server/lib/canvas-resource-locator.ts` |
| Agent Runtime 契约、配置、Definition、Registry、聚合目录与开发规范 | `server/lib/agent-runtimes/contract.ts`、`configuration.ts`、`definitions.ts`、`registry.ts`、`catalog.ts`、`docs/agent-runtimes/ADAPTER-DEVELOPMENT.md` |
| 服务进程组合与依赖注入 | `server/application-context.ts`、`server/app.ts` |
| 发送调度、单次 Worker、投递构建与统一 Runtime 事件/审批关联 | `server/lib/canvas-send-coordinator.ts`、`server/lib/canvas-send-worker.ts`、`server/lib/canvas-send-delivery.ts`、`server/lib/canvas/runtime-event-consumer.ts` |
| OpenClaw Adapter、Gateway 唯一连接、Transcript/Artifact、Session Policy 与设备边界 | `server/lib/agent-runtimes/adapters/openclaw/` |
| Conversation/Turn 协调 | `server/lib/canvas-reconciler.ts`、`server/lib/canvas-context-snapshot.ts` |
| Artifact 观察与 Interaction 终态策略 | `server/lib/canvas/domain/artifact-watch.ts`、`server/lib/canvas/domain/reconciliation-state.ts` |
| 文件持久化、媒体派生与监听后的历史缩略图回填 | `server/index.ts`、`server/lib/canvas-artifact-store.ts`、`server/lib/canvas-media-derivatives.ts`、`server/routes/upload-reference.ts` |

## 发送流程

```text
原始上传 → canvas_attachments 登记
  → POST branch/send {attachmentIds}
  → 服务端校验并写 send_reservations
  → 后端按需生成/复用大图投递派生文件
  → AgentRuntime.dispatchTurn（OpenClaw: chat.send，预留 ID = idempotencyKey）
  → accepted 后事务创建 Interaction
  → canvas_changes + 完整 Interaction upsert
  → 权威记录和 Artifact 协调
```

Interaction 原样重新提交在后端事务中复制源用户输入和附件：首节点创建 `direct-submit` Root，其他节点从父
Interaction 创建 `direct-submit` Fork，随后进入同一发送流程。`creationMode` 只用于区分手动 Composer 与直接
提交，不保存 Retry 来源；接受前失败的 operation 通过 Graph `failedSends` 恢复为普通 Composer。

发送分层测试位于 `server/lib/canvas/domain/send-policy.test.ts`、`server/lib/canvas/application/send-service.test.ts`、`server/lib/canvas-public-dto.test.ts` 与 `server/lib/agent-runtimes/adapters/openclaw/*.test.ts`；Registry/聚合入口由 `server/lib/agent-runtimes/registry.test.ts` 覆盖。前端审批、控制与投影由 `src/features/canvas/CanvasNodes.resize.test.tsx`、`src/features/canvas/CanvasNodes.layout.test.ts`、`src/features/canvas/useCanvasComposerDrafts.test.tsx`、`src/features/canvas/canvas-flow-projection.test.ts` 和 Canvas/SSE 测试覆盖。数据库测试位于 `server/lib/canvas/persistence/canvas-store.test.ts`，从完整 `0.2.0` fixture 建库，验证旧字段物理移除、Handle 回填、审批、事件去重、状态转换、Artifact、附件及重启幂等。
