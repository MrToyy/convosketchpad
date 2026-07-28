# 更新 ConvoSketchpad

从 `0.2.0` 开始，ConvoSketchpad 为已发布的稳定版本提供终端更新器。

更新器只接受 `https://github.com/MrToyy/convosketchpad` 发布的 Release。本地标签、继承自 OpenClaw Nerve 的标签、Fork、分支、Draft 和预发布版本都不能作为更新源。

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

## 快速开始

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

`0.2.0` 自带的旧更新器尚没有独立的迁移阶段。由它发起首次升级时，目标版本服务在第一次打开数据库时执行同一事务化迁移，因此无需先安装中间版本。升级到本版本以后，后续更新将使用上述停服、快照、显式迁移和完整性校验流程。

如果没有检测到受支持的服务管理器，更新器不会假设手动启动的进程已经停止，也不会在线执行显式迁移。目标服务下次手动启动时会先自动迁移数据库。

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

# 选择一个已发布的稳定版本
npm run update -- --version v0.2.0

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

## 回滚与状态

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
