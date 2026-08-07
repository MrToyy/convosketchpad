# 更新日志

ConvoSketchpad 的重要变更均记录在此文件中。格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)。

## [Unreleased]

## [0.4.1] - 2026-08-07

### 发布摘要

ConvoSketchpad v0.4.1 修复 v0.4.0 更新链路中暴露的维护停服、旧配置迁移、GitHub 限流诊断与关闭竞态，并为从 v0.3.x 升级提供明确的一次性离线桥接。该补丁不改变 Canvas 数据模型，不增加数据库迁移。

### 修复

- macOS 更新器以 `launchctl bootout gui/<uid>/<label>` 真正卸载 `KeepAlive` Job，恢复时从已验证 plist 执行 `bootstrap` 并用 `kickstart -k` 启动；状态查询改为精确 Domain/Label，避免服务在迁移期间被自动拉起或把未知状态误判为停止。
- 目标迁移器一次性原子转换 v0.3.x 的 `AGENT_BACKENDS`、`GATEWAY_URL`、`GATEWAY_TOKEN` 和 `CONVOSKETCHPAD_GATEWAY_TIMEZONE`。旧、新键冲突会在任何写入前失败，错误不包含配置值。
- GitHub Release 请求现在区分主 API 限流、带 `Retry-After` 的临时限制和被拒绝的 Token；错误提供 UTC 重置时间或安全处理建议，不返回响应正文，也不降级到非 Release 更新源。
- 进程关闭先通过内部 AbortSignal 终止 Canvas/Runtime SSE 的订阅、心跳和 catch-up 定时器，再关闭 Runtime 与 SQLite；SIGTERM/SIGINT 重入也会被忽略，避免停机或回滚期间定时器读取已关闭数据库。

### 文档

- 更新文档明确说明 v0.3.0–v0.3.2 的源更新器会与目标迁移器发生维护锁自冲突，应使用 `--no-restart` 后离线迁移；v0.4.0 的 macOS launchd 安装升级到本版时也需先 `bootout`。补充已恢复数据库但旧服务重启失败时的判断与 GitHub 403 排障，并让 CLI 准确说明 `--no-restart` 不管理服务。

### 安装与升级

新安装可以使用正式安装器。v0.4.0 的 systemd 安装可直接运行：

```bash
npm run update -- --version v0.4.1
```

v0.3.0–v0.3.2，以及 v0.4.0 的 macOS launchd 安装，必须按[升级文档](https://github.com/MrToyy/convosketchpad/blob/main/docs/UPDATING.md)先完全停服，再执行 `npm run update -- --version v0.4.1 --no-restart`、`npm run migrate -- --confirm-offline` 并恢复服务。不要删除维护锁或手工编辑 SQLite。

## [0.4.0] - 2026-08-07

### 发布摘要

ConvoSketchpad v0.4.0 定位为“Agent 可视化分支工作台——从任意节点回溯并继续探索”，将 OpenClaw 从产品内部的固定运行时重构为标准 Agent Runtime Adapter，并通过同一边界直接接入本地 Codex App Server。现有 Canvas 交互保持不变，同时新增节点内审批、平权 Agent 目录和按 Runtime 分组的运行状态与用量。

本版本包含不可逆的数据库结构升级。服务启动会自动迁移；setup 和更新器只有在属于当前安装的受管服务已明确离线时才显式迁移并创建 SQLite 快照，没有可验证的服务管理器时推迟到下次启动。失败恢复同样不会在服务状态未知时替换数据库。

### 当前版本亮点

- 新建 Canvas 仍然一键完成，自动选择 setup 配置的可用默认 Agent（否则回退到首个可用项），并允许在第一次提交前更换。
- OpenClaw Agent、Codex Agent 和其他 Runtime Agent 使用同一目录与 Canvas 模型，不需要切换 Runtime 模式。
- 原生执行或插件审批直接出现在所属 Interaction 节点中，支持权限子集和持久授权确认。
- 设置、状态栏和用量面板按 Runtime 聚合；不完整或不可比较的数据不会被错误相加。
- OpenClaw 协议与凭据边界收敛到独立 Adapter，新增 Runtime 可遵循统一开发规范。
- 品牌标语统一为“让想法自由分支 / Let ideas fly free”，README、应用元数据、安装器和宣传图不再把产品描述为 OpenClaw 专属工作台。

### 新增

- 新增统一 `AgentRuntime` 契约、Runtime Registry、语义化 Capabilities 和版本化不透明 Conversation/Turn/Artifact/Approval Handle；当前可同时注册 OpenClaw 与 Codex。
- 新增本地 Codex App Server Adapter，最低且已验证 Codex CLI `0.146.0`：监督 stdio JSONL 子进程，提供 `codex/default` Agent、Thread/Turn 恢复、文本/图片输入、流式输出、原生图片和通用 Artifact、账户用量/额度及节点内命令/文件/权限审批。多个受管用户共享宿主机 Codex 账户与配置的工作目录。
- Codex 通用交付物使用 `CODEX_WORKING_DIRECTORY/.convosketchpad-artifacts/<turn-token>/outputs/` 受管目录，经过路径、链接、数量和大小校验后复制到 Canvas Artifact 存储；支持非图片文件下载，失败/中断 Turn 的可用文件保留并标注可能不完整，持久化后释放临时副本。SVG/HTML 等活动内容不内联预览。
- 统一 Runtime 事件从首阶段覆盖终态、流式输出、Artifact、用量和审批 required/resolved，并用按 Runtime 命名空间隔离的 `runtime_event_inbox` 持久化、去重终态与审批；显式 Turn Handle 严格关联，晚到审批结果仍可在 Interaction 终止后收敛。全局断线由 Runtime 状态流传播，不混入 Canvas Inbox。
- Interaction 节点内新增审批卡片，展示已净化的风险、权限、作用域、到期和解析状态；支持权限子集选择、持久授权二次确认及统一审批 HTTP API。
- 新增 Runtime 配置/聚合目录：新建 Canvas 自动选择配置的可用默认 Agent并在必要时回退，首次发送预留前可更换；各 Runtime 的 Agent 平权展示，不提供 Runtime 切换模式。
- setup 新增 Runtime 只读探测与分组多选，并通过统一 `RuntimeSetupDriver` 仅配置、校验用户选择的 Runtime；配置完成后通过统一 Runtime Port 选择默认 Agent，默认项不可用时安全回退到第一个可用 Agent。非交互模式支持 `--runtimes` 与 `--default-agent`。
- 新增 Adapter 开发规范和 `server/lib/agent-runtimes/adapters/<runtime-id>/` 目录约束。

### 变更

- 主体代码按职责收敛：Canvas 持久模型、纯领域规则、应用用例与 SQLite 持久化分别进入 `canvas/model.ts`、`canvas/domain/`、`canvas/application/` 和 `canvas/persistence/`；服务启动由显式 `ApplicationContext` 组合并注入 Runtime Registry 与 Store，不再保留导入即创建的全局 Runtime 单例。前端 Flow 类型/自动布局与节点渲染分离，Canvas 列表从页面编排组件拆出；setup 的 Runtime 选择、默认 Agent 与帮助输出也拆成独立模块。
- 删除浏览器不应直接驱动的 `POST /api/canvas/send-operations/:id/dispatch`；Runtime 重启入口统一为 `POST /api/runtime/:runtimeId/restart`。setup 删除 OpenClaw 专属 `--gateway-timezone` 参数，交互模式继续询问远程 Gateway 时区，自动化使用正式环境变量。
- Canvas Route、发送 Service/Worker/Coordinator、事件消费、Reconciler、上下文快照、Artifact 物化、运行状态、用量和 Provider 配额改为通过统一 Runtime Port 调用；OpenClaw Gateway 方法名、Session Policy、Transcript 与 Artifact 下载收敛到独立 Adapter 目录。
- 导航栏/设置聚合所有 Runtime 的连接状态；账户用量和额度按 Runtime 分组，仅在币种、周期与可加性一致时显示费用合计。Canvas Branch、工作中和上下文仍保持当前 Canvas 局部语义。
- SQLite 在既有 `0.3.2 → 0.4.0` 结构迁移内将旧 OpenClaw 顶层字段彻底迁移为 Runtime/Profile、Conversation/Turn/Artifact Handle、审批和通用事件 Inbox；旧列及 `gateway_signal_inbox` 成功后物理移除，不双写。全新数据库直接创建当前 Schema，不再先构造旧表再重建；setup、更新器和服务启动均自动执行安全迁移。
- 数据库迁移链收敛为且仅为三项：`0.2.0_to_0.3.0_v1`、`0.3.0_media_derivatives_v1` 和 `0.3.2_to_0.4.0_agent_runtime_v1`。`npm run migrate` 在外键与完整性检查后显式验证三项均已落账，并清理未发布开发版本留下的迁移标识；`0.3.x` 可直接升级，`0.2.0` 数据仍由目标迁移代码完整支持，但安装流程必须先完成既有的 `v0.3.0` 更新器桥接。
- Agent Runtime Schema 迁移会根据最早 Send Reservation 回填旧 Canvas 的 Agent 锁定时间，并以最早 Interaction 兜底；已经迁移但锁定字段缺失的数据库会被幂等修复，服务端同时拒绝对任何已有 Reservation 或 Interaction 的 Canvas 更换 Agent。
- 开发期 Backend Schema 会自动原地迁移为 Runtime 物理字段、Handle JSON 与事件表；`AGENT_BACKENDS` 由 setup/update 一次性转换为 `AGENT_RUNTIMES`，正式运行不兼容读取、不双写。
- 派发可靠性增加完整恢复闭环：未知结果保存不透明恢复引用；非幂等 Runtime 必须先权威核对，无法核对时保持锁定且不盲目重发。图片生成 Capability 改为 `supported | unsupported | unknown` 三态，OpenClaw 当前如实报告 `unknown`。
- Conversation 连续性判断下放 Adapter：OpenClaw 继续解释 Session 重置策略，Codex `notLoaded` Thread 视为可恢复并继续原 Thread；只有权威记录确认缺失时才由通用层执行历史 Replay。Codex `turn/start` 没有服务端幂等保证，传输结果未知时通过 `thread/read` 与交付 Token 对账。
- Codex 当前使用 Default 模式并继承宿主机模型、Sandbox、审批与 Reviewer 设置；统一审批暂不表达 execpolicy/network amendment，结构化 ask-user 和 MCP elicitation 无回答通道并会明确拒绝。这些限制不会被伪装成成功。
- 无副作用 Runtime Manifest 统一 ID/展示名支持清单，Definition 对清单逐项提供 Registry 所有的实例工厂与配置校验；ApplicationContext 独立拥有 Store、Adapter 生命周期和后台协调依赖，OpenClaw 共享传输使用租约避免相互关闭。OpenClaw 专属配置、CLI 定位及 setup 支持面收敛到 Adapter 目录，Runtime 状态事件、Canvas 事件消费和用量模块采用不混淆的独立命名。
- setup 与服务启动共用 Runtime 选择语义：只有缺失 `AGENT_RUNTIMES` 时默认 OpenClaw，显式空配置统一拒绝。原生审批 resolved 事件会再次校验已声明 Choice 和权限子集，契约外结果保持 `unconfirmed`，不再默认成功。
- OpenClaw CLI 定位改为显式 `OPENCLAW_BIN` 优先、否则直接通过 `PATH` 执行 `openclaw`；setup 选择页只用 `openclaw --version` 发现入口，不在用户选择前读取 Token 或原生配置，选中后才读取可用预填值。成功发现后持久化实际绝对路径，安装器与服务端不再扫描特定安装器或其他用户目录。本机缺少 CLI 不阻断远程 Gateway 安装。本轮默认 Agent 仅增加环境配置，不增加数据库迁移。
- Codex setup 只用 `codex --version` 做发现；选择后默认创建并使用 `~/codex-convosketchpad`，更新时优先沿用 `.env` 中的工作目录，再临时启动 App Server 读取账户状态。未登录时提示用户自行运行 `codex login` 后重跑 setup，不阻断其他配置，也不读取或修改 `CODEX_HOME`。Codex 接入复用现有通用 Handle 与派发恢复字段，不增加第四条数据库迁移。
- 流式 Preview 按统一语义区分追加 Delta、累计快照和消息完成值，服务端按 `messageId` 组装完整 Turn 文本后再发给前端；Codex 多段文字不再只显示最后一个 Delta，OpenClaw 累计 `message` 也不会被重复追加。运行节点在已有文字时继续显示工作指示，并使用固定高度的运行期输出面板，将正文滚动层与底部工作状态层分离；每次快照更新后正文自动跟随到底部，避免未闭合的流式 Markdown 持续改变容器和滚动轨道尺寸。Codex 上下文改用 `tokenUsage.last.totalTokens`，并通用拒绝超出 Context Window 的累计用量快照。
- Runtime 状态读取改为无副作用快照；Gateway 不可达时，状态聚合和状态订阅不再反向触发即时重连，OpenClaw 严格保持 1–30 秒指数退避，避免启动期热循环和日志风暴。
- setup、migrate 和 update 共用维护锁，并校验 systemd/launchd 的名称、工作目录、启动命令和三态运行状态；只有属于当前安装且明确离线时才快照、迁移或恢复 SQLite。没有匹配管理器时 setup/update 推迟数据库迁移且失败回滚不替换 SQLite；独立 migrate 要求操作者显式确认手工进程已停止。setup 重启后验证服务状态、健康和版本，无法确认离线时不覆盖数据库并保留临时快照。环境配置迁移仍不依赖服务管理器，`--no-restart` 继续只恢复代码和 `.env`。本轮复用既有派发恢复字段，不增加第四条数据库迁移。
- 安装器不再读取 OpenClaw 原生配置或直接生成 Runtime `.env`，交互与非交互安装统一经过 setup；`--skip-setup` 只复用已有配置。已有稳定版跨 Release 升级必须使用事务化更新器，安装器只处理新安装和同版本修复，并拒绝覆盖脏工作区及模糊 CLI 参数。setup 严格拒绝未知、重复、缺值和冲突参数；其一次性数据库快照不覆盖正式 `last-good`，迁移或服务恢复失败时恢复 `.env` 与数据库并保持服务停止。Linux 系统级 systemd 的安装与更新统一经最小权限 sudo 路径执行。安装、setup 与 update 统一强制 Node.js `>=22.22.2`。

### 修复

- Canvas 连接边改为静态显示，避免 React Flow 的 SVG 虚线动画在空闲页面持续触发样式重算和 GPU 绘制；运行状态继续由 Interaction 节点和状态栏反馈。

### 安全

- OpenClaw 远程设备权限增加精确的 `operator.approvals` scope，以便统一审批 Port 能真实响应原生审批；已有 read/write 设备需要重新配对或完成 scope upgrade。审批事件持久化前会移除命令环境等敏感原始数据。
- Runtime 发现 Driver 不再接收完整 `.env`，只获得是否已配置和非敏感可执行文件路径；未选择 Runtime 的发现阶段无法读取连接 Token。
- 更新 Hono、PostCSS、brace-expansion 与 jsdom/Undici 依赖链，修复正式 Release 审计发现的拒绝服务、响应解析、缓存与 Cookie 处理漏洞；完整依赖和生产依赖审计均不再报告已知漏洞。

### 安装与升级

`v0.4.0` 的安装、更新和源码构建需要 Node.js `22.22.2+`。

新安装需先准备至少一个可访问的 Agent Runtime（OpenClaw Gateway，或已登录的本地 Codex CLI `0.146.0+`），然后运行：

```bash
curl -fsSL https://raw.githubusercontent.com/MrToyy/convosketchpad/main/install.sh | bash
```

已经安装 `v0.3.0` 或更高版本的用户可运行：

```bash
npm run update -- --version v0.4.0
```

从 `v0.2.0` 升级必须先按[升级文档](https://github.com/MrToyy/convosketchpad/blob/main/docs/UPDATING.md)固定升级到 `v0.3.0`，获得停服迁移、SQLite 快照和失败回滚能力后，再升级到 `v0.4.0`。不要用旧版本直接打开已经完成 `0.4.0` 结构迁移的数据库。

## [0.3.2] - 2026-07-30

### 发布摘要

ConvoSketchpad v0.3.2 增加安全、可预览的服务注销流程，让用户能够移除 launchd 或 systemd 集成，同时明确保留程序目录、Canvas 数据、附件、Artifact、Gateway 凭据和更新器快照。该版本不改变 Canvas、OpenClaw 集成或数据库语义。

### 新增

- 新增 `./uninstall.sh` 与 `npm run uninstall` 入口，支持 `--dry-run`，并通过工作目录、启动命令和生成模板校验，精确注销属于当前安装的 launchd/systemd 服务。
- 注销完成后列出 `.env`、Canvas SQLite、附件与 Artifact、Gateway 凭据和更新器状态的位置，提供明确警告的手动程序目录删除命令。
- 提供固定当前版本、复用现有配置的安装器命令，用于重新注册并启动已经注销的受管服务。

### 变更

- macOS 安装器生成的根目录 `start.sh` 作为本地运行文件被 Git 忽略，避免自动生成的 launchd wrapper 阻塞后续原生更新。

### 安装与升级

新用户需要先安装并运行可访问的 OpenClaw Gateway，然后执行：

```bash
curl -fsSL https://raw.githubusercontent.com/MrToyy/convosketchpad/main/install.sh | bash
```

已经安装 v0.3.0 或更高版本的用户可以在发布后运行：

```bash
npm run update -- --version v0.3.2
```

从 v0.2.0 升级仍必须先按[升级文档](https://github.com/MrToyy/convosketchpad/blob/main/docs/UPDATING.md)完成一次性 v0.3.0 桥接。升级前应停止服务，并把 `.env`、`database/` 和 `artifacts/` 一起备份到仓库外。

## [0.3.1] - 2026-07-30

### 发布摘要

ConvoSketchpad v0.3.1 是继 v0.3.0 架构升级后的推荐补丁版本。对于已经安装 v0.3.0 的用户，本版本修复离线迁移 CLI 记录错误应用版本的问题；为了让新用户完整了解当前产品，本说明同时汇总 v0.3.0 引入的主要体验、安全性和运维改进。

ConvoSketchpad 是 OpenClaw 可视化分支工作台：你可以从任意已完成的对话节点携带当时的上下文、附件与生成物继续探索，让不同方向各自延伸，同时保持任务主线清晰。

### 当前版本亮点

- **真正的上下文分支**：从任意已完成的 Interaction 创建分支，完整保留历史文本及可用附件、Artifact 的逻辑位置；也可以继续当前方向或原样重试任意 Interaction。
- **可靠的发送与恢复**：后端统一协调发送、幂等重试、Gateway 重连和终态收敛；Session 被替换或移除后，通过规范快照恢复 Branch 上下文。
- **持久化的可视化工作区**：Canvas 拓扑、节点位置、用户尺寸和视口都会保存；“重新排列”可以按真实节点尺寸恢复清晰的从左到右布局。
- **附件与生成物归档**：原始附件保持不可变，生成 Artifact 按 Canvas 和所有者持久化；图片缩略图与投递副本由后端统一生成和缓存。
- **更安全的 OpenClaw 集成**：浏览器只连接 ConvoSketchpad 同源 HTTP/SSE，Gateway Token 和设备 Token 只存在于服务端；远程访问支持精确 Origin、受管用户认证和 Tailscale/反向代理拓扑。
- **一致的安装与更新体验**：Setup 统一支持 Local、LAN、Tailscale IP、Tailscale Serve 和 Custom；从 v0.3.0 开始，更新器提供停服迁移、SQLite 快照、完整性校验和失败回滚。

### 修复

- 修复离线迁移 CLI 从 `bin-dist` 运行时无法定位根 `package.json`、导致迁移账本把实际应用版本记录为 `0.0.0` 的问题。

### 安装与升级

新用户需要先安装并运行可访问的 OpenClaw Gateway，然后执行：

```bash
curl -fsSL https://raw.githubusercontent.com/MrToyy/convosketchpad/main/install.sh | bash
```

已经安装 v0.3.0 的用户可以在发布后运行：

```bash
npm run update -- --version v0.3.1
```

从 v0.2.0 升级仍必须先按[升级文档](https://github.com/MrToyy/convosketchpad/blob/main/docs/UPDATING.md)完成一次性 v0.3.0 桥接，再升级到 v0.3.1。升级前应停止服务，并把 `.env`、`database/` 和 `artifacts/` 一起备份到仓库外。

## [0.3.0] - 2026-07-29

### 变更

- 停止维护历史来源仓库的同步工作流，将 `main` 明确为唯一长期维护和发布分支；产品文档仅保留独立的许可证与第三方来源说明入口。
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
- 更新器停服迁移新增历史图片缩略图全量回填和 60 分钟超时；由 `0.2.0` 旧更新器触发首次启动时，HTTP 先就绪、媒体回填再于后台可重试执行，避免历史图片较多导致旧更新器健康检查超时。单文件失败可诊断地跳过，显式迁移中的系统性存储或数据库错误触发回滚。移除浏览器压缩、媒体准备资源 API 和投递副本上传链。
- 重构 Canvas 继续/Fork 发送链路：分离前端 Graph、Composer 与 Flow 投影，后端拆分应用用例、发送判定、OpenClaw 适配、Worker、投递构建和事件消费；公开 API、SQLite Schema 与 Gateway 协议保持不变。修复排队发送完成或失败后 Composer 仍长期保持发送状态的问题。
- Canvas Interaction 新增“重试”：保留原节点和原执行，从上一节点创建普通 Branch 并原样提交相同文本与附件；首节点会创建新 Root，运行中、待确认、成功和失败节点均可使用。该操作复用现有发送状态机，不建立独立 Retry 模型；接受前失败会通过普通 Composer 恢复输入和持久附件。
- “继续分支”被 OpenClaw 接受后立即同步新的 Branch 头节点，使提交前节点无需等待新任务完成即可创建并行分支。
- 代码块改为安全的纯文本展示并保留复制操作，移除语法着色、语言识别、代码下载及相关 Highlight.js/DOMPurify 运行时依赖。

### 安全

- 升级 ESLint 与 TypeScript-ESLint 开发工具链，使用已修复拒绝服务漏洞的 `brace-expansion` 版本。
- Gateway Token 和设备 Token 现在只存在于服务端；浏览器 CSP `connect-src` 限制为同源。
- 发送接口只接受已登记且属于当前 Canvas 的附件 ID。
- 远程 Gateway 设备 Token 保持精确 read/write；本机 loopback 不读取或使用已有设备凭据。
- 只有可信代理确认的 HTTPS 才设置 Secure Cookie 与 HSTS；远程 Origin 未认证时默认拒绝启动。

### 升级说明

- `0.2.0 → 0.3.0` 是一次性桥接升级。升级前停止服务，并把 `.env`、`database/` 和 `artifacts/` 一起备份到仓库外；随后固定执行 `npm run update -- --version v0.3.0`。
- `0.2.0` 旧更新器不会创建 SQLite 快照；需要完全停服迁移时使用 `--no-restart`，更新完成后执行 `npm run migrate` 再启动服务。
- 从已经安装的 `0.3.0` 开始，后续稳定版保留累计迁移并支持直接升级到目标版本，无需逐个安装中间版本。

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

[Unreleased]: https://github.com/MrToyy/convosketchpad/compare/v0.4.1...HEAD
[0.4.1]: https://github.com/MrToyy/convosketchpad/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/MrToyy/convosketchpad/compare/v0.3.2...v0.4.0
[0.3.2]: https://github.com/MrToyy/convosketchpad/compare/v0.3.1...v0.3.2
[0.3.1]: https://github.com/MrToyy/convosketchpad/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/MrToyy/convosketchpad/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/MrToyy/convosketchpad/releases/tag/v0.2.0
