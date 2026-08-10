# Git 工作流

本文是本仓库 Git 规则的唯一维护位置。`AGENTS.md` 只保留本文件的索引。

## 分支职责

- `main` 是唯一的稳定发布分支，也是 `origin` 唯一长期保留的分支；它只保存已经通过 Pull Request、必需检查和 Release 验证的版本，日常开发不得直接提交到 `main`。
- `dev` 是仅存在于维护者本地的长期开发分支，不设置远端 Upstream，也不以 `dev` 名称推送到 `origin`。功能、修复、文档和 Release 准备都在最新的本地 `dev` 上完成、验证和提交。
- 准备发布时，把本地 `dev` 的准确快照推送为一次性的远端 `release/vX.Y.Z` 分支，再由该分支向 `main` 发起 Pull Request；合并后删除远端临时分支。
- 本地常规状态只保留 `main` 与 `dev`。除非用户为并行工作明确要求临时分支，否则不创建其他本地分支；临时分支完成后及时删除。
- 不从其他长期分支同步或合并外部项目历史；需要采用外部代码时，按其许可证和当前任务范围单独评估。
- `main` 受 GitHub Ruleset 保护，只接受 Pull Request 合并。

## `main` 分支保护

GitHub Ruleset `Protect main` 对 `main` 强制执行以下规则：

- 所有改动必须先推送到非目标分支，再通过 Pull Request 合并。
- Pull Request 不要求审批，适配单维护者工作流，但所有 Review 对话必须解决。
- GitHub Actions 的 `build` 检查必须通过。
- 禁止删除 `main` 或向其 Force Push。
- 不配置绕过账号，管理员也遵循相同规则。

不要临时停用或绕过 Ruleset 来完成日常开发或 Release。

## 远程仓库

- `origin`：`https://github.com/MrToyy/convosketchpad.git`，ConvoSketchpad 官方仓库。
- `origin/main` 是唯一长期远端分支；本地 `dev` 不跟踪或创建 `origin/dev`。
- `release/vX.Y.Z` 只用于一次发布 PR，合并或放弃后必须从远端删除。
- 日常维护只依赖 `origin`；不要为持续同步其他项目配置长期 Remote。
- 临时添加的只读 Remote 应在任务完成后移除，推送前必须再次核对目标 URL。

## 开始 Git 操作前

```bash
git status --short --branch
git remote -v
```

- 切换分支或同步前，工作区应当干净。
- 现有修改属于用户；未经明确许可，不要丢弃、reset、checkout 或 stash。
- 不要把 `.env`、`database/canvas.sqlite*`、日志、依赖或构建产物加入提交。
- Remote tracking 状态可能过期；基于远程状态操作前必须先 `git fetch --prune origin`。

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

## 在 `dev` 开发

开始任务前切换到 `dev` 并刷新远端状态：

```bash
git switch dev
git status --short --branch
git fetch --prune origin
```

修改、验证和提交都留在本地 `dev`。该分支不得设置远端 Upstream，也不得推送为 `origin/dev`。准备 `v0.5.0` 时，把已验证的本地快照推送到临时发布分支：

```bash
git push origin dev:refs/heads/release/v0.5.0
```

PR 合并前如需补充修复，继续在本地 `dev` 提交，并把同一历史快进更新到该临时分支：

```bash
git push origin dev:refs/heads/release/v0.5.0
```

创建 `release/v0.5.0 → main` Pull Request：

```bash
gh pr create --base main --head release/v0.5.0
```

等待 `build` 检查通过并解决全部 Review 对话后再合并。禁止直接向 `main` 推送、删除 `main` 或 Force Push `main`；Ruleset 不提供管理员绕过。

仓库使用 Squash Merge，合并后的 `main` Commit 与本地 `dev` Commit 历史不同。发布完成后先确认两者文件树一致：

```bash
git fetch --prune origin
git diff --quiet dev origin/main
```

若 GitHub 未自动删除临时发布分支，再显式删除它：

```bash
git push origin --delete release/v0.5.0
```

随后从最新 `main` 重建本地 `dev`，避免下一次 PR 重复包含已发布提交：

```bash
git switch main
git merge --ff-only origin/main
git branch -D dev
git switch -c dev main
```

只有 `git diff --quiet dev origin/main` 成功且工作区干净时才能删除并重建本地 `dev`；否则先检查尚未发布的差异，不得强制覆盖。

## Canvas 变更的验证建议

- Canvas UI/layout：运行 `src/features/canvas` 测试、TypeScript 检查和 lint。
- Canvas DB/domain/application：运行 `server/lib/canvas/**/*.test.ts`；涉及协调、文件或 OpenClaw 投影时再运行相关 `server/lib/canvas-*.test.ts` 与 Adapter 测试。
- Auth：运行 auth route、middleware、managed users、login failures，以及 HTTP/SSE 会话撤销相关测试。
- 大范围变更或复杂分支整合：运行 `npm test -- --run`、`npm run lint`、`npm run build`。
