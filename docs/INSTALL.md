# 安装 ConvoSketchpad

ConvoSketchpad 的目标是“让想法自由分支”。它支持 macOS 和 Linux，需要 Node.js 22.22.2 或更高版本，并依赖至少一个可访问的 Agent Runtime：OpenClaw Gateway 或本地 Codex App Server。

## 推荐安装方式

```bash
curl -fsSL https://raw.githubusercontent.com/MrToyy/convosketchpad/main/install.sh | bash
```

默认安装目录为 `~/convosketchpad`，可以通过 `CONVOSKETCHPAD_INSTALL_DIR` 或 `--dir <path>` 修改。

安装器默认解析最新的官方稳定 GitHub Release。GitHub 不可用时不会回退到 `main`。`--version` 只接受 `MrToyy/convosketchpad` 发布的官方稳定 Release；开发版或自定义仓库安装必须显式使用 `--branch main`。安装器只负责新安装和同版本修复注册：已有稳定版升级到不同 Release 必须从安装目录运行 `npm run update`，以便代码、`.env` 和 SQLite 在同一快照边界回滚。

安装器依次执行五个阶段：

1. **前置检查**：严格检查 Node.js 22.22.2、npm 和 Git；Runtime 探测统一留给后续 setup，安装器不读取任何 Runtime 配置或凭据。
2. **下载**：校验并安装所选稳定 Release，或显式指定的开发分支；已有脏工作区一律拒绝覆盖。
3. **安装与构建**：安装 npm 依赖（包括当前平台的 Sharp 图片处理组件）并生成生产构建。
4. **配置**：除非使用 `--skip-setup`，否则一律运行统一配置向导；安装器不直接生成 `.env`。
5. **服务**：配置或重启受支持的系统服务；Linux 系统级 systemd 单元通过 `sudo` 完成安装和重启，任一步失败都会让安装器以失败退出，不会留下“已停服但显示安装成功”的状态。

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

`--skip-setup` 只用于复用安装目录里已经存在的 `.env`，不能与连接或访问模式参数组合；缺少 `.env` 时安装器会失败，不会根据某个具体 Runtime 隐式生成配置。`--gateway-token` 与 `--gateway-url` 是当前 OpenClaw Release 的非交互兼容参数，只作为环境覆盖传给用户选中的 OpenClaw Setup Driver，安装器本身不会读取 OpenClaw 原生配置。无终端的新安装会执行统一的 `setup --defaults`；无法安全发现或验证连接时明确失败。安装器严格拒绝未知、重复、缺值和冲突参数；`--help` 必须单独使用。

## 配置向导

可以随时重新运行向导：

```bash
cd ~/convosketchpad
npm run setup
```

向导配置以下内容：

1. **Runtime 探测与选择**：以只读方式探测本机支持的 Runtime，把已探测和未探测项分组展示，并由用户多选需要接入的项。
2. **Runtime 连接**：逐项配置所选 Runtime；OpenClaw 包括 URL、共享 Token、连通性、远程 Gateway 时区和仅远程 Gateway 所需的 backend 设备配对；Codex 包括 CLI 版本、本地 App Server 登录状态和可读写的绝对工作目录。
3. **访问方式**：localhost、局域网、Tailscale IP、Tailscale Serve 或交互式 Custom。
4. **认证**：非本机访问使用的受管用户登录和会话设置。
5. **默认 Agent**：从所有已配置 Runtime 返回的平权 Agent 目录中选择新建 Canvas 的初始 Agent。

OpenClaw CLI 发现遵循 `OPENCLAW_BIN` 显式值优先、否则直接执行 `openclaw` 的规则，不扫描特定包管理器目录。选择页只执行 `openclaw --version`，不会读取 Gateway Token；用户选中 OpenClaw 后才通过原生 `openclaw config get` 读取可用的 URL/Token 预填值。发现成功时 setup 将 PATH 中实际命中的绝对路径写入 `.env`，避免受管服务与交互 Shell 的 PATH 不同；未发现 CLI 时仍可选择 OpenClaw 并手工配置远程 Gateway。

Codex CLI 发现同样遵循 `CODEX_BIN` 优先、否则执行 `codex --version` 的规则。当前最低且已验证版本为 `0.146.0`，只支持与 ConvoSketchpad 同机的 `codex app-server`。选择 Codex 后，工作目录提示默认使用 `~/codex-convosketchpad`，直接回车或输入其他目录都会按需创建；更新配置时默认显示 `.env` 中的现有值。向导随后临时启动 App Server 检查账户；未登录时继续其他配置并提示运行 `codex login` 后重跑 setup，不会替用户登录。工作目录不得位于 `CODEX_HOME` / `~/.codex` 内。同一部署的受管用户共享宿主机 Codex 账户和该工作目录。

loopback Gateway 使用 OpenClaw 官方支持的共享 Token backend 直连，不发送设备身份，也不会产生配对请求。远程 Gateway 才使用 OpenClaw 原生设备配对；向导不直接编辑配对记录，也不修改 `gateway.controlUi.allowedOrigins`。

- 远程 setup 发起只申请 `operator.read`、`operator.write` 和 `operator.approvals` 的 ConvoSketchpad request；
- 审批必须在 Gateway 宿主机完成，非交互 setup 会输出后续命令；
- repair 若继承了更宽 scope，宿主机操作者应将最终设备 Token 降为精确 read/write/approvals。

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

交互式配置远程 Gateway 时，向导会询问其 IANA 时区，使 ConvoSketchpad 能够预测每日 Session 重置。非交互配置默认保留已有值；首次配置可通过 `OPENCLAW_GATEWAY_TIMEZONE` 环境变量提供，未提供时使用本机 IANA 时区并给出提示。setup 不提供 Runtime 专属 CLI 参数。

自动化安装可以显式指定 Runtime 和默认 Agent：

```bash
npm run setup -- --defaults --runtimes openclaw --default-agent openclaw/main
```

非交互 Codex 配置同样默认创建 `~/codex-convosketchpad`：

```bash
npm run setup -- --defaults --runtimes codex --default-agent codex/default
```

需要覆盖时可预先设置 `CODEX_WORKING_DIRECTORY=/srv/codex-workspace`。

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
AGENT_RUNTIMES=openclaw
CONVOSKETCHPAD_DEFAULT_AGENT_RUNTIME=openclaw
CONVOSKETCHPAD_DEFAULT_AGENT_PROFILE=main
OPENCLAW_GATEWAY_URL=http://127.0.0.1:18789
OPENCLAW_GATEWAY_TOKEN=<detected-token>
```

setup 只配置用户选择的 Runtime，并写入已启用 Agent 运行端列表和默认 Agent。当前 Release 支持 `openclaw` 与 `codex`；未来 Adapter 也必须进入同一发现、选择、配置和 Agent 发现流程，不能增加产品级运行端切换模式。开发期旧键 `AGENT_BACKENDS` 会在备份后一次性转换为 `AGENT_RUNTIMES`。默认 Agent 是环境配置，不改变 SQLite Schema。属于当前安装的受管服务可被明确停服时，setup 会创建一次性一致性快照并自动迁移，重启后验证健康与版本；没有匹配服务管理器时只保存配置，数据库由下次手动启动自动迁移。该临时快照不会改写更新器正式回滚账本。

ConvoSketchpad 不提供内置 TLS。远程 HTTPS 由反向代理或 Tailscale Serve 终止，后端仍使用 HTTP。

如果安装器已经配置系统服务，请使用该服务，不要重复启动前台进程：

```bash
# Linux
sudo systemctl restart convosketchpad.service

# macOS
launchctl kickstart -k "gui/$(id -u)/com.mrtoyy.convosketchpad"
```

macOS 维护数据库时不能用 `launchctl stop`，因为 plist 的 `KeepAlive` 会立即拉起进程；应先
`launchctl bootout "gui/$(id -u)/com.mrtoyy.convosketchpad"`，维护完成后再对 plist 执行 `launchctl bootstrap`。

## 现有安装

替换现有安装前应先检查其状态。跨 Release 升级使用 `npm run update`，重新配置使用 `npm run setup`；安装器仅允许同版本修复和服务重新注册。安装器不会提供覆盖脏工作区的确认旁路，必须先提交、Stash 或另行备份修改。

ConvoSketchpad 依赖至少一个可访问的 Agent Runtime。应尽量复用现有 OpenClaw Gateway 或已登录的本地 Codex 安装。安装/登录 Runtime、修改远程 Gateway 配置、选择 Codex 共享工作目录或扩大网络暴露范围，都必须由运维人员明确决定。

## 注销服务

从安装目录运行卸载脚本，可以停止并注销指向当前 ConvoSketchpad 安装的 launchd 或 systemd 服务：

```bash
# 先预览，不修改服务或文件
./uninstall.sh --dry-run

# 注销服务
./uninstall.sh

# 等价的 npm 入口
npm run uninstall
```

脚本会校验服务的工作目录和启动命令，只删除匹配当前安装的 launchd plist、systemd unit，以及未被用户修改的 macOS `start.sh`。同名但指向其他安装的服务保持不变；没有受管服务时可以安全重复运行。

卸载脚本**不会删除程序目录或用户数据**，也不会修改 Tailscale Serve、OpenClaw 配对或 Gateway 配置。结束时会列出 `.env`、Canvas SQLite、附件与 Artifact、Gateway 凭据和更新器状态的实际位置，并输出一条仅供用户自行执行的程序目录删除命令。该命令会同时删除仍在程序目录内的数据，执行前必须先核对输出路径并自行备份。

只要尚未手工删除程序目录，就可以用脚本最后输出的命令重新注册并启动受管服务。命令会固定使用当前版本并复用已有配置，不会重新运行 setup：

```bash
./install.sh --dir <当前安装目录> --version v<当前版本> --skip-setup
```

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

从旧版本首次启动时，服务会在开始监听前完成数据库结构与核心数据迁移；历史图片缩略图回填在监听后于后台继续，
缺失缩略图仍可按需生成。受管更新器会在停服阶段完成结构迁移与媒体回填。不要同时启动另一份服务或手工修改
`artifacts/`。

发生故障时，记录准确的失败步骤、已执行检查、已做变更，以及仍需运维人员处理的操作。
