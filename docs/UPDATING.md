# 更新 ConvoSketchpad

从 `0.2.0` 开始，ConvoSketchpad 为已发布的稳定版本提供终端更新器。

更新器只接受 `https://github.com/MrToyy/convosketchpad` 发布的 Release。本地标签、继承自 OpenClaw Nerve 的标签、Fork、分支、Draft 和预发布版本都不能作为更新源。

只有关闭受管认证时，状态栏才会显示更新入口。受管部署必须由宿主机管理员直接在服务端终端运行更新器。

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
3. 快照当前 Commit 和 `.env`；
4. 只把所选 Release 标签获取到内部 Ref；
5. 验证目标是否为匹配的 `convosketchpad` Package；
6. 运行 `npm ci` 和 `npm run build`；
7. 检测到服务时，只重启准确匹配的 `convosketchpad.service` 或 `com.mrtoyy.convosketchpad`；
8. 验证 `/health` 和 `/api/version`。

## CLI 参数

| 参数 | 说明 |
|---|---|
| `--version <vX.Y.Z>` | 选择已经存在的官方稳定 Release |
| `--yes`、`-y` | 跳过终端确认，但不会绕过安全检查 |
| `--dry-run` | 解析并校验目标，不修改工作区 |
| `--verbose`、`-v` | 显示详细更新操作 |
| `--rollback` | 恢复上一个确认正常的快照 |
| `--no-restart` | 跳过服务重启和健康检查 |
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
| 50 | 服务重启失败 |
| 60 | 健康检查失败 |
| 70 | 回滚失败 |
| 80 | 另一个更新进程持有锁 |

## 回滚与状态

切换工作区前，更新器会记录当前 Commit、Package 版本、时间戳和 `.env` Hash。存在 `.env` 时，以 `0600` 权限复制。状态保存在 `~/.convosketchpad/updater/` 下。

如果快照完成后 Fetch、校验、构建、重启或健康检查失败，更新器会切回已保存的 Commit，运行 `npm ci` 和 `npm run build`，并重启检测到的服务。

| 路径 | 用途 |
|---|---|
| `~/.convosketchpad/updater/last-good.json` | 上一个确认正常的快照 |
| `~/.convosketchpad/updater/last-run.json` | 最近一次更新结果 |
| `~/.convosketchpad/updater/snapshots/<timestamp>/.env` | 受保护的 `.env` 备份 |
| `~/.convosketchpad/updater/update.lock` | 并发更新锁 |

## Release 策略

`0.1.0` 有意不提供 GitHub Release。准备新 Release 时，更新 `package.json` 和 `package-lock.json`，在 `CHANGELOG.md` 中添加日期与版本匹配的章节，将 Release Commit 推送到 `main`，然后在 GitHub Actions 中手动运行 **Release** Workflow，并输入匹配的 `X.Y.Z`。

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
