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
3. **安装与构建**：安装 npm 依赖并生成生产构建。
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
--access-mode <local|network|custom|tailscale-ip|tailscale-serve>
```

## 配置向导

可以随时重新运行向导：

```bash
cd ~/convosketchpad
npm run setup
```

向导配置以下内容：

1. **Gateway 连接**：URL、Token、连通性、远程 Gateway 时区、原生 Control UI Origin 和原生设备配对。
2. **访问方式**：localhost、局域网/自定义、Tailscale IP 或 Tailscale Serve。
3. **认证**：非本机访问使用的受管用户登录和会话设置。

Gateway 变更使用受支持的 `openclaw config` 和 `openclaw devices` 命令。配置向导不会自行生成或直接编辑 OpenClaw 配对记录。远程 Gateway 的配置必须在 Gateway 宿主机上执行。

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

发生故障时，记录准确的失败步骤、已执行检查、已做变更，以及仍需运维人员处理的操作。
