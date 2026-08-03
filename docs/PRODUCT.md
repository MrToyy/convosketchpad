# 产品目标

**让想法自由分支 · Let ideas fly free**

**Agent 可视化分支工作台——从任意节点回溯并继续探索**

ConvoSketchpad 可连接一个或多个 Agent 运行端（Agent Runtime），让用户从任意节点回溯并继续探索，而不是把所有方向压缩到一条线性对话中。一个 Canvas 可以同时呈现不同思路，保留每个方向的演进过程，并把对应的提示词、输出、参考资料、附件和生成结果组织在一起。

当前 v0.4.0 只正式支持 OpenClaw Gateway；Canvas 领域模型与具体运行时之间已经建立统一 Agent Runtime 边界，Registry 目前仍只注册 OpenClaw。后续可以直接接入本地 Codex，并为其他运行端保留一致的扩展方式。迁移期间的决策和两个功能提交边界记录在 [`AGENT-RUNTIME-MIGRATION.md`](AGENT-RUNTIME-MIGRATION.md)。

## 产品由来

Agent Runtime 中的单个 Conversation 通常以线性消息流推进。创意试验、图片生成、临时调研和补充询问如果都发生在同一条对话中，会共同进入后续上下文，使主线逐渐偏离目标；如果改用独立 Conversation，又需要重新组织分叉点之前的背景。当前 OpenClaw 实现中的 Conversation 对应 Session。

ConvoSketchpad 让用户从任意已完成的 Interaction 携带当时上下文创建可见分支，在不改写既有历史的前提下独立探索不同方向。用户可以保留所有试验过程，只把经过筛选的结果整理回主线。

## 目标用户

- 优先服务自媒体与内容创作者，帮助他们并行管理选题、叙事、文案和视觉方案，在不同分支生成与比较图片。
- 服务研究、产品及其他知识工作者，把临时调研、验证和补充询问放到侧支，使主线上下文持续聚焦于目标任务。
- 继续使用所选 Agent Runtime 已配置的 Agent Profile、模型、插件、技能与工具，不在 ConvoSketchpad 内实现第二套模型或工具运行时。

## 核心体验

- 在一个可视化 Canvas 上开始多个相互独立的方向。
- 无需重放历史即可继续一个值得深入的方向。
- “继续”被 OpenClaw 接受后，提交前的节点立即重新开放分支入口，无需等待新节点执行完成即可探索另一种后续输入。
- 从任意已完成的历史 Interaction 创建分支，探索该节点的另一种可能。
- 对任意 Interaction 原样重试：保留原节点和原执行，从它的上一节点创建普通分支并重新提交相同输入。
- 在工作过程中移动、缩放和排列节点，并在再次访问时恢复位置、用户尺寸和视口。
- 持久化保存源附件和生成的 Artifact，并关联到正确的 Interaction。
- setup 配置需要连接的 Runtime；其 Profile 在产品中组成一个平权 Agent 目录。新建 Canvas 自动选择第一个可用 Agent，不弹窗；首次提交前可在 Canvas 顶部更换，首次持久发送预留后保持 Runtime 和执行归属稳定。
- Agent 请求权限时，在对应 Interaction 节点内查看已净化的风险、权限与作用域并批准或拒绝；持久授权需要额外确认。

## 产品原则

### 空间结构是持久数据

Canvas 拓扑和布局不是临时展示状态。节点位置、用户调整后的尺寸和视口与不可变的 Interaction 历史一起持久化，确保工作区能够被可靠重建；显式重新排列只改变位置，不重置用户尺寸。

### 分支操作必须明确

“继续”用于延伸当前 Branch，“分支”用于从已完成的历史 Interaction 创建可编辑的新方向。“重试”是从上一节点创建普通分支并原样重新提交输入的快捷操作，不改写、取消或删除原 Interaction，也不在持久化模型中建立独立的 Retry 类型。

### Agent Runtime 负责执行，ConvoSketchpad 负责 Canvas 数据

所选 Agent Runtime 负责 Agent、模型与工具执行、Conversation、原生事件和原始运行记录。ConvoSketchpad 后端通过统一 Agent Runtime 边界与具体运行时通信，并保存 Canvas 拓扑、对话内容副本、上传附件、尽力持久化的生成 Artifact、发送状态、恢复元数据和受管用户隔离。前端只负责呈现、上传原始附件与提交用户指令；发送用图片压缩、缩略图和历史媒体处理统一由后端完成。

ConvoSketchpad 不是独立的 Agent 运行环境，至少需要一个可用的 Agent Runtime。当前 Release 仍必须连接到可访问的 OpenClaw Gateway；目标架构还允许通过受监督的本地 Codex App Server 直接执行，但不会把 Codex 嵌入 OpenClaw。

配置多个 Runtime 后不存在“切换 Runtime”模式：每个 Runtime 提供的 Agent 都进入同一目录并平权可用。全局连接状态按 Runtime 聚合并保留故障明细；账户用量与 Provider 额度按 Runtime 分组，只有所有已配置 Runtime 在线、所有声明支持费用的 Runtime 都成功返回数据，且币种、周期和可加性都一致时才显示合计。当前 Canvas 的 Branch、工作中数量和上下文仍只描述当前工作区，不做账户级求和。

统一边界使用 Agent Profile、Conversation、Turn、Artifact、Capabilities 和归一化事件等产品语义，不把 `chat.send`、`sessionKey`、`runId` 或 Codex `threadId` 等协议字段暴露给 Canvas 通用层。统一事件从第一阶段起包含审批请求、审批结果和补充输入请求；具体 Runtime 负责把原生审批协议转换为统一事件并接收统一审批决定。

### 恢复过程保留历史

如果 Agent Runtime 替换或移除了某个 Conversation，ConvoSketchpad 会在下一次发送时使用规范 Branch 快照恢复上下文，不会重写之前的 Interaction 或 Runtime 原始运行记录。Runtime 原生 Fork 只有在语义经过验证时才能作为可选优化，不能改变跨 Runtime 一致的 Branch 行为。

### 所有权必须明确

每个 Canvas 对象和持久化文件都属于一个 ConvoSketchpad 所有者。受管用户可以共享部署者明确开放的 Runtime 能力，但不共享 Canvas 数据；共享 Runtime 不自动等于凭据、额度、Workspace 或工具权限已经按用户隔离。Runtime Profile 必须明确自己的账户和文件系统边界。
