# Git 工作流

本文是本仓库 Git 规则的唯一维护位置。`AGENTS.md` 只保留本文件的索引。

## 分支职责

- `main` 是 ConvoSketchpad 唯一的长期维护和发布分支，用于维护 Canvas、受管用户认证、Agent Runtime 集成和产品品牌。
- 功能、修复、文档和 Release 工作都从最新的 `main` 创建短期分支，并通过 Pull Request 合并回 `main`。
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

等待 `build` 检查通过并解决全部 Review 对话后再合并。禁止直接向 `main` 推送、删除 `main` 或 Force Push `main`；Ruleset 不提供管理员绕过。

## Canvas 变更的验证建议

- Canvas UI/layout：运行 `src/features/canvas` 测试、TypeScript 检查和 lint。
- Canvas DB/reconcile：运行 `server/lib/canvas-*.test.ts`。
- Auth：运行 auth route、middleware、managed users、login failures、WS proxy 测试。
- 大范围变更或复杂分支整合：运行 `npm test -- --run`、`npm run lint`、`npm run build`。
