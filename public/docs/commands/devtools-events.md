# 控制面、事件与错误

本页覆盖握手/自省、工具权限、事件订阅、错误码与 MCP 映射，以及文件索引方法。

## 方法一览

| 方法 | 路由 | 说明 |
| --- | --- | --- |
| `devtools.hello` | local | 身份、端口、活跃编辑器、当前项目 |
| `devtools.tools` | local | 工具权限清单与开关状态 |
| `devtools.catalog` | local | 能力自描述（`verbose:true` 带参数 schema 与示例） |
| `devtools.subscribe` | local | 开启/关闭事件推送 |
| `ping` | local | 返回 `"pong"` |
| `editor.health` | local | `{ok, port, protocol}` |
| `file.index` | local | 大文件模块索引 |
| `file.search` | local | 在文件内检索 |
| `file.module` | local | 按模块读取片段 |

## 握手与自省

### hello

```json
{"id": 1, "method": "devtools.hello"}
```

确认端口、协议、是否有活跃编辑器与当前项目。客户端启动时先读它，比直接猜状态可靠。

### tools

```json
{"id": 2, "method": "devtools.tools"}
```

返回工具权限清单（id、显示名、分组、是否启用）。**权限只能在应用界面（首页 → 开发者服务）修改**，控制面不提供改权限的方法。

### catalog

```json
{"id": 3, "method": "devtools.catalog", "params": {"verbose": true}}
```

返回：

- `protocolVersion`：协议版本；
- `capabilitiesRevision`：方法集 + 参数 schema 的稳定哈希（应用热更新时 `appVersion` 不变，用它探测能力变化）；
- `capabilitiesNotes`：变更说明（最新在前）；
- `protocolParams`：协议层的可选参数说明；
- 方法表：名称、路由（local/editor）、权限工具、是否启用；`verbose` 时附参数 schema 与示例。

**任何依赖指令集的自动化，都应以 `catalog` 的返回作为运行时事实源**；本手册是当前版本的整体说明。

### ping / health

```json
{"id": 4, "method": "ping"}
{"id": 5, "method": "editor.health"}
```

`ping` 只验证链路；`editor.health` 返回服务端口与协议。

## 工具权限

工具权限按分组管理（开发者服务页可逐项开关）：

| 分组 | 工具 id | 覆盖的方法 |
| --- | --- | --- |
| 编辑器 | `editor` | `editor.state` |
| 编辑器 | `projectQuery` / `projectOpen` / `projectCreate` | `project.list` / `project.open`、`project.close` / `project.create` |
| 场景 | `scene` | `scene.list`、`scene.open`、`scene.save`、`scene.tree`、`scene.settings.*` |
| 节点 | `node` / `nodeAdd` / `nodeDelete` / `nodeSet` | `node.select` / `node.add` / `node.remove` / `node.rename`、`node.set`、`node.component.*` |
| 状态 | `state` | `state.snapshot`、`state.restore`、`history.*` |
| 构建 | `projectBuild` | `project.build` |
| 预览 | `previewOpen` / `previewClose` / `previewStart` / `previewStop` | `preview.open` / `preview.close` / `preview.start` / `preview.stop` |
| 屏幕快照 | `screenScreenshot` | `preview.screenshot` |
| 资源 | `assetList` / `assetRead` / `assetWrite` / `assetCreate` / `assetSelect` / `assetDelete` / `assetRename` | 对应 `asset.*` / `material.*` / `shader.write` |

未登记工具的方法（`ping`、`devtools.*`、`editor.health`、`preview.status`、`file.*`）不受工具权限控制。

**最小权限建议**：只读自动化关闭写入类工具（`assetWrite`、`nodeDelete`、`projectBuild`、`nodeAdd` 等）；任务结束恢复原状态。

## 事件

默认不推送。订阅：

```json
{"id": 6, "method": "devtools.subscribe", "params": {"events": true}}
```

取消：`{"events": false}`。断开连接自动清理。

| 事件 | 触发 | data |
| --- | --- | --- |
| `log` | 编辑器日志 | `{level, text, time, tag}` |
| `node.added` / `node.removed` / `node.changed` | 场景图提交（含 UI 操作/撤销重做） | `{kind, nodeId, revision, dirty, nodes, history}` |
| `scene.changed` | 整树替换/清空 | 同上 |
| `settings.changed` | 场景设置补丁/撤销 | `{root, rel, settings, patch?, source}` |
| `scene.saved` | `scene.save` 落盘后 | `{revision, dirty:false}` |
| `selection.changed` | 选中变化 | `{nodeId}` |
| `material.changed` / `shader.changed` / `model.changed` / `splat.changed` / `animation.changed` | 对应缓存刷新 | `{rel}` 或 `{nodeId}` |
| `asset.changed` | 外部文件监听命中（不含 `.scene`） | `{root, paths, kinds, refreshed, pruned, skipped}` |

实现约定（客户端可依赖）：

- 图变更事件只由后端回显发射，一次操作一条；
- `log` 每行只推一次；200ms 内逐字节相同的日志会被折叠；
- `.scene` 不进 `asset.changed`；
- 同一资产/选中的连续刷新在 120ms 内合并；`material.set` 与历史 undo 的自写盘有 1.5s 抑制窗。

事件消费示例：

```js
if (msg.event === "scene.saved") {
  console.log("saved revision", msg.data.revision);
}
```

## 错误码

失败信封：`{id, result:null, error:"…", code:"…"}`。按 `code` 分支：

| code | 含义 | 处理 |
| --- | --- | --- |
| `NO_ACTIVE_EDITOR` | 需要编辑器但没有活跃窗口 | 先 `project.open`；多数命令会自动开窗 |
| `EDITOR_TIMEOUT` | 编辑器执行超时 | 查编辑器状态；不要立即重发写命令 |
| `UNKNOWN_METHOD` | 方法不存在 | 用 `catalog` 刷新方法表 |
| `TOOL_DISABLED` | 工具未启用 | 在开发者服务页启用，或改用只读路径 |
| `BAD_PARAMS` | 参数缺失/非法 | 按 `catalog` 的 schema 修正 |
| `NOT_FOUND` | 节点/资产/文件不存在 | 先读状态/列表 |
| `PARSE_ERROR` | JSON/文档解析失败 | 检查内容与编码 |
| `SCENE_NOT_READY` | 冷启动未就绪或编辑器销毁 | 稍后重试 |
| `MATERIAL_NOT_READY` | 材质注册表未就绪（节点未创建） | `asset.refresh` 后重试一次 |
| `MATERIAL_NOT_APPLIED` | 节点已创建但材质回读不一致 | 报 bug，附节点 id |
| `CONNECTION` | 连接/传输错误 | 重连并重新握手 |
| `ERROR` | 未分类错误 | 看 `error` 文案与日志 |

**幂等性**：协议不承诺幂等。`node.add` 重发会创建两个节点，`asset.write` 重发是覆盖，`project.build` 重发会重复构建。调用方按业务状态去重。

## 文件索引

```json
{"id": 7, "method": "file.index", "params": {"path": "src/main.ts"}}
{"id": 8, "method": "file.search", "params": {"path": "src/main.ts", "query": "start", "topK": 5}}
{"id": 9, "method": "file.module", "params": {"path": "src/main.ts", "no": 0}}
```

- `file.index`：返回文件的模块索引（按注释/结构切分）；
- `file.search`：在文件内检索，`topK` 缺省 0 = 不限；
- `file.module`：按 `title` 或序号 `no`（从 0 起）读取模块片段；
- `root` 可显式指定工作区；不传时用当前项目。

## MCP 映射

同一个控制面在同一端口提供 MCP HTTP 端点：

```
http://127.0.0.1:<port>/mcp
```

- 方法表与 TCP 一致，工具权限同样生效（只暴露已启用的工具）；
- `mcp.listTools` 是 MCP 自省方法（仅 MCP 传输），不在 TCP 50 条方法表内；
- stdio 方式由客户端拉起桥进程转发到同一 TCP 端口：Windows 为同目录 `mcp.exe`，其他平台为主程序 `--mcp-bridge`；
- 应用内「开发者服务 → MCP 服务」页会给出可直接复制的 HTTP / stdio 配置。

## 安全提醒

- 控制面只绑定 `127.0.0.1`，没有 TLS 与账号体系；不要端口转发。
- 发现文件里的 `token` 不是鉴权凭据，不要当密码。
- 外部 Agent 不受内置助手「逐动作批准」的保护，只受工具权限与格式/路径锁约束；接入不完全可信的 Agent 时按最小权限开启工具。
