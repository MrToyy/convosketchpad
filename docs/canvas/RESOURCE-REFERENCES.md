# 资源引用与后续 Canvas 能力规划

本文记录 ConvoSketchpad 从 `0.5.0` 开始的 Canvas 能力开发顺序。第一阶段资源引用已经实现，后续分支合并与跨 Agent 交接仍是规划；现行约束同时以[产品目标](../PRODUCT.md)、[架构](../ARCHITECTURE.md)和 [Canvas 功能与代码地图](CANVAS-CODE-MAP.md)为准。

## 开发顺序

```text
资源引用
  ↓
分支合并
  ↓
跨 Agent 交接
```

Windows 支持排在上述产品能力之后，不是前三项的实现依赖。

这个顺序按可复用基础能力而不是单项功能的表面复杂度确定：资源引用建立选择、校验、持久化和投递 Canvas 内容的统一链路；分支合并在这条链路上增加多来源组合与来源追踪；跨 Agent 交接再进一步改变执行目标和 Conversation 归属。

## 共同原则

- 历史 Interaction、原始附件和 Artifact 保持不可变；新能力只追加来源关系、草稿、Branch、Interaction 或发送记录。
- Conversation 跟随目标 Branch，资源跟随当前 Turn；资源的来源 Branch 不决定发送使用的 Conversation。
- 资源只能从当前目标节点的上游 Interaction 中选择；第一阶段的上游只由既有父节点链确定，未来分支合并再把明确连接的合并来源及其祖先接入同一上游解析能力。
- 在既有 Branch 上继续时必须继续该 Branch 已有的 Conversation，不因引用上游资源而静默新建 Session。
- 只有新的执行方向、明确的目标 Agent 变化，或 Adapter 确认原 Conversation 已经失效时，才创建新 Conversation。
- 浏览器只提交 Canvas 内的稳定引用，不提交服务端文件路径、Runtime 原生标识或可绕过所有者检查的 URI。
- 服务端按当前用户和 Canvas 解析引用，并统一校验所有者、可用性、文件限制、路径安全和目标 Runtime 能力。
- 物理文件继续按内容哈希去重，不能因为同一内容被多次引用而丢失各自的逻辑来源。
- 找不到、无权访问、已降级或无法被目标 Runtime 接收的资源必须给出明确结果，不伪造成功，也不静默丢弃。
- 新发送继续使用现有 Send Reservation、派发三态、恢复和 Artifact 持久化链路，不在 Route 或前端直接调用 Runtime 原生协议。

## 上下文与 Conversation 组织决策

资源引用决定当前 Turn 在其已有上游范围内实际使用哪些材料，Branch 拓扑决定哪些节点属于上游以及结果进入哪条 Runtime Conversation。第一阶段不新增连线能力，也不能直接选择无关分支资源；第二阶段通过明确的分支合并连线扩展上游范围，但资源引用本身仍不会切换 Conversation 或自动带入未选材料。

| 操作 | Canvas 结果 | Runtime Conversation |
|---|---|---|
| 在当前 Branch 继续，引用既有父链上游资源 | 继续当前 Branch | 继续当前 Conversation |
| 从历史 Interaction 创建新分支 | 新 Branch | 新 Conversation，通过 Canonical Replay 恢复分叉点上下文 |
| Adapter 确认原 Session/Thread 失效 | 保留原 Branch | 替换 Conversation，通过 Session Recovery Replay 恢复 |
| 连接多个来源节点并发送合并草稿 | 新 Merge Branch | 新 Conversation，编译用户明确连接和选定的多来源材料 |
| 跨 Agent 交接 | 新目标执行方向 | 目标 Agent 的新 Conversation |

一次发送的通用材料与指令按以下四层组织：

```text
历史恢复材料（仅新分支或 Session 恢复时）
  ↓
当前 Turn 显式引用的资源
  ↓
当前 Turn 新上传的附件
  ↓
保留资源位置的当前用户指令
```

通用 Canvas 层负责把上述材料编译为确定顺序的文本说明、带稳定资源标记的用户指令和物理附件，再通过现有 Runtime Port 的 `message + attachments` 交给 Adapter。Runtime Port 不接收 Canvas 数据库 ID、HTTP URI 或来源 Branch 的 Conversation Handle。相同物理内容在单次派发中去重，但所有逻辑引用、文本位置、所属 Turn 和原始来源都要保留。

Runtime 原生 Fork 不是资源引用的实现依赖。未来只有在其能够从指定 Turn 生成独立 Conversation、不改写来源且语义经过验证时，才能通过 Adapter 作为单来源分支的可选优化；Canonical Replay 仍然是跨 Runtime 的通用基线，合并和交接不依赖原生 Fork。

## 第一阶段：资源引用

资源引用是 `0.5.0` 的首要开发目标。产品入口使用输入框中的 `@` 选择器，但底层必须是通用的 Canvas 资源引用能力，而不是把显示文本解析成文件路径。第一阶段不新增连线、合并边或多来源拓扑。

### 用户体验范围

- 用户可以在 Composer 中通过 `@` 选择本次上传的附件，或查找当前节点既有父链上游中已持久化的图片、附件和 Artifact；因此根节点也能在文本指定位置引用本次附件，而无祖先关系的旁支资源不进入候选集合。
- 选择结果在用户文本的原位置显示为可识别、可移除的原子引用 Token，并能够查看名称、资源类型和来源节点。
- 同一资源可在文本中出现多次但只占一个材料槽位；显式引用和本轮新上传共用最多九个材料槽位。
- 接受前发送失败可在刷新后恢复原引用，重试后仍保留引用位置；成功发送后，Interaction 能够回显本次显式引用的资源。
- 普通本地上传继续使用现有附件流程；上传后可直接随本轮发送，也可以在上传完成前通过 Composer 中的草稿附件 Token 放入文本指定位置。
- `@` 候选按本次附件和上游资源分组，图片可显示安全缩略图；菜单使用标准 `listbox` / `option` 语义，支持 Lexical 的键盘高亮与选择行为。

### 领域与服务端范围

1. 定义与 Runtime 无关的结构化用户输入和资源引用契约，区分普通文本、本次 Canvas Attachment Token、上游 Canvas Attachment Token 和 Interaction Artifact Token，并保留 Token 在用户指令中的顺序与位置。
2. 在应用层提供统一的上游解析能力；第一阶段只沿 `parentInteractionId` 父链计算，目录查询和发送校验必须复用同一结果，未来允许分支合并扩展为多上游遍历。
3. 在应用层集中解析引用，校验所有者、Canvas、上游范围、资源类型、可用状态、九个材料槽位和稳定标识；Route 只传递已验证的命令。
4. 将结构化输入和逻辑引用持久化到 Send Reservation，Runtime 接受后再关联最终 Interaction；引用记录保留消费它的 Turn、原始来源、首次出现顺序和可安全展示的名称/MIME/内容哈希快照，使刷新、失败恢复和历史回放结果一致。
5. 保留 `canvas_attachments` 和 `interaction_artifacts` 作为资源事实来源，不新建一套重复的物理资源库；引用只保存类型化稳定定位和逻辑来源。
6. 将现有 Replay Package 编译能力演进为通用发送材料编译流程，按“历史恢复→显式引用→新上传→用户指令”组成文本和附件；每个引用在用户指令原位置编译为稳定标记，并复用内容哈希去重、图片派生、大小限制和资源定位能力。
7. 在 `continue-existing` 材料化中只添加当前显式引用和新上传，保持 Branch Conversation Handle 不变；只有 `canonical-replay` 和 `session-recovery` 才编译历史恢复材料。
8. Canonical Snapshot 必须保存并恢复结构化用户输入和引用位置；可引用的上游资源只有在当时被用户实际选入指令后才进入后续 Replay。
9. 按目标 Runtime 的输入 Capability 决定能否投递；通用层把引用编译为现有 `message + attachments`，不在 Canvas 通用层根据 OpenClaw、Codex 或其他 Runtime 类型分支。
10. 公开 DTO 只返回安全的显示和读取信息，不暴露文件系统路径、内部 Handle 或其他用户的数据存在性。

### 实现分层

1. **契约与持久化**：确定结构化输入、引用 DTO、上游解析接口、九槽位校验、数据库表达和所有者测试。
2. **解析与投递**：接入资源定位、发送预留、媒体派生、内容去重、Capability 和失败语义。
3. **Composer 交互**：实现上游资源搜索、文本内 Token 的选择/删除/重复引用、来源展示、九槽位计数和草稿恢复。
4. **历史呈现与稳健性**：在 Interaction 中按原位置回显引用，覆盖刷新、失败重试、Fork/Session Replay、资源降级、删除 Canvas 和服务重启。

上述四层已在第一阶段落地。领域与 Store 保持 Runtime 无关，应用层统一解析上游和 Capability，Route 只承担请求校验与 DTO，Composer 只维护结构化草稿和 Token 交互；后续分支合并应扩展上游关系输入，不另建平行引用链路。

### 当前验证状态

- 自动化测试覆盖结构化输入归一化、重复引用、九槽位、父链/旁支/所有者边界、Store 原子持久化与迁移、HTTP 目录和伪造引用、材料编译、Replay、失败恢复及 Composer 投影。
- 浏览器实测覆盖根节点 `@` 本次附件、父链 `@` 上游附件、同一资源重复 Token 仍占一个槽位、九项后阻止第十项，以及独立根分支目录为空。
- OpenClaw 实际派发验证了本次附件和不重新上传文件的上游引用都能到达 Runtime；Codex 的图片输入、Capability 拒绝和统一 Worker 路径由自动化测试与既有 Adapter 契约覆盖。
- `@` 菜单的 DOM 结构必须保持候选位于 Lexical 锚点的 `listbox` 内，并以 `option` 暴露选中状态；可见菜单与可访问性树不得使用两套候选来源。

### 第一阶段验收条件

- OpenClaw 与 Codex 都通过统一 Runtime Port 接收各自声明支持的引用资源。
- 根节点和其他 Composer 都能在文本中 `@` 本次上传附件；本次附件与上游引用共用九个材料槽位。
- 第一阶段只能解析当前节点既有父链上游资源；旁支资源不出现在候选集合中，也不能通过伪造请求引用。
- 在既有 Branch 引用上游资源时继续原 Conversation Handle，不新建不可见的 Session，也不改变来源 Branch。
- 不属于当前用户或 Canvas 的引用不能被解析、发送或通过响应推断其存在。
- 引用在用户文本中的位置在草稿、Send Reservation、Interaction 和 Replay 中保持一致；同一资源多次出现只占一个材料槽位。
- 本轮显式引用和新上传合计不超过九个材料槽位；历史恢复材料不计入该用户可见上限。
- 相同物理内容可以保留多个逻辑来源，但投递文件按内容去重。
- 本轮用户明确选定的引用缺失、超限、不安全或 Runtime 不支持时整次发送明确失败；历史 Replay 资源继续使用已定义的可测试降级语义。
- 引用在草稿、Send Reservation、Interaction、Graph/SSE 和失败恢复中的投影一致。
- 现有文本发送、本地附件、Fork/Replay、Artifact 同步和所有者隔离测试保持通过。

### 第一阶段不包含

- 分支合并、节点连线或自动汇总多个分支。
- 切换、解锁或交接 Canvas 当前绑定的 Agent。
- 引用外部 URL、其他 Canvas 或其他用户的内容。
- 引用无父链祖先关系的旁支资源；这类来源必须等到第二阶段通过分支合并建立上游关系。
- 根据提示词自动选择、裁剪或总结历史资源。
- 因引用上游资源而自动带入未选文本、切换来源 Conversation 或创建新 Session。
- 修改或覆盖被引用的原始附件与 Artifact。

## 第二阶段：分支合并

分支合并复用资源引用形成的选择、投递和来源表达，在当前 Canvas 已锁定的 Agent 下组合多个方向，不引入跨 Runtime 执行。

- 第一版通过在 Canvas 上连接已完成的 Interaction 或 Branch 头节点来建立合并来源；连线是明确的分支合并操作，不在第一阶段作为通用资源授权能力出现。
- 连接一个或多个来源后创建可编辑的 Merge Composer，由用户补充结构化指令并明确发送。
- 发送结果创建在新的 Merge Branch 和新 Runtime Conversation 中；来源 Branch、Interaction 和 Runtime Conversation 保持不变。
- 使用独立的多来源关系持久化连线，不把多个来源压入现有单一 `parentInteractionId`；合并来源及其祖先通过统一上游解析接口进入资源候选范围。
- Merge Composer 复用第一阶段的 `@` 选择器、文本内资源 Token、九槽位校验、引用持久化和物理去重，不为合并实现第二套资源引用链路。
- 合并使用同一材料编译流程，按确定顺序包含用户明确连接的来源 Interaction 文本、显式资源引用和当前结构化指令，不尝试把多个原生 Conversation Handle 合并或交给 Adapter。
- 新 Conversation 的编译输入只包含用户明确选定的来源，不默认加入来源 Branch 中未选定的旁支或后续内容。
- 合并继续遵守大小、九槽位、去重、所有者和目标 Runtime Capability 约束；在新 Conversation 首轮派发失败时保留可恢复的合并连线、草稿和引用位置。
- 新 Interaction 必须能够回看全部来源连线和文本内引用；删除或失败处理不能反向改写来源历史。

## 第三阶段：跨 Agent 交接

跨 Agent 交接复用前两阶段形成的来源选择、材料编译和追踪能力，再引入明确的目标 Agent 与新 Conversation。它是三项中对现有执行归属影响最大的一项，因此最后实现。

- 交接不解锁或改写原 Branch/Canvas 已固定的 Agent 归属，而是创建具有明确目标 Agent 的新执行方向和新 Conversation。
- 先支持同一 Runtime 内的不同 Agent，再支持跨 Runtime 交接。
- 交接材料通过同一编译流程组成，包含用户选定的阶段性结果、资源、来源和当前交接指令，不默认复制无关分支。
- 目标 Runtime 必须重新执行 Capability、审批、文件和 Artifact 边界检查；源 Runtime 的 Handle 不直接交给目标 Runtime。
- 产品和数据模型需要明确目标 Agent、目标 Conversation、来源 Interaction、执行归属及失败恢复语义；交接失败不得回退到源 Conversation 执行。
- 如果最终选择在同一 Canvas 中呈现多个 Agent，需要先把当前 Canvas 级 Agent 锁定约束演进为可验证的 Branch/交接级归属，不能通过临时解锁规避不变量。

## 开发时需要同步的文档与测试

每一阶段开始实现后，按实际契约同步更新：

- `docs/PRODUCT.md`：用户体验和产品边界；
- `docs/ARCHITECTURE.md`：引用、来源、发送、恢复和 Agent 归属语义；
- `docs/API.md`：请求、响应、错误与 SSE/Graph 投影；
- `docs/canvas/CANVAS-CODE-MAP.md`：前后端入口、持久化和测试位置；
- `CHANGELOG.md`：已完成且用户可见的能力。

测试至少覆盖领域校验、上游范围、结构化输入、九槽位、Store/迁移、HTTP 所有者边界、Send Reservation、投递构建、OpenClaw/Codex Adapter、Graph/SSE、Composer 恢复和现有 Fork/Replay 回归。每一阶段还必须验证 Conversation 决策：资源引用不改变当前 Branch Handle，合并连线扩展上游范围并创建新 Conversation，交接只派发到目标 Agent 的新 Conversation，而失效 Conversation 仍通过已有 Session Recovery Replay 恢复。
