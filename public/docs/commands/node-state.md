# 节点、组件与状态

本页覆盖场景内的编辑操作：节点增删改、组件挂载、状态快照、撤销重做与场景设置。项目的打开/保存见 [项目与场景](project-scene.md)。

## 方法一览

| 方法 | 权限工具 | 作用 |
| --- | --- | --- |
| `editor.state` | `editor` | 项目/场景/选中/视图/后端/撤销栈 |
| `node.select` | `node` | 选中节点（空串取消选中） |
| `node.add` | `nodeAdd` | 新增节点（含创建期属性补丁） |
| `node.remove` | `nodeDelete` | 删除节点/子树（根节点不可删） |
| `node.rename` | `nodeSet` | 重命名 |
| `node.set` | `nodeSet` | 设置节点属性（单属性或字段包） |
| `node.component.add` | `nodeSet` | 挂载脚本/内置组件 |
| `node.component.set` | `nodeSet` | 设置组件属性 |
| `state.snapshot` | `state` | 读取完整场景快照 |
| `state.restore` | `state` | 用快照恢复场景 |
| `history.undo` / `history.redo` | `state` | 撤销/重做（含材质与设置） |
| `scene.settings.get` / `scene.settings.patch` | `scene` | 读取/深合并场景设置 |

## 先看状态

```json
{"id": 1, "method": "editor.state"}
```

返回当前项目、场景、选中节点、视图模式、渲染后端与撤销栈摘要。自动化脚本建议先读它拿节点 id，不要猜 id。

## 节点

### 新增

```json
{"id": 2, "method": "node.add", "params": {
  "kind": "mesh",
  "subtype": "box",
  "name": "Box",
  "parentId": "root",
  "position": {"x": 0, "y": 1, "z": 0},
  "size": {"x": 1, "y": 1, "z": 1},
  "material": "assets/Materials/Red.mat",
  "props": {"visible": true, "tag": "cover"}
}}
```

`kind` 常用值：

| kind | 说明 |
| --- | --- |
| `group` | 空组/容器 |
| `mesh` | 网格（`subtype` 为几何/模型/数据/程序化） |
| `light` | 灯光（`subtype` 为 point/directional/spot/ambient，太阳光版本为 sun） |
| `camera` | 相机 |
| `skybox` | 天空盒（`subtype`：procedural / cube；`cubemap` 是 `cube` 别名） |
| `fog` | 雾（`subtype`：linear / exp2 / height；`exponential` 是 `exp2` 别名） |
| `audio` / `particle` / `terrain` / `nav` / `logic` / `ui` / `script` / `model` / `sprite` / `splat` | 对应节点类型 |

要点：

- **枚举值会校验**：拼错会报错并列出可选项；别名在读取时同样归一，旧脚本不受影响。
- **材质**：顶层 `material` 与 `props.material` 等价，`props` 优先。材质注册表未就绪时返回 `MATERIAL_NOT_READY` 且**不会创建节点**；先 `asset.refresh {path}` 再重试一次。节点创建后若回读材质不一致，返回 `MATERIAL_NOT_APPLIED`。
- **创建期补丁**：`position/size/material/props` 与新增合成一条命令，`node.added` 事件里的快照就是最终态，撤销一次回到创建前。
- **返回**：`{ok, id, name, type, applied}`；`applied` 只列核验生效的字段。

### 修改

单属性写法：

```json
{"id": 3, "method": "node.set", "params": {"id": "node_1", "prop": "visible", "value": false}}
```

字段包写法（推荐，一次提交、一次撤销）：

```json
{"id": 4, "method": "node.set", "params": {
  "id": "node_1",
  "tag": "cover",
  "transform": {"position": {"y": 2}, "scale": {"x": 2, "y": 2, "z": 2}}
}}
```

- `transform` 是**部分合并**：只改传入的分量；
- 值按节点类型归一（枚举、颜色、向量等），未知属性/非法值报错并回传可写清单；
- `lightKind` 是派生只读字段，不能通过 `node.set` 改。

### 删除与重命名

```json
{"id": 5, "method": "node.remove", "params": {"id": "node_1"}}
{"id": 5, "method": "node.remove", "params": {"ids": ["node_1", "node_2"]}}
{"id": 6, "method": "node.rename", "params": {"id": "node_1", "name": "Cover"}}
```

`node.remove` 支持单 id 或 `ids` 数组，删除节点及其子树；根节点不可删。`node.rename` 空名称按类型给占位名。

## 组件

### 挂载

```json
{"id": 7, "method": "node.component.add", "params": {"id": "node_1", "script": "src/Player.ts"}}
{"id": 8, "method": "node.component.add", "params": {"id": "node_1", "type": "rigidBody"}}
```

- `type` 省略 = 脚本组件，此时用 `script`（`.ts` 相对路径，`rel`/`path` 同义）；
- 内置组件：`rigidBody` / `collider` / `light` / `audioSource` / `animationClip`；`type=light` 可用 `lightKind` 指定灯光分支；
- 挂载一次进一次撤销。

### 设置属性

```json
{"id": 9, "method": "node.component.set", "params": {
  "id": "node_1",
  "type": "rigidBody",
  "props": {"mass": 2}
}}
```

- `type` 与 `compId` 用于定位组件（同类型多实例时必须用 `compId`）；
- 脚本组件的 `props` 按 `@property` 声明合并；
- `enabled` 可单独开关组件。

## 状态与历史

### 快照

```json
{"id": 10, "method": "state.snapshot"}
```

返回完整场景文档，与 `scene.tree` 同源（后端直答），适合保存检查点或对比。

### 恢复

```json
{"id": 11, "method": "state.restore", "params": {"doc": { "type": "scene", "metadata": {}, "settings": {}, "root": {} }}}
```

用快照恢复场景；`doc` 必须是 `state.snapshot`/`scene.tree` 返回的完整文档。

### 撤销/重做

```json
{"id": 12, "method": "history.undo"}
{"id": 13, "method": "history.redo"}
```

返回历史状态（是否还能继续撤销/重做、标签等）。材质写入与场景设置补丁也进入撤销栈，因此不要假设只有节点操作可撤销。

## 场景设置

```json
{"id": 14, "method": "scene.settings.get"}
{"id": 15, "method": "scene.settings.patch", "params": {"patch": {
  "rendering": {"backgroundColor": "#112233", "ambientIntensity": 0.4}
}}}
```

- 当前补丁**只支持 `rendering` 块**（`backgroundColor` / `ambientIntensity` / `ambientColor`）；未知块/字段/非法类型会报错；
- `intensity` 取值 0..1，越界会收敛并在响应的 `clamped` 中列出；
- 补丁进入撤销栈；与构建配置相关的设置改动后，产物行为可能随之变化。

## 顺序与失败处理

- 写命令返回时写链已静默：`node.add` 成功后可立即 `scene.tree` 读取最终态；
- 材质相关失败按 [项目与场景](project-scene.md) 的重试套路：`MATERIAL_NOT_READY` → `asset.refresh` → 重试一次；
- 不要重发写命令当作重试：`node.add` 重发会创建两个节点，`node.remove` 重发会报不存在。先读状态，再决定。
