# Agent 运行端（Agent Runtime）Adapter 开发规范

本规范是新增或修改 Agent Runtime 的必读入口。Canvas 通用层只依赖 `server/lib/agent-runtimes/contract.ts`；任何原生协议、凭据、进程、Session/Thread、Run/Turn 或工具事件差异都必须封装在对应 Adapter 目录内。

## 目录与依赖方向

```text
server/lib/agent-runtimes/
  contract.ts                 # 唯一上层 Port、事件、Capability 与 Handle 类型
  manifest.ts                 # 无副作用的 Runtime ID 与展示名支持清单
  configuration.ts            # 已配置 Runtime 选择与通用校验
  definitions.ts              # 清单对应的 Adapter 实例工厂
  default-agent.ts            # 产品级默认 Agent 配置解析
  registry.ts                 # 生命周期与按 runtimeId 查找
  catalog.ts                  # Agent、状态的跨 Runtime 聚合
  usage-service.ts            # 用量与额度的跨 Runtime 应用服务
  adapters/
    <runtime-id>/
      index.ts                # 只导出公开 Adapter factory
      adapter.ts              # Port 实现与原生事件归一化
      config.ts               # 该 Adapter 专属环境变量、默认值与校验
      setup-support.ts        # setup 可使用的最小公开支持面（如需要）
      ...                     # 传输、进程、协议、Artifact、恢复等私有模块

scripts/lib/agent-runtimes/
  setup-registry.ts           # setup Driver 注册、统一探测与已选 Runtime 编排
  types.ts                    # RuntimeSetupDriver 契约
  catalog-probe.ts            # 通过统一 Runtime Port 读取可选 Agent
  <runtime-id>/               # Runtime 专属只读探测、连通性、配对与 setup 辅助
```

进程组合根是 `server/application-context.ts`，它显式创建 Registry 与 Canvas Store、启动后台协调器，并统一关闭协调器、Runtime 和数据库；Store 必须沿 Worker、投递构建、事件消费和 Reconciler 链路显式注入，不得在这些链路中重新获取模块级 Store。一个服务进程只允许一个活动 ApplicationContext，重复启动不同上下文必须明确失败，不能静默复用另一数据库的协调器。不得重新增加全局 Registry 单例或让模块导入时隐式连接 Runtime。Canvas application、Route 和 Coordinator 可以依赖纯 `contract` 以及 Registry/Catalog 等应用服务；Canvas `model` 与 `domain` 只能依赖自身层和纯类型的 Runtime `contract.ts`，不得依赖 Registry、具体 Adapter、传输、持久化或 application service。`persistence` 可以依赖 model/domain 与纯 Runtime Contract，外部同步工厂必须通过 `application/ports.ts` 注入。通用代码不得导入 `adapters/*`，不得检查 `runtimeId === "openclaw"` 后调用原生能力，也不得解析 Handle 的 `opaque`。只有 `definitions.ts` 可导入完整 Adapter factory，`configuration.ts` 可导入 Adapter 的配置校验；`registry.ts` 只消费 Definition。ESLint 对全部 Canvas 业务模块和 Route 使用目录模式阻止具体 Adapter 导入，新增文件不需要手工加入白名单。

## 注册与 Agent 目录

- `AGENT_RUNTIMES` 是逗号分隔的 Runtime 类型列表；未知值、重复配置语义或空列表必须在启动时明确失败。
- 新 Adapter 必须同时向纯数据 `manifest.ts` 增加 ID/展示名、向 `definitions.ts` 增加由 TypeScript 完整性检查约束的实例工厂，并在 setup registry 注册探测/配置驱动；每个 Registry 必须得到独立 Adapter 对象，`close()` 只能释放该实例拥有的资源或租约。专属配置校验由 Adapter `config.ts` 提供并由 `configuration.ts` 组合。不得另外维护支持数组、注册链式 `if/else` 或把专属环境变量加回通用 `server/lib/config.ts`。
- 当前模型中同一 Adapter 类型最多一个实例，因此稳定 `runtimeId` 就是类型 ID。未来若需要多实例，必须先扩展配置模型，不能悄悄复用同一 ID。
- 每个 Adapter 返回自己的 Agent Profile；`catalog.ts` 按配置顺序、各 Runtime 默认 Profile、原生顺序形成一个扁平目录。
- 所有 Profile 在产品中平权。setup 配置完成后通过统一 Port 选择 `CONVOSKETCHPAD_DEFAULT_AGENT_RUNTIME + CONVOSKETCHPAD_DEFAULT_AGENT_PROFILE`；新建 Canvas 不弹窗，优先绑定可用的配置默认项，否则回退到目录中的第一个可用 Profile。首次持久发送预留前可以修改，预留创建后永久锁定。
- Runtime 断开时可展示最后一次成功发现的 Profile，但必须标为不可用，不能用陈旧目录执行发送。

## setup 探测与配置

- 发现必须只读、快速、可超时，只确认本机入口与版本；不得启动 Runtime、修改外部配置、读取 Token/凭据或为了判断“已配置”而调用原生配置命令。`RuntimeSetupDriver.detect()` 只接收通用层净化后的 `configured` 和可选 `configuredExecutable`，不得接收完整 `EnvConfig`。`detected` 表示本机入口存在，`configured` 只表示 ConvoSketchpad 已启用该 Runtime；最终可用性仍由 Runtime Port 的连接状态决定。
- setup 先展示全部支持项：已探测与未探测分组，多选后只对用户选择项逐个执行 `RuntimeSetupDriver` 的配置、校验和摘要输出，并且 `.env` 生成器只输出已选 Runtime 的专属配置段。未探测项必须仍可选择，以支持远程 Runtime 或用户显式路径；通用 setup 不得直接读取某个 Adapter 的探测详情或配置键。
- CLI 型 Runtime 优先用不涉及凭据的稳定原生命令（例如 `--version`）发现。遵循显式环境变量路径优先、否则由 `PATH` 解析的规则；不要扫描 Homebrew、npm、Volta、fnm 等安装器私有目录。若受管服务可能使用不同 PATH，setup 可把已成功解析的绝对路径持久化。只有用户选中该 Runtime 后，Driver 的配置阶段才可调用受支持的原生命令读取 URL/Token 等预填值。
- setup 专属代码只能经 Adapter 的 `setup-support.ts` 使用最小公开支持面；Runtime 特有的连接探测、配对与原生配置辅助必须放在 `scripts/lib/agent-runtimes/<runtime-id>/`，通用 `validators.ts` 只保留 URL、端口、Host 等协议无关校验。不得直接导入内部传输或读取本地凭据/工作区文件。Codex 等受监督 App Server 仍必须遵守“不调用 CLI 获取 Provider、用量或配额”的边界。
- Runtime 配置、配对完成后，Agent 选项必须通过 `AgentRuntime.listAgentProfiles()` 获取，不得由 setup 再实现一套原生 Agent 查询。目录暂时不可用时保留已有默认项或不写显式默认项，不能伪造 Agent。
- 新的 Runtime 环境变量要进入 `.env.example`、env writer、配置校验和更新器快照/回滚覆盖。通用 setup CLI 不接受 Runtime 专属参数袋；自动化配置使用正式环境变量，交互配置由所选 Driver 自己询问。仅增加 Runtime 或默认 Agent 配置通常不需要数据库迁移。
- setup、迁移和更新命令必须在产生副作用前拒绝未知或互斥参数；`--help` 必须可以在不打开数据库、不连接 Runtime 的情况下执行。数据库迁移只能在服务归属当前安装且明确离线时运行；没有可验证的服务管理器时必须推迟到启动迁移，或由操作者停止全部进程后显式确认离线。所有显式维护命令共用维护锁。
- 安装器只能调用统一 setup；不得读取某个 Runtime 的原生配置、直接写 Runtime 环境段或在 setup 失败后回退到 Adapter 专属生成逻辑。兼容参数只能作为显式输入传给用户已选 Runtime 的 Driver，`--skip-setup` 只能复用已经存在的 `.env`。

## Port 与不透明 Handle

Adapter 必须实现 `AgentRuntime` 的完整 Port。Conversation、Turn、Artifact、Approval 使用：

```ts
interface RuntimeHandle {
  runtimeId: string;
  schemaVersion: number;
  opaque: Record<string, string>;
}
```

`opaque` 只保存重连、读取和解析所需的最小原生标识。不得保存 Token、Cookie、环境变量、完整命令环境或其他凭据。通用层只比较/持久化整个 Handle 并原样交还 Adapter。

Capabilities 必须描述产品语义而非方法名，尤其包括输入图片、图片生成、Artifact、交互审批、幂等派发、未知结果核对、账户用量和额度。`output.imageGeneration` 必须返回 `supported | unsupported | unknown`：只有原生能力可证实时才使用前两者，方法表或 Artifact 文件扩展名不足以证明时返回 `unknown`。连接或协议能力变化后要随状态重新发布。

## 事件与审批

所有原生事件先归一化为 `RuntimeEvent`。终态与审批 required/resolved 进入 `runtime_event_inbox`，去重键必须包含 `runtimeId`，不能假设不同 Runtime 的原生事件 ID 全局唯一；流式文本只做瞬时 Preview。事件带显式 Turn Handle 时必须严格按该 Handle 关联，未命中不能降级猜测当前 Conversation 的另一个 Turn；仅缺少 Turn Handle 时才允许以 Conversation 的唯一候选恢复。审批 resolved 按 Approval Handle 收敛，即使所属 Interaction 已终止也必须可处理；其 Choice 必须存在于已持久化摘要，授予权限必须是请求权限的子集，拒绝 Choice 不得携带授予权限。任何不满足契约的原生结果都必须记为 `unconfirmed`，不得默认成功。全局断线状态由 Runtime Status/SSE 传播，不写入 Canvas durable inbox；如未来某种断线事实确实改变单个 Turn，必须先投影成明确的 Turn 事件。

审批摘要必须是可直接展示且已净化的数据：类别、标题、描述、风险、权限列表、选择列表、作用域、是否需二次确认和到期时间。不得把原始环境或凭据投影给 Canvas。前端在所属 Interaction 节点内展示审批；持久授权等扩大作用域的选择必须标记 `requiresConfirmation`。前端必须取得显式确认并发送 `confirmed: true`，服务端仍按已持久 Choice 独立校验，不能信任 UI。Route 只能调用 `resolveApproval()`，不能调用原生审批 RPC。

Adapter 必须区分审批结果：

- `accepted`：Runtime 已确认，节点状态转为 resolved/denied；
- `rejected`：保留为 pending 并展示可重试错误；
- `unknown`：转为 unconfirmed，等待原生 resolved 事件或后续核对，不能盲目重发。

## 派发、恢复与 Artifact

- `dispatchTurn()` 必须区分 `accepted`、`rejected`、`unknown`。只有有明确幂等保证时才能重发可能已经写出的请求。
- `unknown` 应尽量返回可持久化的最小 `recoveryRef`。非幂等 Runtime 必须实现 `reconcileDispatch()`，只有返回 `not_found` 才能重新派发；返回 `accepted` 时必须复用权威 Turn，返回 `unknown` 时保持 Reservation 为 `ambiguous`。若既不幂等也不能核对，Worker 会保持锁定且不会重发。
- Adapter 负责权威 Conversation/Turn 检查；Canvas 负责 Reservation、Branch 锁、Interaction 追加和 Canonical Replay。
- 输入附件来自 Canvas 已持久化副本。Adapter 不得接受浏览器路径或跨所有者读取。
- `materializeArtifact()` 只能处理结构化 Artifact Handle 或明确的源 URI；不得扫描整个工作区猜测输出。
- 返回文件仍须经过大小、MIME、路径/符号链接和所有者检查，随后立即复制到 Canvas 存储。
- 图片生成通过 `output.imageGeneration` Capability 与结构化 Artifact 表达，不在通用层根据文件扩展名推断。

## 状态与用量聚合

- `/api/runtime/status` 返回每个 Runtime 状态以及 `ready | degraded | connecting | unavailable` 总态；部分 Runtime 失败不得隐藏健康 Runtime。
- `getStatus()` 必须是无副作用快照读取；不得因为导航栏、健康检查、聚合发布或状态订阅回调读取状态而创建连接、重置退避或绕过重连计时器。连接只能由明确的 Adapter 生命周期、操作调用和受控重连调度驱动，并须测试不可达 Runtime 不会形成热循环或日志风暴。
- Agent 目录与状态可并行读取；单个 Runtime 失败必须局部降级。
- `/api/runtime/usage` 保留每个 Runtime 的用量和 Provider 额度分组。Token、额度窗口、Provider 名称不可跨 Runtime 相加。
- 只有所有已配置 Runtime 均可连接、所有声明支持账户费用的 Runtime 都成功返回 `additive=true` 的费用，且币种和统计周期一致时，服务端才返回 `comparableCostTotal`；缺失数据不能伪装成全局合计。
- Branch 数、工作中数量和上下文 Meter 属于当前 Canvas，不参与账户级聚合。

## 数据库与迁移

通用表只使用 `runtime_id`、`agent_profile_id`、`conversation_*`、`runtime_turn_id`、`turn_ref_json`、`runtime_artifact_*`、`execution_metadata_json` 和 `runtime_event_inbox`。不得为新 Adapter 增加顶层协议字段或双写别名。

迁移必须事务化、幂等，并通过 `PRAGMA foreign_key_check` 与 `integrity_check`。setup、独立 migrate 与 update 必须共享维护锁，锁按获取时的精确路径释放。服务管理必须同时验证固定名称、工作目录和启动命令属于当前安装，并把运行状态表达为 `active | inactive | unknown`；未知状态失败关闭。只有服务明确离线时才能快照、迁移或恢复 SQLite，恢复前还需再次复核离线。setup 重启后验证状态、健康和版本；若无法停止重启后的服务，不得覆盖数据库，并保留快照。没有匹配服务管理器时 setup/update 推迟到下次启动，独立 migrate 则要求操作者停止全部手工进程并显式确认离线。Runtime 环境键迁移不打开数据库，因此即使没有服务管理器或使用 `--no-restart` 也必须执行。

不要仅因新增 Adapter 或实现已有 Port 方法而创建数据库迁移。先确认通用 Handle、`execution_metadata_json` 或 `dispatch_recovery_ref_json` 是否已能表达；只有持久 Schema 或既有数据必须变化时才新增发布迁移。`0.4.0` 的正式账本保持三项。

## 测试与文档验收

每个 Adapter 至少覆盖：Profile 发现与默认顺序、Capability、连接/重连、派发三态、终态去重、Conversation/Turn 恢复、审批 required/resolved/unknown、Artifact/图片、安全路径、用量/额度不可用和关闭清理。还必须通过通用 Canvas 的所有者、锁定、Replay、数据库迁移和公开 DTO 测试。

新增 Adapter 时同步更新 `.env.example`、`docs/CONFIGURATION.md`、`docs/INSTALL.md`、`docs/TROUBLESHOOTING.md`、`docs/SECURITY.md`、`docs/ARCHITECTURE.md`、`docs/API.md`、Canvas 代码地图和 `CHANGELOG.md`。
