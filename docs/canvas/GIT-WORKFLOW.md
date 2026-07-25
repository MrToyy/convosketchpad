# Git 与 Upstream 同步工作流

本文是本仓库 Git 规则的唯一维护位置。`AGENTS.md` 只保留本文件的索引。

## 分支职责

- `master` 是 `upstream/master` 的干净镜像，只用于同步官方 Nerve；不要在此开发 ConvoSketchpad 或创建项目定制提交。
- `main` 是 ConvoSketchpad 的默认分支，用于长期维护 Canvas、受管用户认证和产品品牌；该分支受 GitHub Ruleset 保护，只接受 Pull Request 合并。
- 合并方向固定为 `upstream/master → master → main`。
- 不要把 `main` 合并回 `master`。

## `main` 分支保护

GitHub Ruleset `Protect main` 对 `main` 强制执行以下规则：

- 所有改动必须先推送到非目标分支，再通过 Pull Request 合并。
- Pull Request 不要求审批，适配单维护者工作流，但所有 Review 对话必须解决。
- GitHub Actions 的 `build` 检查必须通过。
- 禁止删除 `main` 或向其 Force Push。
- 不配置绕过账号，管理员也遵循相同规则。

不要临时停用或绕过 Ruleset 来完成日常开发、Release 或 Upstream 同步。

## 远程仓库

- `upstream`：`https://github.com/daggerhashimoto/openclaw-nerve.git`，官方源仓库，只获取更新。
- `origin`：`https://github.com/MrToyy/convosketchpad.git`，ConvoSketchpad 独立仓库，用于推送产品分支。

禁止把项目定制提交推送到 `upstream`。

## 开始 Git 操作前

```bash
git status --short --branch
git remote -v
```

- 切换分支或同步前，工作区应当干净。
- 现有修改属于用户；未经明确许可，不要丢弃、reset、checkout 或 stash。
- 不要把 `.env`、`database/canvas.sqlite*`、日志、依赖或构建产物加入提交。
- Remote tracking 状态可能过期；判断 upstream 是否更新前必须先 fetch。

## 安全同步 Upstream

```bash
git fetch --prune upstream
git fetch --prune origin
git switch master
git merge --ff-only upstream/master
git push origin master
git switch main
git pull --ff-only origin main
git switch -c sync/upstream-YYYY-MM-DD
git merge master
git push -u origin sync/upstream-YYYY-MM-DD
gh pr create --base main --head sync/upstream-YYYY-MM-DD
```

- `master` 无法 fast-forward 时停止操作并调查分叉原因，不要通过 rebase 或 force push 掩盖问题。
- 合并冲突只在本次 `sync/upstream-*` 分支解决，不要直接修改 `main`。
- 冲突解决后运行与冲突文件相关的测试，并至少执行 `npm run lint` 和构建/类型检查。
- 等待 `build` 检查通过、解决全部 Review 对话后，通过 Pull Request 合并到 `main`。

## 提交前检查

```bash
git status --short
git diff --check
git diff --stat
git ls-files --others --exclude-standard
```

暂存后再次检查：

```bash
git diff --cached --check
git diff --cached --stat
git status --short
```

重点确认以下内容未进入暂存区：

```text
.env
database/canvas.sqlite*
agent-log.json
*.log
node_modules/
dist/
server-dist/
bin-dist/
```

## 推送开发分支与创建 Pull Request

从最新的 `main` 创建有含义的功能、修复或文档分支：

```bash
git switch main
git pull --ff-only origin main
git switch -c <type>/<short-description>
```

首次建立 tracking branch：

```bash
git push -u origin <type>/<short-description>
```

后续推送：

```bash
git push
```

然后向 `main` 创建 Pull Request：

```bash
gh pr create --base main
```

等待 `build` 检查通过并解决全部 Review 对话后再合并。禁止直接向 `main` 推送、删除 `main` 或 Force Push `main`；Ruleset 不提供管理员绕过。未经用户明确要求，也不要 Force Push `master`。

## Canvas 变更的验证建议

- Canvas UI/layout：运行 `src/features/canvas` 测试、TypeScript 检查和 lint。
- Canvas DB/reconcile：运行 `server/lib/canvas-*.test.ts`。
- Auth：运行 auth route、middleware、managed users、login failures、WS proxy 测试。
- 大范围变更或 upstream merge：运行 `npm test -- --run`、`npm run lint`、`npm run build`。
