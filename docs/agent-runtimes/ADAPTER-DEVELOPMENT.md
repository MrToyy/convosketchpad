# Agent 运行端（Agent Runtime）Adapter 开发规范

本规范是新增或修改 Agent Runtime 的必读入口。Canvas 通用层只依赖 `server/lib/agent-runtimes/contract.ts`；任何原生协议、凭据、进程、Session/Thread、Run/Turn 或工具事件差异都必须封装在对应 Adapter 目录内。

## 目录与依赖方向

```text
server/lib/agent-runtimes/
  contract.ts                 # 唯一上层 Port、事件、Capability 与 Handle 类型
  config.ts                   # 已配置 Runtime 类型；同一类型最多一个实例
  registry.ts                 # 生命周期与按 runtimeId 查找
  catalog.ts                  # Agent、状态的跨 Runtime 聚合
  adapters/
    <runtime-id>/
      index.ts                # 只导出完整 Adapter
      adapter.ts              # Port 实现与原生事件归一化
      ...                     # 传输、进程、协议、Artifact、恢复等私有模块
```

依赖只能从 Canvas/Route/Coordinator 指向 `contract`、`registry`、`catalog`。通用代码不得导入 `adapters/*`，不得检查 `runtimeId === "openclaw"` 后调用原生能力，也不得解析 Handle 的 `opaque`。只有 `registry.ts` 负责组合具体 Adapter。

## 注册与 Agent 目录

- `AGENT_RUNTIMES` 是逗号分隔的 Runtime 类型列表；未知值、重复配置语义或空列表必须在启动时明确失败。
- 当前模型中同一 Adapter 类型最多一个实例，因此稳定 `runtimeId` 就是类型 ID。未来若需要多实例，必须先扩展配置模型，不能悄悄复用同一 ID。
- 每个 Adapter 返回自己的 Agent Profile；`catalog.ts` 按配置顺序、各 Runtime 默认 Profile、原生顺序形成一个扁平目录。
- 所有 Profile 在产品中平权。新建 Canvas 不弹窗，自动绑定目录中的第一个可用 Profile；首次持久发送预留前可以修改，预留创建后永久锁定。
- Runtime 断开时可展示最后一次成功发现的 Profile，但必须标为不可用，不能用陈旧目录执行发送。

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

Capabilities 必须描述产品语义而非方法名，尤其包括输入图片、图片生成、Artifact、交互审批、幂等派发、未知结果核对、账户用量和额度。连接或协议能力变化后要随状态重新发布。

## 事件与审批

所有原生事件先归一化为 `RuntimeEvent`。终态、审批 required/resolved 和需要恢复的断线事实进入 `runtime_event_inbox` 去重；流式文本只做瞬时 Preview。

审批摘要必须是可直接展示且已净化的数据：类别、标题、描述、风险、权限列表、选择列表、作用域、是否需二次确认和到期时间。不得把原始环境或凭据投影给 Canvas。前端在所属 Interaction 节点内展示审批；持久授权等扩大作用域的选择必须标记 `requiresConfirmation`。Route 只能调用 `resolveApproval()`，不能调用原生审批 RPC。

Adapter 必须区分审批结果：

- `accepted`：Runtime 已确认，节点状态转为 resolved/denied；
- `rejected`：保留为 pending 并展示可重试错误；
- `unknown`：转为 unconfirmed，等待原生 resolved 事件或后续核对，不能盲目重发。

## 派发、恢复与 Artifact

- `dispatchTurn()` 必须区分 `accepted`、`rejected`、`unknown`。只有有明确幂等保证时才能重发可能已经写出的请求。
- Adapter 负责权威 Conversation/Turn 检查；Canvas 负责 Reservation、Branch 锁、Interaction 追加和 Canonical Replay。
- 输入附件来自 Canvas 已持久化副本。Adapter 不得接受浏览器路径或跨所有者读取。
- `materializeArtifact()` 只能处理结构化 Artifact Handle 或明确的源 URI；不得扫描整个工作区猜测输出。
- 返回文件仍须经过大小、MIME、路径/符号链接和所有者检查，随后立即复制到 Canvas 存储。
- 图片生成通过 `output.imageGeneration` Capability 与结构化 Artifact 表达，不在通用层根据文件扩展名推断。

## 状态与用量聚合

- `/api/runtime/status` 返回每个 Runtime 状态以及 `ready | degraded | connecting | unavailable` 总态；部分 Runtime 失败不得隐藏健康 Runtime。
- Agent 目录与状态可并行读取；单个 Runtime 失败必须局部降级。
- `/api/runtime/usage` 保留每个 Runtime 的用量和 Provider 额度分组。Token、额度窗口、Provider 名称不可跨 Runtime 相加。
- 只有所有已配置 Runtime 均可连接、所有声明支持账户费用的 Runtime 都成功返回 `additive=true` 的费用，且币种和统计周期一致时，服务端才返回 `comparableCostTotal`；缺失数据不能伪装成全局合计。
- Branch 数、工作中数量和上下文 Meter 属于当前 Canvas，不参与账户级聚合。

## 数据库与迁移

通用表只使用 `runtime_id`、`agent_profile_id`、`conversation_*`、`runtime_turn_id`、`turn_ref_json`、`runtime_artifact_*`、`execution_metadata_json` 和 `runtime_event_inbox`。不得为新 Adapter 增加顶层协议字段或双写别名。

迁移必须事务化、幂等，并通过 `PRAGMA foreign_key_check` 与 `integrity_check`。setup 会停受管服务、创建一致性快照、迁移并在失败时恢复；更新器采用同一安全顺序。手动启动仍会在监听前执行迁移。

## 测试与文档验收

每个 Adapter 至少覆盖：Profile 发现与默认顺序、Capability、连接/重连、派发三态、终态去重、Conversation/Turn 恢复、审批 required/resolved/unknown、Artifact/图片、安全路径、用量/额度不可用和关闭清理。还必须通过通用 Canvas 的所有者、锁定、Replay、数据库迁移和公开 DTO 测试。

新增 Adapter 时同步更新 `.env.example`、`docs/CONFIGURATION.md`、`docs/INSTALL.md`、`docs/TROUBLESHOOTING.md`、`docs/SECURITY.md`、`docs/ARCHITECTURE.md`、`docs/API.md`、Canvas 代码地图和 `CHANGELOG.md`。
