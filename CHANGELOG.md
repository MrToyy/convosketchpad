# 更新日志

ConvoSketchpad 的重要变更均记录在此文件中。格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)。

## [Unreleased]

## [0.2.0] - 2026-07-24

### 新增

- 提供可视化 Canvas，支持多个主分支、继续与分支工作流、持久化布局、本地化控件，以及每个 Canvas 绑定一个 OpenClaw Agent。
- 持久化保存附件和生成的 Artifact，并按所有者隔离。
- 提供受管用户 Token 认证、会话撤销、请求限流和 Canvas 所有者隔离。
- 通过受支持的 CLI 命令使用 OpenClaw 原生设备配对和配置能力。
- 支持 Session 重置预测、对话记录协调和规范 Branch 恢复。
- 为受支持的 macOS 和 Linux 安装提供仅面向正式 Release 的更新器及系统服务集成。
- 添加应用图标、Apple Touch Icon 和 favicon 等产品视觉资源。

### 变更

- 将 ConvoSketchpad 确立为在 `main` 分支独立维护的产品。
- 将运行时路径、服务、launchd 标识符和环境变量统一重命名为 ConvoSketchpad。
- 分离浏览器与 Node 测试环境。
- 围绕“A branching AI workspace for visual thinkers（为视觉思考者打造的分支式 AI 工作区）”统一产品文案，并整合项目文档。
- 向 OpenClaw 报告的应用版本改为读取 package 元数据。
- 安装器默认使用官方稳定 Release；安装开发版时必须显式提供 `--branch`。
- 将 Hono 服务端适配器及其他直接、间接依赖更新至已修复版本。

### 修复

- 防止首个 ConvoSketchpad Release 的说明错误地基于继承自 OpenClaw Nerve 的标签生成。
- 移除旧运行时日志前缀和过期的 Release 版本示例。

### 安全

- 移除一个保留了存在漏洞的服务端依赖、且已不再使用的开发 CLI。
- 在 Release 验证流程中增加完整依赖审计和生产依赖审计。

### 升级说明

- 升级现有安装前，请同时备份项目内的 `database/` 和 `artifacts/` 目录。
- `0.2.0` 版本不需要手动迁移数据库。

ConvoSketchpad 源自 OpenClaw Nerve。更早的上游版本历史仍可在 [OpenClaw Nerve 更新日志](https://github.com/daggerhashimoto/openclaw-nerve/blob/master/CHANGELOG.md)中查看。

[Unreleased]: https://github.com/MrToyy/convosketchpad/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/MrToyy/convosketchpad/releases/tag/v0.2.0
