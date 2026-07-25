# 参与 ConvoSketchpad 开发

ConvoSketchpad 的目标是“让想法自由分支”。贡献内容应增强 Canvas 体验、OpenClaw 集成，或支撑这些体验所需的安全性和可运维性。

## 开发环境

环境要求：

- Node.js 22.13 或更高版本
- npm
- 可访问的 OpenClaw Gateway

```bash
git clone https://github.com/<your-username>/convosketchpad.git
cd convosketchpad
npm install
npm run setup
npm run dev
```

`npm run dev` 会同时启动 Vite 客户端和监听模式服务端。浏览器只需打开终端中标记为 `Frontend (open in browser)` 的地址，默认是 `http://127.0.0.1:3080`。Vite 会把 `/api`、`/health` 和 `/ws` 代理到内部服务端，默认端口为 `3081`。

客户端变更使用 Vite HMR；服务端变更由 `tsx watch` 自动重启。可以通过 `VITE_PORT` 和 `PORT` 分别指定前端入口端口和内部服务端端口。

## 项目结构

```text
src/
  features/canvas/       Canvas 图、交互、布局和文件
  features/auth/         受管登录和认证状态
  features/connect/      Gateway 连接界面
  features/settings/     连接与外观设置
  features/activity/     日志、事件和用量信息
  features/chat/         Canvas 使用的 Gateway 协议与媒体基础能力
  components/            通用产品框架和 UI 组件
  contexts/              Gateway 与设置状态
server/
  routes/                Canvas、认证、上传及运维 HTTP 路由
  lib/                   持久化、协调、Gateway 和安全逻辑
  middleware/            认证、Origin、限流和响应保护
bin/                     更新及受管用户 CLI
scripts/                 配置向导和安装器辅助模块
config/                  TypeScript 项目配置
docs/                    产品、运维和维护者文档
```

开始 Canvas 工作前阅读 [Canvas 功能与代码地图](docs/canvas/CANVAS-CODE-MAP.md)，开始认证工作前阅读[认证功能与代码地图](docs/canvas/AUTH-CODE-MAP.md)，执行 Git 操作前阅读 [Git 工作流](docs/canvas/GIT-WORKFLOW.md)。

## 实现要求

- 功能代码应放在现有子系统附近，避免创建平行抽象。
- 将 Canvas 拓扑、Branch 头节点、已预留发送、所有者边界和持久化文件视为数据完整性约束。
- 保留 `chat.send` 等 OpenClaw 协议名称；它们属于传输契约，不是产品文案。
- 校验写入输入，保留认证和 Origin 检查，并复用现有 Gateway 辅助模块。
- 前端代码应正确清理计时器、监听器、Socket 和 Observer。

评审顺序为：正确性、安全与隔离、与现有子系统的一致性、测试与可运维性，最后才是代码风格。

## 文档同步

代码修改影响行为、接口、配置、架构、安全、部署、运维方式或组件地图时，必须在同一个 Pull Request 中更新对应文档：

- 新增配置时同步更新 `.env.example` 和 `docs/CONFIGURATION.md`。
- 新增或修改 HTTP 接口时更新 `docs/API.md`。
- 移动或重命名 Canvas/Auth 组件时更新相应代码地图。
- 改变产品、数据流、Session 或恢复语义时更新 `docs/PRODUCT.md` 或 `docs/ARCHITECTURE.md`。
- 改变安装、部署、安全、排障或更新流程时更新对应运维文档。
- 用户可见或 Release 相关的重要变化记录到 `CHANGELOG.md`。

纯内部重构如果确实不影响文档，可以不修改文档，但 Pull Request 说明必须明确记录已经完成文档影响评估。

## 测试与检查

Vitest 对 `server/` 和 `scripts/` 使用 Node 环境，对 `src/` 使用 jsdom。

```bash
npm test -- --run
npm run lint
npm run build
```

在改动代码附近添加针对性测试。不要为了让变更通过而削弱断言。

## Git 与 Pull Request

- 从 `main` 创建功能分支，并向 `main` 发起 Pull Request。
- `master` 是干净的上游镜像，不得包含 ConvoSketchpad 产品定制提交。
- 每个 Pull Request 应保持聚焦，并在可行时包含回归测试。
- 使用 Conventional Commits，例如：

```text
feat(canvas): add branch filter controls
fix(auth): revoke sockets after token rotation
docs: clarify remote gateway deployment
```

请求评审前，确认上面的完整测试、lint 和构建命令均已通过。

## 许可证

贡献内容按 [MIT License](LICENSE) 授权。
