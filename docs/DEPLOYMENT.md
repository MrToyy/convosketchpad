# 部署

所有拓扑都遵循同一链条：

```text
浏览器 → ConvoSketchpad HTTP/SSE → Agent Runtime（当前为 OpenClaw Gateway）
```

浏览器不需要访问 Runtime 地址。只需保证 ConvoSketchpad 宿主机能访问已配置的 Agent Runtime。

ConvoSketchpad 自身只监听 HTTP。图中的 HTTPS 均由反向代理或 Tailscale Serve 终止。

<a id="local-same-machine"></a>

## 同机部署

```text
浏览器（localhost）→ ConvoSketchpad（127.0.0.1:3080）→ Gateway（127.0.0.1:18789）
```

运行 `npm run setup`，选择仅本机访问。检查：

```bash
openclaw gateway status
curl -fsS http://127.0.0.1:18789/health
curl -fsS http://127.0.0.1:3080/health
```

loopback Gateway 使用共享 `OPENCLAW_GATEWAY_TOKEN` 直连，不需要设备配对。旧 `gateway-auth.json` 中即使存在该地址的设备 Token，也会被忽略。

<a id="local-ui-with-a-remote-gateway"></a>

## 本机界面连接远程 Gateway

```text
浏览器 → 本机 ConvoSketchpad → 私有网络 → 远程 Gateway
```

建议通过 Tailscale、WireGuard 或 SSH 隧道连接 Gateway。配置：

```bash
AGENT_RUNTIMES=openclaw
OPENCLAW_GATEWAY_URL=https://gateway.example.internal
OPENCLAW_GATEWAY_TOKEN=<token>
OPENCLAW_GATEWAY_TIMEZONE=Asia/Shanghai
```

不需要 `WS_ALLOWED_HOSTS`，也不需要把浏览器 Origin 加入 OpenClaw `gateway.controlUi.allowedOrigins`。setup 会发起 ConvoSketchpad backend 设备请求；在 Gateway 宿主机审批，并在 repair 后确认最终 Token 只有 read/write/approvals。共享 `OPENCLAW_GATEWAY_TOKEN` 仍需保留，用于 Gateway HTTP 接口和配对 bootstrap。

<a id="remote-browser-access"></a>

## 远程浏览器访问

```text
远程浏览器 → HTTPS 反向代理 → ConvoSketchpad → Gateway
```

最低配置：

```bash
HOST=0.0.0.0
CONVOSKETCHPAD_AUTH=true
CONVOSKETCHPAD_SESSION_SECRET=<stable-random-secret>
ALLOWED_ORIGINS=https://canvas.example.com
OPENCLAW_GATEWAY_URL=http://127.0.0.1:18789
```

通过 Caddy、Nginx、Traefik 或 Tailscale Serve 提供 HTTPS；反向代理到 `http://127.0.0.1:3080` 或私网 HTTP 地址。只有在确实可信时才把与 ConvoSketchpad 直接建立 TCP 连接的代理 IP 配入 `TRUSTED_PROXIES`。`ALLOWED_ORIGINS` 必须是浏览器地址栏中的精确 Origin，只控制 ConvoSketchpad API/SSE。

可信代理传入 `X-Forwarded-Proto: https` 时，登录 Cookie 会设置 `Secure`，生产环境响应会设置 HSTS。未列入 `TRUSTED_PROXIES` 的客户端无法用该 Header 伪造安全连接。

<a id="tailscale"></a>

## Tailscale

优先使用 Tailscale Serve，让 ConvoSketchpad 保持监听回环地址：

```bash
tailscale serve --bg http://127.0.0.1:3080
```

向导只采用 Serve 状态中确实代理到当前 ConvoSketchpad HTTP 端口的 HTTPS Origin，并写入 `ALLOWED_ORIGINS`。无需修改 Gateway Control UI Origin。

## 验证与备份

依次验证登录、Agent 发现、Canvas 创建、文本发送、附件、Fork 和 Artifact 下载。刷新正在排队或 `ambiguous` 的发送时，Graph 应保持对应 Branch 锁定。

必须一起备份：

- `database/canvas.sqlite`
- `artifacts/`

## 安全基线

- 不需要远程访问时保持 `HOST=127.0.0.1`。
- 监听 `0.0.0.0` 前启用受管认证。
- 在本机以外访问时使用 HTTPS。
- Gateway 只暴露给 ConvoSketchpad 宿主机或私有网络。
- 严格限制 `ALLOWED_ORIGINS` 和 `TRUSTED_PROXIES`。
