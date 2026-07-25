# 产品目标

**让想法自由分支**

ConvoSketchpad 帮助用户以空间方式探索 AI 辅助工作，而不是把所有方向压缩到一条线性对话中。一个 Canvas 可以同时呈现不同思路，保留每个方向的演进过程，并把对应的提示词、输出、参考资料、附件和生成结果组织在一起。

## 核心体验

- 在一个可视化 Canvas 上开始多个相互独立的方向。
- 无需重放历史即可继续一个值得深入的方向。
- 从任意已完成的历史 Interaction 创建分支，探索该节点的另一种可能。
- 在工作过程中移动和排列 Branch，并在再次访问时恢复布局。
- 持久化保存源附件和生成的 Artifact，并关联到正确的 Interaction。
- 在工作开始前选择 OpenClaw Agent，此后在整个 Canvas 生命周期中保持执行归属稳定。

## 产品原则

### 空间结构是持久数据

Canvas 拓扑和布局不是临时展示状态。它们与不可变的 Interaction 历史一起持久化，确保工作区能够被可靠重建。

### 分支操作必须明确

“继续”用于延伸当前 Branch，“分支”用于从已完成的历史 Interaction 创建新方向。界面和数据模型始终明确区分这两种操作。

### OpenClaw 负责执行，ConvoSketchpad 负责组织

OpenClaw 负责 Agent、工具、Session、执行、事件和对话记录。ConvoSketchpad 负责可视化图、Branch 关系、发送协调、持久化文件、恢复元数据和受管用户隔离。

ConvoSketchpad 不是独立的 Agent 运行环境，必须连接到可访问的 OpenClaw Gateway。

### 恢复过程保留历史

如果 OpenClaw 替换或移除了某个 Session，ConvoSketchpad 会在下一次发送时使用规范 Branch 快照恢复上下文，不会重写之前的 Interaction 或 OpenClaw 对话记录。

### 所有权必须明确

每个 Canvas 对象和持久化文件都属于一个 ConvoSketchpad 所有者。受管用户共享所配置 Gateway 的能力边界，但不共享 Canvas 数据。
