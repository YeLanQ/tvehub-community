# 资产、材质与预览

本页覆盖项目资产（文本/场景/脚本/材质/着色器/预制体等）、材质参数写入与预览/截图。构建导出见 [项目与场景](project-scene.md) 的 `project.build`。

## 方法一览

| 方法 | 权限工具 | 作用 |
| --- | --- | --- |
| `asset.list` | `assetList` | 列出项目资产 |
| `asset.read` | `assetRead` | 读取文本资产（支持按行分页） |
| `asset.write` | `assetWrite` | 写入文本资产（格式锁 + 体积上限） |
| `asset.create` | `assetCreate` | 新建资产/目录 |
| `asset.select` | `assetSelect` | 在资产面板选中 |
| `asset.delete` / `asset.rename` | `assetDelete` / `assetRename` | 删除/重命名 |
| `asset.refresh` | `assetList` | 重读磁盘并失效引擎缓存 |
| `material.get` / `material.set` | `assetRead` / `assetWrite` | 读写 `.mat` |
| `shader.write` | `assetWrite` | 直写 `.shader`（引擎解析器校验） |
| `preview.open` / `preview.start` | `previewOpen` / `previewStart` | 导出并启动预览 |
| `preview.close` / `preview.stop` | `previewClose` / `previewStop` | 关闭/停止预览 |
| `preview.status` | — | 预览状态 |
| `preview.screenshot` | `screenScreenshot` | 截取编辑器视口（base64 PNG） |

## 资产

### 列表与读取

```json
{"id": 1, "method": "asset.list", "params": {"root": "/home/me/Projects/MyScene"}}
{"id": 2, "method": "asset.read", "params": {"path": "assets/Main.scene"}}
{"id": 3, "method": "asset.read", "params": {"path": "src/Player.ts", "startLine": 1, "endLine": 80}}
```

- `asset.list` 的 `root` 省略时使用当前编辑器项目；
- `asset.read` 是**文本读取**，二进制资产走编辑器内部链路，不在此方法内；
- 大文件用 `startLine` / `endLine` 分页，避免一次拉全量。

### 写入

```json
{"id": 4, "method": "asset.write", "params": {
  "path": "src/Player.ts",
  "content": "export default class Player {}"
}}
```

- 只接受文本资产；有格式锁（例如 `.scene`、`.shader` 有各自的 schema 校验）；
- 体积上限 512KB（文本）；大资产请拆分或使用专用方法；
- `internal/` 内置资源只读，不能通过指令集写入。

### 新建/选择/删除/重命名

```json
{"id": 5, "method": "asset.create", "params": {"type": "material", "path": "assets/Materials/Red.mat"}}
{"id": 6, "method": "asset.select", "params": {"path": "assets/Materials/Red.mat"}}
{"id": 7, "method": "asset.rename", "params": {"path": "assets/Materials/Red.mat", "newName": "WallRed.mat"}}
{"id": 8, "method": "asset.delete", "params": {"path": "assets/Materials/Red.mat"}}
```

- `asset.create` 的 `type`：`scene/script/material/shader/texcube/skybox/prefab/anim/terrain/folder`；可用 `dir + name` 或完整 `path`（扩展名须与类型匹配）；
- `asset.rename` 的字段是 `newName`（不是 `name`/`to`）；无扩展名时沿用原扩展名；
- `asset.delete` 返回 `deleted` 与 `referencedBy`（仍引用该资产的场景节点数）。**删除前先看 `referencedBy`**，避免留下断引用。

### 刷新

```json
{"id": 9, "method": "asset.refresh", "params": {"path": "assets/Materials/Red.mat"}}
{"id": 10, "method": "asset.refresh", "params": {"path": ["assets/Materials/Red.mat", "assets/Textures/a.png"]}}
```

- `path` 可传单个路径或数组；省略时刷新全部已加载引用；
- `.scene` 不走这里（场景由 `scene.changed` / 保存链路处理）；
- 外部直接改文件后，先 `asset.refresh` 再做依赖该资产的写操作。

## 材质

### 读取

```json
{"id": 11, "method": "material.get", "params": {"path": "assets/Materials/Red.mat"}}
```

返回材质名、类型、挂载的着色器与参数表，用于回读核验或生成差异。

### 写入

```json
{"id": 12, "method": "material.set", "params": {
  "path": "assets/Materials/Red.mat",
  "props": {"color": "#ff3300", "roughness": 0.4}
}}
```

- `props` 是材质字段包：PBR 参数（`color`/`metalness`/`roughness`/`emissive` 等）与 `props.props` 下的着色器参数；
- 可选 `shader` 切换挂载的 `.shader`，`name` 改显示名；
- 返回 `applied`（实际生效的字段）、`clamped`（越界被收敛的字段）、`undoable`（是否进撤销栈）；
- `material.set` 是 `.mat` 的唯一写入口；不要用 `asset.write` 拼 JSON 直写材质。

## 着色器

```json
{"id": 13, "method": "shader.write", "params": {
  "path": "assets/Effects/Water.shader",
  "content": "…完整着色器源码…"
}}
```

写入前由引擎解析器校验，语法/结构非法会拒绝。着色器与材质分离：材质引用 `.shader`，参数通过 `material.set` 的 `props.props` 写入。

## 预览与截图

```json
{"id": 14, "method": "preview.open"}
{"id": 15, "method": "preview.status"}
{"id": 16, "method": "preview.screenshot", "params": {"source": "editor"}}
{"id": 17, "method": "preview.close"}
```

- `preview.open` / `preview.start` 会导出产物并启动本地预览服务器；
- `preview.status` 返回 `{running, ready, url, port, dir}`，其中 `ready` 是真实 TCP 探测，不只是进程状态；
- `preview.screenshot` 当前只支持 `source: "editor"`（预览帧跨域，暂不可截取）；返回 base64 PNG，`blank` 标记纯色帧（用于判断是否渲染完成）；
- `preview.close` / `preview.stop` 不会为了关闭而自动打开编辑器窗口。

## 常见问题

- **`asset.write` 被拒**：先确认扩展名是否在格式锁范围内、内容是否符合 schema、文件是否在 `internal/` 下；
- **材质写入后画面没变**：`material.set` 返回 `applied` 里没有目标字段，通常是字段名不在该材质类型（检查 `material.get` 的参数表）；
- **外部改文件后编辑器仍显示旧内容**：`asset.refresh` 指定该路径，或等待文件监听的 `asset.changed` 事件。
