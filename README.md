<div id="top" align="center">
  <img src="./public/convosketchpad-logo-1024.png" alt="ConvoSketchpad Logo" width="144" />

# ConvoSketchpad

**让想法自由分支**

**A branching AI workspace for visual thinkers**

[![GitHub stars](https://img.shields.io/github/stars/MrToyy/convosketchpad?style=for-the-badge&logo=github&label=Star%20ConvoSketchpad&color=0f172a)](https://github.com/MrToyy/convosketchpad)
[![MIT License](https://img.shields.io/badge/license-MIT-blue?style=for-the-badge)](LICENSE)

[中文](#中文) · [English ↓](#english)
</div>

<a id="中文"></a>

## 中文

ConvoSketchpad 把 AI 工作过程组织成可缩放、可分支的空间画布。你可以从多个方向开始对话、继续当前分支，或从任意已完成的交互创建新分支，并把提示词、回复、附件和生成的产物保留在同一条上下文链路中。

> [!IMPORTANT]
> ConvoSketchpad **不是独立的 Agent 运行环境**，也不负责运行模型、工具或 Agent。使用它必须连接到可访问的 [OpenClaw](https://github.com/openclaw/openclaw) Gateway；Agent、工具调用、Session 和对话记录均由 OpenClaw 提供。

### 核心能力

- 在一个可平移、缩放的 Canvas 中创建多个根分支。
- 以仅追加方式组织交互，明确区分“继续”和“分支”。
- 每个 Canvas 绑定一个 OpenClaw Agent；首次发送开始后即锁定。
- 新 Canvas 自动使用 Gateway 的默认 Agent。
- 持久化保存用户附件和生成的 Artifact，并按用户隔离。
- 当 OpenClaw 替换或移除分支 Session 时，通过规范快照恢复上下文。
- 支持可选的受管用户登录、会话撤销、限流和 Canvas 隔离。
- 前端界面支持中文和英文，并默认使用中文。

```text
Canvas
├── 根分支 A：交互 1 ── 交互 2 ── 交互 3
│                           └────── 分支 B
└── 根分支 C：交互 4 ── 交互 5
```

### 运行关系

```text
React Canvas ── WebSocket ── OpenClaw Gateway（Agent、执行、对话记录）
      │
      └──────── HTTP ─────── ConvoSketchpad 服务端 ── SQLite + Artifact 存储
```

OpenClaw 负责 Agent 执行和 Session 对话记录；ConvoSketchpad 负责 Canvas 拓扑与布局、发送预留、恢复元数据、用户隔离，以及附件和 Artifact 的持久化副本。上传、下载和远程工作区信息通过 OpenClaw 原生能力传递，不要求 ConvoSketchpad 直接访问 OpenClaw 的本地工作区目录。

### 环境要求

- macOS 或 Linux
- Node.js 22.13 或更高版本
- npm 和 Git
- 已安装并运行的 OpenClaw，以及可访问的 Gateway

### 快速安装

推荐使用安装脚本：

```bash
curl -fsSL https://raw.githubusercontent.com/MrToyy/convosketchpad/main/install.sh | bash
```

安装脚本默认解析最新的官方稳定 Release。开发版安装需要显式指定 `--branch main`。完整参数请参阅[安装文档](docs/INSTALL.md)。

手动安装：

```bash
git clone https://github.com/MrToyy/convosketchpad.git
cd convosketchpad
npm install
npm run setup
npm run build
npm start
```

`npm run setup` 会配置 Gateway 连接、访问方式和可选的受管用户认证。ConvoSketchpad 依赖可访问的 OpenClaw Gateway，安装或启动本项目不会替代 OpenClaw。

### 开发调试

```bash
npm install
npm run setup
npm run dev
```

`npm run dev` 会同时启动 Vite 客户端和监听模式服务端，只需打开终端中标记为 `Frontend (open in browser)` 的地址：

- `VITE_PORT`：浏览器访问的前端端口，默认 `3080`。
- `PORT`：仅供开发代理使用的内部服务端端口；默认使用前端端口的下一个端口，即 `3081`。
- `/api`、`/health` 和 `/ws` 会由 Vite 代理到内部服务端。
- React 客户端支持 HMR；服务端代码变更后由 `tsx watch` 自动重启。
- 如果 `PORT` 与 `VITE_PORT` 相同，开发脚本会自动为服务端选择相邻端口。

自定义开发地址：

```bash
VITE_HOST=0.0.0.0 VITE_PORT=4000 PORT=4001 npm run dev
```

此时浏览器入口是 `http://localhost:4000`；局域网设备使用开发机 IP 和前端端口 `4000`。端口 `4001` 是内部服务端端口，不是对外的前端入口。修改环境变量后需要重新启动开发进程。

### 常用命令

| 命令 | 用途 |
|---|---|
| `npm run dev` | 同时启动支持热更新的客户端和服务端 |
| `npm run setup` | 运行安装与连接配置向导 |
| `npm run build` | 构建生产版客户端、服务端和 CLI |
| `npm start` | 启动已构建的生产服务 |
| `npm run prod` | 构建并立即启动生产服务 |
| `npm run users -- <command>` | 管理受管用户 |
| `npm run update` | 更新已安装的 ConvoSketchpad |
| `npm test -- --run` | 运行一次完整测试 |
| `npm run lint` | 执行代码检查 |

### 核心配置

复制 `.env.example` 或运行 `npm run setup` 生成 `.env`。以下仅列出最常用的配置：

| 环境变量 | 默认值 | 用途 |
|---|---|---|
| `GATEWAY_URL` | `http://127.0.0.1:18789` | OpenClaw Gateway 地址 |
| `GATEWAY_TOKEN` | 空 | 服务端 RPC 和可信 WebSocket 连接使用的 Gateway Token |
| `HOST` | `127.0.0.1` | 生产服务监听地址 |
| `PORT` | `3080` | 生产服务端口；开发时为内部服务端端口 |
| `VITE_HOST` | `127.0.0.1` | 开发模式前端监听地址 |
| `VITE_PORT` | `3080` | 开发模式浏览器入口端口 |
| `CONVOSKETCHPAD_AUTH` | `false` | 是否启用受管用户认证 |
| `CONVOSKETCHPAD_DATA_DIR` | `~/.convosketchpad` | ConvoSketchpad 自有状态目录 |

对外提供服务前，请启用受管用户认证和 HTTPS，并仔细配置 Origin、代理与网络访问策略。完整说明请参阅[配置文档](docs/CONFIGURATION.md)、[部署文档](docs/DEPLOYMENT.md)和[安全文档](docs/SECURITY.md)。

### 文档

产品与架构：

- [产品目标与原则](docs/PRODUCT.md)
- [架构、Session 与运行时数据流](docs/ARCHITECTURE.md)
- [Canvas 功能索引](docs/canvas/README.md)

安装与运维：

- [文档总索引](docs/README.md)
- [安装](docs/INSTALL.md)
- [部署](docs/DEPLOYMENT.md)
- [配置](docs/CONFIGURATION.md)
- [安全](docs/SECURITY.md)
- [故障排查](docs/TROUBLESHOOTING.md)
- [更新](docs/UPDATING.md)
- [HTTP API](docs/API.md)

维护者参考：

- [Canvas 功能与代码地图](docs/canvas/CANVAS-CODE-MAP.md)
- [认证功能与代码地图](docs/canvas/AUTH-CODE-MAP.md)
- [Git 与 Upstream 同步工作流](docs/canvas/GIT-WORKFLOW.md)

### Upstream 与许可证

ConvoSketchpad 源自 [OpenClaw Nerve](https://github.com/daggerhashimoto/openclaw-nerve)，保留其 MIT 许可证和 Git 历史，目前作为独立代码库维护。这里的“独立维护”仅指项目开发与发布；运行时仍依赖 OpenClaw。

本项目采用 [MIT License](LICENSE)。

<p align="right"><a href="#top">返回顶部 ↑</a> · <a href="#english">跳转到 English ↓</a></p>

---

<a id="english"></a>

## English

ConvoSketchpad organizes AI work as a spatial, zoomable, branching Canvas. Start in multiple directions, continue the current branch, or fork any completed Interaction while keeping prompts, responses, attachments, and generated Artifacts in the same context chain.

> [!IMPORTANT]
> ConvoSketchpad is **not a standalone Agent runtime** and does not run models, tools, or Agents by itself. It requires a reachable [OpenClaw](https://github.com/openclaw/openclaw) Gateway. OpenClaw provides the Agents, tool execution, Sessions, and transcripts.

### Core capabilities

- Create multiple root branches on one pan-and-zoom Canvas.
- Organize append-only Interactions with explicit Continue and Fork semantics.
- Bind one OpenClaw Agent to each Canvas and lock it when the first send begins.
- Use the Gateway's default Agent automatically for new Canvases.
- Keep durable, owner-scoped copies of user attachments and generated Artifacts.
- Recover context from canonical snapshots when OpenClaw replaces or removes a Branch Session.
- Optionally enable managed-user login, session revocation, rate limiting, and Canvas isolation.
- Use the frontend in Chinese or English, with Chinese as the default.

```text
Canvas
├── Root A: Interaction 1 ── Interaction 2 ── Interaction 3
│                                  └────────── Fork B
└── Root C: Interaction 4 ── Interaction 5
```

### Runtime relationship

```text
React Canvas ── WebSocket ── OpenClaw Gateway (Agents, execution, transcripts)
      │
      └──────── HTTP ─────── ConvoSketchpad server ── SQLite + Artifact store
```

OpenClaw owns Agent execution and Session transcripts. ConvoSketchpad owns Canvas topology and layout, send reservations, recovery metadata, user isolation, and durable copies of attachments and Artifacts. Uploads, downloads, and remote workspace information use OpenClaw's native capabilities; ConvoSketchpad does not require direct access to OpenClaw's local workspace directories.

### Requirements

- macOS or Linux
- Node.js 22.13 or newer
- npm and Git
- An installed and running OpenClaw with a reachable Gateway

### Quick install

The install script is recommended:

```bash
curl -fsSL https://raw.githubusercontent.com/MrToyy/convosketchpad/main/install.sh | bash
```

By default, the installer resolves the latest official stable Release. Use `--branch main` explicitly for a development install. See the [installation guide](docs/INSTALL.md) for all options.

Manual install:

```bash
git clone https://github.com/MrToyy/convosketchpad.git
cd convosketchpad
npm install
npm run setup
npm run build
npm start
```

`npm run setup` configures the Gateway connection, access mode, and optional managed-user authentication. ConvoSketchpad requires a reachable OpenClaw Gateway; installing or starting this project does not replace OpenClaw.

### Development

```bash
npm install
npm run setup
npm run dev
```

`npm run dev` starts the Vite client and watch-mode server together. Open only the URL labeled `Frontend (open in browser)` in the terminal:

- `VITE_PORT` is the browser-facing frontend port; its default is `3080`.
- `PORT` is the internal server port used by the development proxy; by default it uses the next port, `3081`.
- Vite proxies `/api`, `/health`, and `/ws` to the internal server.
- The React client supports HMR; `tsx watch` restarts the server after server-side code changes.
- If `PORT` matches `VITE_PORT`, the development script automatically selects an adjacent server port.

To customize the development address:

```bash
VITE_HOST=0.0.0.0 VITE_PORT=4000 PORT=4001 npm run dev
```

The browser entrypoint is then `http://localhost:4000`; devices on the LAN use the development machine's IP address and frontend port `4000`. Port `4001` is the internal server port, not the public frontend entrypoint. Restart the development process after changing environment variables.

### Common commands

| Command | Purpose |
|---|---|
| `npm run dev` | Start the hot-reloading client and server together |
| `npm run setup` | Run the installation and connection setup wizard |
| `npm run build` | Build the production client, server, and CLI |
| `npm start` | Start an existing production build |
| `npm run prod` | Build and immediately start the production service |
| `npm run users -- <command>` | Manage local managed users |
| `npm run update` | Update an installed ConvoSketchpad |
| `npm test -- --run` | Run the full test suite once |
| `npm run lint` | Run code checks |

### Core configuration

Copy `.env.example` or run `npm run setup` to generate `.env`. The most commonly used settings are:

| Environment variable | Default | Purpose |
|---|---|---|
| `GATEWAY_URL` | `http://127.0.0.1:18789` | OpenClaw Gateway address |
| `GATEWAY_TOKEN` | empty | Gateway Token for server RPC and trusted WebSocket connections |
| `HOST` | `127.0.0.1` | Production server bind address |
| `PORT` | `3080` | Production server port; internal server port during development |
| `VITE_HOST` | `127.0.0.1` | Development frontend bind address |
| `VITE_PORT` | `3080` | Development browser entrypoint port |
| `CONVOSKETCHPAD_AUTH` | `false` | Enable managed-user authentication |
| `CONVOSKETCHPAD_DATA_DIR` | `~/.convosketchpad` | ConvoSketchpad-owned state directory |

Before exposing the service to a network, enable managed-user authentication and HTTPS, then configure origins, proxies, and network policy carefully. See [Configuration](docs/CONFIGURATION.md), [Deployment](docs/DEPLOYMENT.md), and [Security](docs/SECURITY.md).

### Documentation

Product and architecture:

- [Product goals and principles](docs/PRODUCT.md)
- [Architecture, Sessions, and runtime data flow](docs/ARCHITECTURE.md)
- [Canvas feature index](docs/canvas/README.md)

Installation and operations:

- [Documentation index](docs/README.md)
- [Installation](docs/INSTALL.md)
- [Deployment](docs/DEPLOYMENT.md)
- [Configuration](docs/CONFIGURATION.md)
- [Security](docs/SECURITY.md)
- [Troubleshooting](docs/TROUBLESHOOTING.md)
- [Updating](docs/UPDATING.md)
- [HTTP API](docs/API.md)

Maintainer references:

- [Canvas feature and code map](docs/canvas/CANVAS-CODE-MAP.md)
- [Authentication feature and code map](docs/canvas/AUTH-CODE-MAP.md)
- [Git and upstream synchronization workflow](docs/canvas/GIT-WORKFLOW.md)

### Upstream and license

ConvoSketchpad is derived from [OpenClaw Nerve](https://github.com/daggerhashimoto/openclaw-nerve), retains its MIT license and Git history, and is maintained as an independent codebase. “Independently maintained” refers only to project development and releases; the runtime still depends on OpenClaw.

This project is available under the [MIT License](LICENSE).

<p align="right"><a href="#top">Back to top ↑</a> · <a href="#中文">中文 ↑</a></p>
