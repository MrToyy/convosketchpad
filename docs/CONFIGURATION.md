# 配置

推荐运行 `npm run setup` 使用配置向导。只有手动配置时才需要复制 `.env.example`。

## 核心配置

| 环境变量 | 默认值 | 用途 |
|---|---|---|
| `GATEWAY_URL` | `http://127.0.0.1:18789` | OpenClaw Gateway HTTP Origin |
| `GATEWAY_TOKEN` | 空 | 服务端 RPC 和可信 WS 注入使用的 Gateway Token |
| `CONVOSKETCHPAD_GATEWAY_TIMEZONE` | 应用宿主机时区 | Gateway 每日重置 Session 使用的 IANA 时区；远程 Gateway 应显式设置 |
| `PORT` | `3080` | HTTP 端口 |
| `HOST` | `127.0.0.1` | 监听地址 |
| `SSL_PORT` | `3443` | 存在证书时使用的可选内置 TLS 端口 |
| `CONVOSKETCHPAD_PUBLIC_ORIGIN` | 空 | Gateway 握手使用的浏览器访问 Origin |
| `OPENCLAW_CONFIG_PATH` | 未设置 | 可选的 OpenClaw CLI 实例选择器；ConvoSketchpad 只会透传，不会打开该文件 |

`CONVOSKETCHPAD_GATEWAY_TIMEZONE` 必须是 `Asia/Shanghai`、`America/New_York` 等 IANA 时区名称。显式设置无效值时服务会停止启动，因为错误时区可能导致 Canvas 错过 OpenClaw 每日重置后的首次恢复发送。

开发模式下，`npm run dev` 会同时启动两个进程，并在 `VITE_PORT`（默认 `3080`）提供唯一的浏览器入口。监听模式服务端在配置的 `PORT` 与前端端口不同时使用该端口；否则自动使用下一个端口，默认是 `3081`。Vite 会把 `/api`、`/health` 和 `/ws` 代理到服务端。客户端变更使用 Vite HMR；服务端变更会自动重启服务端进程，因此内存状态和活动 WebSocket 连接会重新创建。

## OpenClaw 负责的 Gateway 配置

ConvoSketchpad 不需要 OpenClaw 工具 Allowlist 或管理员权限。如果浏览器 Origin 不在 Gateway 默认回环地址范围内，ConvoSketchpad 只会修改一个 OpenClaw 配置项：

```text
gateway.controlUi.allowedOrigins
```

`npm run setup` 使用 `openclaw config get` 读取该值，合并所需 Origin，使用 `openclaw config patch --dry-run` 校验完整变更，然后通过 `openclaw config patch` 应用。Gateway 端口和 Token 发现也通过 `openclaw config get` 完成。ConvoSketchpad 绝不会直接读写 `openclaw.json`、`devices/paired.json` 或 `identity/device-auth.json`。

设备注册使用 OpenClaw 原生待审批请求流程：

```bash
openclaw devices list --json
openclaw devices approve <requestId>
```

交互式配置会展示准确匹配的请求，并在审批前询问用户。`--defaults` 只创建或检查待审批请求，最终审批留给运维人员。ConvoSketchpad 只申请 `operator.read` 和 `operator.write`。

使用远程 Gateway 时，配置向导不会修改本机 OpenClaw 配置。请在 Gateway 宿主机上执行向导输出的 `openclaw config` 和 `openclaw devices` 命令。

审批完成后，OpenClaw 返回的设备 Token 按 Gateway URL 保存到 `$CONVOSKETCHPAD_DATA_DIR/gateway-auth.json`，默认路径为 `~/.convosketchpad/gateway-auth.json`，权限模式为 `0600`。服务端把 connect 响应转发到浏览器前会移除设备 Token 字段。

## ConvoSketchpad 自有存储

| 环境变量 | 默认值 | 用途 |
|---|---|---|
| `CONVOSKETCHPAD_DATA_DIR` | `~/.convosketchpad` | 设备身份、Gateway 设备 Token 和更新器状态 |

Canvas SQLite 和持久化 Artifact 有意保存在项目内的 `database/` 和 `artifacts/` 路径。上传内容会在 `chat.send` 前持久化到这里；核心用量汇总来自 OpenClaw `usage.cost`，Provider 配额窗口来自 `usage.status`。Provider 和消息明细通过 `sessions.usage` 尽力刷新；该较慢查询失败时不会导致用量接口整体不可用。

ConvoSketchpad 不检查 Codex 或 Claude 的本地凭据，也不会调用它们的 CLI。已经废弃的工作区、Session 和用量路径环境变量会被忽略，并在启动时输出警告。

## 受管认证

| 环境变量 | 默认值 | 用途 |
|---|---|---|
| `CONVOSKETCHPAD_AUTH` | `false` | 启用受管用户登录 |
| `CONVOSKETCHPAD_SESSION_SECRET` | 进程启动时生成 | Cookie 签名密钥；生产环境应设置稳定值以确保重启后会话继续有效 |
| `CONVOSKETCHPAD_SESSION_TTL` | 30 天 | 会话有效期，单位为毫秒 |
| `CONVOSKETCHPAD_AUTH_MAX_FAILURES` | `3` | 滚动时间窗口内允许的登录失败次数 |
| `CONVOSKETCHPAD_AUTH_FAILURE_WINDOW` | 30 分钟 | 统计登录失败的时间窗口，单位为毫秒 |
| `CONVOSKETCHPAD_AUTH_LOCKOUT` | 30 分钟 | 锁定时长，单位为毫秒 |

用户管理：

```bash
npm run users -- add <name> [--token <token>]
npm run users -- list
npm run users -- rotate <name> [--token <token>]
npm run users -- disable <name>
npm run users -- enable <name>
```

## 网络策略

| 环境变量 | 用途 |
|---|---|
| `CONVOSKETCHPAD_ALLOW_INSECURE=true` | 显式允许在未启用受管认证时监听 `0.0.0.0`；正常使用不安全 |
| `WS_ALLOWED_HOSTS` | 允许的额外 Gateway 目标主机，以逗号分隔 |
| `ALLOWED_ORIGINS` | 允许的浏览器 Origin，以逗号分隔 |
| `CSP_CONNECT_EXTRA` | 额外的 `connect-src` Origin |
| `TRUSTED_PROXIES` | 可以信任其转发客户端 Header 的反向代理 |

除非显式启用不安全覆盖，未启用认证时 ConvoSketchpad 会拒绝以 `HOST=0.0.0.0` 启动。所有非本机部署都应优先使用 TLS 和受管认证。
