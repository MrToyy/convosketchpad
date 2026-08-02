# 安全

## 信任模型

ConvoSketchpad 用户可以调用所选 OpenClaw Agent 已获准的工具和工作区权限。受管用户隔离 Canvas 数据和持久化文件，但不会创建独立 Gateway 沙箱。

## 浏览器与 Gateway 边界

- 浏览器只访问同源 HTTP/SSE，不连接 OpenClaw WebSocket。
- 浏览器不接收或保存 Gateway URL、Gateway Token、设备私钥或设备 Token。
- CSP `connect-src` 为 `'self'`。
- 服务端使用唯一 `gateway-client/backend/node` 连接；loopback 使用共享 Token且不发送设备身份，远程连接只申请 `operator.read`、`operator.write`、`operator.approvals` 的设备权限。
- Node 连接不发送浏览器 Origin；`gateway.controlUi.allowedOrigins` 不属于 ConvoSketchpad 配置。

远程 Gateway 的设备凭据以 `0600` 权限保存在 `CONVOSKETCHPAD_DATA_DIR`，配对状态由 OpenClaw 管理；loopback 模式会忽略这些凭据。设备 Token 只用于远程 WebSocket，Gateway HTTP 路由只接收共享 `OPENCLAW_GATEWAY_TOKEN`。最终保存的 ConvoSketchpad 设备 Token 必须精确为 read/write/approvals；已有远程设备缺少 `operator.approvals` 时必须重新配对或完成 scope upgrade，不能继续使用权限不足的旧 Token。

统一审批只持久化已净化的类别、摘要、风险、权限、选择、作用域和结果；原始环境、凭据与 Backend Approval Handle 不返回浏览器。所有审批写入口执行所有者检查、选择/权限子集验证、到期检查和并发 claim；持久授权必须由 UI 二次确认。Backend 返回结果未知时保持 `unconfirmed`，不得自动重复授权。

OpenClaw 审批请求和结果会先由 Adapter 归一化，再进入通用持久事件 Inbox。持久化摘要不得包含命令环境、凭据或其他未经筛选的原始审批数据。本阶段没有向浏览器公开审批读取或处理 API，审批决定只能通过服务端 `resolveApproval` Port 返回 Backend。

## 受管用户

- 用户只通过本机 CLI 创建。
- 数据库只保存 scrypt Hash。
- Cookie 为 HttpOnly、SameSite=Strict；直连 HTTPS 或可信代理确认的 HTTPS 会额外设置 Secure。
- 轮换、禁用和启用会撤销旧 Session。
- 每个 HTTP 请求以及 SSE 心跳都会重新检查用户状态。
- 登录失败按真实客户端 IP 限流。

只有来自 `TRUSTED_PROXIES` 中直接上游 IP 的 `X-Forwarded-For` 和 `X-Forwarded-Proto` 会被信任。生产环境只在请求已被确认使用 HTTPS 时发送 HSTS。

## Canvas 完整性

所有 Canvas、Branch、Interaction、附件、Artifact 和发送预留都按所有者解析。发送接口只接受登记过的附件 ID，不信任前端提供的路径、MIME 或大小。

Agent、预期头节点和“每 Branch 一个预留”在服务端事务中检查。结果不确定的发送保持锁定，并只用同一幂等键重试；不能通过超时伪造失败或成功。

## 文件处理

- 每次上传最多四个文件，单文件最大 20 MiB。
- 原始附件先持久化且保持不可变；后端在受限像素数、超时和并发队列内生成投递图与缩略图。
- 媒体派生按所有者 Canvas 和真实内容哈希隔离；外部 HTTP Artifact 不会为生成缩略图而被主动抓取。
- Artifact 持久化上限为 25 MiB，失败会降级而不丢弃文本。
- 路径经过规范化、`realpath` 和允许根目录检查。
- Gateway 凭据只发送给配置的 Gateway。

## 卸载边界

`uninstall.sh` 只注销经路径校验、且明确指向当前安装目录的 launchd 或 systemd 服务。它不会删除程序目录、`.env`、Canvas SQLite、附件、Artifact、`CONVOSKETCHPAD_DATA_DIR`、更新器快照或外部服务状态。

同名服务如果指向其他安装，或 macOS `start.sh` 不再完全匹配安装器生成模板，脚本会保留对应文件并输出警告。OpenClaw 设备撤销和 Tailscale Serve 清理必须由操作者通过各自原生工具显式完成，卸载脚本不会推断这些共享外部资源的所有权。

## 部署检查

1. 远程访问通过反向代理或 Tailscale Serve 使用 HTTPS；不要依赖应用内置 TLS。
2. 启用受管认证并设置稳定的 Session Secret。
3. 限制 `ALLOWED_ORIGINS` 和可信代理。
4. 保护 `.env`、`CONVOSKETCHPAD_DATA_DIR`、`database/` 和 `artifacts/`。
5. 只授予 Agent 必要的工具和文件权限。
6. 同时备份 SQLite 与 Artifact。
