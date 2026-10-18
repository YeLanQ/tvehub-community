# 03 · 两套协议，一张能力面：TCP 指令集与 MCP 的分工

> **TL;DR**
> TvEHub Community 同时提供 TCP JSON Lines 与 MCP（JSON-RPC）两套协议，但它们**不是两套
> 能力、也不是两套实现**。方法表是唯一语义契约，命令注册表是唯一执行路径；两者
> 同属首页的「开发者服务」，共用同一端口、工具权限和调用记录。TCP 是可直接驱动
> 的原生接口（外部 Agent 工具只要能说 JSON Lines 就能接入），MCP 面向标准宿主，
> 内置助手则走进程内通道。三者的差别在传输、发现方式和结果形态，不在“能做什么”。

---

## 1. 先回答“为什么不能只留一套”

### 1.1 只留 MCP 会怎样

MCP 是一个面向外部 Agent 的互操作标准，优点是生态通用、客户端现成、有
`tools/list` 发现机制。但如果把它当成应用内部唯一的控制面，会付出四个代价：

- **推送能力丢失。** MCP 的基本形态是请求/响应；TCP 连接可以主动推 `log` 等事件。
  编辑器的运行日志、状态变化、长任务进度，用 MCP 表达要么缺失，要么需要额外
  定义通知语义。
- **长任务与超时模型不匹配。** 转发到前端的 MCP HTTP 调用当前是 12 秒等待；
  构建、打开项目这类分钟级操作需要更长的等待或异步任务协议。
- **多一层进程/HTTP 开销。** 应用内助手每次调工具都要走一次 MCP 客户端语义，既
  多一跳，也把“内置能力”绑到了对外协议的版本上。
- **工具名与结果形态受限。** MCP 工具名要符合客户端约束（这里做了
  `method.replace(".", "_")`），结果是文本内容；而原生控制面可以直接用
  `node.add` 这样的方法名和结构化 JSON。

### 1.2 只留 TCP 会怎样

- **标准 MCP 宿主接不进来。** Claude Desktop、Cursor 等宿主不会说自定义 JSON
  Lines；每个集成都得写一个专用客户端。能自定义 TCP 客户端的外部 Agent 工具当然
  可以直接用，但生态摩擦和接入成本更高。
- **没有标准发现机制。** TCP 客户端只能读文档或硬编码方法表；MCP 有
  `tools/list`，宿主可以在运行时发现能力。
- **生态摩擦。** 对外文档、示例、集成成本都会上升。

### 1.3 所以选择“一张能力面 + 两种投影”

```text
                  ┌──────────────────────────────┐
                  │ 方法表（语义契约）            │
                  │ editor.state / node.add / …  │
                  └──────────────┬───────────────┘
                                 │
        ┌────────────────────────┼─────────────────────────┐
        │                        │                         │
   TCP JSON Lines           MCP JSON-RPC              进程内通道
 （外部 Agent/脚本/CI）    （标准 MCP 宿主）          （内置助手）
        │                        │                         │
        └────────────────────────┴─────────────────────────┘
                                 │
                                 ▼
                  ┌──────────────────────────────┐
                  │ 命令注册表（唯一执行实现）    │
                  │ src/app/commands/            │
                  └──────────────────────────────┘
```

**能力面在最下面，协议只是入口。** 换协议不改命令；加命令自动被两套协议看见
（前提是契约表同步更新）。

---

## 2. TCP JSON Lines：可直接驱动的原生接口

### 2.1 它擅长什么

- **外部 Agent 工具可直接接入。** 只要能建立 TCP 连接、按行收发 JSON，就能调用
  方法表里的能力；不需要 MCP 宿主或额外 SDK。
- **持久连接 + 服务端推送。** 一个连接可以收多个请求的响应，也可以收 `log` 事件。
- **任意请求 id。** 数字、字符串、UUID 都可以；响应原样带回。
- **低开销。** 没有握手、没有 JSON-RPC 包络、没有工具名转换。
- **易脚本化。** 一行 JSON 就是一帧，`nc` / Node / Python 都能直接发。

### 2.2 它不擅长什么

- 没有标准发现机制；方法表靠文档。
- 没有鉴权帧；安全边界靠回环绑定与工具权限。
- 没有统一的超时/取消语义；长任务由调用方自己管理。

TCP 的完整规范见 [02 TCP 指令集](02-tcp-command-set.md)。

---

## 3. MCP：标准宿主的接入入口

### 3.1 两种接入形态

**streamable HTTP**：与应用同一端口，约定路径 `/mcp`。

```json
{
  "mcpServers": {
    "tve-devtools": { "url": "http://127.0.0.1:39100/mcp" }
  }
}
```

**stdio**：客户端拉起与应用同目录的 `mcp.exe`，由它把 JSON-RPC 转发到 TCP。

```json
{
  "mcpServers": {
    "tve-devtools": {
      "command": ".../mcp.exe",
      "args": ["--port", "39100"]
    }
  }
}
```

stdio 桥的端口来源：环境变量 `TVE_DEVTOOLS_PORT` 或 `--port <N>`。它本身不实现
业务逻辑，只做协议翻译。

### 3.2 支持的方法

| JSON-RPC 方法 | 行为 |
| --- | --- |
| `initialize` | 返回 `protocolVersion: "2024-11-05"`、`capabilities.tools`、`serverInfo: tve-devtools` |
| `notifications/initialized` | 通知，无响应 |
| `ping` | 返回空结果 |
| `tools/list` | 经前端 `mcp.listTools` 返回**已启用工具**清单 |
| `tools/call` | 按工具名反查真实方法，走权限门与执行路径 |

### 3.3 工具名转换

MCP 工具名只允许 `[a-z0-9_-]`，所以：

```text
node.add      →  node_add
asset.write   →  asset_write
preview.open  →  preview_open
```

`tools/list` 返回时会把内部 `method` 字段去掉，只暴露 `name`；服务端在
`name_to_method` 缓存里保留反查表。`tools/call` 先用 `name` 找到真实方法，再走
`require_tool` 和执行。

### 3.4 结果形态

MCP 要求结果是 content 数组。当前实现把结果 JSON 序列化成文本：

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "content": [{ "type": "text", "text": "{ ... pretty JSON ... }" }],
    "isError": false
  }
}
```

出错时 `isError: true`，`text` 是错误文案。**MCP 客户端拿到的是文本，需要自己
再解析 JSON**；这是 MCP 包络带来的额外一步。

### 3.5 当前 MCP 的边界

- `tools/list` 的 `inputSchema` 目前是空对象 `{type: "object", properties: {}}`，
  参数说明在工具描述和文档里，不在 schema 里。这是已知的协议适配债务；内置助手
  的工具目录（`src/assistant-window/tools.ts`）反而有更完整的参数描述。
- 转发到前端的 MCP HTTP 调用超时是 12 秒；长任务（构建）需要客户端自行延长或
  改用 TCP。
- MCP 连接不参与 TCP 的日志广播；它没有实现服务端通知。
- 工具清单只包含用户已启用的工具；禁用后即使客户端缓存了旧清单，`tools/call`
  仍会被 `require_tool` 拒绝。
- **MCP 暴露的是策展子集，不是 TCP 全量方法表。** 当前 `MCP_TOOLS` 包含
  `editor/project/scene/node/preview/state/asset` 的常用方法，但 `scene.write`、
  `shader.write`、`file.*` 只在 TCP 与助手通道可用。效果上是给外部 Agent 一个
  更窄的默认面；需要完整控制面时用 TCP。

---

## 4. 第三条路径：进程内通道

内置助手不走 TCP，也不走 MCP。它调 Tauri 命令 `brain_execute`，由 Rust 直接：

```text
brain_execute
  → 行动三区 + 审批会话（G2）
  → devtools_internal_call（进程内，不走 TCP socket）
  → require_tool（G1）
  → 本地直答 / emit devtools:cmd 给活跃编辑器
  → devtools_reply 回填
```

这条通道的意义：

- **没有网络栈开销。** 进程内 channel 直接回填，适合高频工具调用。
- **仍然共享同一套门。** 它不绕过 `require_tool`，也不绕过格式锁/引擎校验；只是
  多了一层助手专属的行动三区与审批。
- **不依赖 MCP 版本。** 内置助手的能力演进不需要跟着外部协议走。
- **共享“开发者服务已启用”开关。** 进程内通道不复用 TCP 连接，但开发者服务
  未运行时同样拒绝执行——这是一个统一的能力开关，避免“关掉了服务但助手还在
  偷偷操作”。

---

## 5. 差异总表

| 维度 | TCP JSON Lines | MCP（HTTP / stdio） | 进程内通道 |
| --- | --- | --- | --- |
| 传输 | TCP 长连接，换行 JSON | HTTP POST / JSON-RPC；或 stdio 桥 | Tauri invoke + 进程内 channel |
| 帧格式 | `{id, method, params}` | JSON-RPC 2.0 | Tauri 命令参数 |
| 发现机制 | 文档/硬编码 | `initialize` + `tools/list` | 助手工具目录（提示词下发） |
| 方法名 | 原名（`node.add`） | 转换名（`node_add`） | 原名 |
| 结果形态 | 结构化 JSON | 文本 content（内含 JSON） | 结构化 JSON |
| 推送事件 | 支持（`log` 等） | 当前未实现 | 前端事件（流式、时间线） |
| 超时 | 无服务端上限，客户端自定 | HTTP 12s；stdio 10s | 60s |
| 权限门 | G1 + G3 + G4 | G1 + G3 + G4 | G1 + G2 + G3 + G4 |
| 逐动作批准 | 无 | 无 | 有（黄灯） |
| 目标用户 | 外部 Agent 工具、本地脚本、CI、测试 | 标准 MCP 宿主（Claude Desktop/Cursor 等） | 应用内置助手 |
| 鉴权 | 回环绑定；token 未校验 | 回环绑定；token 未校验 | 同机应用内 |

---

## 6. 为什么这不是“维护两套”

判断一套系统有没有“双实现”，看三个地方：

1. **能力定义是否只有一份？** 是。方法表 + 命令注册表。
2. **执行路径是否只有一条？** 是。TCP/MCP 都经 `require_tool` → `try_local` /
   编辑器执行；助手经决策中心后进入同一条内部通道。
3. **行为是否会分叉？** 协议适配层只做参数规整、名称转换、结果包装；业务语义在
   命令实现里。新增命令时，两套协议自动获得同一行为。

MCP 适配层做的三件事，都是“翻译”而不是“实现”：

- `sanitizeMcpName`：方法名 → MCP 合法名；
- `enabledMcpTools`：按工具权限过滤；
- `resolve_mcp`：JSON-RPC 包装/解包、`isError` 映射。

TCP 适配层做的也是翻译：权限门、本地直答、转发、`replyToken` 回填。

---

## 7. 选型指南

| 你的场景 | 推荐 |
| --- | --- |
| 外部 Agent 工具（能自定义 JSON Lines 客户端）直接驱动编辑器 | TCP JSON Lines |
| 本机脚本批量改项目、CI 冒烟、需要收日志 | TCP JSON Lines |
| Claude Desktop / Cursor 等标准 MCP 宿主 | MCP（HTTP 或 stdio） |
| 应用内助手/自动化，要求低延迟与完整门控 | 进程内通道（仅应用内部） |
| 需要长任务（构建）且客户端不支持长超时 | TCP + 客户端长超时/轮询 |
| 需要工具发现、但不关心推送 | MCP |
| 需要严格逐动作人工批准 | 内置助手（G2），不是外部协议 |

---

## 8. 安全提醒（两套协议共享）

- 两者都只监听 `127.0.0.1`；不要把端口暴露到局域网/公网。
- 启动信息里的 `token` **不是**鉴权凭据，协议分发不校验它。
- 外部协议没有 G2 的逐动作批准；不完全可信的 Agent 应只启用必要工具。
- 禁用工具是权威控制点（Rust `devtools_perms.json`），不要只靠提示词约束。
- 详见 [05 权限门](05-permission-gate.md)。

---

## 9. 外部 Agent 接入后，TvEHub Community 里看到什么

TCP 与 MCP 都属于「开发者服务」，外部 Agent 的操作不是“后台静默执行”：

- **命令在活跃编辑器里执行。** 外部 Agent 发来的 `node.add`、`node.set`、
  `asset.create`、`preview.start` 等命令，走与用户 UI 相同的命令路径；节点、
  场景、预览的变化会即时显示，文件写入会落盘并由文件监听刷新。
- **调用记录可见。** 开发者服务记录最近 50 条调用：来源（`control` = TCP/MCP，
  `assistant` = 内置助手）、方法、是否成功、耗时、结果摘要；首页
  「开发者服务 · 最近调用」可查。
- **Agent 的文本由 Agent 自己呈现。** TvEHub Community 不读取外部 Agent 的对话文本，也不
  替它生成回复；它只负责执行命令、可视化操作结果、记录调用。Agent 需要确认画面时，
  应显式调用 `preview.screenshot`。
- **前提是连上开发者服务。** 服务未启用、端口不可达或工具被禁用时，TCP/MCP 都
  不会执行；连接本身不等于授权。

---

## 10. 事实源

| 内容 | 文件 |
| --- | --- |
| TCP 服务与 MCP HTTP 端点 | `src-tauri/src/devtools.rs`（`resolve_mcp`、`mcp_http_response`、`dispatch_command`） |
| MCP stdio 桥 | `src-tauri/src/bin/mcp.rs` |
| MCP 工具清单/名称转换 | `src/app/lib/devtools/state.ts`（`MCP_TOOLS`、`sanitizeMcpName`、`enabledMcpTools`） |
| 方法 → 命令映射 | `src/app/lib/devtools/state.ts`（`METHOD_TO_COMMAND`）、`handlers.ts` |
| 进程内通道 | `src-tauri/src/devtools.rs`（`internal_call_blocking`、`internal_dispatch`） |
| 助手执行入口 | `src/assistant-window/tools.ts`（`execAssistantTool`） |

**下一篇：** [04 原子命令中心](04-command-center.md) —— 两套协议最终都落到哪里，
为什么“一条命令 = 一次撤销”。
