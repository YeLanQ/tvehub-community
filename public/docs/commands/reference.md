# 方法速查（50 条）

当前方法集：**50 条**（本地 18 / 编辑器 32）。本页是速查表；参数细节与示例见各专题页，**运行时以 `devtools.catalog {verbose:true}` 为准**（方法集热更新时这里可能滞后）。

路由说明：

- **local**：Rust 直接应答，不依赖编辑器窗口；
- **editor**：需要活跃编辑器窗口；没有时多数方法会自动开窗（`project.close` / `preview.close` / `preview.stop` 除外）；
- **local / editor**：有本地兜底，兜底不命中时转发编辑器。

## 协议与本地（9）

| 方法 | 路由 | 权限 | 参数 | 返回 / 备注 |
| --- | --- | --- | --- | --- |
| `devtools.hello` | local | — | 无 | 身份、端口、活跃编辑器、当前项目 |
| `devtools.tools` | local | — | 无 | 工具权限清单 |
| `devtools.catalog` | local | — | `verbose?` | 方法表；`verbose:true` 带 schema 与示例 |
| `devtools.subscribe` | local | — | `events` | 事件推送开关 |
| `ping` | local | — | 无 | `"pong"` |
| `editor.health` | local | — | 无 | `{ok, port, protocol}` |
| `file.index` | local | — | `path`、`root?` | 文件模块索引 |
| `file.search` | local | — | `path`、`query`、`topK?`、`root?` | 文件内检索 |
| `file.module` | local | — | `path`、`title?`/`no?`、`root?` | 模块片段 |

## 项目与场景（10）

| 方法 | 路由 | 权限 | 参数 | 返回 / 备注 |
| --- | --- | --- | --- | --- |
| `project.list` | local | `projectQuery` | 无 | `{recent:[{path,name,sceneCount}]}` |
| `project.create` | local | `projectCreate` | `name`、`parent?` | 创建项目并登记最近 |
| `project.open` | local / editor | `projectOpen` | `path` | 切换工作区；无编辑器时新开窗口 |
| `project.close` | editor | `projectOpen` | 无 | 关闭项目回首页（不自动开窗） |
| `project.build` | editor | `projectBuild` | 构建参数，见 [项目与场景](project-scene.md) | 构建导出 |
| `scene.list` | local | `scene` | `root?` | 项目内 `.scene` 列表 |
| `scene.open` | editor | `scene` | `rel`、`discard?` | 打开/强制重载场景 |
| `scene.save` | editor | `scene` | 无（`rel`/`path` 已弃用） | `{ok,flushed:true,dirty:false,revision}` |
| `scene.tree` | editor | `scene` | 无 | 完整场景文档（后端直答） |
| `scene.write` | local | `assetWrite` | `rel`/`path`、`content`、`root?` | 按场景 schema 直写文件 |

## 节点、组件与状态（14）

| 方法 | 路由 | 权限 | 参数 | 返回 / 备注 |
| --- | --- | --- | --- | --- |
| `editor.state` | editor | `editor` | 无 | 项目/场景/选中/视图/dirty |
| `node.select` | editor | `node` | `id?` | 空串/省略 = 取消选中 |
| `node.add` | editor | `nodeAdd` | `kind`、`subtype?`、`parentId?`、`name?`、`position/rotation/scale/size`、`material?`、`props?`、`rel?` | `{ok,id,name,type,applied}`；创建期补丁单条撤销 |
| `node.remove` | editor | `nodeDelete` | `id` 或 `ids` | 删除子树；根不可删 |
| `node.rename` | editor | `nodeSet` | `id`、`name` | 空名按类型占位 |
| `node.set` | editor | `nodeSet` | `id`、`prop`+`value` 或字段包（含 `transform`） | 值归一；未知属性报错 |
| `node.component.add` | editor | `nodeSet` | `id`、`script` 或 `type`、`lightKind?` | 挂脚本/内置组件 |
| `node.component.set` | editor | `nodeSet` | `id`、`type`/`compId`、`props`、`enabled` | 组件属性 |
| `state.snapshot` | editor | `state` | 无 | 完整场景快照 |
| `state.restore` | editor | `state` | `doc` | 用快照恢复 |
| `history.undo` | editor | `state` | 无 | 撤销并返回历史状态 |
| `history.redo` | editor | `state` | 无 | 重做并返回历史状态 |
| `scene.settings.get` | editor | `scene` | 无 | 场景 settings |
| `scene.settings.patch` | editor | `scene` | `patch` | 仅 `rendering` 块；越界 `clamped`；入撤销栈 |

## 资产、材质与预览（17）

| 方法 | 路由 | 权限 | 参数 | 返回 / 备注 |
| --- | --- | --- | --- | --- |
| `asset.list` | local | `assetList` | `root?` | 资产列表 |
| `asset.read` | local | `assetRead` | `path`、`root?`、`startLine?`、`endLine?` | 文本读取/分页 |
| `asset.write` | local | `assetWrite` | `path`、`content`、`root?` | 文本写入；格式锁 + 512KB |
| `asset.create` | editor | `assetCreate` | `type`、`dir`+`name` 或 `path`、`shaderKind?`、`skyKind?` | 新建资产/目录 |
| `asset.select` | editor | `assetSelect` | `path` | 资产面板选中 |
| `asset.delete` | editor | `assetDelete` | `path` | 返回 `deleted` / `referencedBy` |
| `asset.rename` | editor | `assetRename` | `path`、`newName` | 无扩展名沿用原扩展名 |
| `asset.refresh` | editor | `assetList` | `path?`（字符串/数组） | 重读磁盘并失效缓存；不含 `.scene` |
| `material.get` | editor | `assetRead` | `path` | 材质名/类型/着色器/参数 |
| `material.set` | editor | `assetWrite` | `path`、`props`、`shader?`、`name?` | `applied`/`clamped`/`undoable` |
| `shader.write` | local | `assetWrite` | `path`/`rel`、`content`、`root?` | 引擎解析器校验 |
| `preview.open` | editor | `previewOpen` | 无 | 导出并打开预览 |
| `preview.close` | editor | `previewClose` | 无 | 关闭预览（不自动开窗） |
| `preview.start` | editor | `previewStart` | 无 | 导出并启动预览服务器 |
| `preview.stop` | editor | `previewStop` | 无 | 停止预览（不自动开窗） |
| `preview.status` | editor | — | 无 | `{running,ready,url,port,dir}` |
| `preview.screenshot` | editor | `screenScreenshot` | `source:"editor"` | base64 PNG；`blank` 标记纯色帧 |

## 方法名与命令 id

方法名是对外稳定契约；命令 id 是前端内部实现，两者不保证同名（如 `project.list` 对应内部 `project.recentList`）。**客户端只使用方法名**，不要依赖命令 id。

## 新增/变更时

语言服务不提供静态签名文件；请以 `devtools.catalog {verbose:true}` 为运行时事实源。能力版本变化看 `capabilitiesRevision` 与 `capabilitiesNotes`；本页随方法集更新时同步维护。
