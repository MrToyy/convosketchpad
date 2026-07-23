# Nerve 运行机制、数据边界与页面功能

本文面向准备在 Nerve 基础上继续开发的维护者，集中回答以下问题：

- Nerve 前端、Nerve 后端与 OpenClaw Gateway 各自负责什么；
- 聊天会话如何读取、发送和持久化；
- Chat 页面与 Session 的关系；
- 如何在不复用飞书、Telegram 等 channel 会话的情况下聊天；
- 新功能应该把状态放在哪一层。

本文结论来自现有文档和当前实现，重点代码入口列在文末。

> Canvas 定制功能的当前实现入口见 [`docs/canvas` 索引](canvas/README.md)。

## 1. 一句话理解 Nerve

Nerve 不是新的 Agent Runtime，也不是独立的聊天服务。它是 OpenClaw 前面的本地优先 Web Cockpit：

- 浏览器提供 Chat、Sessions、Workspace、语音和监控 UI；
- Nerve Node 服务提供安全边界、本地文件能力、Cron/Session 编排、语音服务和 Gateway 代理；
- OpenClaw Gateway 仍负责 Agent 会话、模型调用、工具执行、事件流和聊天 transcript。

因此，Nerve 可以扩展操作界面和编排能力，但核心聊天运行时仍属于 OpenClaw。

## 2. 总体拓扑

### 2.1 生产模式

```text
Browser
  │
  │ HTTP / REST / SSE / WebSocket
  ▼
Nerve Server :3080
  ├─ 提供 dist/ React 静态文件
  ├─ /api/*：本地能力或 Gateway HTTP/RPC 适配
  ├─ /api/events：Nerve 自己的 SSE 事件
  └─ /ws：OpenClaw WebSocket 安全代理
          │
          ▼
OpenClaw Gateway :18789
  ├─ sessions.list / sessions.patch / sessions.reset
  ├─ chat.send / chat.history / chat.abort
  ├─ Agent、模型和工具执行
  ├─ channel 适配
  └─ session metadata 与 transcript 持久化
```

### 2.2 开发模式

```text
Browser :3080
  ▼
Vite Dev Server :3080
  ├─ HMR 和前端资源
  ├─ /api/* ─┐
  └─ /ws ────┴─ proxy → Nerve Dev Server :3081 → OpenClaw :18789
```

开发时必须同时启动两部分：

```bash
# Terminal 1：后端
PORT=3081 npm run dev:server

# Terminal 2：前端
npm run dev
```

## 3. 前端负责什么

前端位于 `src/`，技术栈是 React、TypeScript、Vite 和 Tailwind CSS。

主要职责：

1. **页面与交互**
   - Chat 消息列表、输入框、流式响应、工具调用、Markdown、图片、语音；
   - Sessions 树、会话切换、重命名、删除、重置、创建 Agent/Subagent；
   - Workspace、Memory、Config、Skills、Crons；
   - Settings、主题、字体、TTS/STT 配置和日志面板。

2. **Gateway 实时客户端**
   - 浏览器通过 Nerve 的 `/ws` 代理连接 OpenClaw Gateway；
   - 使用 Gateway RPC 调用 `sessions.*`、`chat.*` 等方法；
   - 订阅 `chat`、`agent`、`cron` 等 Gateway 事件并更新 UI。

3. **前端临时状态**
   - React Context 管理 Gateway、Session、Chat、Settings 状态；
   - 当前消息窗口、stream buffer、生成状态主要存在内存中；
   - 连接偏好、界面设置和当前 Canvas/Chat 视图等部分偏好存在浏览器 `localStorage`。

前端不会直接调用模型供应商，也不会自己写入 OpenClaw 聊天 transcript。

### 3.1 四个核心 Context

| Context | 作用 |
|---|---|
| `GatewayContext` | WebSocket 连接、RPC、事件分发、Gateway 状态 |
| `SessionContext` | `sessions.list`、当前 session、会话树和会话操作 |
| `ChatContext` | 当前 session 的历史、发送、stream、恢复、TTS |
| `SettingsContext` | UI、音频和显示设置，部分持久化到 `localStorage` |

## 4. 后端负责什么

后端位于 `server/`，使用 Hono 和 Node.js。

### 4.1 HTTP 服务与安全边界

- 生产模式下提供前端静态文件；
- 提供 `/api/*` REST API；
- 可选 Nerve 登录认证、签名 Cookie、CORS、安全响应头、限流和 body size 限制；
- Gateway Token 默认只保留在服务端 `.env`，不会直接交给可信浏览器流程。

### 4.2 WebSocket Gateway 代理

浏览器实际连接的是 Nerve：

```text
Browser → ws://<nerve>/ws?target=ws://127.0.0.1:18789/ws
        → Nerve ws-proxy
        → OpenClaw Gateway
```

代理会：

- 校验目标主机 allowlist；
- 校验 Nerve 登录状态和 Origin；
- 为可信连接注入 Gateway Token；
- 注入持久化的 Ed25519 device identity；
- 在握手完成后双向转发 Gateway 消息。

### 4.3 Nerve 自有能力

- Workspace 文件、Memory、Skills、Crons 的 REST 适配；
- TTS、STT、Whisper 模型管理；
- 文件监听并通过 `/api/events` 推送 SSE；
- Token usage 扫描、Agent log 和服务健康检查。

后端不替代 OpenClaw 的 Agent Runtime。它可能读取 OpenClaw transcript 做统计或媒体恢复，但普通 Chat 历史仍通过 Gateway `chat.history` 获取。

## 5. 聊天会话是如何运行的

### 5.1 发送流程

```text
Chat Input
  → ChatContext.handleSend()
  → 浏览器先插入 optimistic user bubble
  → Gateway RPC chat.send
       sessionKey = 当前选中的 session
       message = 用户消息
       deliver = false
       idempotencyKey = 唯一键
  → OpenClaw Agent 执行
  → Gateway 推送 chat / agent stream events
  → ChatContext 合并 delta、tool 和 final 消息
```

`deliver:false` 非常重要：从 Nerve 发出的消息默认不要求 OpenClaw 把回答投递到外部 channel。

### 5.2 历史读取流程

切换 Session 或 WebSocket 连接成功后：

```text
SessionContext.currentSession 改变
  → ChatContext 清空当前内存窗口
  → Gateway RPC chat.history({ sessionKey, limit: 500 })
  → OpenClaw 从对应 transcript 返回消息
  → Nerve 前端过滤内部通知、整理 tool blocks、图片和 Markdown
```

也就是说，Chat 页面显示的是“当前选中 OpenClaw session”的历史，而不是 Nerve 自己维护的一份聊天副本。

### 5.3 `sessionKey` 决定上下文

常见 key 形态：

| 类型 | 示例 | 含义 |
|---|---|---|
| Top-level root | `agent:main:main` | 不绑定外部 channel 的根会话 |
| 其他 top-level agent | `agent:reviewer:main` | 独立 Agent 的根会话 |
| Subagent | `agent:main:subagent:<id>` | 根 Agent 下的子会话 |
| Channel direct | `agent:main:feishu:direct:<peer>` | 飞书私聊对应上下文 |
| Channel group | `agent:main:feishu:group:<chat>` | 飞书群聊对应上下文 |
| Cron | `agent:main:cron:<job>` | 定时任务会话或 run |

选择不同 session 后，Chat 页面发送和加载历史所使用的 `sessionKey` 会一起变化。

## 6. 会话记录存在哪里

### 6.1 OpenClaw 会话 metadata 与 transcript

默认每个 Agent 使用自己的 sessions 目录：

```text
~/.openclaw/agents/<agentId>/sessions/
  ├─ sessions.json
  ├─ <sessionId-1>.jsonl
  ├─ <sessionId-2>.jsonl
  └─ <sessionId>.jsonl.deleted.*
```

- `sessions.json`：`sessionKey → session metadata` 的索引，包含 `sessionId`、label、更新时间、model、token 等摘要；
- `<sessionId>.jsonl`：真正的逐行 transcript；可能包含 message、model change、thinking level change、tool 结果和图片 block；
- `.jsonl.deleted.*`：被清理或删除后的 transcript，部分 Nerve 读取路径仍会尝试查找它。

主 Agent 的默认目录是：

```text
~/.openclaw/agents/main/sessions/
```

Nerve 的 `SESSIONS_DIR` 默认指向这个目录，也可以通过 `.env` 覆盖。其他 Agent 通常解析到：

```text
~/.openclaw/agents/<agentId>/sessions/
```

### 6.2 谁负责写 transcript

OpenClaw Gateway/Runtime 负责创建和更新 `sessions.json` 与 `.jsonl`。Nerve 的普通 Chat 流程通过 Gateway 读写会话，不直接向 transcript 追加消息。

Nerve 后端会直接读取 transcript 的场景包括：

- 扫描 token/cost；
- 恢复某些 session 实际使用的 model/thinking；
- 从历史 message block 恢复图片；
- 补充隐藏的 cron session metadata。

### 6.3 三种容易混淆的 Session

| 名称 | 含义 | 存储方式 |
|---|---|---|
| OpenClaw Agent Session | 聊天/Agent 执行上下文 | `sessions.json` + `.jsonl` transcript |
| Nerve 登录 Session | 保护 Nerve 页面和 API 的单用户登录态 | 浏览器 HttpOnly 签名 Cookie；服务端无 session 数据库 |

### 6.4 其他相关持久化位置

| 数据 | 默认位置 | 所有者 |
|---|---|---|
| Device identity | `~/.nerve/device-identity.json` | Nerve |
| Token usage high-water mark | `~/.openclaw/token-usage.json` | Nerve 辅助统计 |
| Agent activity log | `<project>/agent-log.json` | Nerve |
| Memory | `~/.openclaw/workspace*/MEMORY.md` 与 `memory/` | OpenClaw workspace |
| Nerve 配置与密钥 | `<project>/.env` | Nerve |
| UI 偏好/连接偏好 | Browser `localStorage` | Nerve frontend |

## 7. Chat 页面是什么

顶部 `Chat` 是统一聊天视图，不是某个固定 channel 的页面。

它由以下部分共同组成：

- ChatPanel：当前 session 的消息、工具调用和输入框；
- Sessions：选择当前 `sessionKey`；
- Workspace/File Browser：当前根 Agent 对应的文件和 Memory；
- GatewayContext：与 OpenClaw 的实时连接。

因此 Chat 页面的含义是：

> 对当前 Sessions 面板中选中的 OpenClaw session 进行浏览和交互。

切到 Channel direct、群聊、Subagent 或 root session，看到的上下文都会不同。

Chat 页面的 Reset 调用 `sessions.reset`，会重置当前 OpenClaw session，而不是只清空浏览器 DOM。


## 8. 如何脱离 OpenClaw channel 聊天

先区分两个目标。

### 8.1 只是不希望回答发回飞书/Telegram

Nerve Chat 当前发送 `chat.send` 时固定使用：

```ts
deliver: false
```

因此，从 Nerve 输入框发出的消息默认不会要求 OpenClaw 把回答投递到外部 channel。

但是，如果当前选中的是 `agent:main:feishu:direct:*` 等 session，你仍然在复用该 channel session 的历史和上下文，只是本次回答不向外投递。

### 8.2 希望上下文也与 channel 完全分离

正确入口仍然是顶部 **Chat**，但 Sessions 中应选择：

```text
agent:<agentId>:main
```

对于默认主 Agent，就是：

```text
agent:main:main
```

完整路径：

```text
Top Bar: Chat
  → Sessions: 选择 <Agent name> (main)
  → ChatPanel 输入消息
  → chat.send(deliver:false, sessionKey=agent:<id>:main)
  → 独立 root transcript
```

不要选择带有以下片段的 session：

```text
:feishu:direct:
:feishu:group:
:telegram:direct:
:channel:
```

### 8.3 Root session 不存在时

OpenClaw 可能只有 channel 产生的 session，而还没有 `agent:main:main` transcript。当前 Nerve 的 Sessions 列表不会凭空合成一个不存在的 root row，而是以 Gateway `sessions.list` 为准。

现有 UI 中：

- `Create session → New agent` 可以创建一个新的 top-level agent 和独立 root conversation；
- `Create session → New subagent` 会创建附属于已有 root 的短期子会话；
- 对“为已存在的 main Agent 创建第一个 `agent:main:main` webchat”没有单独、明确的入口。

这是后续改造值得优先处理的产品缺口。比较自然的方案是在 Chat/Sessions 中增加 **New root chat**：

1. 选择已有 Agent；
2. 生成或确认 `agent:<id>:main`；
3. 用首条 `chat.send(..., deliver:false)` 初始化；
4. 切换到该 session。

## 9. 对后续新功能开发的建议

开发新功能前先判断它的事实来源：

| 问题 | 推荐归属 |
|---|---|
| 属于模型对话、工具调用、Agent 执行上下文吗？ | OpenClaw session/transcript |
| 属于 Nerve 自己的工作流或 UI 扩展吗？ | Nerve backend store/API |
| 只是显示偏好或临时交互状态吗？ | Frontend state/localStorage |
| 需要读取本机 workspace 吗？ | Nerve backend filesystem API，注意远程 Gateway 场景 |
| 需要实时 Agent 事件吗？ | Gateway WebSocket event |
| 需要本地文件变化通知吗？ | Nerve SSE `/api/events` |

特别注意：

1. 不要在前端另存一份聊天 transcript，除非明确要做数据镜像；
2. 不要把 `sessionKey` 当作普通 UI id，它决定真正的上下文和 transcript；
3. channel-free 与 `deliver:false` 不是同一件事：前者还要求使用 root session；
4. 同机部署才能完整访问 Workspace；远程 Gateway 只有部分文件 RPC fallback。

## 10. 关键代码地图

### 前端

| 路径 | 作用 |
|---|---|
| `src/App.tsx` | Canvas/Chat 总布局和 view mode |
| `src/contexts/GatewayContext.tsx` | Gateway RPC 与事件总线 |
| `src/contexts/SessionContext.tsx` | Session 列表、选择和创建 |
| `src/contexts/ChatContext.tsx` | Chat 状态、stream、发送和恢复 |
| `src/hooks/useWebSocket.ts` | WebSocket 协议与 `mode: webchat` 握手 |
| `src/features/chat/operations/sendMessage.ts` | `chat.send` 与 `deliver:false` |
| `src/features/chat/operations/loadHistory.ts` | `chat.history` 与消息转换 |
| `src/features/sessions/sessionKeys.ts` | root/channel/subagent key 分类 |

### 后端

| 路径 | 作用 |
|---|---|
| `server/index.ts` / `server/app.ts` | 服务入口和 REST app |
| `server/lib/ws-proxy.ts` | Gateway WebSocket 代理、Token/device 注入 |
| `server/lib/gateway-rpc.ts` | 后端到 Gateway 的持久 RPC 连接 |
| `server/routes/sessions.ts` | transcript 辅助读取和 Subagent spawn |
| `server/routes/tokens.ts` | transcript token/cost 扫描 |
| `server/lib/config.ts` | 路径和运行配置 |

### 现有文档

- `docs/ARCHITECTURE.md`：完整模块和系统架构；
- `docs/API.md`：REST API；
- `docs/SECURITY.md`：认证、Token 注入和 WebSocket 安全；
- `docs/CONFIGURATION.md`：环境变量和默认路径；
- `docs/AGENT-MARKERS.md`：TTS、Chart marker；
- `docs/DEPLOYMENT-A.md` / `B.md` / `C.md`：部署拓扑和 locality 差异。
