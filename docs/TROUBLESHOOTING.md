# 故障排查

## Gateway 连接失败

检查两个服务和配置的 Token：

```bash
openclaw gateway status
curl -sS http://127.0.0.1:18789/health
curl -sS http://127.0.0.1:3080/health
```

Gateway 重新注册或轮换 Token 后，重新运行 `npm run setup`。使用远程 Gateway 时，将其主机名加入 `WS_ALLOWED_HOSTS`。

如果错误与配对或权限有关，使用 OpenClaw 原生恢复流程：

```bash
openclaw devices list --json
openclaw devices approve <requestId>
```

不要在 `paired.json` 和 `device-auth.json` 之间复制 Token。如果已保存的设备 Token 发生漂移，使用 `openclaw devices rotate/remove` 后重新审批。

## `origin not allowed`

在 OpenClaw `gateway.controlUi.allowedOrigins` 中使用准确的浏览器 Origin。`npm run setup` 只会通过带 dry run 的 `openclaw config get/patch` 修改该值。远程访问时，在 `CONVOSKETCHPAD_PUBLIC_ORIGIN` 和 `ALLOWED_ORIGINS` 中设置同一个 Origin，并在 Gateway 宿主机上运行 OpenClaw 配置命令。

## Agent 列表无法加载，或创建 Canvas 返回 502

创建 Canvas 时会调用 Gateway `agents.list`。确认服务端 `GATEWAY_TOKEN`、Gateway 连通性、设备审批和所需权限均正常。Agent 目录不可用时，服务端不会猜测 Agent 并创建 Canvas。

## 无法修改 Agent

首次发送进入准备阶段后，选择器会锁定。这是预期行为；如需使用其他 Agent，请创建新 Canvas。如果另一个标签页已经发送，而当前界面仍显示可编辑选择器，`prepare-send` 会以 `409 agent_changed` 拒绝过期 Agent，并重新加载 Graph。

## Interaction 一直处于生成中

Gateway 终止事件只作为提示，协调过程会等待权威对话记录。重新加载 Graph 会重新调度未完成记录；重启服务端也会继续处理候选项。检查服务端日志中的 Gateway 对话记录或 Artifact 错误。

## Branch 提示 Session 恢复

OpenClaw 已经替换或移除了稳定 Branch key 后面的 Session。下一次发送会携带 ConvoSketchpad 的规范快照。这是预期恢复行为，不会修改旧 Interaction。

## 附件发送失败

- 每次发送最多四个文件。
- 每个文件最大 20 MiB。
- 大图会针对模型输入进行压缩。
- 完整 Base64 WebSocket Frame 必须小于 Gateway 声明的 `maxPayload`，因此实际总上限可能低于四倍的 20 MiB。
- 上传文件归 Canvas 所有，并通过 `chat.send.attachments` 发送，不要求共享 Agent 工作区。

## Artifact 不可用

文本完成和 Artifact 持久化相互独立。延迟到达或无法读取的 Artifact 会被标记为降级并重试。确认 `artifacts/` 可写，且 Gateway 声明 `artifacts.list/download`。旧版相对路径还需要 `agents.workspace.get`；旧版绝对路径必须在本机真实存在，并位于原生报告的工作区根目录或系统临时目录之下。

## 登录被锁定

默认策略是在 30 分钟内失败三次后，按客户端 IP 锁定 30 分钟。检查 `CONVOSKETCHPAD_AUTH_*` 和 `TRUSTED_PROXIES`。重启会清除内存中的失败记录，但不能替代对 Token 的妥善保护。

## 拒绝远程启动

监听 `HOST=0.0.0.0` 要求 `CONVOSKETCHPAD_AUTH=true`。请启用认证和 HTTPS。`CONVOSKETCHPAD_ALLOW_INSECURE=true` 只用于明确的不安全覆盖场景。

## 构建或测试失败

```bash
npm install
npm test -- --run
npx tsc --noEmit -p config/tsconfig.app.json
npx tsc --noEmit -p config/tsconfig.server.json
npm run build
```

需要 Node.js 22.13 或更高版本。
