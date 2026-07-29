# 安装 ConvoSketchpad

ConvoSketchpad 的目标是“让想法自由分支”。它支持 macOS 和 Linux，需要 Node.js 22.13 或更高版本，并依赖可访问的 OpenClaw Gateway。

## 推荐安装方式

```bash
curl -fsSL https://raw.githubusercontent.com/MrToyy/convosketchpad/main/install.sh | bash
```

默认安装目录为 `~/convosketchpad`，可以通过 `CONVOSKETCHPAD_INSTALL_DIR` 或 `--dir <path>` 修改。

安装器默认解析最新的官方稳定 GitHub Release。GitHub 不可用时不会回退到 `main`。`--version` 只接受 `MrToyy/convosketchpad` 发布的官方稳定 Release；开发版或自定义仓库安装必须显式使用 `--branch main`。

安装器依次执行五个阶段：

1. **前置检查**：检查 Node.js、npm、Git、OpenClaw 和 Gateway 可用性。
2. **下载**：校验并安装所选稳定 Release，或显式指定的开发分支；不会丢弃已有脏工作区。
3. **安装与构建**：安装 npm 依赖（包括当前平台的 Sharp 图片处理组件）并生成生产构建。
4. **配置**：除非使用 `--skip-setup`，否则运行配置向导。
5. **服务**：配置或重启受支持的系统服务；不使用服务管理器时输出直接启动命令。

使用 `./install.sh --help` 查看权威参数列表。常用参数包括：

```text
--dir <path>
--version <vX.Y.Z>
--branch <name>
--repo <url>
--skip-setup
--dry-run
--gateway-token <token>
--gateway-url <url>
--access-mode <local|network|tailscale-ip|tailscale-serve>
```

## 配置向导

可以随时重新运行向导：

```bash
cd ~/convosketchpad
npm run setup
```

向导配置以下内容：

1. **Gateway 连接**：URL、共享 Token、连通性、远程 Gateway 时区，以及仅远程 Gateway 所需的 backend 设备配对。
2. **访问方式**：localhost、局域网、Tailscale IP、Tailscale Serve 或交互式 Custom。
3. **认证**：非本机访问使用的受管用户登录和会话设置。

loopback Gateway 使用 OpenClaw 官方支持的共享 Token backend 直连，不发送设备身份，也不会产生配对请求。远程 Gateway 才使用 OpenClaw 原生设备配对；向导不直接编辑配对记录，也不修改 `gateway.controlUi.allowedOrigins`。

- 远程 setup 发起只申请 `operator.read`、`operator.write` 的 ConvoSketchpad request；
- 审批必须在 Gateway 宿主机完成，非交互 setup 会输出后续命令；
- repair 若继承了更宽 scope，宿主机操作者应将最终设备 Token 降为精确 read/write。

访问模式的具体行为：

- **Local**：只监听回环地址，不设置远程 Origin。
- **LAN**：监听所有接口，写入实际 LAN IP 的 HTTP Origin，并启用受管认证。
- **Tailscale IP**：直接绑定当前 tailnet IPv4，写入对应 HTTP Origin，并启用受管认证。
- **Tailscale Serve**：只监听回环地址，只采用确实代理到当前端口的 Serve HTTPS Origin，并启用受管认证。
- **Custom**：逐项询问 ConvoSketchpad 入口端口、入口监听地址、Direct HTTP 或 HTTPS reverse proxy、精确浏览器 Origin 和可信代理 IP。远程访问默认启用认证；只有再次确认风险后才允许关闭。

Custom 依赖交互问答，不能与 `--defaults --access-mode custom` 一起使用。

生产和开发统一使用 `HOST` / `PORT` 作为浏览器入口。开发模式内部的 Hono 端口由 `npm run dev` 自动选择并绑定到 loopback，不需要配置 `VITE_HOST` 或 `VITE_PORT`。

非交互式本机配置：

```bash
npm run setup -- --defaults
```

使用远程 Gateway 时，还应提供其 IANA 时区，使 ConvoSketchpad 能够预测每日 Session 重置：

```bash
npm run setup -- --defaults --gateway-timezone Asia/Shanghai
```

## 手动安装

```bash
git clone https://github.com/MrToyy/convosketchpad.git ~/convosketchpad
cd ~/convosketchpad
npm install
npm run setup
npm run build
npm start
```

最小本机 `.env`：

```bash
PORT=3080
HOST=127.0.0.1
GATEWAY_URL=http://127.0.0.1:18789
GATEWAY_TOKEN=<detected-token>
```

ConvoSketchpad 不提供内置 TLS。远程 HTTPS 由反向代理或 Tailscale Serve 终止，后端仍使用 HTTP。

如果安装器已经配置系统服务，请使用该服务，不要重复启动前台进程：

```bash
# Linux
sudo systemctl restart convosketchpad.service

# macOS
launchctl stop com.mrtoyy.convosketchpad || true
launchctl start com.mrtoyy.convosketchpad
```

## 现有安装

替换现有安装前应先检查其状态。优先采用正常更新、重新运行配置向导、重启服务或定向修复。未经明确确认，绝不要删除、重置或覆盖已有脏工作区。

ConvoSketchpad 依赖可访问的 OpenClaw Gateway。应尽量复用现有 Gateway。安装 OpenClaw、修改远程 Gateway 配置或扩大网络暴露范围，都必须由运维人员明确决定。

## 选择部署方式

根据浏览器、ConvoSketchpad 服务端和 Gateway 的运行位置选择拓扑：

- [浏览器、服务端与 Gateway 位于同一台机器](DEPLOYMENT.md#local-same-machine)
- [本机界面连接远程 Gateway](DEPLOYMENT.md#local-ui-with-a-remote-gateway)
- [远程浏览器访问](DEPLOYMENT.md#remote-browser-access)
- [Tailscale](DEPLOYMENT.md#tailscale)

## 受管用户

可通过网络访问的安装应启用 `CONVOSKETCHPAD_AUTH=true`，设置稳定的 `CONVOSKETCHPAD_SESSION_SECRET`，并创建第一个用户：

```bash
npm run users -- add <name>
```

CLI 还支持列出、轮换、禁用和启用用户。详见[配置](CONFIGURATION.md)与[安全](SECURITY.md)。

## 验证

只有在目标进程、Gateway 连接、访问方式和认证行为均正常后，才能认为安装完成。

```bash
openclaw gateway status
curl -fsS http://127.0.0.1:18789/health
curl -fsS http://127.0.0.1:3080/health
```

根据所选拓扑调整 URL，然后打开 ConvoSketchpad，确认能够发现 Agent、创建 Canvas，并发送一个简单 Interaction。

从旧版本首次启动时，服务会在开始监听前完成数据库迁移和历史图片缩略图回填；已有图片较多时启动时间会相应
增加。受管更新器会在停服阶段执行该步骤。不要同时启动另一份服务或手工修改 `artifacts/`。

发生故障时，记录准确的失败步骤、已执行检查、已做变更，以及仍需运维人员处理的操作。
