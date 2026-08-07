# 更新 ConvoSketchpad

`0.2.0` 首次提供终端更新器；`0.2.0 → 0.3.0` 是一次性桥接升级。数据库迁移链支持从
`0.3.x` 直接迁移到当前版本，但 `0.3.0`–`0.3.2` 自带的更新器还需要按下文完成一次离线桥接。
从已经安装的 `0.4.1` 开始，可直接升级到后续受支持的稳定版本，无需依次安装中间版本。

更新器只接受 `https://github.com/MrToyy/convosketchpad` 发布的 Release。本地标签、非本仓库发行的历史标签、Fork、分支、Draft 和预发布版本都不能作为更新源。

只有关闭受管认证时，“设置 → 系统”中的 ConvoSketchpad 版本区域才会显示更新入口。受管部署必须由宿主机管理员直接在服务端终端运行更新器。

## 前置条件

工作区必须满足：

- 使用 Node.js 22.22.2 或更高版本；
- 已安装 `git` 和 `npm`；
- 工作区干净，不存在已暂存、未暂存或未跟踪文件；
- `origin` 使用官方 HTTPS 地址：

```bash
git remote set-url origin https://github.com/MrToyy/convosketchpad.git
```

即使使用 `--yes`，更新器也会拒绝脏工作区，因为切换 Release 无法安全保留未提交工作。

## 从 0.2.0 升级到 0.3.0

`0.2.0` 自带的旧更新器没有独立的数据库迁移阶段，也不会创建 SQLite 快照。升级前必须停止服务，并把
`.env`、`database/` 和 `artifacts/` 一起备份到仓库外。

### 1. 检查工作区

```bash
git status --short
```

只有没有输出时才继续；更新器不会覆盖、暂存或保留本地修改。

### 2. 停止服务

根据部署方式选择一条命令：

```bash
# systemd 系统服务
sudo systemctl stop convosketchpad.service

# systemd 用户服务
systemctl --user stop convosketchpad.service

# macOS launchd（KeepAlive Job 必须从 Domain 中卸载）
uid="$(id -u)"
launchctl bootout "gui/${uid}/com.mrtoyy.convosketchpad"
```

手动运行的服务直接在原终端中停止。

### 3. 创建仓库外备份

在 ConvoSketchpad 仓库根目录执行：

```bash
backup_dir="../convosketchpad-0.2.0-backup-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$backup_dir"
for path in .env database artifacts; do
  if [ -e "$path" ]; then
    cp -R -p "$path" "$backup_dir/"
  fi
done
echo "Backup saved to $backup_dir"
```

备份目录必须位于仓库外，否则更新器会因为工作区存在未跟踪文件而拒绝继续。

### 4. 更新并验证

固定选择 `v0.3.0`，避免这次一次性桥接跨过兼容基线：

```bash
npm run update -- --version v0.3.0
```

已停止的 systemd 服务会在升级后恢复。macOS 上面的 `bootout` 会卸载 Job，升级完成后运行：

```bash
uid="$(id -u)"
launchctl bootstrap "gui/${uid}" "$HOME/Library/LaunchAgents/com.mrtoyy.convosketchpad.plist"
```

没有服务管理器时手动运行：

```bash
npm start
```

将端口替换为实际配置后验证：

```bash
curl -fsS http://127.0.0.1:3080/health
curl -fsS http://127.0.0.1:3080/api/version
```

`0.3.0` 首次打开数据库时会在 HTTP 监听前完成事务化结构与 Interaction 数据迁移。历史媒体 Hash
和缩略图回填在监听后于后台继续；缺失缩略图仍可在首次请求时按需生成，因此不会占用 `0.2.0`
旧更新器的 60 秒健康检查窗口。系统性回填错误会写入服务日志且不记录迁移完成标识，下次启动会重试。

需要在重新开放服务前完成全部历史媒体回填时，使用保守流程：

```bash
npm run update -- --version v0.3.0 --no-restart
npm run migrate
sudo systemctl start convosketchpad.service
```

systemd 用户服务或 launchd 部署应把最后一条命令替换成对应的启动命令。这个流程同样依赖第 3 步的手动备份；
`0.2.0` 旧更新器生成的回滚状态不包含数据库副本。

## 从 0.3.0–0.3.2 升级到 0.4.1

`0.3.0`–`0.3.2` 更新器启动目标版本迁移器时不会传递“维护锁已由父更新器持有”的内部标记。因此直接运行
`npm run update` 会让目标迁移器正确拒绝重入，并报告 `Another ConvoSketchpad maintenance operation is already running`。
这不是另一个人工启动的 migrate；不要删除锁文件或结束错误的 PID。使用下面的一次性离线桥接：

1. 确认 `git status --short` 没有输出，并按前文方法把 `.env`、`database/`、`artifacts/` 备份到仓库外。
2. 停止全部 ConvoSketchpad 进程。systemd 使用 `systemctl stop`；macOS 必须使用 `launchctl bootout`，不能用会被 `KeepAlive` 自动拉起的 `launchctl stop`：

```bash
# macOS
uid="$(id -u)"
launchctl bootout "gui/${uid}/com.mrtoyy.convosketchpad"
```

3. 确认配置端口已不再监听，然后只更新代码和环境，不让旧更新器调用数据库迁移器：

```bash
npm run update -- --version v0.4.1 --no-restart
```

4. 上一个命令退出并释放维护锁后，在完全停服状态运行目标版本迁移器：

```bash
npm run migrate -- --confirm-offline
```

5. 恢复原来的服务并验证版本：

```bash
# systemd 系统服务
sudo systemctl start convosketchpad.service

# systemd 用户服务
systemctl --user start convosketchpad.service

# macOS launchd
uid="$(id -u)"
launchctl bootstrap "gui/${uid}" "$HOME/Library/LaunchAgents/com.mrtoyy.convosketchpad.plist"

curl -fsS http://127.0.0.1:3080/health
curl -fsS http://127.0.0.1:3080/api/version
```

`0.4.0` 的 systemd 安装可正常使用一条更新命令。`0.4.0` 的 macOS launchd 更新器仍使用不能可靠压制
`KeepAlive` 的旧停服方式，因此升级到 `0.4.1` 时也应使用上述 `bootout → --no-restart → migrate → bootstrap` 流程。

## 从 0.4.1 开始更新

只解析和预览目标 Release，不修改文件：

```bash
npm run update -- --dry-run
```

交互确认后执行更新：

```bash
npm run update
```

从官方 `0.4.1` 首次升级到 `0.4.2` 时，当前进程仍运行 `0.4.1` 的旧编排代码。`0.4.2` 迁移器为这一跳保留受约束的交接桥：只有当前安装的 PID-only 维护锁由迁移器直接父进程持有且仍存活时，才接受 `0.4.1` 传入的旧持锁/离线变量。普通 Shell 设置变量、错误 PID、其他安装的锁或新 JSON Lease 都不能绕过校验。该首次升级正常完成后，后续更新才完整使用以下事务流程；由于旧进程无法获得追溯式恢复能力，首次升级前仍应保留外部备份并避免强制终止或断电。

更新器会：

1. 校验工具、官方 Origin、权限和干净工作区；
2. 从官方 GitHub 仓库解析已发布的稳定 Release；
3. 创建持久更新事务，后续每个阶段都以原子状态文件落盘；
4. 检测受管服务的实际运行状态；除精确名称外还校验工作目录和启动命令属于当前安装，并等待稳定的 active/inactive，状态未知或仍在转换时失败关闭；
5. 快照当前 Commit 和 `.env`；只有当前安装的受管服务已确认停止时才创建一致 SQLite 数据库副本，并记录大小、SHA-256、外键与完整性验证结果；
6. 只把所选 Release 标签获取到内部 Ref，并验证目标是匹配的 `convosketchpad` Package；
7. 运行 `npm ci` 和 `npm run build`；
8. 通过父进程 Maintenance Lease 运行目标版本的 Agent Runtime 环境配置迁移；
9. 对可确认离线的受管服务运行目标版本数据库迁移、历史图片缩略图回填，并校验 SQLite 外键与完整性；
10. 除非使用 `--leave-stopped`，只重启更新前正在运行的服务，原本停止的服务保持停止；
11. 只对已恢复运行的服务验证 `/health` 和 `/api/version`，完成后提交事务记录。

从 `0.2.0` 升级到本版本时，数据迁移标识为 `0.2.0_to_0.3.0_v1`。它只读取现有 SQLite 数据，不依赖 Gateway 在线、Session 历史或某个特定数据库实例；迁移成功后通过 `schema_migrations` 账本保证不会在后续启动中重复扫描历史节点。

`0.3.0 → 0.3.2` 小版本维护迁移的历史标识为 `0.3.0_media_derivatives_v1`。它读取 Canvas 本地文件，为所有历史上传附件和 Agent Artifact
计算真实内容哈希，并为其中的图片生成缩略图，不修改原件。更新器允许该停服步骤最长运行 60 分钟；单个损坏或不支持的图片
会记录警告并继续，存储或数据库系统性错误会触发回滚。迁移账本存在后，后续更新和服务启动都不会重复全量扫描。
需要诊断性地复查历史媒体时，停止服务后显式运行 `npm run migrate -- --rescan-media`。

`0.4.0` 的 Agent Runtime 结构迁移标识为 `0.3.2_to_0.4.0_agent_runtime_v1`。所有 `0.3.x` 数据库会在目标版本迁移流程中补齐上述维护迁移和该结构步骤；`0.2.0` 数据库还会先完成结构桥接。Agent Runtime 结构迁移会在同一边界创建审批与通用事件 Inbox，重建核心表、写入通用 Handle 和事件数据，并按最早 Send Reservation、最早 Interaction 的优先级回填旧 Canvas 的 Agent 锁定时间；已完成通用 Schema 但缺失锁定时间的数据库会在下次迁移检查中自动修复。全新数据库直接创建当前 Schema 并记录既定三项，不先创建旧 OpenClaw Schema。校验外键与完整性后才记录完成标识。由于媒体维护代码依赖目标结构，实际执行时允许先完成目标 Schema、再处理媒体；统一清单表达的是发布边界和最终必备项，而不是数据库事务的调用先后。

截至 `0.4.2`，统一迁移清单中仅有以上三项，版本边界连续为 `0.2.0 → 0.3.0 → 0.3.2 → 0.4.0`；`0.4.1` 和 `0.4.2` 均不增加数据库迁移。结构迁移会在数据库打开时幂等执行，并删除未进入任何正式 Release 的 `0.2.0_to_single_chain_v1`、`0.3.0_to_0.4.0_agent_backend_v1` 与 `0.3.2_to_0.4.0_agent_backend_v1` 开发态账本记录；已经使用开发期 Backend Schema 的数据库会原地改名物理字段、事件表和 Handle JSON。显式迁移器随后完成媒体维护，并在最终外键和完整性检查后确认三个正式迁移 ID 全部存在，否则更新失败并触发回滚。

`npm run migrate -- --help` 只显示帮助，不打开数据库。迁移命令会在任何环境迁移或数据库操作前拒绝未知、重复参数，以及 `--env-only`、`--rescan-media` 等互斥模式的组合，避免输入错误被当成普通全量迁移执行。独立运行迁移器会取得与 setup/update 相同的维护锁；匹配当前安装的受管服务必须明确处于停止状态。没有匹配的服务管理器时，先停止所有手工进程，再显式运行 `npm run migrate -- --confirm-offline`；`--rescan-media` 可以和该确认参数组合。

如果没有检测到指向当前安装的受支持服务管理器，更新器不会假设手动启动的进程已经停止，不会打开、快照、显式迁移或失败回滚 SQLite；但不需要打开数据库的 `.env` Runtime 键迁移仍会在更新过程中完成。目标服务下次手动启动时会先自动迁移数据库。

Agent Runtime Schema 迁移会把旧 OpenClaw 顶层列转换为通用 Runtime/Profile、Conversation/Turn/Artifact Handle 和 `runtime_event_inbox`，随后物理删除旧列及 `gateway_signal_inbox`，不会双写。目标版本显式迁移器还会把 `.env` 中的 `AGENT_BACKENDS`、`GATEWAY_URL`、`GATEWAY_TOKEN` 和 `CONVOSKETCHPAD_GATEWAY_TIMEZONE` 一次性改写为对应的 `AGENT_RUNTIMES` / `OPENCLAW_*` 稳定键；运行时不读取旧键。旧、新键同时存在且值不同时会在写文件前失败，且错误不会输出 Token 值。该迁移本身不可由新版本“降级反向执行”；安全回滚依赖更新器在停服后创建的整库 SQLite 快照。不要绕过快照直接用旧版本打开已经迁移的数据库。

重新运行 `npm run setup` 会先取得和更新器相同的维护锁。只有服务配置属于当前安装且状态明确时，setup 才会停止原本运行的服务、创建一次性 SQLite 快照并迁移；重启后还会验证服务状态、健康接口和版本。迁移或服务恢复失败时，在确认服务已经离线后恢复数据库和 `.env` 并保持服务停止；若无法确认重启后的服务已停止，则不覆盖 SQLite，并保留临时快照供人工恢复。Setup 临时快照不会覆盖更新器的 `last-good.json`。没有匹配服务管理器时 setup 只保存配置并推迟数据库迁移，目标服务下次手动启动会幂等完成尚未应用的迁移。

从 `0.3.0` 开始，目标 Release 必须保留基线之后的全部迁移步骤；更新器直接安装所选目标版本，并由目标版本
按依赖补齐尚未记录在 `schema_migrations` 中的迁移。迁移 ID 发布后不得修改或删除。大型、可延后的历史数据处理
应设计成幂等维护迁移或按需生成，不应让普通服务启动长期不可用。

## CLI 参数

| 参数 | 说明 |
|---|---|
| `--version <vX.Y.Z>` | 选择已经存在的官方稳定 Release |
| `--yes`、`-y` | 跳过终端确认，但不会绕过安全检查 |
| `--dry-run` | 解析并校验目标，不修改工作区 |
| `--verbose`、`-v` | 显示详细更新操作 |
| `--rollback` | 恢复上一个确认正常的快照 |
| `--resume` | 恢复中断事务的准确源快照，然后重新执行该事务原定目标版本 |
| `--status` | 只读显示当前中断事务或最近完成事务的阶段和结果 |
| `--no-restart` | 跳过停服、数据库迁移、服务重启和健康检查，但仍迁移 `.env` Runtime 键；下次手动启动目标服务时自动迁移数据库 |
| `--leave-stopped` | 要求存在匹配的受管服务；正常停服、创建完整快照并完成环境/数据库迁移，但升级结束后保持服务停止并跳过健康检查 |
| `--help`、`-h` | 显示帮助 |

`--rollback`、`--resume` 和 `--status` 是互斥的独立模式，不能与版本、确认、预览或服务控制参数组合；`--no-restart` 和 `--leave-stopped` 也不能组合。冲突会在获取更新 Lease 或修改工作区前失败。更新 CLI 同时拒绝未知、重复、缺值参数以及把 `--help` 与其他参数组合，避免拼写错误被当成普通更新执行。

## 示例

```bash
# 先预览
npm run update -- --dry-run

# 选择一个已发布且不低于当前版本的稳定版本
npm run update -- --version v0.4.2

# 回滚到上一个快照
npm run update -- --rollback

# 查看更新事务
npm run update -- --status

# 进程被终止后，恢复源快照并重试原目标版本
npm run update -- --resume

# 完成离线迁移，但由管理员稍后启动服务
npm run update -- --leave-stopped

# 兼容桥接：完全不管理服务和数据库，更新后另行离线迁移
npm run update -- --no-restart
```

## 退出码

| 退出码 | 含义 |
|---|---|
| 0 | 成功 |
| 1 | 已是最新版本，或 CLI 参数无效 |
| 10 | 前置检查失败 |
| 20 | 官方 Release 解析失败 |
| 40 | Fetch、校验、安装或构建失败 |
| 45 | 数据库迁移或完整性校验失败 |
| 50 | 服务重启失败 |
| 60 | 健康检查失败 |
| 70 | 回滚失败 |
| 80 | 另一个 setup、migrate 或 update 维护进程持有锁 |

## 0.3.0 及以后版本的回滚与状态

切换工作区前，更新器会记录当前 Commit、Package 版本、时间戳、`.env` 是否存在及其 Hash。存在 `.env` 时，以 `0600` 权限复制。匹配当前安装的受管服务正在运行时先停服并等待稳定 `inactive`；原本停止的服务不重复停服。只有这样确认数据库离线后，才使用 SQLite `VACUUM INTO` 创建包含已提交 WAL 内容的一致副本，验证其外键与完整性并保存大小和 SHA-256。只有这种完整快照会替换正式 `last-good`；无服务管理器或 `--no-restart` 产生的部分快照只属于当前事务。状态保存在 `$CONVOSKETCHPAD_DATA_DIR/updater/`；更新命令按进程环境、项目 `.env`、默认 `~/.convosketchpad` 的顺序解析该目录，相对路径以项目根目录为基准。

如果快照完成后 Fetch、校验、构建、环境/数据库迁移、重启或健康检查失败，普通更新会切回已保存的 Commit、恢复 `.env` 并运行 `npm ci` 和 `npm run build`。只有更新前已经确认离线并保存了 SQLite 快照时才恢复数据库，且恢复前再次停止并复核受管服务。只有更新前正在运行的受管服务会在回滚后重启；原本停止的服务保持停止。没有匹配服务管理器或使用 `--no-restart` 时，失败回滚只恢复代码和 `.env`，不会替换可能正在使用的 SQLite；手工 `--rollback` 也遵循相同规则。原始附件和 Artifact 文件不在数据库迁移中改写；媒体回填只在 `artifacts/` 下增加可再生成的派生文件。

| 路径 | 用途 |
|---|---|
| `$CONVOSKETCHPAD_DATA_DIR/updater/last-good.json` | 上一个确认正常的正式更新快照 |
| `$CONVOSKETCHPAD_DATA_DIR/updater/last-run.json` | 最近一次更新结果 |
| `$CONVOSKETCHPAD_DATA_DIR/updater/active-transaction.json` | 未完成或等待恢复的更新事务；存在时普通更新拒绝覆盖 |
| `$CONVOSKETCHPAD_DATA_DIR/updater/last-transaction.json` | 最近提交或成功恢复的完整阶段记录 |
| `$CONVOSKETCHPAD_DATA_DIR/updater/snapshots/<timestamp>/.env` | 受保护的 `.env` 备份 |
| `$CONVOSKETCHPAD_DATA_DIR/updater/snapshots/<timestamp>/canvas.sqlite` | 已确认受管服务离线时创建的一致数据库备份；无匹配服务或 `--no-restart` 不创建 |
| `$CONVOSKETCHPAD_DATA_DIR/updater/update.lock` | setup、migrate 和 update 共用的进程绑定 Maintenance Lease；包含随机 nonce、PID、时间和安装目录，权限为 `0600` |

上表中的默认 `$CONVOSKETCHPAD_DATA_DIR` 是 `~/.convosketchpad`。Linux 系统级 systemd 单元的停服、重启与回滚需要管理员权限：交互终端会通过 `sudo systemctl` 请求授权，非交互执行使用 `sudo -n` 并在权限不可用时立即失败和回滚，不会等待隐藏的密码提示。

## Release 策略

`0.1.0` 有意不提供 GitHub Release。准备新 Release 时，从最新的 `main` 创建 Release 分支，更新 `package.json`、`package-lock.json` 与 `update-compatibility.json` 中的应用版本，并在 `CHANGELOG.md` 中添加日期与版本匹配的章节。若数据库结构或旧代码的可读范围变化，还要提升 `databaseSchemaEpoch` 或调整其最小/最大可读 Epoch；不得把不可读的新数据库标记为可由旧 Release 回滚。提交并推送 Release 分支，通过 Pull Request 和必需的 `build` 检查合并到受保护的 `main`，然后在 GitHub Actions 中手动运行 **Release** Workflow，并输入匹配的 `X.Y.Z`。

Workflow 会先验证 Package、Lockfile 与兼容性清单版本一致，并确认当前 Schema Epoch 落在声明的可读范围内；随后在 Ubuntu 和 macOS 上对准确的 `main` Commit 执行测试、构建、审计和启动，然后创建带注释的 `vX.Y.Z` 标签及 Draft GitHub Release。检查 Draft 说明和安装行为后，将其发布为 Latest：

```bash
gh release edit vX.Y.Z --draft=false --latest
```

安装器和更新器绝不会提供 Draft 或预发布版本。

### GitHub Release 说明

Release Workflow 会把 `CHANGELOG.md` 中与目标版本匹配的完整章节原样写入 Draft GitHub Release。开发期间先在 `## [Unreleased]` 下维护内容；准备 Release 分支时，再把它改成带发布日期的 `## [X.Y.Z] - YYYY-MM-DD`，并在文件末尾补充对应的比较链接。

Agent 准备 Release 说明时必须直接检查目标版本的实际差异、测试结果和受影响文档，不得仅根据提交标题推测用户可见行为。Release 章节使用以下结构，并删除不适用的空章节：

```markdown
## [Unreleased]

### 发布摘要

用一至两段说明本版本解决的用户问题、适合谁，以及最重要的结果。

### 当前版本亮点

- 用用户可感知的结果概括三至六项主要能力。

### 新增

- ...

### 变更

- ...

### 修复

- ...

### 安全

- ...

### 安装与升级

写明新安装前提和命令、从上一稳定版升级的命令、特殊桥接路径、备份要求及已知限制。
```

填写规则：

- `发布摘要` 和 `当前版本亮点` 面向首次看到项目的用户，先说明价值，再补充必要的协议名、迁移 ID 或内部实现。
- Patch Release 如果承担尚未正式推广的上一版本介绍，可以汇总当前稳定版本的累计亮点，但必须明确哪些是此前版本引入、哪些是本次修复，不能把旧能力伪装成本次新增。
- `新增`、`变更`、`修复` 和 `安全` 只记录已经合入目标 Commit 且经过验证的事实；不要放入计划、占位符或未完成事项。
- 安装命令必须指向正式稳定 Release。`0.2.0 → 0.3.0` 仍是固定的一次性桥接，后续 Release 说明不得暗示可以跳过。
- 相对文档链接在 GitHub Release 页面可能解析错误，Release 章节使用完整的 `https://github.com/MrToyy/convosketchpad/...` 链接。
- 正式 Draft 只能由 Release Workflow 创建。不要提前手工创建同名 Draft、标签或 Release，否则 Workflow 会因目标已存在而失败。
- 发布前逐段核对 Draft 与目标 Commit，并验证安装和升级命令；发布后再将其标记为 Latest。

从 `0.3.0` 开始，改变 Schema 或持久数据语义的 Release 还必须：

- 保留从 `0.3.0` 起的全部已发布迁移，不要求用户先安装中间版本；
- 为新迁移使用新的幂等 ID，并在成功结束时才写入 `schema_migrations`；
- 在 `update-compatibility.json` 提升 Schema Epoch，并准确声明该 Release 可读取的最小与最大 Epoch；
- 使用最老受支持版本的数据库 Fixture 验证直接迁移、重复执行、外键和 SQLite 完整性；
- 把耗时且不影响核心读取正确性的回填放入可重试维护阶段。

## 故障排查

### 无法解析稳定 Release

检查仓库 Releases 页面和 GitHub API 可用性。安装器会直接失败，不会安装未发布分支。本地标签、继承标签、Draft 和预发布版本都会被忽略；只有明确安装开发版时才使用 `--branch main`。

若错误是 HTTP 403，先查看更新器的新诊断：主限流会显示 UTC 重置时间，可为当前 Shell 设置有效的
`GITHUB_TOKEN` 或 `GH_TOKEN` 后重试；带 `Retry-After` 的临时限制应等待提示秒数；401 表示已配置 Token 被拒绝，
应刷新或取消该 Token。更新器不会输出 Token 或 GitHub 响应正文，也不会降级为未发布的 Git Tag。

### 从 0.3.2 更新时迁移器报告维护锁被占用

这是 `0.3.0`–`0.3.2` 源更新器的兼容问题，不表示用户同时运行了第二个 migrate。不要删除
`update.lock`。如果失败输出已经包含 `Checked out <旧版本 Commit>` 和 `Database snapshot restored`，代码与数据库已恢复；
后续的 `Service failed to start after rollback` 只表示旧 launchd 重启失败。保留更新前快照，确认服务完全停止后，按
“从 0.3.0–0.3.2 升级到 0.4.1”的 `--no-restart` 离线桥接继续。

若输出没有确认代码和数据库均已恢复，先保留整个 updater 快照目录并查看 `last-good.json`。只有正式
`last-good` 存在、且更新器仍能确认受管服务离线时才运行 `npm run update -- --rollback`；否则不要手工编辑 SQLite，
应依据保留的快照单独恢复。任何恢复完成后仍使用上述离线桥接，不再直接重试旧的一键更新路径。

### 工作区不干净

检查工作区，并提交、暂存到 Stash 或删除报告的修改：

```bash
git status --short
```

### 必须使用官方 Origin

```bash
git remote -v
git remote set-url origin https://github.com/MrToyy/convosketchpad.git
```

### 构建或健康检查失败

更新器会自动尝试回滚。如果必须手动恢复：

```bash
cat "${CONVOSKETCHPAD_DATA_DIR:-$HOME/.convosketchpad}/updater/last-good.json"
git checkout --force <snapshot-ref>
npm ci
npm run build
sudo systemctl restart convosketchpad.service
```

### 数据库迁移失败

不要删除 `schema_migrations` 或直接编辑 Interaction 状态。更新器会自动恢复更新前数据库；检查准确错误后，可在目标版本已构建且服务停止时手动验证：

```bash
npm run migrate
```

成功输出应按统一清单包含 `0.2.0_to_0.3.0_v1 verified`、`0.3.0_media_derivatives_v1 verified` 和 `0.3.2_to_0.4.0_agent_runtime_v1 verified`。若手动替换数据库，
请同时移除同名 `-wal`、`-shm` 文件，或优先使用更新器的 `--rollback`。
