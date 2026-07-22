# Canvas 功能与代码地图

本文用于快速定位 Canvas 相关实现。产品级决策以 [Canvas MVP 设计说明](../OPENCLAW-CANVAS-MVP-DESIGN.md) 为准。

## 功能边界与不变量

- Canvas 独立于普通 Chat；不从现有 Chat 创建，也不修改 OpenClaw 原始 Transcript。
- 一个 Canvas 绑定一个 OpenClaw Agent，可以包含多个从头开始的 Root Branch。
- 用户操作只有三种：创建 Root Branch、继续 Branch、从历史 Interaction Fork 新 Branch。
- 继续已有 Branch 默认沿用其 OpenClaw Session；若稳定 `sessionKey` 对应的 `sessionId` 被替换或消失，下一次发送先注入 Canonical Snapshot 恢复上下文。
- Session 在用户真正发送消息时才物化，避免空 OpenClaw Session。
- 一个 Interaction 表示一轮完整的 User Input → Agent Output，并包含附件、Artifact 和 Session 元数据。
- Canvas 关系、状态和布局存入 `database/canvas.sqlite`；OpenClaw Transcript 仍由 OpenClaw 管理，用户附件和本地产物另有 Canvas 持久副本。
- 完成的 Branch Head 自动出现下一编辑节点；历史 Interaction 的添加操作创建 Fork。
- 当前用户只能访问自己的 Canvas 数据；身份入口见 [Auth 代码地图](./AUTH-CODE-MAP.md)。

## 按问题定位代码

| 问题或改动 | 首要文件 | 相关文件 |
|---|---|---|
| Canvas 页面、列表、节点卡片、图片预览、发送状态 | [`src/features/canvas/CanvasPanel.tsx`](../../src/features/canvas/CanvasPanel.tsx) | [`types.ts`](../../src/features/canvas/types.ts) |
| Canvas/设置中英文文案、语言切换与动态区域翻译保护 | [`src/features/canvas/messages.ts`](../../src/features/canvas/messages.ts) | [`src/features/settings/messages.ts`](../../src/features/settings/messages.ts)、[`CanvasSendButton.tsx`](../../src/features/canvas/CanvasSendButton.tsx)、[`SettingsContext.tsx`](../../src/contexts/SettingsContext.tsx) |
| 新节点位置、自动布局、Fork 避让、composer 坐标 | [`src/features/canvas/layout.ts`](../../src/features/canvas/layout.ts) | [`layout.test.ts`](../../src/features/canvas/layout.test.ts) |
| 浏览器调用 Canvas API | [`src/features/canvas/api.ts`](../../src/features/canvas/api.ts) | [`server/routes/canvas.ts`](../../server/routes/canvas.ts) |
| 发送图片和其他文件给 OpenClaw | [`src/features/canvas/attachments.ts`](../../src/features/canvas/attachments.ts) | [`server/lib/upload-reference.ts`](../../server/lib/upload-reference.ts)、[`server/routes/upload-reference.ts`](../../server/routes/upload-reference.ts) |
| Canvas、Branch、Interaction、Reservation、布局表结构 | [`server/lib/canvas-db.ts`](../../server/lib/canvas-db.ts) | [`canvas-db.test.ts`](../../server/lib/canvas-db.test.ts) |
| Streaming 完成后等待 Transcript 落盘、提取完整回复和 Artifact | [`server/lib/canvas-reconciler.ts`](../../server/lib/canvas-reconciler.ts) | [`canvas-reconciler.test.ts`](../../server/lib/canvas-reconciler.test.ts) |
| Canvas owner 解析和无 Auth 的 Local User | [`server/lib/canvas-auth.ts`](../../server/lib/canvas-auth.ts) | [`server/lib/managed-users.ts`](../../server/lib/managed-users.ts) |
| Canvas HTTP 路由和 owner 校验 | [`server/routes/canvas.ts`](../../server/routes/canvas.ts) | [`server/app.ts`](../../server/app.ts) |
| Canvas Session 不出现在普通 Session 列表 | [`src/features/sessions/sessionKeys.ts`](../../src/features/sessions/sessionKeys.ts) | [`src/contexts/SessionContext.tsx`](../../src/contexts/SessionContext.tsx) |
| Canvas 成为默认页面、顶部导航和命令面板 | [`src/App.tsx`](../../src/App.tsx) | [`src/components/TopBar.tsx`](../../src/components/TopBar.tsx)、[`src/features/command-palette/commands.ts`](../../src/features/command-palette/commands.ts) |
| OpenClaw Artifact 持久化、安全代理和文件读取 | [`server/lib/canvas-artifact-store.ts`](../../server/lib/canvas-artifact-store.ts) | [`server/routes/canvas.ts`](../../server/routes/canvas.ts)、[`server/lib/canvas-reconciler.ts`](../../server/lib/canvas-reconciler.ts) |
| Branch Session 被 OpenClaw reset/delete 后的漂移检测与恢复 | [`server/lib/canvas-db.ts`](../../server/lib/canvas-db.ts) | [`server/routes/canvas.ts`](../../server/routes/canvas.ts)、[`server/lib/canvas-reconciler.ts`](../../server/lib/canvas-reconciler.ts) |
| 后端启动/停止落盘协调器 | [`server/index.ts`](../../server/index.ts) | [`server/lib/canvas-reconciler.ts`](../../server/lib/canvas-reconciler.ts) |

## 前端文件职责

### `src/features/canvas/CanvasPanel.tsx`

- 加载 Canvas 列表和当前 Graph。
- 渲染 `InteractionNode`、`ComposerNode`、React Flow Edge、缩略图与全屏图片预览。
- 限制 UI 操作：Branch Head 只能继续，历史 Interaction 才能 Fork。
- 在空 Canvas 自动创建首个 Root Branch，并直接显示编辑节点。
- 发送时依次执行附件持久化、`prepare-send`、Gateway `chat.send`、`ack` 和 Graph 刷新。
- 订阅 Gateway 流事件；terminal event 只作为 reconcile 提示，并保留 active Run 映射直到服务端确认 Interaction 完成。
- 使用 Graph 返回的 `reconciliationVersion` 判断旧记录，前端不再硬编码协调器版本。
- 维护节点坐标、Viewport 和延迟保存布局。
- 从通用 `language` 设置读取 `zh-CN` / `en` 文案；只对发送、状态、加载和错误等动态风险区域禁用浏览器翻译。

### `src/features/canvas/messages.ts` 与 `CanvasSendButton.tsx`

- `messages.ts` 保存类型安全的 Canvas 中英文系统文案和已知错误映射；不翻译用户输入、Agent 回复或已有 Canvas 数据。
- `CanvasSendButton.tsx` 用稳定包装节点隔离动态图标与文本，避免浏览器翻译改写文本节点后触发 React DOM 插入异常。
- 通用 `language` 首选项由 `SettingsContext` 保存到浏览器 `localStorage`；Canvas 与完整设置链路消费该设置，设置内的 STT/TTS 语音语言仍是独立偏好。

### `src/features/canvas/layout.ts`

- `placeNodeToRight`：把 Continue/Fork composer 放到来源节点右侧；目标列被占用时向下排列。
- `placeRootNode`：把独立 Root Session 放入左侧列并纵向错开。
- `composerNodeId`：用 Branch ID 和来源 Interaction ID 标识临时编辑节点，避免下一轮复用旧坐标。
- `mergeVisibleNodePositions`：清理已消失 composer 的坐标，同时保留 Interaction 布局。
- Dagre 首次布局由 `CanvasPanel.tsx` 的 `autoLayout` 负责。

### `src/features/canvas/attachments.ts`

- 小图片转换为 OpenClaw 原生 `image` attachment。
- 其他文件使用 OpenClaw 原生 `file` attachment。
- 控制图片与普通附件大小；批量准备 Gateway attachments。

### `src/features/canvas/api.ts` 与 `types.ts`

- `api.ts` 封装 Canvas CRUD、Graph、Branch、send reservation、reconcile、layout 和 upload 请求。
- `types.ts` 是前端 Canvas/Branch/Interaction/Artifact/Layout 的契约镜像。

## 后端文件职责

### `server/routes/canvas.ts`

- Canvas CRUD、Graph 和布局保存。
- Root Branch、历史 Interaction Fork。
- `prepare-send → ack/fail` 两阶段发送协议。
- 手动/终态 reconcile。
- `prepare-send` 前核对 OpenClaw `sessionId`，对 replacement/missing Session 选择 `session-recovery`。
- Context Resource、持久附件和 OpenClaw Artifact 的 owner-scoped 安全读取。

### `server/lib/canvas-db.ts`

- SQLite schema、迁移和事务入口 `CanvasStore`。
- 同时保存受管用户、Canvas、Branch、Interaction、send reservation 和 layout。
- `createRootBranch`、`forkInteraction`、`prepareSend`、`acknowledgeSend` 实现 Branch/Session Mapping 的核心状态机。
- Branch 同时记录预期/最近观察到的 OpenClaw `sessionId` 和一致性状态。
- Fork 根据祖先 Interaction 构建 Snapshot 和可复用资源清单；健康 Continue 不重放历史，Session 漂移时重放截至 Head 的 Canonical Snapshot。
- 数据库固定为项目根目录的 `database/canvas.sqlite`。

### `server/lib/canvas-reconciler.ts`

- 从 OpenClaw Session/Transcript 读取最终消息，不修改 Transcript。
- terminal event 本身不启动完成倒计时；协调器先确认 Session 终态属于当前 Run，或确认 Transcript 已出现当前 Interaction 的有效回复，再进入 settling。
- 空 Transcript 即使指纹稳定也不视为完成；15 秒前台窗口后继续长尾读取，避免把尚未启动的 OpenClaw Run 写成“暂无响应内容”。
- 从内容块、工具结果和文本链接提取 Artifact，并更新 Interaction。
- Artifact 在 30 秒、1 分钟、2 分钟、5 分钟、15 分钟和 1 小时做长尾复查；最终失败标记 `degraded`，页面加载、服务启动或手动 reconcile 都可再次恢复。
- 服务启动时恢复遗留的 streaming、旧版本、pending、degraded 以及错误标记为 synced 的空 Interaction；服务关闭时清理计时器。

### 附件与 Artifact 接入

- [`server/lib/upload-reference.ts`](../../server/lib/upload-reference.ts) 把 Canvas 上传暂存到 Agent Workspace 的 `.nerve/canvas-uploads/<canvasId>/`，供本轮 OpenClaw 工具访问。
- [`server/routes/upload-reference.ts`](../../server/routes/upload-reference.ts) 接收 `purpose=canvas` 和 Canvas ID。
- `prepare-send` 在记录 Interaction 前把用户附件复制到 `artifacts/<owner-hash>/<canvasId>/attachments/`；SQLite 和后续 Fork 只引用 owner-scoped 稳定 URI，不再依赖 `.openclaw` Workspace 原件。
- [`server/routes/files.ts`](../../server/routes/files.ts) 与 Canvas 附件/Artifact 路由负责 owner 校验后的文件读取。
- OpenClaw 受管媒体、Workspace/临时文件和 data URI 在 reconcile 时持久化到项目 `artifacts/`；外部 HTTP(S) 链接只保存引用。
- 单个持久化 Artifact 上限为 25 MiB；失败时保留源引用和不可用原因，不影响文本 Interaction 完成。
- 删除 Canvas 时同步删除其 owner-scoped Artifact 目录，启动时补充清理失去数据库记录的孤儿目录。

## 关键数据流

### 新会话与继续

```text
Composer send
  → stage attachments for OpenClaw + persist Canvas-owned copies
  → POST prepare-send
  → verify Branch sessionId; recover Snapshot on drift/missing
  → Gateway chat.send(sessionKey, message, attachments)
  → POST ack(runId)
  → Interaction streaming
  → Gateway terminal event
  → reconcile Transcript
  → Interaction completed
  → 新 composer 放到该 Interaction 右侧
```

### Fork

```text
历史 Interaction 的添加按钮
  → POST interactions/:id/fork
  → 创建 draft Branch（尚无 OpenClaw Session）
  → 右侧避让位置显示 composer
  → 用户发送时 prepare-send
  → 新 Session + Snapshot/Resource bootstrap
```

### 布局保存

```text
React Flow drag / 自动新节点 / viewport change
  → positionsRef + viewportRef
  → PUT canvases/:id/layout
  → canvas_layouts.layout_json
```

## 测试入口

```bash
npm test -- --run \
  src/features/canvas/layout.test.ts \
  src/features/canvas/attachments.test.ts \
  server/lib/canvas-db.test.ts \
  server/lib/canvas-reconciler.test.ts
```

涉及 Canvas 路由、Auth 或 Gateway 事件时，还应运行对应路由/WS 测试以及 `npm run lint`、`npm run build`。
