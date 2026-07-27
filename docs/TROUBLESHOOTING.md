# 故障排查

## Gateway 连接失败

```bash
openclaw gateway status
curl -sS http://127.0.0.1:18789/health
curl -sS http://127.0.0.1:3080/api/runtime/status
```

确认服务端 `GATEWAY_URL`、`GATEWAY_TOKEN` 和网络可达性。loopback Gateway 不需要设备配对；远程 Gateway 在 Token 轮换或客户端身份升级后重新运行 `npm run setup`，并在 Gateway 宿主机审批 backend 设备：

```bash
openclaw devices list --json
openclaw devices approve <requestId>
```

ConvoSketchpad 会在首次连接失败和运行中断线后自动指数退避重连，最长间隔 30 秒；不需要依靠刷新浏览器触发。如果 Gateway 恢复超过 30 秒后 `/api/runtime/status` 仍未变为 `connected`，再检查后端服务日志中的握手或鉴权错误。

不需要配置 `WS_ALLOWED_HOSTS` 或 `gateway.controlUi.allowedOrigins`。如果后端连接仍报告 `origin not allowed`，确认实际运行的是新版本且客户端身份为 `gateway-client/backend/node`；不要通过扩大浏览器 Origin 列表掩盖旧进程。

## 配对提示 `missing scope: operator.admin`

这只可能发生在远程 Gateway 的旧 ConvoSketchpad 设备 repair。OpenClaw 会保留既有设备的审批基线；如果旧 operator Token 曾包含 `operator.admin`，普通 read/write CLI 身份无权批准它。

setup 不会为远程 Gateway 自动取得 admin 权限。请在 Gateway 宿主机使用具有 `operator.admin` 的管理上下文审批；若 repair 保留了更宽权限，再执行：

```bash
openclaw devices rotate \
  --device <convosketchpad-device-id> \
  --role operator \
  --scope operator.read operator.write
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
- 大图在浏览器压缩后上传投递副本，原件仍保存在 Canvas。
- 最终 Base64 `chat.send` Frame 必须小于 Gateway `maxPayload`。
- 上传成功但投递副本缺失时，重新选择文件后重试。

## Artifact 不可用

Artifact 与文本完成相互独立。所有完成节点由后端稀疏观察晚到 Artifact 至 2 分钟；已发现 Artifact、同步失败或 Gateway Artifact 能力不完整时继续退避观察到 1 小时。已发现文件全部持久化后节点立即显示同步完成，剩余观察在后端静默进行；超过 25 MiB、无法安全读取或最终仍不可用时才进入终态 `degraded`。刷新页面不会无限重启同步。检查 `artifacts/` 权限和 Gateway `artifacts.list/download` 能力。

从 `0.2.0` 升级时会执行一次本地数据库迁移。迁移只依据已有 SQLite 数据合并等价 Artifact、修正旧同步状态并恢复明确的未完成任务，不会重新读取 Gateway 历史。已终止节点不会因服务重启再次进入协调；旧 run 无法反查 Session 本身也不会被判定为 Artifact 失败。

若更新器在数据库迁移阶段失败，它会恢复更新前的一致 SQLite 快照。手动验证当前版本的迁移与数据库完整性可在构建后运行：

```bash
npm run migrate
```

如果 `/api/chat/media/outgoing/...` 返回 401，确认 `GATEWAY_TOKEN` 是当前 Gateway 的共享密钥。设备 Token 只用于远程 WebSocket，不能替代 Gateway HTTP Bearer Token。已完成 run 无法被 `artifacts.list` 反查 Session 时，后端会安全回退到当前 Interaction 的 transcript Artifact，不会扫描并导入整条 Session 的历史文件。

如果 OpenClaw 已完成而节点仍显示运行中，检查数据库中的 `execution_state`、`run_id` 和 `gateway_signal_inbox`，再检查后端能否调用 `sessions.get/list`。不要依据浏览器调试事件或手工修改节点状态；无法唯一关联的信号会保守进入协调流程。

## 远程启动被拒绝

非回环 `HOST` 或远程 `ALLOWED_ORIGINS` 都要求受管认证，除非 Custom 模式中经过二次确认并显式设置不安全覆盖。远程部署应由代理提供 HTTPS，并将准确的浏览器 Origin 写入 `ALLOWED_ORIGINS`。

如果启动报告 `Invalid ALLOWED_ORIGINS`，移除路径、查询、Fragment、凭据、`null` 和通配符，只保留例如 `https://canvas.example.com` 的精确 Origin。

`SSL_PORT` 和 `VITE_DISABLE_HTTPS` 已废弃并被忽略。ConvoSketchpad 只提供 HTTP；旧 `certs/` 文件也不会再被自动加载。

`VITE_HOST` 和 `VITE_PORT` 也已废弃。开发和生产统一使用 `HOST` / `PORT` 作为浏览器入口；`npm run dev` 会自动选择 loopback 后端端口。如果旧 `.env` 仍包含这些变量，重新运行 setup 会在备份后移除。

## 构建或测试失败

```bash
npm install
npm test -- --run
npm run lint
npm run build
```

需要 Node.js 22.13 或更高版本。
