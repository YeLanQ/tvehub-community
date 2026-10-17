# 单元：外部 Agent 直连 devtools TCP（裸连接命令集）

面向**进程外**的 Agent / 脚本 / 自动化。**不依赖 MCP，也不依赖任何客户端库**：
一条 TCP 连接 + 换行分隔 JSON 即可。应用内助手不走这里（进程内桥见
`tve-api-usage` references/facade-ai.md）。

## 第一步：找到端口

服务随应用启动。端口优先 39100；被占用时回退随机端口，并写入发现文件：

| 形态 | 发现文件 |
|---|---|
| 便携版（release，exe 同级 data/ 可写） | `<exe 目录>/data/devtools.json` |
| 非便携 / dev（数据落系统目录） | `%APPDATA%\TvE.Hub\devtools.json`（macOS/Linux 对应 app_config_dir） |

文件内容 `{port,pid,protocol,appVersion,startedAt}`；应用停止时删除。连不上就
说明实例已退出或文件是残留——换下一个候选（39100）即可。客户端应校验 `pid`：
进程已退出的残留文件（例如另一版本/便携目录遗留）会被 `pnpm devtools clean`
清理，连接层也会自动跳过。清理其它便携目录的残留可在其 exe 目录执行
`node <repo>/scripts/devtools/cli.mjs clean`，或把 `TVE_CONFIG_ROOT` 指向其 `data/`。

## 第二步：握手与命令集自省

```json
{"id":1,"method":"devtools.hello","params":{}}
→ {"id":1,"result":{"name":"tve-devtools","protocolVersion":1,"transport":"tcp-jsonlines",
   "port":39100,"pid":1234,"appVersion":"1.0.5","activeEditor":null,"activeProject":null}}
```

```json
{"id":2,"method":"devtools.catalog","params":{}}
→ 命令集：每条 {name, route:"local"|"editor", permission, enabled}
   + envelope/events/autoOpenEditor 的协议说明
```

`route:"editor"` 的方法需要编辑器窗口；服务端在无会话时**自动打开项目再执行**
（`params.root`/`path` 指向现存目录优先，否则最近项目；`params.autoOpen:false` 关闭）。
未知方法不会触发开窗。

## 第三步：直接发命令

```json
{"id":3,"method":"node.add","params":{"kind":"mesh","name":"Box"}}
→ {"id":3,"result":{"ok":true,"id":"node_xxx","name":"Box","type":"mesh"},"error":null}
```

失败信封带稳定错误码（不解析中文）：

```json
{"id":4,"result":null,"error":"没有活跃的编辑器窗口","code":"NO_ACTIVE_EDITOR"}
```

`NO_ACTIVE_EDITOR` / `EDITOR_TIMEOUT` / `UNKNOWN_METHOD` / `TOOL_DISABLED` /
`BAD_PARAMS` / `NOT_FOUND` / `PARSE_ERROR` / `SCENE_NOT_READY` / `MATERIAL_NOT_READY` /
`MATERIAL_NOT_APPLIED` / `CONNECTION` / `ERROR`。
`SCENE_NOT_READY`：编辑器/场景仍在装载（冷启动自动开窗时命令先到），稍后重试即可。
`MATERIAL_NOT_READY`：`node.add` 引用的 .mat 预取失败（文件缺失/解析失败），不会静默绑定默认材质。
`MATERIAL_NOT_APPLIED`：节点已创建但后端回读的材质引用与请求不一致（写链落账后核验），
不会在成功响应里谎报 `applied`。

`node.add` / `node.set` 的枚举与校验（拼错报错并列出可选项，reader 对旧文件做同样的别名归一）：
`geometry`=box/sphere/plane/quad/cylinder/cone/torus/capsule；`lightKind`=point/directional/
ambient/spot；`skyKind`=procedural/cube（**cubemap 为 cube 别名**）；`fogKind`=linear/exp2/height
（**exponential 为 exp2 别名**）。`lightKind` 是派生只读字段（灯光类型由节点类固定），`node.set` 会拒绝。

写命令（`node.add/remove/rename/set`、`node.component.*`、`scene.settings.patch`、
`scene.save`、`history.*`、`state.restore`、`scene.write`）**在写链落账后才回响应**：
收到成功即可直接 `scene.tree` 读数，不必自己等待或重试。`scene.tree` / `state.snapshot`
由 Rust 本地直答（不经过前端链），所以这个等待是必须的——历史版本曾出现
「`node.add` 成功但紧跟的读取看到默认材质」的读己之写缺口。
`node.add` 的 `applied` 只列**核验生效**的字段（材质按后端文档回读核验）。

冷启动/新会话的第一条写命令会等 `sceneReady`（挂载管线与场景切换完成）再执行，
正常**不需要**重试。若仍收到 `MATERIAL_NOT_READY`（材质资产确实缺失/解析失败），
客户端固定套路即可兼顾：`node.add` → `MATERIAL_NOT_READY` → `asset.refresh {path}`
→ 重试一次。`node.add` 的创建期属性（含材质/尺寸/落位）会并入 add 载荷，
`node.added` 事件的节点快照就是最终态，不存在「先默认、后补丁」的中间事件。

## 协议约束（自研客户端必须遵守）

- 地址 `127.0.0.1:<port>`，换行分隔 JSON，一条连接可连续发多条，按 `id` 配对；
- **推送行没有 `id`**：`{"event":...}`。默认**不推送**；需要日志事件时先发
  `{"method":"devtools.subscribe","params":{"events":true}}`，不需要时发
  `{"events":false}` 取消订阅；
- 首条消息前服务端会探测 HTTP（`POST /mcp`），所以第一条不能以 `POST `/`GET `
  开头；
- 转发类命令服务端等待 60s 应答；客户端超时不要小于它；
- 断开后服务端自动清理广播登记，无需客户端发取消订阅。

## 命令集（route 以 `devtools.catalog` 为准）

| route | 方法 |
|---|---|
| local（无编辑器可答） | `devtools.hello/tools/catalog/subscribe`、`ping`、`editor.health`、`project.list/create/open`、`scene.list`、`scene.write`、`shader.write`、`asset.list/read/write`、`file.index/search/module` |
| editor（需要编辑器） | `editor.state`、`project.close/build`、`scene.open/save/tree`、`scene.settings.get/patch`、`node.select/add/remove/rename/set`、`node.component.add/set`、`history.undo/redo`、`preview.*`、`state.snapshot/restore`、`asset.create/select/delete/rename/refresh`、`material.get/set` |

参数语义与返回值见本技能 references/editor-commands.md 与
`src/app/lib/devtools/state.ts` 的 `MCP_TOOLS`。`devtools.catalog {verbose:true}`
现在覆盖**全部命令**的参数 schema（无参数命令也显式给出空 properties，与「没文档」
区分），新接入先读它。catalog 还返回：

- `capabilitiesRevision`：方法集 + schema + devtools 实现源码 + 手动行为版本的指纹；
  热更新导致 appVersion 不变时用它探测能力变化；
- `capabilitiesNotes`：`[{revision, note}]` 能力变更说明（最新在前）。任何影响
  请求/响应契约的改动（含前端实现的行为变更、事件形状、错误码）都会 bump
  revision 并追加一条说明——客户端按 revision 做能力探测是可靠的；
- `protocolParams`：`autoOpen`/`root` 两个协议级参数。

所有返回的绝对路径（`project.open/create` 的 `path`、`project.build` 的
`output_dir`、`preview.status` 的 `dir`）统一用**正斜杠**，客户端可直接拼接/去重/展示；
内部文件系统路径不受影响。

## 结构化变更事件（subscribe 后）

`{"method":"devtools.subscribe","params":{"events":true}}` 后，除 `log` 外还会收到：

| 事件 | 触发 | data |
|---|---|---|
| `node.added` / `node.removed` / `node.changed` | 场景图提交（含 UI 操作/撤销重做） | `{kind,nodeId,revision,dirty,nodes,history}` |
| `scene.changed` | 整树 replace/clear | 同上 |
| `settings.changed` | settings patch/undo/redo | `{root,rel,settings,patch?,source}` |
| `scene.saved` | `scene.save` 同步落盘后 | `{revision,dirty:false}` |
| `selection.changed` | 选中变化 | `{nodeId}` |
| `material/shader/model/animation.changed` | 对应缓存刷新 | `{rel}` 或 `{nodeId}` |
| `asset.changed` | 外部文件监听命中 | `{root,paths,kinds,refreshed,pruned,skipped}` |

事件默认不推；断开连接自动清理订阅。同一资产/选中的连续刷新在 120ms 内合并为
最后一条；`material.set` 与历史 undo 的**自写盘**另有 1.5s 抑制窗（文件监听不再
回读同一 .mat），因此一次材质修改只推一条 `material.changed`。`internal/` 内置
资产（如默认材质）的缓存事件不推给外部订阅方。`revision` 保留在场景变更事件里
用于增量同步。客户端可据此同步，不必反复 `scene.tree`。
`log` 事件每条控制台行只推一次（推送器按行对象去重）。`.scene` 不进入
`asset.changed`（场景走 `scene.changed`/replace 与脏态重载流程），因此 `scene.save`
不再附带只有 `skipped` 的资产事件。

## 历史与场景设置

- `history.undo` / `history.redo`：执行并等待写入链落定，返回
  `{ok,undone|redone,canUndo,canRedo,depth,position,entries,undoLabel,redoLabel,labels,refreshedAssets}`；
  `undone/redone=false` 表示栈为空（命令成功但无操作）。`position` = 可撤销位置
  （undo 后减少），`entries` = undo+redo 总条目，`depth` 与 `position` 同义（兼容旧客户端）。
  **材质与 settings 也进历史**：材质 undo 由后端写回 .mat 文本并让 `refreshedAssets`
  直接刷新缓存；settings undo 直接还原信封字段并广播 `settings.changed`。
- `scene.settings.get` / `scene.settings.patch`：`patch` 深合并进场景 `settings`
  （如 `{rendering:{backgroundColor:"#112233"}}`），只改给定字段、标脏随保存落盘；
  注意渲染设置目前只是文档字段，环境效果仍以 skybox/fog 节点为准。

## 材质与资产刷新（P0 写入口）

- **`material.set`**：`.mat` 唯一的属性写入口（`asset.write` 对 .mat 有格式锁）。
  `{path, props}`，`props` 支持 PBR 参数（`color:"#ff3300"`、`metalness/roughness/...`）
  与 `props.props` 着色器参数；可带 `shader` 切换挂载着色器。走与资产检查器相同的
  `material_write` + 引擎 `cachePut` + `refreshMaterialNodes`，保存即视口生效；
  写入同时记入场景撤销栈（返回 `undoable`），`history.undo/redo` 会写回 .mat 并自动重读。
  `material.get` 读回 `{name,type,shader,params}`。
- **`asset.refresh`**：外部改写磁盘资产后让编辑器重读并失效缓存
  （`{path}` 单路径/数组；缺省 = 全部已加载材质/着色器/模型/贴图）。
  外部窗口监听本身也会自动刷新；本命令用于无监听/需要显式确认的场景。
  `.scene` 不走本命令（按脏态走 `scene.open` 或编辑器内提示）。
- **`preview.status`**：`{running,ready,url,port,dir}`；`ready` 是真实 TCP 探测，
  `preview.open/start` 返回的 url 也已等待就绪，拿到即可直接请求。


## 分发形态

命令集就是契约：**分发包里不需要额外客户端程序**（这一点与 MCP stdio 桥不同，
后者需要 `mcp.exe` 同级分发）。外部 Agent 只需知道“读发现文件找端口 → 连 TCP →
发 JSON”。仓库里的 `pnpm devtools`（`scripts/devtools/`）只是调试便利，不是运行前提。

## 行为约定（2026-10-17 起）

- `node.add` 创建即应用 `position/rotation/scale/size/material`（其余节点属性放
  `props`）；未识别字段直接报错，`geometry/lightKind/skyKind/fogKind` 拼错也报错，
  不再静默退化成默认值。`name` 在创建时一次写入（不再 add + rename 两条历史），
  一次 undo 即移除整个节点。
- `node.set` 同样校验：`geometry` 只接受
  box/sphere/plane/quad/cylinder/cone/torus/capsule（拼错不再写入场景），
  `material` 只接受 `.mat` 路径；未知属性报错并回传该节点的可写属性清单。
- `node.remove` 的 `deleted` 是**完整级联列表**（含子孙），`roots` 是请求删除的顶层。
- `scene.save` 同步落盘，返回 `{ok,flushed:true,dirty:false,revision}`——`flushed`
  即保存完成信号，不必再轮询 `editor.state`；`editor.state.dirty` 也已改为读后端
  权威值（前端镜像有事件延迟）。保存是自写盘：不会触发文件监听的整树重载，
  不产生额外的 `replace`/`asset.changed`。旧脚本传 `rel`/`path` 仍可调用（接受但
  忽略，响应带 `deprecated` 提示）；保存目标始终是当前打开场景。
- `scene.open` 返回 `{ok,opened,dirty,reason}`：已打开且脏时 `opened:false,
  reason:"already-open-dirty"`（不静默假装重载）；`discard:true` 才会放弃未保存
  修改、强制以磁盘版本重装。编辑器内「外部修改 → 重新载入」也走这条 discard 语义。
- `asset.create` 支持 `{type, path}`（完整目标路径）；扩展名与类型不符会报错。
- `scene.write` 的 `content` 可直接传对象（`scene.tree` 返回的原样），不必先 `JSON.stringify`。
- `node.set` 的 `size` 拒绝 0/负数（网格会不可见）；`material.set` 的越界数值会收敛，
  并在返回的 `clamped` 数组里列出被收敛字段（不再静默）。
- `asset.read` 缺失文件归 `NOT_FOUND`（与 asset.delete 一致）。
- 未知参数不再静默忽略：所有固定参数命令（含本地直答的 `asset.list`/`project.open`
  等与编辑器侧的 `scene.open`/`history.*`/`settings.*`/`preview.*`）都会拒绝未声明
  字段并列出支持集合；`autoOpen`/`root` 是协议级参数，始终放行。字段包类命令
  （`node.set`/`material.set` 等）也忽略这两个协议参数。
- `scene.settings.patch` 有白名单与类型校验：只接受 `rendering` 块的
  `backgroundColor`/`ambientIntensity`/`ambientColor`；颜色收 `#rgb/#rrggbb` 或数字，
  `ambientIntensity` 收 0..1 数值（数字字符串可）；越界数值收敛并在返回的
  `clamped` 数组里回显（与 `material.set` 同语义），未知块/字段/非法类型报错。
- `hello.activeEditor` 与 `editor.state` 一致：聚焦事件未到达时依次用窗口枚举、
  场景会话反查兜底，冷启动不再出现「hello 说没有编辑器、editor.state 又能执行」。
- `asset.delete` 返回 `referencedBy`（仍引用该资产的场景节点数）与
  `referencedByMaterials`；路径缺失返回 `NOT_FOUND` 语义。
- `asset.refresh` 对磁盘上已删除的缓存引用返回 `pruned`（不再混进 `skipped` 报错），
  返回的 `path` 只含仍在磁盘上的项。
- `material.get` 的颜色统一为 `#rrggbb` 字符串（与 `material.set` 入参同形）；
  缺失返回 `材质不存在`（NOT_FOUND），格式损坏返回 `材质解析失败`（PARSE_ERROR，
  带首个出错位置/字段）。
- `preview.screenshot` 返回 `{source:"editor", blank, dataUrl, saved}`；`blank=true`
  表示画面为纯色（渲染失败或本来就是纯色场景，需结合场景判断）；命令会先等两帧、
  纯色时自动重试一次，但自动化仍建议对 `blank` 做一次重试。预览帧跨域不可读，
  `source` 只接受 `editor`。
- 场景渲染设置（backgroundColor/ambientIntensity）走 `scene.settings.patch`；
  环境效果仍以 skybox/fog 节点为准。

## 规则/要点

- **不要硬编码端口**：随机端口回退是常态（默认端口被其他实例占用时）。
- 写命令先查 `devtools.hello.activeEditor`；不想触发自动开窗就带
  `autoOpen:false`，自己先 `project.open`。
- 长任务给足超时；`EDITOR_TIMEOUT` 后先用 `editor.state`/`project.list` 确认结果，
  不要盲目重发写命令。
- `TOOL_DISABLED`：到首页「开发者服务 → 工具权限」开启，重试无效。
- 同一项目已开编辑器时 `project.open` 只聚焦不新建（返回 `window` 为承载窗口）。

## 测试例

- 离线：`pnpm devtools:selftest`（分帧/事件过滤/错误归一/端口发现）；
- 端到端：应用启动后
  `pnpm devtools info`、`pnpm devtools catalog`；
  无编辑器时 `pnpm devtools call node.add '{"kind":"mesh"}' --project <目录>`
  应自动开窗成功。
