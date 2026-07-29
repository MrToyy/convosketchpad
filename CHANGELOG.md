# 更新日志

ConvoSketchpad 的重要变更均记录在此文件中。格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)。

## [Unreleased]

### 变更

- 将运行链路统一为“浏览器 HTTP/SSE ↔ ConvoSketchpad 后端 ↔ OpenClaw Gateway”，移除浏览器 Gateway RPC、通用 WebSocket 中继和浏览器 Gateway 凭据设置。
- 新增后端发送协调器、可恢复幂等重试和 `ambiguous` 安全状态；未知发送结果会保持 Branch 锁定。
- 增量新增 Canvas 附件登记与发送派发字段，并提供从 `0.2.0` Schema 到单链条数据模型的事务化一次性迁移；旧 Interaction JSON 保持回滚兼容。
- Gateway 鉴权改为双模式：loopback backend 使用共享 Token且无需设备配对，远程 Gateway 的 WebSocket 才使用 read/write 设备 Token；所有 Gateway HTTP 请求固定使用共享 Token。
- 安装向导只为远程 `gateway-client/backend/node` 发起配对，不再修改 `gateway.controlUi.allowedOrigins`。
- 移除 `CONVOSKETCHPAD_PUBLIC_ORIGIN`、`WS_ALLOWED_HOSTS` 和 `CSP_CONNECT_EXTRA`；`ALLOWED_ORIGINS` 只用于 ConvoSketchpad HTTP API/SSE。
- Graph 改为无副作用快照，并新增持久 cursor、按 Canvas 的完整实体 SSE、非持久 Preview 和 `Retry-After` 降级退避，避免长响应触发 429。
- Interaction 执行状态与 Artifact 同步状态分离；后端持久化 Gateway 终态信号和 Artifact 同步任务，服务重启后继续协调。
- Gateway 首次连接和运行中断线统一使用 1–30 秒指数退避自恢复；发送重试改为新任务/重连主动唤醒和按 `next_attempt_at` 单次定时，不再每秒扫描 SQLite。
- 失败 Interaction 同样保留独立的晚到 Artifact 观察，Runtime/Gateway 事件订阅会隔离并移除失效消费者，避免单个已关闭 SSE 中断后端状态发布。
- 修复 Artifact HTTP 下载错误使用设备 Token 导致的 401；已完成 run 无法反查 Session 时安全回退到当前 Interaction transcript。
- 修复已持久化 Artifact 仍长期显示“同步中”，将晚到 Artifact 静默观察与用户可见同步状态分离；`0.2.0_to_0.3.0_v1` 数据库迁移会一次性修复旧版误标的 `degraded` 节点、合并等价文件来源并防止旧 JSON 在重启后恢复重复记录，同时保留超出 OpenClaw Transcript 范围的既有持久化结果。
- 更新器新增一致 SQLite 快照、停服迁移、完整性校验和数据库回滚；运行时只恢复具有明确未完成状态或持久同步任务的节点，不再通过内部协调版本扫描历史。
- 移除面向用户的原始事件和 Agent log 面板，以及 `/api/agentlog`、`agent-log.json` 写入链；后端诊断改为结构化服务日志。
- 清理旧 setup 自动管理员审批、Gateway workspace 文件 RPC、Agent Log Markdown 辅助、未使用 UI 组件与服务端文件工具，并将 Canvas 节点渲染和 Artifact 观察策略从大型协调模块中拆出。
- Setup 统一 Local、LAN、Tailscale IP、Tailscale Serve 和 Custom 的精确浏览器 Origin、绑定地址、可信代理与远程认证策略。
- 生产与开发统一使用 `HOST` / `PORT` 作为浏览器入口；开发后端端口改为自动分配的 loopback 实现细节，并废弃用户级 `VITE_HOST` / `VITE_PORT`。
- 移除应用和 Vite 的内置 TLS；HTTPS 统一由反向代理或 Tailscale Serve 终止。
- 用量面板移除高成本的 Provider 历史明细扫描，改为按需读取 Gateway 全局金额与 Input/Output/Cache Read；Provider 配额保持独立展示。
- 精简底部状态栏：分支和工作中数量直接来自 Graph；Interaction 完成时保存其 Session 累计上下文快照，获得焦点的 Compose Node 只展示来源节点的快照，不聚合祖先节点；移除实时 Branch 上下文查询、Canvas 级 Session 聚合、服务端时间、Gateway 运行时间及其周期轮询，并把版本与更新入口迁移到“设置 → 系统”。
- 重组设置面板为默认“外观”和“系统”两个页签；系统页分别呈现 OpenClaw 网关管理与 ConvoSketchpad 版本更新，并按运行能力区分本机重启和远程主机管理。
- Canvas 工具栏新增“重新排列”：在没有可见发送或运行任务时，按真实节点尺寸执行从左到右的拓扑布局、自动适应全图，并把节点位置与视口完整保存到后端。
- Canvas 的 Interaction 和 Composer 支持通过始终显示的右下角控制柄调整大小；用户尺寸随 Layout 持久化并在 Composer 提交后转移到新 Interaction，重新排列只更新位置而不重置尺寸。
- Fork 与失效 Session 恢复统一为完整 Replay Package：保留全部历史文本及可用附件/Artifact 的逻辑位置，按真实内容哈希去重物理文件，通过原生 `chat.send.attachments` 投递。恢复 Interaction 完成后会收敛 Branch 的新物理 Session ID，超出 Gateway 载荷上限时明确失败而不静默裁剪历史。
- 图片压缩与历史媒体处理统一迁移到后端：原图保持不可变，投递图和 WebP 缩略图按 Canvas、内容哈希和策略版本缓存；Canvas 节点只加载缩略图，打开预览或下载时才读取原图，外部 HTTP Artifact 不主动抓取。
- 更新器停服迁移新增历史图片缩略图全量回填和 60 分钟超时；单文件失败可诊断地跳过，系统性存储或数据库错误触发回滚。移除浏览器压缩、媒体准备资源 API 和投递副本上传链。
- 重构 Canvas 继续/Fork 发送链路：分离前端 Graph、Composer 与 Flow 投影，后端拆分应用用例、发送判定、OpenClaw 适配、Worker、投递构建和事件消费；公开 API、SQLite Schema 与 Gateway 协议保持不变。修复排队发送完成或失败后 Composer 仍长期保持发送状态的问题。
- Canvas Interaction 新增“重试”：保留原节点和原执行，从上一节点创建普通 Branch 并原样提交相同文本与附件；首节点会创建新 Root，运行中、待确认、成功和失败节点均可使用。该操作复用现有发送状态机，不建立独立 Retry 模型；接受前失败会通过普通 Composer 恢复输入和持久附件。
- “继续分支”被 OpenClaw 接受后立即同步新的 Branch 头节点，使提交前节点无需等待新任务完成即可创建并行分支。
- 代码块改为安全的纯文本展示并保留复制操作，移除语法着色、语言识别、代码下载及相关 Highlight.js/DOMPurify 运行时依赖。

### 安全

- Gateway Token 和设备 Token 现在只存在于服务端；浏览器 CSP `connect-src` 限制为同源。
- 发送接口只接受已登记且属于当前 Canvas 的附件 ID。
- 远程 Gateway 设备 Token 保持精确 read/write；本机 loopback 不读取或使用已有设备凭据。
- 只有可信代理确认的 HTTPS 才设置 Secure Cookie 与 HSTS；远程 Origin 未认证时默认拒绝启动。

## [0.2.0] - 2026-07-24

### 新增

- 提供可视化 Canvas，支持多个主分支、继续与分支工作流、持久化布局、本地化控件，以及每个 Canvas 绑定一个 OpenClaw Agent。
- 持久化保存附件和生成的 Artifact，并按所有者隔离。
- 提供受管用户 Token 认证、会话撤销、请求限流和 Canvas 所有者隔离。
- 通过受支持的 CLI 命令使用 OpenClaw 原生设备配对和配置能力。
- 支持 Session 重置预测、对话记录协调和规范 Branch 恢复。
- 为受支持的 macOS 和 Linux 安装提供仅面向正式 Release 的更新器及系统服务集成。
- 添加应用图标、Apple Touch Icon 和 favicon 等产品视觉资源。

### 变更

- 将 ConvoSketchpad 确立为在 `main` 分支独立维护的产品。
- 将运行时路径、服务、launchd 标识符和环境变量统一重命名为 ConvoSketchpad。
- 分离浏览器与 Node 测试环境。
- 围绕“A branching AI workspace for visual thinkers（为视觉思考者打造的分支式 AI 工作区）”统一产品文案，并整合项目文档。
- 向 OpenClaw 报告的应用版本改为读取 package 元数据。
- 安装器默认使用官方稳定 Release；安装开发版时必须显式提供 `--branch`。
- 将 Hono 服务端适配器及其他直接、间接依赖更新至已修复版本。

### 修复

- 防止首个 ConvoSketchpad Release 的说明错误地基于继承自 OpenClaw Nerve 的标签生成。
- 移除旧运行时日志前缀和过期的 Release 版本示例。

### 安全

- 移除一个保留了存在漏洞的服务端依赖、且已不再使用的开发 CLI。
- 在 Release 验证流程中增加完整依赖审计和生产依赖审计。

### 升级说明

- 升级现有安装前，请同时备份项目内的 `database/` 和 `artifacts/` 目录。
- `0.2.0` 版本不需要手动迁移数据库。

ConvoSketchpad 源自 OpenClaw Nerve。更早的上游版本历史仍可在 [OpenClaw Nerve 更新日志](https://github.com/daggerhashimoto/openclaw-nerve/blob/master/CHANGELOG.md)中查看。

[Unreleased]: https://github.com/MrToyy/convosketchpad/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/MrToyy/convosketchpad/releases/tag/v0.2.0
