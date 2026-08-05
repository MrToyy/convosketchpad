# 故障排查

## Gateway 连接失败

```bash
openclaw gateway status
curl -sS http://127.0.0.1:18789/health
curl -sS http://127.0.0.1:3080/api/runtime/status
```

确认 `AGENT_RUNTIMES`、`OPENCLAW_GATEWAY_URL`、`OPENCLAW_GATEWAY_TOKEN` 和网络可达性。loopback Gateway 不需要设备配对；远程 Gateway 在 Token 轮换或客户端身份升级后重新运行 `npm run setup`，并在 Gateway 宿主机审批 backend 设备：

```bash
openclaw devices list --json
openclaw devices approve <requestId>
```

ConvoSketchpad 会在首次连接失败和运行中断线后自动指数退避重连，最长间隔 30 秒；不需要依靠刷新浏览器触发。如果 Gateway 恢复超过 30 秒后 `/api/runtime/status` 仍未变为 `connected`，再检查后端服务日志中的握手或鉴权错误。远程设备必须同时具有 `operator.read`、`operator.write` 和 `operator.approvals`；升级前创建的设备缺少审批 scope 时重新运行 setup 并完成配对或 scope upgrade。

不需要配置 `WS_ALLOWED_HOSTS` 或 `gateway.controlUi.allowedOrigins`。如果运行端连接仍报告 `origin not allowed`，确认实际运行的是新版本且客户端身份为 `gateway-client/backend/node`；不要通过扩大浏览器 Origin 列表掩盖旧进程。

## 配对提示 `missing scope: operator.admin`

这只可能发生在远程 Gateway 的旧 ConvoSketchpad 设备 repair。OpenClaw 会保留既有设备的审批基线；如果旧 operator Token 曾包含 `operator.admin`，普通 read/write/approvals CLI 身份无权批准它。

setup 不会为远程 Gateway 自动取得 admin 权限。请在 Gateway 宿主机使用具有 `operator.admin` 的管理上下文审批；若 repair 保留了更宽权限，再执行：

```bash
openclaw devices rotate \
  --device <convosketchpad-device-id> \
  --role operator \
  --scope operator.read operator.write operator.approvals
```

随后重新运行 setup 验证。不要删除或直接编辑 OpenClaw 的配对文件。本机 loopback 配置若看到配对提示，确认运行的是新版本并重启 ConvoSketchpad；不要批准不再需要的本机 request。

## Agent 列表或 Canvas 创建返回 502

服务端无法完成 `agents.list`。检查 `/api/runtime/status`、设备审批和 `operator.read` 权限。

## 发送一直排队

Graph 的 `pendingSends` 会在 Gateway 不可用时保持 Branch 锁定。检查 operation：

```text
GET /api/canvas/send-operations/:id
```

- `reserved`：确认请求没有写出，等待连接后重试。
- `awaiting_media`：后端正在读取或生成大图投递派生文件；浏览器无需执行操作。长时间不推进时检查服务日志、
  `artifacts/` 写权限、可用磁盘空间和源图片是否有效。
- `ambiguous`：请求可能已写出，服务端会持续用同一幂等键重试；这是防止重复消息的安全状态。
- `failed`：Gateway 明确拒绝，或附件/载荷无法构造。

不要直接修改 SQLite 解锁。

## Interaction 一直生成

Gateway 终止事件只是提示。服务端会从权威对话记录协调最终文本和 Artifact；新 Interaction 会直接登记，服务重启和 Gateway 重连会恢复未完成协调。Graph 读取本身不会启动协调。

## Graph 返回 429

前端先读取一次 Graph 快照，之后通过当前 Canvas 的 `canvas.sync` 完整实体更新推进 cursor，不会为流式 Preview 或完成状态持续读取 Graph。只有 Canvas SSE 不可用且 `hasPendingUpdates=true` 时才降级读取；同一 Canvas 最多一个 Graph 请求在途，并按 `Retry-After` 退避。如果仍持续出现：

- 检查是否运行了旧的前端 Bundle，清理浏览器缓存并重载；
- 检查是否同时打开了大量同一 Canvas 标签页；
- 反向代理部署确认 `TRUSTED_PROXIES` 正确，避免所有用户共享同一限流 IP。

不建议仅提高通用限流阈值。

## 附件发送失败

- 最多四个原始文件，每个最大 20 MiB。
- 大图由后端按需生成投递派生文件，原件始终保存在 Canvas 且不被改写。
- 最终 Base64 `chat.send` Frame 必须小于 Gateway `maxPayload`。
- 图片格式无效、不受支持或超过后端安全解码限制时，发送会明确失败；检查 Send Operation 错误与服务日志。

Fork 与 Session 恢复会完整投递目标历史中仍可用的附件和 Artifact，不会根据本轮指令自动裁剪。相同内容
只占一个物理附件，后端生成的历史大图会按真实内容哈希在同一 Canvas 内复用。若 operation 报告
`replay_payload_too_large`，说明完整 Replay Package 即使经过物理去重仍超过 Gateway `maxPayload`；
服务端不会静默删文件。应提高 Gateway 的受支持载荷上限，或从较短历史位置创建新 Branch。

OpenClaw 的 Session 记录可能把收到的原生附件显示为 `MediaPaths` / `MediaTypes`，而不是保留 RPC
`attachments` 字段。判断媒体是否传入 Agent 时应同时检查这些字段。

## Artifact 不可用

Artifact 与文本完成相互独立。所有完成节点由后端稀疏观察晚到 Artifact 至 2 分钟；已发现 Artifact、同步失败或 Gateway Artifact 能力不完整时继续退避观察到 1 小时。已发现文件全部持久化后节点立即显示同步完成，剩余观察在后端静默进行；超过 25 MiB、无法安全读取或最终仍不可用时才进入终态 `degraded`。刷新页面不会无限重启同步。检查 `artifacts/` 权限和 Gateway `artifacts.list/download` 能力。

从 `0.2.0` 升级时会执行一次本地数据库迁移。迁移只依据已有 SQLite 数据合并等价 Artifact、修正旧同步状态并恢复明确的未完成任务，不会重新读取 Gateway 历史。已终止节点不会因服务重启再次进入协调；旧 run 无法反查 Session 本身也不会被判定为 Artifact 失败。

若更新器在数据库迁移阶段失败，它会恢复更新前的一致 SQLite 快照。手动验证当前版本的迁移与数据库完整性可在构建后运行：

```bash
npm run migrate
```

该命令会取得维护锁并拒绝在线或状态未知的受管服务。没有匹配的 systemd/launchd 服务时，先停止全部手工启动的 ConvoSketchpad 进程，再运行 `npm run migrate -- --confirm-offline`。

如果 `/api/chat/media/outgoing/...` 返回 401，确认 `OPENCLAW_GATEWAY_TOKEN` 是当前 Gateway 的共享密钥。设备 Token 只用于远程 WebSocket，不能替代 Gateway HTTP Bearer Token。已完成 Turn 无法被 `artifacts.list` 反查 Conversation 时，后端会安全回退到当前 Interaction 的 transcript Artifact，不会扫描并导入整条 Session 的历史文件。

如果 OpenClaw 已完成而节点仍显示运行中，优先检查数据库中的 `execution_state`、`turn_ref_json` 和 `runtime_event_inbox`，再检查 OpenClaw Adapter 能否调用 `sessions.get/list`。不要在新 Schema 中寻找 `run_id` 或 `gateway_signal_inbox`，它们会在迁移后移除；也不要依据浏览器调试事件或手工修改节点状态。带显式 Turn Handle 但未命中的事件会保留为待处理且不会回退猜测；只有缺少 Turn Handle 且 Conversation 恰好只有一个候选节点时才允许恢复关联。

审批卡片未出现时，先确认 `/api/runtime/status` 中对应 Runtime 已连接、OpenClaw 设备 Token 含 `operator.approvals`、服务端日志没有报告审批方法不受支持，并检查 `runtime_event_inbox` 是否记录 `approval.required`。公开 Runtime 状态不会返回 `interactiveApprovals` Capability、原生方法表或诊断数据。`409` 通常表示审批已处理、选择无效或权限集合越界；`410` 表示已过期；`202` 表示结果未知，应等待原生 resolved 事件，不要反复点击。

状态栏显示“部分可用”是正常聚合结果：在设置中查看各 Runtime 错误。用量缺少全局费用合计通常表示币种/统计周期不一致、某个 Runtime 未声明可加，或只返回额度而不返回费用；这不是数据丢失。

## 图片缩略图不显示

Canvas 节点只加载后端缩略图，不以原图作为自动回退；点击预览后才请求原图。外部 HTTP Artifact 按设计只显示
文件卡片，不生成缩略图。Canvas 本地图片缩略图返回 404 时检查：

- 原附件或 Artifact 是否仍存在于 `artifacts/`，MIME 是否为受支持的栅格图片；
- `artifacts/` 是否可写、磁盘是否有空间；
- 升级时 `npm run migrate` 的 `0.3.0_media_derivatives_v1` 输出是否有对应警告。

可在目标版本已构建且服务停止时运行 `npm run migrate -- --rescan-media`，复查并补齐缺失的缩略图；没有匹配服务管理器时还需追加 `--confirm-offline`。该命令不会
改写原图。普通 `npm run migrate` 在迁移账本存在时不会重复全量扫描。

## 远程启动被拒绝

非回环 `HOST` 或远程 `ALLOWED_ORIGINS` 都要求受管认证，除非 Custom 模式中经过二次确认并显式设置不安全覆盖。远程部署应由代理提供 HTTPS，并将准确的浏览器 Origin 写入 `ALLOWED_ORIGINS`。

如果启动报告 `Invalid ALLOWED_ORIGINS`，移除路径、查询、Fragment、凭据、`null` 和通配符，只保留例如 `https://canvas.example.com` 的精确 Origin。

`SSL_PORT` 和 `VITE_DISABLE_HTTPS` 已废弃并被忽略。ConvoSketchpad 只提供 HTTP；旧 `certs/` 文件也不会再被自动加载。

`VITE_HOST` 和 `VITE_PORT` 也已废弃。开发和生产统一使用 `HOST` / `PORT` 作为浏览器入口；`npm run dev` 会自动选择 loopback 后端端口。如果旧 `.env` 仍包含这些变量，重新运行 setup 会在备份后移除。

## 更新或 Setup 失败

更新或重新 Setup 失败时，先查看更新器最近结果和服务状态：

```bash
cat "${CONVOSKETCHPAD_DATA_DIR:-$HOME/.convosketchpad}/updater/last-run.json"
sudo systemctl status convosketchpad.service --no-pager
```

如果项目 `.env` 自定义了 `CONVOSKETCHPAD_DATA_DIR`，但当前 Shell 没有导出它，应把上面的路径替换为 `.env` 中的实际值。系统级 systemd 更新在交互终端会请求 sudo；CI、SSH 无终端任务或其他非交互执行必须事先提供无提示授权，否则 `sudo -n` 会让更新明确失败。不要在更新器失败后再次运行安装器跨版本覆盖；排除权限或构建问题后重试 `npm run update`，或用 `npm run update -- --rollback` 恢复正式 `last-good` 快照。

Setup 失败不会改变上述正式回滚目标。它会恢复迁移前的 `.env`；SQLite 只在服务再次确认离线后恢复。若重启后的服务无法停止或状态无法确认，setup 不会覆盖数据库并会保留临时快照，先人工停止服务再处理。没有匹配服务管理器时 setup 不打开数据库，迁移由下次手动启动完成。

## 构建或测试失败

```bash
npm install
npm test -- --run
npm run lint
npm run build
```

需要 Node.js 22.13 或更高版本。
