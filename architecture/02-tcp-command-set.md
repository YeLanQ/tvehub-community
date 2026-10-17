# 02 · TCP 指令集：设计与规范

> **TL;DR**
> TvE Hub 在 `127.0.0.1` 上开一个本地控制面，默认端口 `39100`，协议是**换行分隔的
> JSON（JSON Lines）**。请求是 `{id, method, params}`，响应是
> `{id, result, error}`，服务端还可以主动推送 `{event, data}`。方法名是稳定契约，
> 执行端在 Rust 本地或活跃编辑器窗口；权限、格式锁、路径检查在执行侧统一完成。
> 它是首页「开发者服务」的 TCP 接口，面向脚本、CI、**外部 Agent 工具**和应用自身
> 的助手；不是公网服务。

---

## 1. 定位：这是控制面，不是网络服务

先把边界说清楚：

- **只绑定 `127.0.0.1`。** 应用启动时自动开启；默认端口 `39100` 被占用时回退到
  随机端口。没有远程监听、没有 TLS、没有跨机发现。
- **它是「开发者服务」的 TCP 接口。** 首页「开发者服务」同时提供 TCP JSON Lines
  与 MCP 两个接口；两者同一端口、同一方法表、同一套工具权限和同一份调用记录。
  启用/关闭开发者服务，就是对这两个接口的统一总闸。
- **同一端口同时承载 TCP 与 MCP。** 连接建立后读第一行：如果以 `POST` / `GET` /
  `PUT` / `DELETE` 开头，按 HTTP（MCP）处理；否则按 JSON Lines 处理。一条连接
  只属于一种协议。
- **能力面是方法表。** 不是“任意 RPC”：每个方法都必须在契约表里登记，最终映射到
  命令注册表里的一个命令，或由 Rust 本地直接应答。

它解决的问题是：让本机的脚本、CI、测试工具、**外部 Agent 工具**能用一种
**简单、稳定、可推送**的方式操作编辑器，而不需要理解前端框架、窗口体系或引擎
内部结构。外部 Agent 只要能建立 TCP 连接并发送 JSON Lines，就可以直接使用这套
指令集；前提是开发者服务已启用、端口可达。

---

## 2. 传输与帧格式

### 2.1 连接

```text
TCP 127.0.0.1:39100（被占用时随机端口）
UTF-8
一行一条 JSON
以 \n 结束
```

没有握手、没有版本协商、没有认证帧。连接建立后直接发请求。

### 2.2 三种帧

**请求**

```json
{"id": 1, "method": "scene.list", "params": {"root": "D:/projects/demo"}}
```

- `id`：任意 JSON 值（数字、字符串都可以），响应原样带回；用于客户端匹配。
- `method`：方法名，见第 3 节。
- `params`：对象或 `null`；各方法自行解释。

**响应**

```json
{"id": 1, "result": [...], "error": null}
```

- 成功：`error` 为 `null`，`result` 为方法返回值。
- 失败：`error` 为非空字符串，`result` 通常为 `null`。
- 注意：某些工具的业务失败会以 `result: {"error": "..."}` 的形式返回（为了把
  错误回喂给模型自纠）。客户端应同时检查顶层 `error` 和结果对象里的 `error`。

**推送**

```json
{"event": "log", "data": {"level": "info", "message": "场景已保存"}}
```

推送没有 `id`，不属于任何请求。当前实现会把编辑器控制台新增日志以 `log` 事件
广播给所有 JSON Lines 客户端。

### 2.3 非法输入

- 一行不是合法 JSON：服务端**静默丢弃**，不会回错误帧。客户端会等到自己的读超时。
- 空行：忽略。
- 没有 `id` 的请求：响应里 `id` 为 `null`；规范要求请求必须带 `id`。

> 规范建议：客户端永远设置 socket 读超时，并把“超时”当作“结果未知”，不要假定
> 服务端一定回复。

---

## 3. 方法目录

方法分两类执行端：

- **Rust 本地**：纯后端方法，不依赖编辑器窗口，直接在服务端应答。
- **编辑器转发**：需要活跃编辑器窗口的前端状态（场景镜像、选中、预览、构建），
  由 Rust 生成 `replyToken`，经 Tauri 事件 `devtools:cmd` 发给活跃编辑器窗口，
  前端执行后经 `devtools_reply` 回填。

### 3.1 编辑器 / 项目

| 方法 | 执行端 | 权限工具 | 区域 | 说明 |
| --- | --- | --- | --- | --- |
| `ping` | Rust | — | — | 返回 `"pong"` |
| `editor.health` | Rust | — | — | 返回 `{ok, port, protocol}` |
| `editor.state` | 编辑器 | `editor` | 绿 | 项目/场景/选中/视图/后端/撤销栈 |
| `project.list` | Rust | `projectQuery` | 绿 | 最近项目（path/name/sceneCount） |
| `project.create` | Rust | `projectCreate` | 黄 | 按模板创建项目（磁盘） |
| `project.open` | Rust 兜底 / 编辑器 | `projectOpen` | 黄 | 无活跃编辑器时新开窗口；否则切换工作区 |
| `project.close` | 编辑器 | `projectOpen` | 黄 | 关闭项目回首页 |
| `project.build` | 编辑器 | `projectBuild` | 黄 | 走构建管线导出 Web 产物 |

### 3.2 场景 / 节点 / 状态

| 方法 | 执行端 | 权限工具 | 区域 | 说明 |
| --- | --- | --- | --- | --- |
| `scene.list` | Rust | `scene` | 绿 | 列出 `.scene`（可用 `root` 指定工作区） |
| `scene.open` | 编辑器 | `scene` | 黄 | 在编辑器中打开场景（需已开项目） |
| `scene.save` | Rust | `scene` | 黄 | 保存当前场景的后端会话快照 |
| `scene.tree` | Rust | `scene` | 绿 | 当前场景完整 JSON 文档 |
| `scene.write` | Rust | `assetWrite` | 黄 | 直写 `.scene`，写入前按 `NodeData` 校验 |
| `shader.write` | Rust | `assetWrite` | 黄 | 直写 `.shader`，写入前按引擎解析器校验 |
| `node.select` | 编辑器 | `node` | 绿 | 选中节点（空串取消选中） |
| `node.add` | 编辑器 | `nodeAdd` | 黄 | 新增节点（kind/subtype/parentId…） |
| `node.remove` | 编辑器 | `nodeDelete` | 黄 | 删除节点（根节点不可删） |
| `node.rename` | 编辑器 | `nodeSet` | 黄 | 重命名节点 |
| `node.set` | 编辑器 | `nodeSet` | 黄 | 设置属性（单属性或字段包；走撤销） |
| `node.component.add` | 编辑器 | `nodeSet` | 黄 | 挂脚本/内置组件（一次撤销） |
| `state.snapshot` | Rust | `state` | 绿 | 场景状态快照（完整 JSON） |
| `state.restore` | 编辑器 | `state` | 黄 | 用快照恢复场景 |

### 3.3 预览 / 资源 / 文件

| 方法 | 执行端 | 权限工具 | 区域 | 说明 |
| --- | --- | --- | --- | --- |
| `preview.open` | 编辑器 | `previewOpen` | 黄 | 导出预览并切到预览视图 |
| `preview.close` | 编辑器 | `previewClose` | 黄 | 关闭预览回场景 |
| `preview.start` | 编辑器 | `previewStart` | 黄 | 启动预览服务，返回 URL |
| `preview.stop` | 编辑器 | `previewStop` | 黄 | 停止预览服务 |
| `preview.screenshot` | 编辑器 | `screenScreenshot` | 绿 | 截取视口，返回 base64 PNG |
| `asset.list` | Rust | `assetList` | 绿 | 列出项目资源 |
| `asset.read` | Rust | `assetRead` | 绿 | 读文本资产（整读/分页） |
| `asset.write` | Rust | `assetWrite` | 黄 | 写文本资产（格式锁 + 512KB 上限） |
| `asset.create` | 编辑器 | `assetCreate` | 黄 | 新建资源/目录 |
| `asset.select` | 编辑器 | `assetSelect` | 绿 | 选中资产 |
| `asset.delete` | 编辑器 | `assetDelete` | 黄 | 删除资源 |
| `asset.rename` | 编辑器 | `assetRename` | 黄 | 重命名资源 |
| `file.index` | Rust | — | 绿 | 为大文本文件建模块索引 |
| `file.search` | Rust | — | 绿 | 在索引内语义检索模块 |
| `file.module` | Rust | — | 绿 | 按序号/标题读单模块全文 |

`mcp.listTools` 是 MCP 自省方法，由前端返回“已启用工具”的清单，不出现在普通
TCP 客户端的使用场景里。

### 3.4 方法名与命令 id

方法名是对外稳定契约；命令 id 是前端内部实现。两者大多同名，但不完全一一对应：

| 方法 | 命令 id |
| --- | --- |
| `project.list` | `project.recentList` |
| `scene.tree` / `state.snapshot` | `scene.doc` |
| `node.remove` | `node.delete` |
| `state.restore` | `state.restore` |

映射表在 `src/app/lib/devtools/state.ts` 的 `METHOD_TO_COMMAND`；执行适配在
`src/app/lib/devtools/handlers.ts`。**新增方法必须同时更新方法表、权限映射、
区域表、命令映射和助手目录**，否则会出现“TCP 能调但助手看不见”或“助手能调但
门控不认识”的漂移。

---

## 4. 生命周期与路由

### 4.1 启动

应用启动时自动开启控制服务器（后台线程）。默认端口被占用时回退随机端口；也可以
从首页「开发者服务」显式启停。启动返回的信息包括：

```json
{
  "port": 39100,
  "url": "tcp://127.0.0.1:39100",
  "mcp_url": "http://127.0.0.1:39100/mcp",
  "stdio_command": ".../mcp.exe",
  "token": "...",
  "protocol": "tcp-jsonlines + mcp-http"
}
```

### 4.2 分发

```text
读一行
  │
  ├─ 是 HTTP 方法行？ → 按 MCP/HTTP 处理（见 03 篇）
  │
  └─ 解析 JSON
        │
        ├─ ping / editor.health → Rust 直接应答
        │
        ├─ require_tool(method)  ← 工具权限门（Rust 权威存储）
        │     └─ 工具未启用 → 错误响应
        │
        ├─ try_local(method)
        │     ├─ 有本地实现 → Rust 直接应答
        │     └─ 无 → 继续
        │
        └─ 转发活跃编辑器
              ├─ 找 label 为 editor-* 且最近聚焦的窗口
              ├─ 生成 replyToken（UUID）
              ├─ emit_to(label, "devtools:cmd", {id, method, params, replyToken})
              └─ 前端执行后 devtools_reply(replyToken, result, error)
```

### 4.3 多客户端与并发

- 每个 TCP 连接一个读线程 + 一个写线程；写线程通过 channel 串行化输出。
- 同一连接上的多个请求可以同时在途；响应按完成顺序返回，客户端必须用 `id` 匹配，
  不能假定 FIFO。
- 多个客户端共享同一个编辑器执行端；`replyToken` 保证回复不会串到别的请求。
- 服务端推送广播给所有 JSON Lines 客户端；HTTP/MCP 连接不参与广播。

### 4.4 超时语义

| 路径 | 服务端等待上限 | 说明 |
| --- | --- | --- |
| 助手进程内通道 | 60 秒 | `internal_dispatch` 显式超时 |
| MCP HTTP（转发到前端） | 12 秒 | `mcp_frontend_call` 显式超时 |
| MCP stdio 桥 | 10 秒 | `mcp.rs` 的 socket 读超时 |
| TCP JSON Lines | **无显式上限** | 转发后等前端回填；客户端应自行设置读超时 |

长操作（构建、打开项目）建议客户端把超时设长，或在业务层轮询状态；不要把“没在
10 秒内返回”直接当成失败。

### 4.5 冷启动竞态

打开新编辑器窗口后，前端监听器可能还没装好。`project.open` 的本地兜底会等待
窗口的 `devtools_listener_ready` 回执（最多 15 秒）再放行，避免后续命令在 JS
就绪前 `emit` 丢失、调用方白等 60 秒。

### 4.6 外部 Agent 接入后的可视化与调用记录

TCP 不是“后台批处理接口”，外部 Agent 的操作会直接呈现在应用里：

- **命令在活跃编辑器窗口执行。** `node.add`、`node.set`、`asset.create`、
  `preview.start` 等命令走的就是用户 UI 同一条命令路径；节点、场景、预览的变化
  会即时显示，文件写入会落盘并由文件监听刷新，不存在一个与用户所见分离的
  “影子会话”。
- **调用有统一记录。** 开发者服务维护最近 50 条调用日志，字段包括来源
  （`control` = TCP/MCP，`assistant` = 内置助手）、方法、是否成功、耗时、结果
  摘要；首页「开发者服务 · 最近调用」直接展示。
- **Agent 的文本由 Agent 自己呈现。** TvE Hub 不解析外部 Agent 的对话文本，也不
  替它生成回复；它负责执行命令、把结果可视化、记录调用。Agent 想确认画面，应显式
  调用 `preview.screenshot`，而不是假设应用会自动理解它的文字。
- **越过协议边界的只有结构化命令。** Agent 的自然语言推理留在它自己的上下文里；
  TvE Hub 收到的是 `{method, params}`，执行的是方法表里的能力。这条边界让“Agent
  说什么”和“应用做什么”解耦。
- **前提是开发者服务已启用。** 服务未运行、端口不通或工具被禁用时，命令不会执行；
  这不是“连上就能绕过”的通道。

---

## 5. 错误模型

错误分三层，客户端要分别处理：

| 层级 | 形态 | 典型原因 | 建议 |
| --- | --- | --- | --- |
| 传输/协议 | 无响应、连接断开 | 非法 JSON、端口不通、进程退出 | 客户端超时；重连；检查端口 |
| 方法级 | 顶层 `error: "..."` | 未知方法、工具未启用、没有活跃编辑器、参数缺失 | 读错误文案修正；不要原样重试 |
| 业务级 | `result: {error: "..."}` | 引擎校验失败、文件不存在、节点不存在 | 把错误回喂模型/用户，修正参数 |

几个常见错误：

- `工具「添加节点」未启用（可在首页 开发者服务 中开启）` —— 权限门 G1。
- `没有活跃的编辑器窗口` —— 需要先 `project.open`。
- `未知方法: xxx` —— 方法不在契约表，或对应命令未注册。
- `拒绝写入：...` —— 格式锁/引擎校验拒绝（`.scene` 结构、`.shader` 解析等）。

**幂等性**：协议不承诺幂等。`node.add` 重发会加两个节点；`asset.write` 重发是
覆盖（相对安全），但 `project.build` 重发会重复构建。调用方应基于 `id` 和业务
状态去重。

---

## 6. 安全规范

这一节是“规范”，不是“实现细节”，因为 TCP 是最容易被误用的入口。

### 6.1 当前真实边界

- **网络边界**：只 bind `127.0.0.1`。同机的任何进程都可以连接；不同机不行
  （除非用户自己做了端口转发，不应这样做）。
- **能力边界**：工具权限门（G1）。用户在首页「开发者服务」逐项启用/禁用工具；
  Rust 侧 `devtools_perms.json` 是权威存储，前端有内存镜像用于即时 UI。
- **数据边界**：路径/格式锁（G3）在所有入口共用；外部客户端不能借 TCP 绕过
  `asset.write` 的格式锁，也不能写 `internal/`。
- **执行边界**：只有活跃编辑器窗口执行前端方法；关闭开发者服务会拒绝助手与
  外部调用。

### 6.2 必须说清楚的三件事

1. **`token` 目前不是鉴权凭据。** 启动信息里会返回一个 UUID，但协议分发时没有
   校验它。不要把它当密码，也不要把端口暴露到局域网/公网。
2. **外部客户端不走“行动三区”的逐动作批准。** 那是内置助手路径的策略门
   （见 05 篇）。外部 TCP/MCP 客户端只受 G1 工具权限 + G3/G4 数据/引擎校验约束。
   如果你接入的是不完全可信的 Agent，正确做法是**只启用必要的工具**（尤其是
   关闭 `assetWrite` / `nodeDelete` / `projectBuild` 等写工具），而不是依赖提示词。
3. **没有 TLS、没有用户隔离。** 它是本机开发/自动化控制面，安全模型是“同机、
   同用户、用户主动开启”。跨用户或跨机场景不在设计范围内。

### 6.3 推荐实践

- 不用时关闭开发者服务；需要时只开本次任务需要的工具。
- 不要让自动化客户端使用生产项目目录；用独立工作区或副本。
- 外部 Agent 的任务结束后，检查首页「最近调用」与项目 `build/` 产物。
- 不要把 `39100` 端口写进任何对外服务配置或反向代理。

---

## 7. 客户端配方

最小 Node.js 客户端（按 `id` 匹配、按行解析、带超时）：

```js
import net from "node:net";

const sock = net.createConnection({ host: "127.0.0.1", port: 39100 });
const pending = new Map();
let buf = "";

sock.on("data", (chunk) => {
  buf += chunk.toString("utf8");
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    const msg = JSON.parse(line);
    if (msg.id !== undefined && pending.has(msg.id)) {
      const { resolve } = pending.get(msg.id);
      pending.delete(msg.id);
      resolve(msg);
    } else if (msg.event) {
      console.log("[event]", msg.event, msg.data);
    }
  }
});

let nextId = 1;
function call(method, params = null, timeoutMs = 30000) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`timeout: ${method}`));
    }, timeoutMs);
    pending.set(id, {
      resolve: (msg) => {
        clearTimeout(timer);
        if (msg.error) reject(new Error(msg.error));
        else resolve(msg.result);
      },
    });
    sock.write(JSON.stringify({ id, method, params }) + "\n");
  });
}

await call("project.open", { path: "D:/projects/demo" });
await call("node.add", { kind: "mesh", subtype: "box", name: "Box" });
await call("scene.save");
await call("project.build", { singlePage: true, title: "Demo" });
```

Python 等价物只需 `socket.create_connection` + `makefile("rwb")` + `json.dumps`。

---

## 8. 扩展规范

新增一个 TCP 方法，按以下顺序改，缺一处就会出现契约漂移：

1. **命令实现**：在 `src/app/commands/` 注册命令（id/label/group/run）。
2. **远程契约**：`src/app/lib/devtools/state.ts` 的 `MCP_TOOLS` 加描述，
   `METHOD_TO_COMMAND` 加映射。
3. **权限工具**：`TOOL_CATALOG` 加工具（如果需要独立开关），`METHOD_TO_TOOL`
   加方法映射。Rust 侧 `src-tauri/src/devtools.rs` 的同名表保持同构。
4. **行动区域**：`src-tauri/src/brain/policy/zones.rs` 的 `ALL_METHODS` 加方法；
   只读方法加入 `GREEN_METHODS`，写方法保持默认黄灯。
5. **助手目录**：`src/assistant-window/tools.ts` 的 `CATALOG` 加描述与参数；
   如果方法需要工作区 root，加入 `ROOT_METHODS`。
6. **测试**：至少覆盖命令层参数解析、区域门控一致性、远程映射存在性。

方法一旦发布，**只增不改语义**。要改语义就加新方法，并在文档里标注旧方法废弃；
不要让同一个方法名在不同版本里做不同的事。

---

## 9. 事实源

| 内容 | 文件 |
| --- | --- |
| 协议服务、权限、分发、超时 | `src-tauri/src/devtools.rs` |
| MCP stdio 桥 | `src-tauri/src/bin/mcp.rs` |
| 远程方法 → 命令映射 | `src/app/lib/devtools/state.ts`、`handlers.ts` |
| 前端执行器 | `src/app/lib/devtools/index.ts` |
| 命令实现 | `src/app/commands/` |
| 权限工具目录 | `src-tauri/src/devtools.rs`（`TOOL_CATALOG`） |
| 行动区域 | `src-tauri/src/brain/policy/zones.rs` |
| 助手工具目录 | `src/assistant-window/tools.ts` |
| 构建/预览 | `src-tauri/src/build/`、`src-tauri/src/preview.rs` |

**下一篇：** [03 两套协议](03-dual-protocols.md) —— 既然有了 TCP，为什么还要 MCP？
两套协议如何共用一张能力面。
