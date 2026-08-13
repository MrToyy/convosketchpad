# 分支合并设计

本文记录 `0.6.0` 分支合并的现行设计，包括产品目标、UX、数据关系、上下文编译、发送与恢复边界；本文列出的产品决策已经确认，后续实现若发现新的语义分叉，必须携带代码和数据上下文重新确认，不能自行推断。

现有 Canvas 不变量、职责边界和代码入口仍以[产品目标](../PRODUCT.md)、[架构](../ARCHITECTURE.md)和 [Canvas 功能与代码地图](CANVAS-CODE-MAP.md)为准。已实现的 HTTP 契约见 [HTTP API](../API.md)。

## 状态与范围

- 状态：`0.6.0` 已实现。
- 目标：让用户把当前 Canvas 中明确选定的 Interaction 路径组合进目标 Composer 的后续方向，同时保留每个来源和既有历史。
- 执行归属：由目标 Composer 选择 Agent；来源 Interaction 的 Agent 不限制目标执行者。
- 执行结果：Root/Fork 草稿 Composer 在所选 Agent 创建新 Conversation；Continue 选择相同 Agent 时继续现有 Conversation，选择不同 Agent 时完整回放目标 Branch 与冻结来源并创建新 Conversation。来源 Branch、Interaction 和 Conversation 保持不变。
- 基础能力：复用现有结构化输入、`@` 资源引用、九个材料槽位、附件/Artifact 持久化、发送预留、派发三态、恢复和 Graph/SSE 链路。

第一版不包含跨 Canvas 或跨所有者合并，不修改或压缩来源历史，不调用 Runtime 原生 Fork/Merge，也不根据提示词自动选择来源、总结来源或带入未明确选择的旁支。

## 核心对象与不变量

| 对象 | 语义 |
|---|---|
| Merge Source | 用户明确选中的、属于当前所有者和 Canvas 的来源 Interaction |
| Merge Target Composer | 接受一个或多个 Interaction 拖线的现有 Composer；连接后继续编辑指令、附件和 `@` 资源引用 |
| Merge Branch | 目标 Composer 所属 Branch；Root/Fork 使用其新 Conversation；Continue 在 Agent 不变时保持原 Conversation，改选 Agent 时完整回放并创建新 Conversation |
| Merge Source Link | 从来源 Interaction 指向某一代 Composer 的持久、不可删除关系，不等同于现有单一父子关系 |
| Merge Turn | 带有当前代次 Merge Source Link 的 Composer 发送；只有 Runtime 接受后才创建目标 Interaction |

必须保持以下不变量：

- 只有执行状态为 `completed` 的 Interaction 可以创建来源连接；运行中、失败、未确认或其他非完成状态由前端禁用并由服务端拒绝，发送只读取已冻结的完成内容。
- 多来源不能写入或伪装成 `parentInteractionId`；该字段继续只表达单一父链。
- 来源连接在拖线成功时立即由服务端持久化；连接关系一旦创建便不能删除、改序或改指向，重复提交同一连接必须幂等返回已有关系。
- 合并不能复用、拼接或向 Adapter 传递任一来源 Conversation Handle；Continue Composer 在 Agent 不变时使用目标 Branch 原有 Conversation Handle，改选 Agent 时由通用 Canvas 层完整回放目标 Branch 和冻结来源，在目标 Agent 创建新 Conversation。
- 每个 Composer 代次不设置来源数量上限；创建仍是一条连接一次写入，目录查询保持分页/搜索，发送仍受文件、总载荷、请求、Runtime Capability 和通用限流约束。
- 浏览器只提交稳定的 Canvas 来源 ID、结构化输入和附件 ID；服务端重新验证所有者、Canvas、来源状态、上游范围、文件与 Runtime Capability。
- 目录查询、发送校验和材料编译必须复用扩展后的统一上游解析能力，不得为合并建立第二套资源引用链路。
- 一次发送继续只有一个 Send Reservation；`reserved`、`dispatching`、`awaiting_media` 和 `ambiguous` 的锁定与恢复语义不变。
- 发送接受前的失败必须保留合并来源、结构化草稿、资源 Token 位置、附件和明确错误；重启或刷新后可恢复。
- 相同物理内容按内容哈希去重，但每个逻辑来源、来源顺序、引用位置和显示快照都保留。

## UX 设计

### 节点操作点

现有 Interaction 右侧中点已经是 React Flow 的唯一 Source Handle：它目前承担普通父子投影边的出边锚点，同时会被 React Flow 默认识别为可开始连接的 Handle；但 Canvas 没有注册持久化连接的 `onConnect`，所以拖动或点选它只会产生无业务结果的临时连接手势。现有 `+` Fork 按钮又覆盖在这个 Handle 上。

第一版不新建第二个连线点，也不禁用或移除现有 Source Handle，而是把它提升为唯一的 Merge 拖线 Handle，并把 Fork 按钮移到其上方。Interaction 右侧因此保留两个上下排列、语义不同的操作点：

- **Fork 操作点**：保留点击行为，创建新的可编辑 Fork Composer；沿用现有 Fork 状态和服务端校验。
- **Merge 操作点**：复用右侧中点现有 Source Handle，既继续作为普通投影边的视觉锚点，也作为唯一可发起 Merge 的拖线 Handle；只能落到 Composer 的 Target Handle，不能落到 Interaction 或空白 Canvas 后自动创建节点。

两个操作点不能只显示成无标签的相同圆点。Fork 使用现有 `+`/分支含义，Merge 使用连接含义；两者都提供 Tooltip、可访问名称、键盘焦点和足够的命中区域。键盘用户需要等价的“选择目标 Composer”流程，但它创建的仍是同一种持久连接，不形成第二套交互语义。

默认布局保持 Merge Handle 位于 Interaction 右侧中点；Fork 按钮沿同一竖轴移动到它上方，两者可见区域不重叠。Merge 直接使用 React Flow 原生 Handle 作为与 Fork 同为 `32px` 的圆形链路按钮，内部使用链路图标，不叠加第二个装饰按钮或额外 Handle；普通父子边与 Merge 边继续共用这一真实锚点。Fork 继续使用 `+`/分支含义。两者都提供 Tooltip、可访问名称、键盘焦点和足够的命中区域。

Merge Handle 的鼠标操作只允许拖线，不把单击映射为另一套动作；键盘聚焦后按 Enter 或空格打开目标 Composer 选择框。默认、悬停、键盘焦点、拖线中和不可连接状态都由原生 Handle 状态与产品样式共同呈现；悬停、键盘焦点和拖线中沿用 Fork 的主色背景/前景反色反馈，不增加环形光晕。

React Flow 中给 Interaction Source Handle 和 Composer Target Handle 使用明确且固定的 Handle ID。Source Handle 仅在 Interaction 为 `completed` 时允许开始连接、永远不能作为终点；Composer Target Handle 只能作为终点。关闭 `connectOnClick`，由全局 `onConnect` 和 `isValidConnection` 处理拖线与服务端保存；普通左侧 Target Handle 和其他静态锚点不得发起连接。持久 Merge 边不可重连或删除。

拖动期间使用 React Flow 的临时预览线；服务端确认连接后立即替换为实线持久 Merge 边。目标 Composer 发送并被 Runtime 接受后，同一关系改为指向新生成 Interaction 的普通左侧 Target Handle，实线必须始终保留，不能因 Composer 被替换而消失。Merge 边通过比普通父子边更粗的线宽以及 Tooltip/可访问名称区分，不能只依赖颜色。

Composer 继续使用左侧 Target Handle。开始从 Merge Source Handle 拖线后，所有当前可接受的 Composer 左侧 Target Handle 都通过 React Flow 原生 `useConnection` 状态扩展为与 Fork 同尺寸的主色反色圆形提示，并显示 `GitMerge` 图标；不可接受的 Composer 保持原有小连接点。来源 Interaction 如果已经是某个 Composer 普通入边的直接来源，该 Composer 不显示目标提示且不能命中。悬停到其他目标时继续由 React Flow 原生 `connectingto valid` 状态完成命中与连接判定，不建立第二套拖拽状态。普通父子边和 Merge Source Link 必须在视觉、Tooltip 和可访问名称上可区分，不能只依赖颜色。

### 可连接来源与目标

所有来源必须同时满足：

- 属于当前用户和当前 Canvas；
- 是服务端仍可解析且执行状态为 `completed` 的 Interaction；
- 不会形成指向既有历史的反向改写。

目标必须是当前 Canvas 中真实存在的 Composer 投影，不能提交任意目标节点 ID。Root/Fork 草稿 Composer 和活跃 Branch 末尾的 Continue Composer 都可以作为目标，但如果来源 Interaction 已经通过普通父子边直接指向该 Composer，则不能再为相同端点创建 Merge Source Link。Continue 接入其他来源后不转换 Branch；发送时若 Agent 不变，则在原 Conversation 的下一轮加入来源增量上下文，若改选 Agent，则完整回放目标 Branch 和冻结来源并创建新 Conversation。其他 Canvas 的节点不能成为来源或目标。前端禁用不满足条件的入口，服务端仍执行同样校验并以 `redundant_merge_source` 拒绝直接普通来源，不能依赖客户端隐藏来保证完整性。

### 创建与编辑

用户从 Interaction 的 Merge 操作点拖线到一个现有 Composer。每次成功拖线只增加一条来源关系，不派发 Agent：

1. 浏览器提交来源 Interaction、目标 Branch 和目标 Composer 代次（当前预期头节点）。
2. 服务端校验所有者、Canvas、来源、目标、重复关系和并发头节点，在单个事务中分配顺序并保存连接。
3. 服务端成功后，Graph/SSE 返回完整关系；Canvas 才把临时拖线替换为持久来源边。失败时移除临时边并在目标 Composer 附近显示明确错误。
4. 后续 Interaction 可以继续连接到同一个 Composer；连接按服务端成功保存的先后获得稳定顺序。
5. 已保存连接不提供删除、撤销或拖动改序操作。重复连接同一来源不新增边，也不改变原顺序。
6. Composer 标题栏显示当前选择的目标 Agent；来源关系由画布上的不可删除实线表达，不在节点内重复显示来源信息块。
7. 用户可以输入合并指令、上传本轮附件，并通过既有 `@` 选择器引用合并上游范围内的附件或 Artifact。
8. 连接事务成功后，该 Composer 代次的 `@` 候选范围立即扩展为目标 Branch 原有上游与全部明确来源完整路径的并集；无关旁支不因位于同一 Canvas 而获得引用权限。
9. 本轮新附件和不同的显式上游引用继续共用九个材料槽位；合并历史上下文不冒充资源 Token，也不占用这九个当前 Turn 文件材料槽位。
10. 用户必须执行明确的发送操作；保存连接不能自动调用 Runtime。

`@` 不在连线时预加载全部来源资源。现有按查询请求资源目录的方式继续保留，并使用当前 Composer 代次的来源关系解析范围。连接成功响应和 Graph/SSE 更新必须推进该 Composer 的来源修订号；若 `@` 菜单已经打开，前端中止旧请求并立即用相同查询刷新，若尚未打开，则下一次输入 `@` 时按新关系查询。这样连线成功后即可引用新来源，不依赖刷新页面或先发送一次。目录、搜索和发送校验复用同一个 DAG Resolver，并保持服务端分页，来源数量增加不会导致浏览器一次加载整个目录。

资源候选按稳定逻辑身份去重：同一个 `kind + sourceInteractionId + resourceId` 只显示一次；内容哈希相同但来自不同 Interaction 的逻辑资源仍保留各自来源和可选择身份。已插入的资源 Token 在发送时按准确 Composer 代次重新校验；由于来源连接不可删除，成功连接后不会出现因撤销连接导致的 Token 失效。

Merge Composer 通过每条持久实线展示直接来源关系，不在 Composer 或合并后的 Interaction 内重复渲染来源摘要卡片。由于连接不可删除，拖线落下前需要明确的有效目标反馈；成功后不再弹出容易被误认为可撤销的临时确认。

### 发送状态

发送后的可见状态复用普通 Composer：

- 媒体准备中：保留 Composer 和多条来源边，显示后端正在处理材料；
- 已排队或派发结果不确定：保持来源和 Branch 锁定，不能重复创建同一合并；
- 明确拒绝：在 Merge Composer 内显示可操作错误，并保留来源、输入文档、引用位置和持久附件；
- Runtime 接受：Merge Composer 在原布局位置转换为运行中的 Interaction，多条来源边继续可见；
- 执行完成或失败：Interaction 保留持久来源入边，但不显示额外来源信息块；Root/Fork 目标的后续“继续”沿目标 Branch 的新 Conversation 正常工作；Continue 在 Agent 不变时沿原 Conversation 继续，改选 Agent 时沿新建的目标 Agent Conversation 继续。

合并执行失败只影响目标 Composer/Branch，不回写来源节点。Runtime 断线、审批、Preview、Artifact 同步和晚到观察继续显示在新的目标 Interaction 中。

### 历史呈现与可访问性

- 多条来源边表达来源关系，普通父子边继续表达 Branch 内的时间顺序；两者必须在视觉和可访问名称上可区分，不能只靠颜色。
- Merge Composer 和合并后的 Interaction 不显示额外来源信息块；持久来源边与 Graph/API 关系仍保留完整来源和顺序。
- 连接入口必须支持键盘操作与明确焦点状态；键盘创建连接时使用语义化列表选择目标 Composer，并与拖线复用同一服务端命令。
- 重新排列必须把多来源边纳入 DAG 布局，同时继续保留用户显式尺寸；布局只改变位置，不改变来源顺序或数据关系。

## 数据设计

### 领域模型

连接可以添加到现有 Root、Fork 或 Continue Composer。`BranchKind = root | fork` 继续只表达 Branch 的创建来源，是否构成合并由当前 Composer 代次是否存在 Merge Source Link 决定。不能在连接发生后覆写 Branch 的创建类型，也不能把来源 ID 塞进 JSON 字符串或重复使用 `forkedFromInteractionId` / `parentInteractionId`。

建议的逻辑关系为：

```text
Canvas
  ├─ Interaction A ─┐
  ├─ Interaction B ─┼─ immutable Merge Source Links ─→ existing Composer
  └─ Interaction C ─┘                                  └─ Send Reservation
                                                              ↓ accepted
                                                        Merge Interaction
```

持久化至少需要表达：

| 字段 | 目的 |
|---|---|
| Target Branch ID | 标识目标 Composer 所属 Branch |
| Expected Head Interaction ID | 标识 Composer 代次并阻止旧页面把连接写到已经推进的 Branch；草稿 Root/Fork 为 `null` |
| Source Interaction ID | 指向不可变来源，服务端由它反查 Canvas、所有者和 Branch |
| Ordinal | 按连接成功持久化的顺序单调分配；同一 Composer 代次内不可修改 |
| Created At | 支持稳定排序、同步和诊断；连接不可更新，因此不需要可变 `updated_at` 语义 |
| Send Reservation ID / Target Interaction ID | 在发送预留和 Runtime 接受后保留本次 Turn 的准确来源投影 |

建议把立即保存的关系与发送快照分开：

- `composer_merge_sources` 以 `(target_branch_id, expected_head_interaction_id, source_interaction_id)` 唯一标识一条不可删除连接，并保存 `ordinal`。
- `turn_merge_sources` 在创建 Send Reservation 时复制本次直接来源、顺序和安全显示快照；Runtime 接受后在同一事务中关联目标 Interaction。
- 新 Interaction 推进 Branch 头节点后会形成下一代 Continue Composer；上一代连接不能自动出现在下一代，也不能被新连接修改。

SQLite 的 `NULL` 不参与普通复合唯一约束，因此草稿 Root/Fork 的 `expected_head_interaction_id = NULL` 不能只依赖一条 `UNIQUE` 声明。Schema 必须使用分别覆盖 `IS NULL` / `IS NOT NULL` 的部分唯一索引，或引入非空的 `composer_generation_id`；来源身份和 `ordinal` 都要在同一 Composer 代次内唯一。分配 `MAX(ordinal) + 1` 必须发生在同一个写事务中。

创建 Send Reservation 时必须把当次来源集合、顺序和编译后的完整路径上下文原子快照到预留。之后即使来源产生晚到 Artifact，已经派发或结果不确定的输入也不能变化。

来源关系只保存稳定定位、顺序和安全展示所需快照，不复制附件或 Artifact 文件。源文件仍由 `canvas_attachments` 和 `interaction_artifacts` 管理；合并引用继续写入 `turn_resource_references`。

### 上游解析

`UpstreamResourceResolver` 需要从当前单父链遍历扩展为通用 DAG 遍历：

1. 普通 Root/Fork/Continue 保持现有父链结果，不改变 `0.5.0` 资源引用行为。
2. 目标 Composer 从当前代次的 Merge Source Link 开始，把每个直接来源的完整路径加入上游集合。
3. “完整路径”从来源 Interaction 反向遍历到根：普通节点沿 `parentInteractionId`；如果路径经过已经接受的 Merge Interaction，还要沿该 Interaction 的冻结 `turn_merge_sources` 递归展开其合并来源。
4. 遍历只读取在目标 Send Reservation 创建前已经存在且属于当前 Canvas 的 Interaction 和已接受来源快照，不读取来源 Branch 的当前头节点或之后新增内容。
5. 使用 `visited` 集合对共享祖先去重并检测循环；检测到缺失节点、跨 Canvas 关系或循环时以 `invalid_upstream_graph` 失败关闭。
6. 资源目录和发送解析调用同一个遍历结果；浏览器提交的 `sourceInteractionId/resourceId` 不能扩大上游集合。
7. 多来源遍历顺序来自持久来源顺序和拓扑关系，不能依赖 SQLite 返回顺序、节点坐标或前端对象插入顺序。

这里的“去重”只用于遍历和物理投递。直接来源关系和用户在文本中多次放置的逻辑资源 Token 仍按现有规则保留。

### 完整路径去重与确定顺序

后端在发送时把目标 Composer 的基础上下文和全部直接来源组织为一个有向无环上下文图，并生成可冻结、可重放的 Merge Context Snapshot。合并是现有发送材料化上的增量层，不改变目标 Conversation 的选择。算法固定如下：

1. 先确定目标基础上下文集合 `B`：Root 为空；Fork 为现有 Canonical Replay 已投递的分叉路径；Continue 为目标 Branch 原 Conversation 已接受并仍驻留的上下文；Session Recovery 为本次恢复会先 Canonical Replay 的目标历史。此前已接受 Merge Interaction 的冻结来源也属于相应基础集合，不能在恢复时漏掉。
2. 只为持久 Merge Source Link 分配 `S001`、`S002` 等安全标记，顺序严格使用服务端成功保存的 `ordinal`。目标 Branch 的基础历史不是一条用户连接，不占用 `Sxxx` 来源身份。
3. 对每个 `Sxxx` 从根到来源 Interaction 展开完整闭包：普通节点沿 `parentInteractionId`，已接受的 Merge Interaction 递归使用其冻结来源快照。节点用稳定 Interaction ID 判同，不能因文本、内容哈希或创建时间相同而合并两个不同 Interaction。
4. 合并全部来源闭包与基础集合形成 DAG。边由普通 `parentInteractionId` 和已接受 Merge Interaction 的冻结来源关系组成，方向统一为“祖先/来源 → 后继/合并结果”。同一个 Interaction 无论出现在目标基础历史还是多少条来源路径中，都只保留一个图节点。
5. 对 DAG 执行稳定拓扑排序，保证所有祖先先于后继。多个节点同时可输出时，基础节点先按目标历史顺序定位；其余节点依次比较包含该节点的最小来源 `ordinal`、该来源路径深度、Interaction `createdAt`、Interaction ID。目标历史顺序和来源顺序都来自冻结数据，不能读取 Canvas 坐标或数据库偶然返回顺序。
6. 基础集合中的节点按其既有顺序标记为 `B001`、`B002` 等，表示已经存在于目标 Conversation 或会由本次基础材料化先行重放；来源闭包中不属于基础集合的唯一节点按稳定拓扑顺序标记为 `C001`、`C002` 等，只把这些 `Cxxx` 作为合并增量正文投递一次。
7. 来源清单为每个 `Sxxx` 保留从根到来源的完整 `Bxxx/Cxxx` 路径。共享祖先可出现在多个来源清单中，但 `Bxxx` 不重复投递，`Cxxx` 正文也只输出一次。同一 Branch 的祖先和后继即使都被直接连接，仍保留两条 `Sxxx` 来源身份；如果一条来源完全包含在目标基础上下文中，其清单仍保留，而本轮增量正文可以为空。

该算法的结果只依赖持久关系和稳定字段：刷新、服务重启、SQLite 查询计划或 Canvas 重新布局都不能改变输出顺序。若检测到循环、缺失依赖或排序无法覆盖全部节点，整次发送失败，不能裁剪到一个“看起来可用”的子图。

例如 Root Composer 的两个来源路径分别为 `I1 → I2` 和 `I1 → I3`，并按这个顺序连接，后端生成：

```text
S001: C001 → C002
S002: C001 → C003

C001 = I1（只编译一次，共享祖先）
C002 = I2
C003 = I3
```

如果反向连接，`I1` 仍最先输出，但两个分支后缀的顺序随持久来源顺序交换。若直接连接同一 Branch 的祖先和后继，来源清单仍保留两条路径，正文中的重合 Interaction 仍只出现一次。

如果目标 Agent 不变，且 Continue Composer 的原 Conversation 已经包含 `I1 → I2`，此时接入 `I1 → I3`，则来源清单为 `S001: B001 → C001`：`B001 = I1` 只表示它已在原 Conversation 中，后端本轮只补充 `C001 = I3`，不会重发 `I1` 或目标 Branch 的 `I2`。后续 Turn 继续沿同一个 Conversation 执行，因此自然保留这次补充上下文；当前代次的来源连接不会复制到下一代 Composer，但已接受 Interaction 的冻结 Merge Snapshot 会进入目标 Branch 历史和后续恢复。若改选 Agent，`agent-handoff` 会把目标 Branch 与冻结 Merge 上下文完整回放到目标 Agent 的新 Conversation，不使用这一增量优化。

### 材料编译

合并不把多个 Runtime Conversation 交给 Adapter。通用 Canvas 层在目标 Composer 发送前，把 Merge Context Snapshot 编译为现有 `message + attachments` 的增量部分：

```text
来源清单（S 标记 → 完整 B/C 路径）
  ↓
去重并拓扑排序后的新增路径上下文（每个 C 节点一次，B 不重发）
  ↓
当前 Turn 显式引用的上游资源
  ↓
当前 Turn 新上传的附件
  ↓
保留资源 Token 位置的当前合并指令
```

每个 `Cxxx` 上下文节点包含该 Interaction 的用户输入、Agent 输出、当时的结构化资源位置、原始附件和可用 Artifact，复用现有 Canonical Replay 的逻辑资源与降级规则。每个来源和上下文节点都有稳定的安全标记，让 Agent 能区分路径归属；这些标记不暴露数据库 ID、Canvas HTTP URI 或 Conversation Handle。

共享 Interaction 只编译一次；不同 Interaction 即使文字相同也分别保留。相同物理文件按内容哈希只投递一次，但每个 `Cxxx` 中的逻辑位置、来源和警告保持不变。完整路径中的历史文件不占当前 Composer 的九个材料槽位，仍受单文件、总载荷、路径安全和目标 Runtime Capability 约束；当前 Turn 明确选择的引用不可用时整次发送失败，历史文件不可用时沿用 Canonical Replay 的明确降级警告。完整合并载荷超限继续使用 `replay_payload_too_large` 失败，不静默删减来源。

Send Reservation 保存编译后的 `outgoingMessage`、去重物理附件和 Merge Context Snapshot；一旦进入 `dispatching`，晚到 Artifact 或新的 Canvas 数据不能改变它。Runtime 接受后，Snapshot 关联目标 Interaction。后续 Fork、嵌套合并或 Session Recovery 使用已接受的冻结 Snapshot 恢复 Agent 当时实际收到的合并上下文，不从来源 Branch 重新读取“最新”历史。

现有 `lazy-root`、`continue-existing`、`canonical-replay`、`agent-handoff` 和 `session-recovery` 保持原义，Merge Snapshot 与它们正交组合，不增加会改变 Conversation 选择的 `merge-bootstrap` 类型：

| 目标 Composer | 基础材料化 | Merge 处理 |
|---|---|---|
| Root | `lazy-root`，创建目标 Branch 的新 Conversation | 基础集合为空，投递全部去重来源增量 |
| Fork | `canonical-replay`，在目标 Branch 的新 Conversation 重放分叉路径 | 以 Replay 节点为 `B`，只补充其他来源的 `C` 节点 |
| Continue，Agent 不变 | `continue-existing`，保持目标 Branch 原 Conversation | 以原 Conversation 已接受上下文为 `B`，只补充接入来源的 `C` 节点 |
| Continue，改选 Agent | `agent-handoff`，在目标 Agent 创建新 Conversation 并完整回放 | 目标 Branch 历史与冻结 Merge 上下文共同进入完整回放，不向目标 Runtime 传递旧 Conversation Handle |
| Conversation 失效 | `session-recovery`，先恢复目标 Branch 历史 | 以恢复 Replay 为 `B`，再补充当前 Composer 的 `C` 节点 |

### 原子事务与并发

创建来源连接时，目标 Composer 代次、来源关系和 Canvas 变更必须在同一应用用例内完成所有者、来源与并发头节点校验。目标 Root/Fork Branch 由现有 Composer 创建流程生成；其 Conversation 仍由现有 `lazy-root` / `canonical-replay` 发送流程创建，连接操作不得另建平行 Branch 或 Conversation。Continue 在 Agent 不变时读取目标 Branch 已有 Conversation，改选 Agent 时通过 `agent-handoff` 新建目标 Conversation。发送时在一个数据库事务中：

1. 校验目标 Composer 代次仍然存在、来源集合未发生并发变化、目标 Agent 可用且没有未终止预留；
2. 解析结构化输入、当前附件和多来源上游资源；
3. 校验材料上限、文件可用性和目标 Runtime Capability；
4. 编译确定的来源文本、资源标记和附件清单；
5. 写入 Send Reservation、合并来源快照和 `turn_resource_references`；
6. 锁定 Branch，并由现有协调器异步派发。

创建预留后，连接端点必须拒绝对同一 Composer 代次追加新来源；连接与发送并发时以先成功提交的事务为准，失败方重新读取 Graph。Runtime 返回 `accepted` 后，创建 Interaction、推进目标 Branch 头节点、关联来源/资源快照并写入 `canvas_changes` 必须在同一事务完成。`rejected` 保留失败预留；`unknown` 保持 `ambiguous`，不能因超时解锁或新建另一条 Conversation。

### Graph、SSE 与恢复

Graph 和 SSE 需要投影当前 Composer 代次和已接受 Merge Interaction 的完整来源实体，前端只应用当前 Canvas 的完整 upsert。布局边由持久来源关系纯投影，不能从节点坐标猜测。连接成功的 HTTP 响应可以立即返回关系，但 SSE/Graph 仍是刷新和多页面收敛的权威投影。

失败恢复沿用 `failedSends`：除了现有 `inputDocument`、附件和安全资源快照，还必须返回该失败预留的来源快照。页面刷新后，前端用同一 Branch 恢复 Merge Composer 和多条来源边，不能退化为不含来源的普通 Composer。

Canonical Snapshot 需要能表达 Merge Turn 的来源标记、结构化输入和资源位置。Merge Branch 后续 Fork 或 Session Recovery 只重放已经被用户发送并由 Runtime 接受的合并 Turn，不重新读取来源 Branch 的最新头节点，也不把来源后续新增内容带入历史。

### 所有者、删除与安全

- 创建、读取和发送的每个来源都必须通过当前 owner 和 Canvas 联表解析；跨用户或跨 Canvas ID 统一按不可推断存在性的错误处理。
- 来源 DTO 只返回稳定公开 ID、安全名称/摘要和节点导航信息，不返回文件路径、内容哈希、Runtime Handle 或来源 Conversation 标识。
- 产品不提供删除单条 Merge Source Link 的入口；Canvas 删除仍可级联删除其 Branch、来源关系、预留和持久文件，且不反向修改任何 Runtime 原始 Conversation。
- 如果以后增加 Branch/Interaction 删除，必须先定义来源关系的阻止或降级规则；第一版不能通过级联删除来源而留下看似成功但材料缺失的合并历史。
- 诊断日志只记录结构化 ID、状态和错误码，不记录用户正文、编译材料或凭据。

## 实现分层

1. **领域与迁移**：Composer 代次、多来源关系、不可删除约束、来源顺序/快照、循环和所有者校验；`0.5.0 → 0.6.0` 的唯一 Canvas Composition 发布迁移同时新增关系表、预留快照列和节点级 Agent 归属，Schema Epoch 提升到 6。
2. **应用与发送**：Merge 创建用例、DAG 上游解析、合并材料编译、预留原子性、失败恢复和 Runtime Capability。
3. **HTTP 与同步**：来源命令/DTO、Graph/SSE 投影、明确错误码和伪造来源测试；契约确定后更新 `docs/API.md`。
4. **Canvas UX**：来源选择、Merge Composer、多来源边、键盘操作、布局和草稿恢复。
5. **端到端验证**：OpenClaw、Codex、OpenCode 的 Root/Fork 新 Conversation 合并派发、Continue 同 Agent 的原 Conversation 增量派发、Continue 改选 Agent 的完整回放、`@` 目录即时扩展、刷新/重启/断线恢复，以及现有 Root/Fork/Continue/Replay 回归。

## 验收条件

- Interaction 右侧保留现有 Source Handle 作为唯一 Merge 拖线点，Fork 按钮移到其上方；只有 `completed` Interaction 能发起连接，来源只能连接到当前 Canvas 的其他有效 Composer，不能连接到已有普通入边的直接下游 Composer；连接成功即持久化且不能删除、改序、重连或重复创建。
- 创建连接不会自动发送；Root/Fork 目标使用其新 Branch Conversation；Continue 在 Agent 不变时保持原 Branch Conversation，改选 Agent 时完整回放并创建新 Conversation。来源 Branch、Interaction 和 Conversation 不变。
- 每个 Composer 代次不设来源数量上限；逐条连接、目录分页和载荷/Runtime 限制保持有效。
- Merge Composer 复用现有结构化输入与 `@` 资源选择；连接成功后已经打开的候选菜单立即刷新，下一次查询也直接包含新来源完整路径，无关旁支和伪造来源均被拒绝。
- 后端按来源持久顺序构建完整路径 DAG，以 Interaction ID 对目标基础历史和全部来源去重并稳定拓扑排序；来源清单保留完整 `B/C` 路径，只把唯一新增上下文、资源引用、当前附件和用户指令按确定顺序编译。
- Adapter 只接收现有 `message + attachments`，不接收 Canvas ID 或多个 Conversation Handle。
- 本轮附件与显式资源引用继续遵守九槽位、内容去重、文件大小、路径安全、所有者和 Runtime Capability 约束。
- Runtime 接受前失败可在刷新和服务重启后恢复完整 Merge Composer；`ambiguous` 不会解锁或重复派发。
- 接受后的 Interaction、Graph/SSE、历史回放和后续 Replay 都保留准确来源，不读取来源 Branch 的后来内容。
- 多来源边和错误状态支持键盘与辅助技术，不只依赖颜色或鼠标拖拽。
- 现有文本发送、附件、资源引用、Root/Fork/Continue/Copy、发送重试、Session Recovery、Artifact 和所有者隔离测试保持通过。

## 已确认产品决策

1. Interaction 右侧只有两个产品操作：上方 Fork 按钮和右侧中点 Merge Handle；Merge 复用现有 Source Handle，不再叠加第三个点，也不禁用它的投影边锚点职责。
2. 只有执行状态为 `completed` 的 Interaction 可以作为来源。
3. 当前 Canvas 中任一真实存在且不以当前来源 Interaction 作为普通入边直接来源的 Composer 都可作为目标，包括其他活跃 Branch 末尾的 Continue Composer；Continue 在 Agent 不变时沿原 Conversation 继续并加入接入来源的增量上下文，改选 Agent 时完整回放并创建新 Conversation。
4. 每个 Composer 代次不设置来源数量上限，连接关系逐条保存且不可删除；发送仍受已有载荷和 Runtime 限制。
5. 连接保存成功后，目标 Composer 的 `@` 资源作用域立即包含新来源的完整上游路径。
