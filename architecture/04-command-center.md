# 04 · 原子命令中心：一个意图，一条命令，一次撤销

> **TL;DR**
> TvE Hub 把“用户想做的事”收敛成命令：`id + label + group + canRun + run`。
> 工具栏、快捷键、右键菜单、TCP、MCP、内置助手，凡是需要编辑器状态的操作，都
> 通过同一个注册表和同一个执行器调用命令。命令只做编排，真正的场景写由引擎/
> 后端执行，并进入撤销历史。一条命令对应一个用户意图、一次撤销、一个权限区域、
> 一条观测记录——这就是“原子”的含义。
>
> 本文主要讲**编辑器语义命令**（`node.*` / `scene.*` / 预览 / 构建等）。纯后端
> 方法（`project.create`、`scene.write`、`asset.write`、`file.*` 等）由 Rust
> 本地执行器直答，不走前端注册表，但共享同一套权限门、路径检查与格式校验；
> 详见 [02 TCP 指令集](02-tcp-command-set.md)。

---

## 1. 问题：入口越多，越容易长出多套实现

一个编辑器天然有很多入口：

```text
工具栏按钮   快捷键   右键菜单   拖放   首页   命令行   TCP/MCP   内置助手
     │          │        │        │      │       │        │          │
     └──────────┴────────┴────────┴──────┴───────┴────────┴──────────┘
                                   │
                                   ▼
                          “删除节点”到底走哪段代码？
```

如果没有统一层，常见结果是：

- 工具栏删节点走 `store.deleteSelected()`；
- 快捷键删节点走 `engine.deleteNodes()`；
- 右键菜单删节点走另一段带确认框的逻辑；
- Agent 删节点直接改 JSON。

四段代码对“根节点能不能删”“多选时父子节点怎么去重”“删除后选中谁”“撤销标签
叫什么”的回答各不相同。用户看到的是同一个产品，行为却随入口变化。

命令中心就是为消灭这种分叉而存在的。

---

## 2. 命令模型

`src/app/commands/types.ts` 定义了一条命令：

```ts
interface EditorCommand<A = unknown> {
  id: string;          // 全局唯一，如 node.add
  label: string;       // 展示名（工具栏/菜单/权限清单）
  group: string;       // 分组（编辑器/场景/节点/资源…）
  expose?: boolean;    // 是否暴露给 devtools/MCP
  description?: string;// 远程入口的描述（给 Agent 读）
  canRun?: (ctx) => boolean; // 可用性判定
  run(ctx, args: A): unknown | Promise<unknown>; // 执行主体
}
```

执行上下文只有轻量快照：

```ts
interface CommandContext {
  view: "home" | "editor";
  hasProject: boolean;
}
```

它故意不塞引擎实例、store 或 DOM。命令内部按需获取依赖，这样注册表可以被两个窗口
（首页/编辑器）共同导入，而不会在首页首屏把整个引擎拖进来。

---

## 3. 注册与执行

### 3.1 自注册

每条命令在模块加载时调用 `registerCommand`。`src/app/commands/index.ts` 导入
`editorCommands`、`nodeCommands`、`assetCommands`、`remoteCommands`，入口只要
`import "./commands"`，注册表就是全量的。

```text
入口 main.ts / home-main.ts
   │
   └─ import "./commands"
         ├─ editorCommands.ts   editor.undo / editor.save / editor.close …
         ├─ nodeCommands.ts     node.add / node.delete / node.set …
         ├─ assetCommands.ts    asset.* 的 UI 侧动作
         └─ remoteCommands.ts   editor.state / project.build / preview.* …
```

重复 id 会 `console.warn` 并覆盖，方便 HMR 热替换；生产代码不应依赖这个行为。

### 3.2 两个执行入口

| 函数 | 语义 | 使用方 |
| --- | --- | --- |
| `dispatchCommand(id, args)` | 永不抛错；返回 `{ok:true,value}` 或 `{ok:false,skipped/error}` | UI 事件、工具栏、快捷键 |
| `runCommand(id, args)` | 失败抛 `Error`；`skipped` 视为成功但返回 `undefined` | 组件 `await`、devtools/MCP（要把错误回给客户端） |

`dispatchCommand` 的流程：

```text
查命令 → 无 → {ok:false, error:"未知命令"}
  │
  ├─ canRun? → false → {ok:false, skipped:true}
  │            → 抛错 → 按不可用处理（不让整条 dispatch 静默 reject）
  │
  ├─ await run(ctx,args)
  │     ├─ 返回 undefined → {ok:true}
  │     └─ 返回值        → {ok:true, value}
  │
  └─ 异常 → logStore 记错误 → {ok:false, error}
```

`canRun` 是“当前上下文能不能做”，不是权限门。典型用途：

- 焦点在输入框里时，不劫持 `Ctrl+Z`，让 WebView 的文本撤销生效；
- 非编辑器视图（首页/脚本/预览）不执行场景命令；
- 编辑器未挂载时，`node.add` 直接不可用；
- 地形绘制期间，不切换 gizmo。

---

## 4. 原子性到底指什么

这里的“原子”不是数据库事务的 ACID，而是**语义原子**：

> 一条命令 = 一个用户意图 = 一次撤销 = 一条权限区域 = 一条观测记录。

### 4.1 一条命令，一次撤销

场景写的权威在 Rust：

```text
前端命令
  → 乐观应用镜像 + 广播 SceneChange
  → 提交后端（Tauri 命令）
  → 后端构造 SceneCmd + before/after 快照
  → 执行 + push 到撤销栈
  → 广播 scene:changed
  → 前端回填/校正镜像
```

`src-tauri/src/scene/history.rs` 的命令枚举：

| 命令 | 撤销方式 |
| --- | --- |
| `Add` | 移除新增子树 |
| `AddTree` | 移除整棵新子树（预制体实例化） |
| `RemoveNodes` | 首次执行捕获子树，undo 逆序重挂 |
| `ReparentNodes` | 首次执行记录旧父级/旧位置，undo 还原 |
| `Rename` | 改回旧名 |
| `SetTransform` | 回填 before 快照 |
| `PatchNode` | 回填 before 节点快照 |
| `PatchNodes` | 批量回填（多选批量编辑一次撤销） |

“批量删除”“批量改属性”“一次挂组件”都只产生**一条**撤销记录。用户按一次
`Ctrl+Z`，回到操作前，而不是回到中间某个半完成状态。

### 4.2 乐观应用 + 串行提交 + 失败回滚

`SceneClient` 的写路径（`src/framework/scene/SceneClient.ts`）：

```text
本地先改镜像（用户立即看到结果）
  → 标记该节点有在途提交
  → 进入 mutationChain 串行链
  → 后端按提交顺序执行
  → 失败：回滚镜像（恢复 before）并记日志
  → 成功：回显落定，释放在途标记
```

两个关键机制：

- **串行链**：Tauri 命令在线程池并发执行，同窗口先后提交不保证到达顺序；整节点
  快照式补丁一旦乱序落盘，旧快照会覆盖新编辑。链保证后端按提交顺序执行。
- **在途回显抑制**：快速连续编辑时，回显可能滞后于本地乐观态；无条件回填会把
  新编辑打回，造成属性面板数值跳变。在途期间跳过该节点的回显回填，保证
  “本地乐观态 ≥ 回显态”。

### 4.3 保存前等待落账

`quiesceWrites()` 等待全部在途后端写提交落定。前端保存路径
（`saveCurrentSceneToMain`）必须先等它，否则 `scene.save` 序列化的后端快照可能
落后于前端所见——真实事故是“批量建节点后立即保存，最后 2~3 条操作丢失”。

需要区分：TCP/MCP 的 `scene.save` 由 Rust 本地直答，直接序列化后端会话，不经过
前端的 `quiesceWrites`。如果调用方刚通过远程接口发起过写操作，应先确认后端已
落账（例如读一次 `scene.tree` 对照），再保存；编辑器内的保存路径则自带等待。

---

## 5. 多入口收敛

| 入口 | 进入方式 | 最终执行 |
| --- | --- | --- |
| 工具栏/菜单/快捷键 | `dispatchCommand(id, args)` | 命令 `run` |
| 右键菜单/拖放 | `dispatchCommand` | 命令 `run` |
| TCP JSON Lines | 方法 → `METHOD_TO_COMMAND` → `runCommand` | 命令 `run` |
| MCP | 工具名 → 真实方法 → 同上 | 命令 `run` |
| 内置助手 | `brain_execute` → 内部通道 → 方法 → 命令 | 命令 `run` |

表里是**前端命令路径**。Rust 本地方法（`project.create`、`scene.write`、
`asset.write`、`file.*` 等）不经过命令注册表，由 `try_local` 直接应答；它们仍在
同一方法契约、同一权限门和同一数据/引擎校验之下，只是没有前端撤销历史。

因此，“Agent 能做什么”不是另写一份工具实现，而是**把能力表暴露出去**（前端命令
+ Rust 本地方法）。`expose: true` 的命令才有远程描述；`METHOD_TO_COMMAND` 决定
方法名到命令 id 的映射。

这带来一个重要的工程约束：**新增能力时，实现只写一次。** 如果某个入口需要
不同的参数形态，在适配层做归一（例如 `node.remove` 的 `{id}` → `{ids:[id]}`），
不要复制一份实现。

---

## 6. 命令内部的边界设计

命令层负责“解析、校验、编排”，不负责“直接改场景”。以几个高风险命令为例。

### 6.1 `node.set`：属性域与部分合并

`src/app/commands/nodeSet.ts` 把参数解析成三类补丁：

```text
{ id, prop, value }        单属性
{ id, ...fields }          字段包
  ├─ name                  → 重命名
  ├─ transform/position/rotation/scale → 逐轴部分合并
  └─ 其余属性              → 整值补丁（一次撤销）
```

关键规则：

- **身份/层级字段不可改**：`id`、`childIds`、`parentId`、`children`、`type` 在
  禁止清单里；换父级用 `node.reparent`，换类型用删+加。
- **变换逐轴合并**：只给 `position.x` 时，`y/z` 保持原值，不整包覆盖；未知分量
  报错并回喂。
- **数值校验**：`Number.isFinite`；非数值直接报错，不做静默转换。
- **错误可回喂**：抛出的是人可读的原因，助手会把它作为 `{error}` 回喂模型自纠。

当前实现中，`props` 是“除禁止清单外的任意字段整值补丁”，没有逐字段 schema。
这给了灵活性，也意味着 `materialSettings` 等复杂结构可以被整体替换。边界靠
禁止清单 + 引擎补丁 + 撤销历史兜底；如果未来要收紧，应该在这里加字段级白名单，
而不是在提示词里劝模型“别乱写”。

### 6.2 `node.add`：类型解析与父级别名

`src/app/commands/nodeCommands.ts` 对 `kind` / `subtype` / `parent` / `parentId`
做归一：

- `kind` 支持 `group/mesh/light/camera/skybox/fog/audio/particle/terrain/nav/logic/ui/model`
  及若干别名；
- `mesh` 的 `subtype` 走几何类型白名单，未知回退 `box`；
- `light` 的 `subtype` 走灯光类型白名单；
- `parent` 是 `parentId` 的别名，值可以是节点 id 或 `"root"`；
- 父级缺省策略由引擎决定（“只认容器型”的隐式父级规则），命令层不擅自猜测。

### 6.3 `node.delete`：根保护与子孙去重

- 根场景节点不可删除；
- 多选时剔除互为子孙的冗余项，只保留顶层，避免父删后子再删的重复；
- 删除子树由后端 `RemoveNodes` 捕获，undo 逆序重挂。

### 6.4 `node.component.add`：脚本不是子节点

用户说“给节点挂脚本”，模型常写成 `node.add kind=script`。命令层不做语义改写，
但助手通道会在 `execAssistantTool` 里把这种形态改写成 `node.component.add`，并
在缺目标/缺脚本路径时回喂教学错误。这是一个典型的“入口适配层吸收模型方言”
的例子：命令本身保持干净，方言处理留在助手适配层。

---

## 7. 为什么这套设计让 Agent 更安全

| 风险 | 没有命令中心 | 有命令中心 |
| --- | --- | --- |
| 未知能力 | Agent 直接调内部函数/写文件 | 方法表里没有就调不到 |
| 绕过撤销 | 直接改内存/JSON | 写走 `SceneCmd`，一次命令一次撤销 |
| 参数畸形 | 半截写入，项目损坏 | 解析/校验失败即拒绝，错误可回喂 |
| 行为分叉 | 每个入口一套逻辑 | 一条命令，所有入口一致 |
| 权限遗漏 | 新入口忘记加检查 | 权限映射挂在方法/命令上，测试可扫描 |
| 无法审计 | 只知道“文件变了” | 方法名、参数、结果、耗时、来源都有记录 |

“原子”不是为了代码好看，而是为了让 Agent 的每次操作都成为**可回滚、可解释、
可拒绝的最小单元**。

---

## 8. 文件写通道：命令中心之外的受控旁路

必须区分两类写：

1. **编辑器语义写**：`node.*` / `scene.*` / `state.restore` / `asset.select` 等，
   作用于编辑器会话和场景镜像，走命令中心 + 撤销历史。
2. **项目文件写**：`asset.write` / `scene.write` / `shader.write`，由 Rust 本地
   直接落盘，**不经过编辑器镜像**，但有独立的格式锁和校验：
   - `asset.write`：拒绝 `.scene`（引导到 `scene.write`）、`.shader`（引导到
     `shader.write`）、引擎管理格式、根 `*.config.json`、`internal/`；
   - `scene.write`：必须是合法 JSON 对象，`root` 必须是 `empty` 标记或可反序列化
     的 `NodeData`；
   - `shader.write`：必须有 `Shader "组/名"` 指令行，且通过引擎解析器
     （Base/钩子/属性行）。

这不是“绕过命令中心”，而是**明确分工**：会话状态写要撤销历史；文件内容写要格式
校验。两者共享路径安全检查（`workspace_path_of` 拒绝空路径、`..`、反斜杠）和
体积上限。

---

## 9. 扩展一条命令

1. 在对应域文件里 `registerCommand({...})`，确保 id 全局唯一。
2. 选择是否 `expose: true`；远程可用的命令必须有 `description`。
3. 在 `src/app/lib/devtools/state.ts` 加 `MCP_TOOLS` 与 `METHOD_TO_COMMAND`。
4. 在 `src-tauri/src/devtools.rs` 加权限工具映射（若需要独立开关）。
5. 在 `src-tauri/src/brain/policy/zones.rs` 登记方法区域（只读进绿灯表）。
6. 在 `src/assistant-window/tools.ts` 加助手目录条目（若希望助手直接可用）。
7. 补测试：参数解析、失败路径、远程映射、区域一致性。

漏掉第 3~6 步的任意一步，都会造成“某个入口看不见/调不到/门控不认识”的漂移。
仓库里的 `tve-self-evolution` 技能与 `skills:check` 门禁就是为这类漂移准备的。

---

## 10. 边界与限制

- **命令层不是类型安全的 schema 系统。** 远程参数最终是 `unknown`，靠各命令自己
  解析；复杂属性（如材质设置）没有逐字段 schema。
- **`canRun` 不是权限。** 它只处理上下文可用性；真正的权限在 Rust 侧。
- **命令可以返回 `undefined`。** `dispatchCommand` 视为成功；需要结构化结果的
  调用方应返回对象。
- **撤销历史是会话级的。** 关闭项目/重启后不保留；它不是版本控制。
- **文件写没有撤销。** `asset.write` / `scene.write` 覆盖原文件；需要版本控制或
  备份。命令中心的撤销只覆盖编辑器会话内的场景写。

---

## 11. 事实源

| 内容 | 文件 |
| --- | --- |
| 命令类型/上下文 | `src/app/commands/types.ts` |
| 注册表与执行器 | `src/app/commands/registry.ts` |
| 命令总出口 | `src/app/commands/index.ts` |
| 编辑器命令 | `src/app/commands/editorCommands.ts` |
| 节点命令 | `src/app/commands/nodeCommands.ts` |
| `node.set` 参数解析 | `src/app/commands/nodeSet.ts` |
| 远程域命令 | `src/app/commands/remoteCommands.ts` |
| 远程方法映射 | `src/app/lib/devtools/state.ts`、`handlers.ts` |
| 场景撤销命令 | `src-tauri/src/scene/history.rs` |
| 场景权威状态 | `src-tauri/src/scene/mod.rs`、`graph.rs` |
| 前端镜像/乐观写 | `src/framework/scene/SceneClient.ts` |

**下一篇：** [05 权限门](05-permission-gate.md) —— 命令中心给了 Agent 能力，
权限门决定它能在什么边界内使用这些能力。
