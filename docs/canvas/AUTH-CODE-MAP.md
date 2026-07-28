# 认证功能与代码地图

本文覆盖 ConvoSketchpad 使用的受管用户认证。通用安全背景见[安全](../SECURITY.md)，环境变量和操作命令见[配置](../CONFIGURATION.md)。

## 功能边界与不变量

- 用户只能由本机 CLI 创建、轮换 Token、禁用或启用；登录接口绝不自动注册。
- Token 可以由管理员指定简单字符串；未指定时 CLI 才随机生成。
- 数据库只保存 scrypt Token hash，不保存或回显明文 Token。
- 用户 ID 稳定；轮换 Token 或改变启用状态会递增 `token_version`，使旧 Cookie 失效。
- 第一个受管用户原子接管 `Local User` 的已有 Canvas；后续用户互相隔离。
- `CONVOSKETCHPAD_AUTH=false` 时使用固定 Local User；启用认证后所有 Canvas 查询按 Cookie 中的 owner 过滤。
- 产品级隔离面向少量可信用户；用户仍共享同一个 OpenClaw Gateway 能力边界。
- 同一客户端 IP 默认 30 分钟内失败 3 次后锁定 30 分钟；记录只在内存中保存。
- loopback Gateway 使用共享 Token且不发送设备身份；远程 Gateway 设备身份固定请求 `operator.read` / `operator.write`，设备 Token 只保存在服务端。
- 远程配对审批和状态由 OpenClaw 原生 `devices list/approve` 管理，setup 不直接改写 OpenClaw 配对文件，也不为远程 Gateway 自动取得 admin 权限。
- 启用受管认证时不向用户暴露宿主机项目路径，并禁用设置面板中的升级入口；升级只能由宿主机管理员在终端执行。

## 按问题定位代码

| 问题或改动 | 首要文件 | 相关文件 |
|---|---|---|
| 登录页、Token 输入和错误显示 | [`src/features/auth/LoginPage.tsx`](../../src/features/auth/LoginPage.tsx) | [`LoginPage.test.tsx`](../../src/features/auth/LoginPage.test.tsx) |
| 前端登录状态、登录/登出请求 | [`src/features/auth/useAuth.ts`](../../src/features/auth/useAuth.ts) | [`AuthGate.tsx`](../../src/features/auth/AuthGate.tsx)、[`useAuth.test.ts`](../../src/features/auth/useAuth.test.ts) |
| 登录、登出、状态 API | [`server/routes/auth.ts`](../../server/routes/auth.ts) | [`server/routes/auth.test.ts`](../../server/routes/auth.test.ts) |
| 普通 HTTP API Cookie 鉴权 | [`server/middleware/auth.ts`](../../server/middleware/auth.ts) | [`server/middleware/auth.test.ts`](../../server/middleware/auth.test.ts) |
| Cookie 签名、解析、Token hash | [`server/lib/session.ts`](../../server/lib/session.ts) | [`server/lib/config.ts`](../../server/lib/config.ts) |
| Token 验证、Cookie 用户解析、状态/version 复查 | [`server/lib/managed-users.ts`](../../server/lib/managed-users.ts) | [`server/lib/managed-users.test.ts`](../../server/lib/managed-users.test.ts) |
| 用户创建、随机 Token、轮换和唯一性 | [`server/lib/user-management.ts`](../../server/lib/user-management.ts) | [`bin/convosketchpad-users.ts`](../../bin/convosketchpad-users.ts) |
| 用户表、状态、Token version、首用户接管 | [`server/lib/canvas-db.ts`](../../server/lib/canvas-db.ts) | [`server/lib/canvas-db.test.ts`](../../server/lib/canvas-db.test.ts) |
| 登录失败次数和 IP 锁定 | [`server/lib/login-failures.ts`](../../server/lib/login-failures.ts) | [`server/lib/login-failures.test.ts`](../../server/lib/login-failures.test.ts) |
| Canvas owner 解析 | [`server/lib/canvas-auth.ts`](../../server/lib/canvas-auth.ts) | [`server/routes/canvas.ts`](../../server/routes/canvas.ts) |
| Gateway/Canvas SSE 与运行中会话撤销 | [`server/routes/runtime.ts`](../../server/routes/runtime.ts)、[`server/routes/canvas.ts`](../../server/routes/canvas.ts) | [`server/middleware/auth.test.ts`](../../server/middleware/auth.test.ts) |
| Gateway 本机/远程模式、设备身份、签名和服务端 Token 存储 | [`server/lib/gateway-client-identity.ts`](../../server/lib/gateway-client-identity.ts)、[`server/lib/device-identity.ts`](../../server/lib/device-identity.ts) | [`server/lib/device-identity.test.ts`](../../server/lib/device-identity.test.ts)、[`server/lib/gateway-rpc.ts`](../../server/lib/gateway-rpc.ts) |
| OpenClaw 原生配置与配对安装流程 | [`scripts/lib/gateway-detect.ts`](../../scripts/lib/gateway-detect.ts) | [`scripts/lib/gateway-pairing.ts`](../../scripts/lib/gateway-pairing.ts)、[`scripts/setup.ts`](../../scripts/setup.ts) |
| 真实客户端 IP 和可信反向代理 | [`server/middleware/rate-limit.ts`](../../server/middleware/rate-limit.ts) | [`server/middleware/rate-limit.test.ts`](../../server/middleware/rate-limit.test.ts) |
| 精确 Origin、远程暴露与启动拒绝 | [`server/lib/browser-origin-policy.ts`](../../server/lib/browser-origin-policy.ts) | [`server/lib/config.ts`](../../server/lib/config.ts)、[`server/lib/origin-utils.ts`](../../server/lib/origin-utils.ts) |
| 认证模式下禁用升级入口与路径返回 | [`server/routes/version-check.ts`](../../server/routes/version-check.ts) | [`src/components/UpdateBadge.tsx`](../../src/components/UpdateBadge.tsx) |
| setup 提示和 `.env` 示例 | [`scripts/setup.ts`](../../scripts/setup.ts) | [`.env.example`](../../.env.example) |

## 前端认证流程

```text
AuthGate
  → useAuth 模块首次 GET /api/auth/status
  → 未登录时显示 LoginPage
  → POST /api/auth/login { token }
  → HttpOnly Cookie 写入成功
  → 渲染 App / Canvas
```

- 前端不生成用户、不生成 Token，也不把受管 Token 持久化到浏览器。
- 浏览器不保存 Gateway URL 或 Token；ConvoSketchpad 用户 Token 只用于换取产品 Session Cookie。

## 后端认证流程

### CLI 创建用户

```text
npm run users -- add Alice --token example-token
  → bin/convosketchpad-users.ts
  → user-management.ts 校验名称和 Token
  → session.ts 生成 scrypt hash
  → CanvasStore.createManagedUser
  → canvas_users
```

支持的命令：

```bash
npm run users -- add <name> [--token <token>]
npm run users -- list
npm run users -- rotate <name> [--token <token>]
npm run users -- disable <name>
npm run users -- enable <name>
```

CLI 和服务端固定使用同一项目根目录下的 `database/canvas.sqlite`。

### 登录

```text
POST /api/auth/login
  → rateLimitAuth（通用每分钟限制）
  → LoginFailureTracker（失败窗口/锁定）
  → authenticateManagedToken（读取受管用户并验证 hash）
  → createSession(sub, name, tokenVersion)
  → HttpOnly SameSite=Strict Cookie
```

未知、错误或 disabled 用户统一返回无效 Token，不会创建任何用户。

### 每次请求与即时撤销

- HTTP middleware 每次请求都用数据库中的 `status` 和 `token_version` 复查 Cookie。
- Gateway 与 Canvas SSE 建立时复查，之后每 15 秒心跳再次复查；普通 HTTP 请求逐次复查。
- Rotate、disable 和 enable 都递增 version；旧 Cookie 永久失效，用户必须重新登录。

### 防暴力破解

- [`LoginFailureTracker`](../../server/lib/login-failures.ts) 按 `getClientId` 的结果记录失败。
- 登录成功清除当前 IP 的失败记录；锁定期间返回 429 和 `Retry-After`。
- 状态在服务进程内存中，重启清空。
- Caddy/Nginx 后需要正确设置 `TRUSTED_PROXIES`，否则多个外部用户可能共享反向代理 IP 的失败额度。只有可信代理的 `X-Forwarded-Proto: https` 会让登录 Cookie 设置 Secure，并让生产环境发送 HSTS。

## 配置入口

主要配置位于 [`server/lib/config.ts`](../../server/lib/config.ts)：

```text
CONVOSKETCHPAD_AUTH
CONVOSKETCHPAD_SESSION_SECRET
CONVOSKETCHPAD_SESSION_TTL
CONVOSKETCHPAD_AUTH_MAX_FAILURES
CONVOSKETCHPAD_AUTH_FAILURE_WINDOW
CONVOSKETCHPAD_AUTH_LOCKOUT
TRUSTED_PROXIES
```

Origin、CSP、服务端 Gateway 凭据和反向代理配置继续参考[配置](../CONFIGURATION.md)与[安全](../SECURITY.md)。

## 测试入口

```bash
npm test -- --run \
  src/features/auth/LoginPage.test.tsx \
  src/features/auth/useAuth.test.ts \
  server/routes/auth.test.ts \
  server/middleware/auth.test.ts \
  server/lib/managed-users.test.ts \
  server/lib/login-failures.test.ts \
  server/routes/auth.test.ts
```

改变用户表或 owner 语义时，同时运行 Canvas DB 和 Canvas route 相关测试。
