# 更新 ConvoSketchpad

`0.2.0` 首次提供终端更新器；`0.2.0 → 0.3.0` 是一次性桥接升级。从已经安装的 `0.3.0`
开始，ConvoSketchpad 支持直接升级到任意后续受支持的稳定版本，无需依次安装中间版本。

更新器只接受 `https://github.com/MrToyy/convosketchpad` 发布的 Release。本地标签、非本仓库发行的历史标签、Fork、分支、Draft 和预发布版本都不能作为更新源。

只有关闭受管认证时，“设置 → 系统”中的 ConvoSketchpad 版本区域才会显示更新入口。受管部署必须由宿主机管理员直接在服务端终端运行更新器。

## 前置条件

工作区必须满足：

- 使用 Node.js 22 或更高版本；
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

# macOS launchd
launchctl stop com.mrtoyy.convosketchpad
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

已注册的 systemd 或 launchd 服务即使已经停止，仍会被更新器识别并在升级后启动。没有服务管理器时手动运行：

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

## 从 0.3.0 开始更新

只解析和预览目标 Release，不修改文件：

```bash
npm run update -- --dry-run
```

交互确认后执行更新：

```bash
npm run update
```

更新器会：

1. 校验工具、官方 Origin、权限和干净工作区；
2. 从官方 GitHub 仓库解析已发布的稳定 Release；
3. 检测到受管服务时，先停止准确匹配的 `convosketchpad.service` 或 `com.mrtoyy.convosketchpad`；
4. 快照当前 Commit、`.env` 和停服后的一致 SQLite 数据库副本；
5. 只把所选 Release 标签获取到内部 Ref；
6. 验证目标是否为匹配的 `convosketchpad` Package；
7. 运行 `npm ci` 和 `npm run build`；
8. 对已停止的受管服务运行目标版本数据库迁移、历史图片缩略图回填，并校验 SQLite 外键与完整性；
9. 重启检测到的服务；
10. 验证 `/health` 和 `/api/version`。

从 `0.2.0` 升级到本版本时，数据迁移标识为 `0.2.0_to_0.3.0_v1`。它只读取现有 SQLite 数据，不依赖 Gateway 在线、Session 历史或某个特定数据库实例；迁移成功后通过 `schema_migrations` 账本保证不会在后续启动中重复扫描历史节点。

媒体回填标识为 `0.3.0_media_derivatives_v1`。它读取 Canvas 本地文件，为所有历史上传附件和 Agent Artifact
计算真实内容哈希，并为其中的图片生成缩略图，不修改原件。更新器允许该停服步骤最长运行 60 分钟；单个损坏或不支持的图片
会记录警告并继续，存储或数据库系统性错误会触发回滚。迁移账本存在后，后续更新和服务启动都不会重复全量扫描。
需要诊断性地复查历史媒体时，停止服务后显式运行 `npm run migrate -- --rescan-media`。

如果没有检测到受支持的服务管理器，更新器不会假设手动启动的进程已经停止，也不会在线执行显式迁移。目标服务下次手动启动时会先自动迁移数据库。

从 `0.3.0` 开始，目标 Release 必须保留基线之后的全部迁移步骤；更新器直接安装所选目标版本，并由目标版本
顺序执行尚未记录在 `schema_migrations` 中的迁移。迁移 ID 发布后不得修改或删除。大型、可延后的历史数据处理
应设计成幂等维护迁移或按需生成，不应让普通服务启动长期不可用。

## CLI 参数

| 参数 | 说明 |
|---|---|
| `--version <vX.Y.Z>` | 选择已经存在的官方稳定 Release |
| `--yes`、`-y` | 跳过终端确认，但不会绕过安全检查 |
| `--dry-run` | 解析并校验目标，不修改工作区 |
| `--verbose`、`-v` | 显示详细更新操作 |
| `--rollback` | 恢复上一个确认正常的快照 |
| `--no-restart` | 跳过停服、数据库迁移、服务重启和健康检查；下次手动启动目标服务时自动迁移 |
| `--help`、`-h` | 显示帮助 |

## 示例

```bash
# 先预览
npm run update -- --dry-run

# 选择一个已发布且不低于当前版本的稳定版本
npm run update -- --version v0.4.0

# 回滚到上一个快照
npm run update -- --rollback

# 更新后手动重启
npm run update -- --no-restart
```

## 退出码

| 退出码 | 含义 |
|---|---|
| 0 | 成功 |
| 1 | 已是最新版本 |
| 10 | 前置检查失败 |
| 20 | 官方 Release 解析失败 |
| 40 | Fetch、校验、安装或构建失败 |
| 45 | 数据库迁移或完整性校验失败 |
| 50 | 服务重启失败 |
| 60 | 健康检查失败 |
| 70 | 回滚失败 |
| 80 | 另一个更新进程持有锁 |

## 0.3.0 及以后版本的回滚与状态

切换工作区前，更新器会记录当前 Commit、Package 版本、时间戳和 `.env` Hash。存在 `.env` 时，以 `0600` 权限复制。检测到受管服务时会先停服；存在 `database/canvas.sqlite` 时，再使用 SQLite `VACUUM INTO` 创建包含已提交 WAL 内容的一致副本，并以 `0600` 权限保存。状态保存在 `~/.convosketchpad/updater/` 下。

如果快照完成后 Fetch、校验、构建、迁移、重启或健康检查失败，更新器会先停止服务，切回已保存的 Commit，恢复数据库快照，运行 `npm ci` 和 `npm run build`，并重启检测到的服务。原始附件和 Artifact 文件不在数据库迁移中改写；媒体回填只在 `artifacts/` 下增加可再生成的派生文件。更新器不会复制或删除 `artifacts/`，因此回滚数据库后多出的派生文件可能保留，但不会被旧版本引用。

| 路径 | 用途 |
|---|---|
| `~/.convosketchpad/updater/last-good.json` | 上一个确认正常的快照 |
| `~/.convosketchpad/updater/last-run.json` | 最近一次更新结果 |
| `~/.convosketchpad/updater/snapshots/<timestamp>/.env` | 受保护的 `.env` 备份 |
| `~/.convosketchpad/updater/snapshots/<timestamp>/canvas.sqlite` | 一致的更新前数据库备份 |
| `~/.convosketchpad/updater/update.lock` | 并发更新锁 |

## Release 策略

`0.1.0` 有意不提供 GitHub Release。准备新 Release 时，从最新的 `main` 创建 Release 分支，更新 `package.json` 和 `package-lock.json`，并在 `CHANGELOG.md` 中添加日期与版本匹配的章节。提交并推送 Release 分支，通过 Pull Request 和必需的 `build` 检查合并到受保护的 `main`，然后在 GitHub Actions 中手动运行 **Release** Workflow，并输入匹配的 `X.Y.Z`。

Workflow 会在 Ubuntu 和 macOS 上对准确的 `main` Commit 执行校验、测试、构建、审计和启动，然后创建带注释的 `vX.Y.Z` 标签及 Draft GitHub Release。检查 Draft 说明和安装行为后，将其发布为 Latest：

```bash
gh release edit vX.Y.Z --draft=false --latest
```

安装器和更新器绝不会提供 Draft 或预发布版本。

从 `0.3.0` 开始，改变 Schema 或持久数据语义的 Release 还必须：

- 保留从 `0.3.0` 起的全部已发布迁移，不要求用户先安装中间版本；
- 为新迁移使用新的幂等 ID，并在成功结束时才写入 `schema_migrations`；
- 使用最老受支持版本的数据库 Fixture 验证直接迁移、重复执行、外键和 SQLite 完整性；
- 把耗时且不影响核心读取正确性的回填放入可重试维护阶段。

## 故障排查

### 无法解析稳定 Release

检查仓库 Releases 页面和 GitHub API 可用性。安装器会直接失败，不会安装未发布分支。本地标签、继承标签、Draft 和预发布版本都会被忽略；只有明确安装开发版时才使用 `--branch main`。

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
cat ~/.convosketchpad/updater/last-good.json
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

成功输出应包含 `0.2.0_to_0.3.0_v1 applied` 和 `0.3.0_media_derivatives_v1 applied`。若手动替换数据库，
请同时移除同名 `-wal`、`-shm` 文件，或优先使用更新器的 `--rollback`。
