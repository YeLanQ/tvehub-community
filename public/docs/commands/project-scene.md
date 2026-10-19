# 项目与场景

本页覆盖项目生命周期与场景文件的读取/保存/直写。节点的增删改、组件与撤销见 [节点、组件与状态](node-state.md)；预览与构建产物见 [资产、材质与预览](asset-preview.md)。

## 方法一览

| 方法 | 路由 | 权限工具 | 作用 |
| --- | --- | --- | --- |
| `project.list` | local | `projectQuery` | 最近项目列表（与首页项目管理页同源） |
| `project.create` | local | `projectCreate` | 按内置模板创建项目目录 |
| `project.open` | local / editor | `projectOpen` | 打开项目；已有编辑器时切换工作区，否则新开编辑器窗口 |
| `project.close` | editor | `projectOpen` | 关闭项目回首页（不会为了关闭而自动开窗） |
| `project.build` | editor | `projectBuild` | 构建导出（与构建面板同链路） |
| `scene.list` | local | `scene` | 列出项目的 `.scene` 资产 |
| `scene.open` | editor | `scene` | 打开/重载场景 |
| `scene.save` | editor | `scene` | 保存当前场景（写链静默后返回） |
| `scene.tree` | editor | `scene` | 读取当前场景完整文档（后端直答） |
| `scene.write` | local | `assetWrite` | 直写 `.scene` 文件（按场景文档校验） |

## 项目

### 列出最近项目

```json
{"id": 1, "method": "project.list"}
```

```json
{"id": 1, "result": {"recent": [{"path": "/home/me/demo", "name": "demo", "sceneCount": 2}]}, "error": null}
```

返回的是「最近打开」列表，已不存在的目录会被后端滤掉。数据与首页项目管理页一致。

### 新建项目

```json
{"id": 2, "method": "project.create", "params": {"name": "MyScene", "parent": "/home/me/Projects"}}
```

- `name` 同时作为目录名；`parent` 省略时使用首页偏好里的默认项目位置；
- 创建成功返回项目信息，并登记到最近项目；
- 模板内容来自应用内置模板（`public/templates`）。

### 打开项目

```json
{"id": 3, "method": "project.open", "params": {"path": "/home/me/Projects/MyScene"}}
```

- 已有活跃编辑器窗口：在当前窗口切换工作区；
- 没有活跃编辑器：自动新开一个编辑器窗口并交付项目（等同首页「打开项目」）；
- 打开会加载默认场景并等待场景就绪，首次调用可能稍慢。

### 关闭项目

```json
{"id": 4, "method": "project.close"}
```

关闭当前项目并回首页。有未保存修改时会走与界面一致的确认流程；自动化场景请先 `scene.save`。

### 构建导出

```json
{"id": 5, "method": "project.build", "params": {"singlePage": true, "outDir": "build/preview-check"}}
```

常用参数：

| 参数 | 说明 |
| --- | --- |
| `scenes` | 场景 rel 数组或逗号分隔字符串；缺省用构建配置 |
| `mainScene` | 主场景 rel |
| `title` | 产物标题 |
| `debug` | 调试构建 |
| `singlePage` | 单页产物（默认 false = 多页） |
| `gzip` / `gzipBase` | gzip 归档与远程基址 |
| `release` | 发布模式 |
| `cdn` / `cdnBase` | CDN 模式与基址 |
| `outDir` | 输出目录（项目相对；缺省 `build/web`） |
| `template` | 导出模板 id |

构建是重命令：会等待产物写完再返回；重复调用会重复构建，不做幂等去重。

## 场景

### 列出场景

```json
{"id": 6, "method": "scene.list", "params": {"root": "/home/me/Projects/MyScene"}}
```

`root` 省略时使用当前编辑器项目；返回项目内 `.scene` 资产列表。

### 打开与重载

```json
{"id": 7, "method": "scene.open", "params": {"rel": "assets/Main.scene"}}
{"id": 8, "method": "scene.open", "params": {"rel": "assets/Main.scene", "discard": true}}
```

- 默认会保护未保存修改；
- `discard: true` 放弃未保存修改、以磁盘版本强制重装；
- 打开完成后编辑器才进入可执行状态；冷启动阶段命令会等待 `sceneReady`（上限 15 秒）。

### 保存

```json
{"id": 9, "method": "scene.save"}
```

- 保存目标固定为**当前打开场景**；`rel` / `path` 参数仅为旧脚本兼容保留，会被忽略；
- 返回 `{ok, flushed: true, dirty: false, revision}`；
- 返回时写盘已完成，紧跟 `scene.tree` 看到的就是磁盘内容。

### 读取完整文档

```json
{"id": 10, "method": "scene.tree"}
```

返回场景信封（`type/metadata/settings/root`）的完整 JSON。`state.snapshot` 是同一份数据的另一种入口，见 [节点、组件与状态](node-state.md)。

### 直写场景文件

```json
{"id": 11, "method": "scene.write", "params": {
  "rel": "assets/Main.scene",
  "content": {"type": "scene", "metadata": {}, "settings": {}, "root": {}}
}}
```

- `content` 可直接传 `scene.tree` 返回的对象，也可传 JSON 文本；
- 后端按场景文档 schema 校验，非法结构拒绝写入；
- 这是**文件级**写入，不经过编辑器撤销栈；需要可撤销的编辑请用节点/组件/设置方法。

## 常见问题

- **`SCENE_NOT_READY`**：冷启动项目装载超过 15 秒或编辑器已销毁。稍后重试；大项目可先 `editor.health` 确认编辑器存在。
- **`NO_ACTIVE_EDITOR`**：该命令需要编辑器，但没有活跃窗口。多数命令会自动开窗；`project.close` / `preview.close` / `preview.stop` 例外。
- **保存后又读到旧内容**：确认调用的是 `scene.save` 而不是直接写文件；`scene.save` 返回时写链已静默。
