# 配置

推荐运行 `npm run setup`。手动配置时参考 `.env.example`。

## 核心配置

| 环境变量 | 默认值 | 用途 |
|---|---|---|
| `AGENT_RUNTIMES` | `openclaw` | 启用的 Agent 运行端类型，逗号分隔；同一类型最多一个实例，未知或空配置会拒绝启动 |
| `CONVOSKETCHPAD_DEFAULT_AGENT_RUNTIME` | 未设置 | 新建 Canvas 优先选择的 Runtime ID；必须与 Profile 同时设置且属于 `AGENT_RUNTIMES` |
| `CONVOSKETCHPAD_DEFAULT_AGENT_PROFILE` | 未设置 | 新建 Canvas 优先选择的 Agent Profile ID；不可用时回退到第一个可用 Agent |
| `OPENCLAW_GATEWAY_URL` | `http://127.0.0.1:18789` | OpenClaw Adapter 连接的 Gateway HTTP Origin |
| `OPENCLAW_GATEWAY_TOKEN` | 空 | Gateway 共享密钥；本机 RPC、Gateway HTTP 和远程配对 bootstrap 使用，不会发给浏览器 |
| `OPENCLAW_GATEWAY_TIMEZONE` | 应用宿主机时区 | OpenClaw Adapter 预测每日 Session 重置的 IANA 时区 |
| `PORT` | `3080` | ConvoSketchpad 浏览器入口端口 |
| `HOST` | `127.0.0.1` | ConvoSketchpad 浏览器入口监听地址 |
| `OPENCLAW_CONFIG_PATH` | 未设置 | 只透传给 OpenClaw CLI 的实例选择器 |
| `OPENCLAW_BIN` | `openclaw` | OpenClaw CLI 命令或显式绝对路径；未设置时直接通过服务进程的 `PATH` 查找 |

`HOST` / `PORT` 在生产和开发模式下含义一致：都是用户打开的 ConvoSketchpad 入口。生产模式由 Hono 在该地址同时提供前端静态文件与 API；开发模式由 Vite 使用该地址，启动脚本自动为 Hono 分配仅监听 `127.0.0.1` 的内部端口，并代理 `/api` 和 `/health`。内部端口不属于用户配置。

Runtime ID 与展示名在无副作用的 `server/lib/agent-runtimes/manifest.ts` 维护；`definitions.ts` 必须为清单中的每项提供 Registry 所有的实例工厂，通用配置选择与校验位于 `configuration.ts`。每个 Adapter 的专属环境变量、默认值和校验位于自身 `adapters/<runtime-id>/config.ts`。通用 `server/lib/config.ts` 不承载 OpenClaw/Codex 专属字段。只有 `AGENT_RUNTIMES` 完全缺失时才默认启用 `openclaw`；显式空值与未知、重复项一样会被 setup 检查和服务启动拒绝。

setup 先执行只读 Runtime 发现，只用无凭据命令确认本机入口与版本，将已探测和未探测的支持项分组展示并允许多选；发现 Driver 只接收“是否已配置”和可选可执行文件路径，不接收 Token，也不读取原生配置。用户选中后才由对应 Driver 读取可用的 URL/Token 预填值并逐项配置。CLI 未探测到不代表远程 Runtime 不可接入。配置完成后 setup 通过统一 Runtime Port 获取 Profile 并选择默认 Agent；若目录暂时不可用，保留已有默认值或不写显式默认值，运行时再安全回退。非交互模式可使用 `--runtimes openclaw` 和 `--default-agent openclaw/main`。

ConvoSketchpad 运行时和 Vite 都只提供 HTTP。HTTPS 必须由 Caddy、Nginx、Traefik、Tailscale Serve 等外部入口终止；项目不会读取 `certs/`。

## OpenClaw 配置与配对

ConvoSketchpad 使用 `gateway-client/backend/node` 身份连接，不发送浏览器 `Origin` Header。Gateway URL 决定鉴权模式：

| Gateway 地址 | WebSocket RPC | Gateway HTTP | 设备配对 |
|---|---|---|---|
| loopback（`localhost`、`127.0.0.0/8`、`::1`） | 共享 `OPENCLAW_GATEWAY_TOKEN`，不发送设备身份 | 共享 `OPENCLAW_GATEWAY_TOKEN` | 不需要 |
| 远程地址 | 精确 read/write/approvals 的设备 Token | 共享 `OPENCLAW_GATEWAY_TOKEN` | 需要 |

因此：

- 不需要为 ConvoSketchpad 修改 `gateway.controlUi.allowedOrigins`；
- `npm run setup` 不再要求 `openclaw config patch` 能力；
- 安装、更新和重跑向导都不会增加或删除该列表的值；
- 原生 OpenClaw Control UI 仍可能需要该配置，应由其自身部署负责。

只有远程 Gateway 使用 OpenClaw 原生设备注册流程：

```bash
openclaw devices list --json
openclaw devices approve <requestId>
```

远程 ConvoSketchpad 只申请 `operator.read`、`operator.write` 和 `operator.approvals`。setup 会创建或验证 request，但不会跨主机自动取得管理权限；必须由 Gateway 宿主机上的操作者审批。旧设备缺少 approvals scope 时必须重新配对或完成 scope upgrade；repair 若保留了更宽权限，应在宿主机把最终 Token 降为上述精确集合。

设备 Token 按 Gateway URL 保存在 `$CONVOSKETCHPAD_DATA_DIR/gateway-auth.json`，默认是 `~/.convosketchpad/gateway-auth.json`，权限为 `0600`。
切换到 loopback Gateway 时已有记录会保留但被忽略；以后切回同一远程 Gateway 时可以继续复用。

## 浏览器 Origin 与网络

| 环境变量 | 用途 |
|---|---|
| `ALLOWED_ORIGINS` | 允许访问 ConvoSketchpad HTTP API/SSE 的精确浏览器 Origin，以逗号分隔 |
| `TRUSTED_PROXIES` | 可以信任其 `X-Forwarded-*` Header 的直接上游代理 IP |
| `CONVOSKETCHPAD_ALLOW_INSECURE=true` | 显式允许未认证的远程浏览器访问；只供 Custom 模式二次确认后使用 |

`ALLOWED_ORIGINS` 仍然必要，但它只保护 ConvoSketchpad 自身，不再参与 Gateway 握手。

每个值必须是浏览器地址栏实际使用的 `http://host[:port]` 或 `https://host[:port]` Origin。不能包含用户名、密码、路径、查询、Fragment、`null` 或 `*` 通配符。默认端口会被规范化，重复值会合并；无效值会阻止服务启动。

setup 的内置模式写入规则如下：

| 模式 | `HOST` | `ALLOWED_ORIGINS` | 认证 |
|---|---|---|---|
| Local | `127.0.0.1` | 不写入 | 保留本机设置 |
| LAN | `0.0.0.0` | 检测或输入的准确 LAN HTTP Origin | 强制启用 |
| Tailscale IP | 当前 tailnet IPv4 | 当前 tailnet IPv4 HTTP Origin | 强制启用 |
| Tailscale Serve | `127.0.0.1` | 确实代理到当前端口的 Serve HTTPS Origin | 强制启用 |
| Custom | 用户输入 | 用户输入的精确 Origin | 远程时默认启用；关闭需要二次确认 |

Custom 的“HTTPS reverse proxy”还会询问额外可信代理 IP。回环代理已经默认可信，无需重复填写。只有可信代理的 `X-Forwarded-Proto: https` 才会触发 Secure Cookie 和 HSTS；来自其他客户端的伪造 Header 会被忽略。

生产服务并非始终只能绑定 loopback：

- 生产模式由 Hono 同时提供前端静态文件和 API；LAN 或 Tailscale IP 直连要求入口绑定可达接口。
- 同机反向代理或 Tailscale Serve 应优先绑定 `127.0.0.1`。
- 反向代理位于另一台机器时，入口必须绑定该代理可达的私网接口，并用防火墙限制来源。
- 开发模式仍使用相同的 `HOST` / `PORT` 作为浏览器入口；Hono 内部监听固定为 loopback，无需也不能单独配置。

以下变量已经废弃并被忽略；启动时会警告，重跑 setup 会在备份旧 `.env` 后不再写出它们：

- `CONVOSKETCHPAD_PUBLIC_ORIGIN`
- `WS_ALLOWED_HOSTS`
- `CSP_CONNECT_EXTRA`
- `SSL_PORT`
- `VITE_DISABLE_HTTPS`
- `VITE_HOST`
- `VITE_PORT`

旧 `.env` 中的 `GATEWAY_URL`、`GATEWAY_TOKEN` 和 `CONVOSKETCHPAD_GATEWAY_TIMEZONE` 仅由 setup 读取并原子改写为 `OPENCLAW_*` 名称；开发期使用过的 `AGENT_BACKENDS` 会由 setup 或目标版本迁移器一次性改写为 `AGENT_RUNTIMES`。正式运行只读取新名称，不保留别名或双写；旧、新名称同时存在且值冲突时迁移会明确失败。

浏览器 CSP 的 `connect-src` 固定为 `'self'`，因为产品通信只有同源 HTTP/SSE。

## 存储

| 环境变量 | 默认值 | 用途 |
|---|---|---|
| `CONVOSKETCHPAD_DATA_DIR` | `~/.convosketchpad` | 远程 Gateway 设备身份与设备 Token、更新器状态；相对路径以项目根目录为基准 |

Canvas SQLite 位于 `database/canvas.sqlite`，附件和 Artifact 位于项目内 `artifacts/`。二者必须一起备份。

ConvoSketchpad 不检查 Codex/Claude 本地凭据，也不调用它们的 CLI。

更新器按“进程环境 → 项目 `.env` → 默认值”解析 `CONVOSKETCHPAD_DATA_DIR`，因此锁、正式回滚账本、快照和最近运行记录始终位于同一个配置目录。`~/...` 会展开为当前用户目录；相对路径按项目根目录解析。

setup 写入 Agent 运行端配置后，只在受管服务的工作目录和启动命令属于当前安装、且服务状态明确时自动迁移数据库：运行中先停服并复核离线，创建一次性 SQLite 快照，成功重启后验证状态、健康接口和版本；原本停止的服务保持停止。迁移或服务恢复失败时，只有再次确认离线后才恢复数据库与 `.env`；无法确认离线时不覆盖 SQLite，并保留快照供人工处理。Setup 不会改写更新器的正式 `last-good.json`。没有匹配服务管理器时只保存配置并推迟迁移，服务下次手动启动会在监听前幂等检查 Schema。setup 与更新器的显式迁移超时统一为 60 分钟。

## 受管认证

| 环境变量 | 默认值 | 用途 |
|---|---|---|
| `CONVOSKETCHPAD_AUTH` | `false` | 启用受管用户登录 |
| `CONVOSKETCHPAD_SESSION_SECRET` | 启动时生成 | Cookie 签名密钥；生产环境应固定 |
| `CONVOSKETCHPAD_SESSION_TTL` | 30 天 | Session 有效期，毫秒 |
| `CONVOSKETCHPAD_AUTH_MAX_FAILURES` | `3` | 窗口内允许的登录失败次数 |
| `CONVOSKETCHPAD_AUTH_FAILURE_WINDOW` | 30 分钟 | 失败统计窗口 |
| `CONVOSKETCHPAD_AUTH_LOCKOUT` | 30 分钟 | 锁定时长 |

未启用认证时，只要监听地址或已配置 Origin 允许远程访问，服务都会拒绝启动，除非显式设置不安全覆盖。所有内置远程模式都会启用受管认证；只有 Custom 模式允许在二次确认后写入该覆盖。
