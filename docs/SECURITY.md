# 安全

## 信任模型

ConvoSketchpad 是 OpenClaw Gateway 的高权限界面。能够使用 Canvas 的用户，可以要求所选 Agent 使用该 Gateway 授予的任意工具和工作区权限。受管用户隔离只会分离 ConvoSketchpad Canvas 数据行和持久化文件，不会创建彼此独立的 Gateway 沙箱。

## 本机安全默认值

安全默认值为 `HOST=127.0.0.1`。监听 `0.0.0.0` 必须启用 `CONVOSKETCHPAD_AUTH=true`，除非通过 `CONVOSKETCHPAD_ALLOW_INSECURE=true` 显式绕过启动拒绝。不要在不可信网络中使用该覆盖配置。

## 受管用户

- 用户只能通过本机 CLI 创建。
- 数据库只保存 scrypt Hash，不保存明文 Token。
- 登录成功后返回 HttpOnly、SameSite=Strict 的签名 Cookie。
- 轮换、禁用和启用用户会递增 `token_version`，使旧 Cookie 失效。
- HTTP 请求和 WebSocket 活动都会重新检查当前用户状态。
- 登录失败按客户端 IP 限流，并会触发临时锁定。

生产环境必须设置稳定、随机的 `CONVOSKETCHPAD_SESSION_SECRET`。只为自己控制的代理配置 `TRUSTED_PROXIES`。

## Gateway 凭据

服务端可以把 `GATEWAY_TOKEN` 注入可信的本机或已认证 WebSocket 握手，使浏览器不必持久化该 Token。外部未认证客户端绝不会获得服务端 Token 注入。将 `WS_ALLOWED_HOSTS`、`ALLOWED_ORIGINS` 和 `CSP_CONNECT_EXTRA` 严格限制在必要范围内。

ConvoSketchpad 使用一个持久化 Ed25519 设备身份，并且只向 OpenClaw 申请 `operator.read` 和 `operator.write`。配对审批和配对状态仍由 OpenClaw 管理；ConvoSketchpad 不会编辑 OpenClaw 配对文件。签发的设备 Token 以 `0600` 权限保存在服务端的 `~/.convosketchpad/gateway-auth.json` 或 `CONVOSKETCHPAD_DATA_DIR` 中，并在 Gateway 响应到达浏览器前被移除。

## Canvas 所有权

每个 Canvas、Branch、Interaction、附件、Artifact 和发送资源都通过已认证所有者解析。请求其他所有者的资源时返回 404。

只有首次发送前允许修改 Canvas Agent。服务端使用 `agents.list` 校验 Agent，在事务中重写草稿 Session key，并要求 prepare-send 携带 `expectedAgentId`，以拒绝过期客户端产生的竞态请求。

## 文件处理

- Canvas 层每次发送最多允许四个文件，每个文件最大 20 MiB。
- 上传内容直接写入按所有者隔离的 Canvas 存储，不会写入 OpenClaw 工作区。
- OpenClaw Artifact 字节通过 `artifacts.download` 请求；不存在通用的宿主机路径 HTTP 路由。
- 显式绝对路径兼容能力仅限于原生 Agent 工作区根目录或系统临时目录。
- 路径会经过规范化和 `realpath` 解析；符号链接逃逸出允许根目录时会被拒绝。
- 读取相对工作区路径要求 Gateway 声明 `agents.workspace.get`。
- Gateway 凭据只发送给同 Gateway Artifact URL，绝不会发送到外部 Origin。

## 部署检查清单

1. 远程访问使用 HTTPS。
2. 启用受管认证并设置 `CONVOSKETCHPAD_SESSION_SECRET`。
3. 严格限制 Origin、WS 目标主机和可信代理。
4. 只向 OpenClaw Agent 授予用户确实需要的工具和文件系统权限。
5. 保护 `.env`、`.convosketchpad/`、`database/`、`artifacts/` 和 OpenClaw 配置目录。
6. 同时备份 SQLite 与 Artifact。
